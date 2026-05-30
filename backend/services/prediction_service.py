"""
Rico Net — Prediction Service
================================
Nightly risk scoring for every active ONU.
Algorithms (rule-based, no ML required):
  1. Fiber degradation slope  — linear regression on onu_daily avg_rx (7 days)
  2. Chronic fault score      — alarm count in last 30 days
  3. Churn risk               — customer account health (expiry, balance, status)
  4. Health score             — composite 0–100

Run nightly by workers/prediction_runner.py (2 AM).
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

import models
from services.noc_service import _customer_name, _load_customer_index, _fuzzy_find_customer

logger = logging.getLogger("rico_net.prediction_service")


# ---------------------------------------------------------------------------
# FIBRE RISK THRESHOLDS
# ---------------------------------------------------------------------------
FIBER_RISK_LEVELS = {
    # slope_7d (dBm/day)  — negative = degrading
    "CRITICAL": -0.5,   # losing 0.5 dBm/day or more
    "HIGH":     -0.2,
    "MEDIUM":   -0.05,
}

# Rx absolute thresholds (regardless of slope)
RX_CRITICAL_DBM = -27.0
RX_WEAK_DBM     = -24.0


def _linear_slope(points: List[Tuple[float, float]]) -> Optional[float]:
    """Simple least-squares slope. points = [(x, y), ...]. Returns dy/dx or None."""
    n = len(points)
    if n < 2:
        return None
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points)
    denom = n * sxx - sx * sx
    if abs(denom) < 1e-9:
        return None
    return (n * sxy - sx * sy) / denom


def _compute_fiber_risk(rx_avg: Optional[float], slope: Optional[float]) -> str:
    if rx_avg is not None and rx_avg < RX_CRITICAL_DBM:
        return "CRITICAL"
    if slope is not None:
        for level, threshold in FIBER_RISK_LEVELS.items():
            if slope <= threshold:
                return level
    if rx_avg is not None and rx_avg < RX_WEAK_DBM:
        return "MEDIUM"
    return "LOW"


def _compute_churn_risk(expiry: Optional[Any], balance: Optional[float],
                        status: Optional[str]) -> str:
    score = 0
    now = datetime.now(timezone.utc)
    if status and status.lower() not in ("active", "online"):
        score += 3
    if expiry:
        try:
            exp = expiry if hasattr(expiry, 'tzinfo') else datetime.fromisoformat(str(expiry))
            if not exp.tzinfo:
                exp = exp.replace(tzinfo=timezone.utc)
            days_left = (exp - now).days
            if days_left < 0:
                score += 4
            elif days_left < 7:
                score += 2
            elif days_left < 30:
                score += 1
        except Exception:
            pass
    if balance is not None:
        if balance < 0:
            score += 3
        elif balance < 50:
            score += 1
    if score >= 5:
        return "HIGH"
    if score >= 2:
        return "MEDIUM"
    return "LOW"


def _compute_health_score(rx_avg: Optional[float], slope: Optional[float],
                          alarm_count: int, offline_count: int,
                          churn_risk: str) -> int:
    score = 100
    # Signal deductions
    if rx_avg is not None:
        if rx_avg < RX_CRITICAL_DBM:
            score -= 30
        elif rx_avg < RX_WEAK_DBM:
            score -= 15
    # Slope deductions
    if slope is not None and slope < -0.2:
        score -= 20
    elif slope is not None and slope < -0.05:
        score -= 10
    # Fault deductions
    score -= min(alarm_count * 2, 20)
    score -= min(offline_count * 3, 15)
    # Churn deductions
    if churn_risk == "HIGH":
        score -= 10
    elif churn_risk == "MEDIUM":
        score -= 5
    return max(0, min(100, score))


def _recommended_action(fiber_risk: str, churn_risk: str,
                        rx_avg: Optional[float], alarm_count: int) -> str:
    if fiber_risk == "CRITICAL":
        return "DISPATCH NOW — fiber critical, OTDR test required"
    if fiber_risk == "HIGH":
        return "Schedule fiber check within 48h"
    if alarm_count >= 10:
        return "Investigate chronic faults — check splice/connector"
    if churn_risk == "HIGH":
        return "Call customer — account at risk of churning"
    if fiber_risk == "MEDIUM":
        return "Monitor signal — schedule maintenance if worsens"
    if churn_risk == "MEDIUM":
        return "Proactive renewal reminder recommended"
    return "No action needed"


# ---------------------------------------------------------------------------
# MAIN ENTRY POINT
# ---------------------------------------------------------------------------

def run_predictions(db: Session) -> Dict[str, Any]:
    """
    Compute predictions for all ONUs in onu_latest.
    Upserts into the predictions table.
    Returns summary dict.
    """
    now = datetime.now(timezone.utc)
    cutoff_30d = now - timedelta(days=30)
    cutoff_7d  = now - timedelta(days=7)

    logger.info("prediction_service: starting prediction run at %s", now.isoformat())

    # --- 1. Load all ONUs ---
    onus = db.execute(text("""
        SELECT o.mac_address, o.olt_host, o.pon_port, o.rx_power_dbm
        FROM onu_latest o
        ORDER BY o.olt_host, o.pon_port, o.mac_address
    """)).fetchall()

    # Load customer index for fuzzy MAC+offset matching (PPPoE MAC = ONU MAC + offset)
    cust_index = _load_customer_index(db)

    # --- 2. Load 7-day daily averages for all MACs ---
    daily_rows = db.execute(text("""
        SELECT mac_address, day, avg_rx
        FROM onu_daily
        WHERE day >= :cutoff AND avg_rx IS NOT NULL
        ORDER BY mac_address, day
    """), {"cutoff": cutoff_7d.date()}).fetchall()

    daily_by_mac: Dict[str, List[Tuple[float, float]]] = {}
    for row in daily_rows:
        mac = row[0]
        day_num = (row[1] - cutoff_7d.date()).days
        avg_rx = row[2]
        if mac not in daily_by_mac:
            daily_by_mac[mac] = []
        daily_by_mac[mac].append((float(day_num), float(avg_rx)))

    # --- 3. Load 30-day alarm counts ---
    alarm_rows = db.execute(text("""
        SELECT mac_address,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE event_type = 'ONU_OFFLINE') AS offline_count
        FROM alarm_events
        WHERE received_at >= :cutoff
        GROUP BY mac_address
    """), {"cutoff": cutoff_30d}).fetchall()

    alarm_by_mac: Dict[str, Dict] = {
        row[0]: {"total": row[1], "offline": row[2]}
        for row in alarm_rows
    }

    # --- 4. Compute + upsert predictions ---
    computed = 0
    for row in onus:
        mac, olt_host, pon_port, rx_current = row[0], row[1], row[2], row[3]

        # Fuzzy customer lookup: ONU MAC + offset = customer PPPoE MAC
        c = _fuzzy_find_customer(cust_index, mac)
        name = _customer_name(c)
        phone = c.phone if c else None
        expiry = c.expiry_date if c else None
        balance = c.balance if c else None
        cust_status = c.status if c else None

        # Signal slope
        daily_points = daily_by_mac.get(mac, [])
        slope = _linear_slope(daily_points)
        rx_avg_7d = (sum(p[1] for p in daily_points) / len(daily_points)) if daily_points else rx_current

        # Alarm counts
        alarms = alarm_by_mac.get(mac, {"total": 0, "offline": 0})
        alarm_count = alarms["total"]
        offline_count = alarms["offline"]

        # Risk levels
        fiber_risk = _compute_fiber_risk(rx_avg_7d, slope)
        churn_risk = _compute_churn_risk(expiry, balance, cust_status)
        health_score = _compute_health_score(rx_avg_7d, slope, alarm_count, offline_count, churn_risk)
        action = _recommended_action(fiber_risk, churn_risk, rx_avg_7d, alarm_count)

        db.execute(text("""
            INSERT INTO predictions (mac_address, olt_host, pon_port,
                rx_slope_7d, rx_avg_7d, alarm_count_30d, offline_count_30d,
                fiber_risk, churn_risk, health_score, recommended_action,
                customer_name, customer_phone, last_computed)
            VALUES (:mac, :olt_host, :pon_port,
                :slope, :rx_avg, :alarm_count, :offline_count,
                :fiber_risk, :churn_risk, :health_score, :action,
                :name, :phone, :now)
            ON CONFLICT (mac_address) DO UPDATE SET
                olt_host = EXCLUDED.olt_host,
                pon_port = EXCLUDED.pon_port,
                rx_slope_7d = EXCLUDED.rx_slope_7d,
                rx_avg_7d = EXCLUDED.rx_avg_7d,
                alarm_count_30d = EXCLUDED.alarm_count_30d,
                offline_count_30d = EXCLUDED.offline_count_30d,
                fiber_risk = EXCLUDED.fiber_risk,
                churn_risk = EXCLUDED.churn_risk,
                health_score = EXCLUDED.health_score,
                recommended_action = EXCLUDED.recommended_action,
                customer_name = EXCLUDED.customer_name,
                customer_phone = EXCLUDED.customer_phone,
                last_computed = EXCLUDED.last_computed
        """), {
            "mac": mac, "olt_host": olt_host, "pon_port": pon_port,
            "slope": slope, "rx_avg": rx_avg_7d,
            "alarm_count": alarm_count, "offline_count": offline_count,
            "fiber_risk": fiber_risk, "churn_risk": churn_risk,
            "health_score": health_score, "action": action,
            "name": name, "phone": phone, "now": now,
        })
        computed += 1

    db.commit()
    logger.info("prediction_service: computed %d predictions", computed)
    return {"computed": computed, "ran_at": now.isoformat()}


def get_predictions(db: Session, limit: int = 100,
                    min_risk: Optional[str] = None) -> List[Dict]:
    """Return predictions sorted by health_score ascending (worst first)."""
    rows = db.execute(text("""
        SELECT mac_address, olt_host, pon_port,
               rx_slope_7d, rx_avg_7d, alarm_count_30d, offline_count_30d,
               fiber_risk, churn_risk, health_score, recommended_action,
               customer_name, customer_phone, last_computed
        FROM predictions
        ORDER BY health_score ASC
        LIMIT :limit
    """), {"limit": limit}).fetchall()

    return [
        {
            "mac_address": r[0], "olt_host": r[1], "pon_port": r[2],
            "rx_slope_7d": r[3], "rx_avg_7d": r[4],
            "alarm_count_30d": r[5], "offline_count_30d": r[6],
            "fiber_risk": r[7], "churn_risk": r[8],
            "health_score": r[9], "recommended_action": r[10],
            "customer_name": r[11], "customer_phone": r[12],
            "last_computed": r[13].isoformat() if r[13] else None,
        }
        for r in rows
    ]
