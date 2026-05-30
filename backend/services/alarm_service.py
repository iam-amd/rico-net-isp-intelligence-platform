"""
Rico Net — Alarm Lifecycle Service
====================================
Manages the full alarm lifecycle: open → (dedup increment) → resolved.
Handles PON port outage correlation and geographic area outage detection.

All functions are pure DB logic — no FastAPI imports, no HTTP context.
Called from ingest_service and diagnosis_service.
"""

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("rico_net.alarm_service")

# ─── Thresholds ──────────────────────────────────────────────────────────────

# Min ONUs offline on same PON port within window to declare PON port outage
PON_OUTAGE_MIN_ONUS = 3
PON_OUTAGE_WINDOW_SECONDS = 60

# Min ONUs offline within GPS radius to declare area outage
AREA_OUTAGE_MIN_ONUS = 3
AREA_OUTAGE_WINDOW_SECONDS = 120
AREA_OUTAGE_RADIUS_M = 600      # 600 metres — covers one street cluster

# Event types that use full lifecycle (open → resolved)
LIFECYCLE_TYPES: Set[str] = {
    "ONU_OFFLINE", "ONU_OFFLINE_GPON", "DYING_GASP",
    "FIBER_CRITICAL", "FIBER_WEAK", "FIBER_FLAP", "HIGH_TEMP",
}

# Event types that resolve ONU_OFFLINE/DYING_GASP alarms when received
RECOVERY_TYPES: Set[str] = {"ONU_ONLINE"}

# Alarm types that get auto-resolved when ONU comes back online
RESOLVED_BY_ONLINE: Set[str] = {"ONU_OFFLINE", "ONU_OFFLINE_GPON", "DYING_GASP"}

# Fallback area coordinates by address keyword — approximate 300m accuracy
# (imported from noc_service to avoid duplication)
_AREA_COORDS_FALLBACK: Dict[str, Tuple[float, float]] = {
    "VICTORIA AVENUE":       (12.825, 80.044),
    "VICTORIA APPARTMENT":   (12.825, 80.044),
    "SAI NIVAS":             (12.824, 80.043),
    "NEAR TRS HOSTEL":       (12.827, 80.042),
    "G S T ROAD":            (12.820, 80.044),
    "POTHERI":               (12.820, 80.043),
    "KATTANKULATHUR":        (12.810, 80.044),
    "SRM NAGAR":             (12.823, 80.045),
    "CHROMPET":              (12.952, 80.143),
    "TAMBARAM":              (12.924, 80.129),
    "PERUNGALATHUR":         (12.890, 80.098),
}

# PON port approximate cluster coordinates (fallback when no GPS)
_PORT_COORDS: Dict[str, Tuple[float, float]] = {
    "0/1": (12.832, 80.032), "0/2": (12.830, 80.044),
    "0/3": (12.825, 80.053), "0/4": (12.816, 80.052),
    "0/5": (12.810, 80.043), "0/6": (12.811, 80.033),
    "0/7": (12.817, 80.025), "0/8": (12.824, 80.026),
}


# ─── Core lifecycle functions ─────────────────────────────────────────────────

def find_active_maintenance_window(
    db: Session,
    olt_host: Optional[str],
    pon_port: Optional[str],
    at: datetime,
) -> Optional[models.OLTMaintenanceWindow]:
    """Return the active OLT/PON maintenance window covering this alarm time."""
    if not olt_host:
        return None

    query = db.query(models.OLTMaintenanceWindow).filter(
        models.OLTMaintenanceWindow.is_active.is_(True),
        models.OLTMaintenanceWindow.olt_host == olt_host,
        models.OLTMaintenanceWindow.starts_at <= at,
        models.OLTMaintenanceWindow.ends_at >= at,
    )
    if pon_port:
        query = query.filter(
            (models.OLTMaintenanceWindow.pon_port.is_(None))
            | (models.OLTMaintenanceWindow.pon_port == pon_port)
        )
    else:
        query = query.filter(models.OLTMaintenanceWindow.pon_port.is_(None))
    return query.order_by(models.OLTMaintenanceWindow.pon_port.desc()).first()


def create_maintenance_window(
    db: Session,
    olt_host: str,
    pon_port: Optional[str],
    starts_at: datetime,
    ends_at: datetime,
    reason: Optional[str],
    created_by: Optional[int],
) -> models.OLTMaintenanceWindow:
    """Create a planned maintenance window used by the alarm processor."""
    if ends_at <= starts_at:
        raise ValueError("ends_at must be after starts_at")

    window = models.OLTMaintenanceWindow(
        olt_host=olt_host,
        pon_port=pon_port,
        starts_at=starts_at,
        ends_at=ends_at,
        reason=reason,
        created_by=created_by,
        is_active=True,
    )
    db.add(window)
    db.commit()
    db.refresh(window)
    logger.info(
        "alarm_service: maintenance window id=%d olt=%s pon=%s %s..%s",
        window.id, olt_host, pon_port or "*", starts_at, ends_at,
    )
    return window


def list_maintenance_windows(
    db: Session,
    active_only: bool = True,
    include_expired: bool = False,
) -> List[models.OLTMaintenanceWindow]:
    """List planned maintenance windows for NOC display."""
    query = db.query(models.OLTMaintenanceWindow)
    if active_only:
        query = query.filter(models.OLTMaintenanceWindow.is_active.is_(True))
    if not include_expired:
        query = query.filter(models.OLTMaintenanceWindow.ends_at >= datetime.now(timezone.utc))
    return query.order_by(models.OLTMaintenanceWindow.starts_at.asc()).all()


def cancel_maintenance_window(
    db: Session,
    window_id: int,
    operator_id: Optional[int],
) -> Optional[models.OLTMaintenanceWindow]:
    """Cancel a planned maintenance window without deleting its audit trail."""
    window = db.get(models.OLTMaintenanceWindow, window_id)
    if not window:
        return None
    window.is_active = False
    window.cancelled_at = datetime.now(timezone.utc)
    window.cancelled_by = operator_id
    db.commit()
    db.refresh(window)
    logger.info("alarm_service: maintenance window %d cancelled by %s", window_id, operator_id)
    return window

def open_alarm(
    db: Session,
    mac_address: str,
    event_type: str,
    olt_host: Optional[str],
    pon_port: Optional[str],
    onu_index: Optional[int],
    payload: Optional[dict],
    received_at: datetime,
) -> models.AlarmEvent:
    """
    Open a new alarm or increment an existing open alarm for the same ONU+type.

    If an OPEN alarm already exists:
        → increment occurrence_count, update last_seen, return existing alarm.
    If no open alarm exists:
        → create new alarm with status='open'.

    This is the single entry point for all alarm creation — never call
    db.add(AlarmEvent(...)) directly from ingest code.
    """
    if event_type in LIFECYCLE_TYPES:
        maintenance = find_active_maintenance_window(db, olt_host, pon_port, received_at)
        if maintenance:
            suppressed_payload = dict(payload or {})
            suppressed_payload.update({
                "maintenance_window_id": maintenance.id,
                "maintenance_reason": maintenance.reason,
            })
            alarm = models.AlarmEvent(
                mac_address=mac_address,
                event_type=event_type,
                olt_host=olt_host,
                pon_port=pon_port,
                onu_index=onu_index,
                payload=suppressed_payload,
                received_at=received_at,
                status="suppressed",
                occurrence_count=1,
                last_seen=received_at,
                suppressed_until=maintenance.ends_at,
                resolution_reason="maintenance_window",
                operator_note=maintenance.reason,
            )
            db.add(alarm)
            db.commit()
            db.refresh(alarm)
            logger.info(
                "alarm_service: suppressed %s for %s during maintenance window %d",
                event_type, mac_address, maintenance.id,
            )
            return alarm

        existing = db.execute(
            text("""
                SELECT id FROM alarm_events
                WHERE mac_address = :mac
                  AND event_type  = :etype
                  AND status      = 'open'
                ORDER BY received_at DESC
                LIMIT 1
            """),
            {"mac": mac_address, "etype": event_type},
        ).fetchone()

        if existing:
            db.execute(
                text("""
                    UPDATE alarm_events
                    SET occurrence_count = occurrence_count + 1,
                        last_seen        = :now
                    WHERE id = :id
                """),
                {"id": existing[0], "now": received_at},
            )
            db.commit()
            logger.debug(
                "alarm_service: dedup alarm id=%d %s %s (incremented)",
                existing[0], event_type, mac_address,
            )
            return db.get(models.AlarmEvent, existing[0])

    alarm = models.AlarmEvent(
        mac_address=mac_address,
        event_type=event_type,
        olt_host=olt_host,
        pon_port=pon_port,
        onu_index=onu_index,
        payload=payload,
        received_at=received_at,
        status="open",
        occurrence_count=1,
        last_seen=received_at,
    )
    db.add(alarm)
    db.commit()
    db.refresh(alarm)
    logger.debug(
        "alarm_service: new alarm id=%d %s %s",
        alarm.id, event_type, mac_address,
    )
    return alarm


def resolve_alarms_for_mac(
    db: Session,
    mac_address: str,
    event_types: Set[str],
    resolved_at: datetime,
) -> int:
    """
    Mark all OPEN alarms of the given types for this MAC as resolved.
    Calculates duration_seconds from received_at to resolved_at.
    Returns count of alarms resolved.
    """
    rows = db.execute(
        text("""
            SELECT id, received_at FROM alarm_events
            WHERE mac_address = :mac
              AND event_type  = ANY(:etypes)
              AND status      = 'open'
        """),
        {"mac": mac_address, "etypes": list(event_types)},
    ).fetchall()

    if not rows:
        return 0

    for row in rows:
        duration = None
        if row[1]:
            try:
                duration = int((resolved_at - row[1]).total_seconds())
                duration = max(0, duration)
            except Exception:
                pass
        db.execute(
            text("""
                UPDATE alarm_events
                SET status           = 'resolved',
                    resolved_at      = :rat,
                    duration_seconds = :dur
                WHERE id = :id
            """),
            {"rat": resolved_at, "dur": duration, "id": row[0]},
        )

    db.commit()
    logger.info(
        "alarm_service: resolved %d alarm(s) for %s (types=%s)",
        len(rows), mac_address, event_types,
    )
    return len(rows)


def handle_onu_online(db: Session, mac_address: str, received_at: datetime) -> int:
    """
    Called when ONU_ONLINE event received (trap or snapshot recovery).
    Resolves all open offline/dying_gasp alarms for this MAC.
    Returns count of alarms resolved.
    """
    return resolve_alarms_for_mac(db, mac_address, RESOLVED_BY_ONLINE, received_at)


def acknowledge_alarm(
    db: Session,
    alarm_id: int,
    operator_id: int,
    note: Optional[str] = None,
) -> Optional[models.AlarmEvent]:
    """Record that a NOC operator has seen an alarm without closing it."""
    alarm = db.get(models.AlarmEvent, alarm_id)
    if not alarm:
        return None

    now = datetime.now(timezone.utc)
    alarm.acknowledged_by = operator_id
    alarm.acknowledged_at = now
    if note:
        alarm.operator_note = note
    db.commit()
    db.refresh(alarm)
    logger.info("alarm_service: alarm %d acknowledged by %s", alarm_id, operator_id)
    return alarm


def suppress_alarm(
    db: Session,
    alarm_id: int,
    operator_id: int,
    suppressed_until: datetime,
    reason: Optional[str] = None,
    note: Optional[str] = None,
) -> Optional[models.AlarmEvent]:
    """Suppress an alarm until a specific time, preserving audit fields."""
    alarm = db.get(models.AlarmEvent, alarm_id)
    if not alarm:
        return None

    now = datetime.now(timezone.utc)
    alarm.status = "suppressed"
    alarm.acknowledged_by = operator_id
    alarm.acknowledged_at = alarm.acknowledged_at or now
    alarm.suppressed_until = suppressed_until
    alarm.resolution_reason = reason or "suppressed_by_operator"
    if note:
        alarm.operator_note = note
    db.commit()
    db.refresh(alarm)
    logger.info("alarm_service: alarm %d suppressed by %s until %s", alarm_id, operator_id, suppressed_until)
    return alarm


def resolve_alarm(
    db: Session,
    alarm_id: int,
    operator_id: int,
    reason: Optional[str] = None,
    note: Optional[str] = None,
    resolved_at: Optional[datetime] = None,
) -> Optional[models.AlarmEvent]:
    """Resolve one alarm manually with operator audit context."""
    alarm = db.get(models.AlarmEvent, alarm_id)
    if not alarm:
        return None

    now = resolved_at or datetime.now(timezone.utc)
    duration = None
    if alarm.received_at:
        try:
            duration = max(0, int((now - alarm.received_at).total_seconds()))
        except Exception:
            duration = None

    alarm.status = "resolved"
    alarm.resolved_at = now
    alarm.duration_seconds = duration
    alarm.acknowledged_by = alarm.acknowledged_by or operator_id
    alarm.acknowledged_at = alarm.acknowledged_at or now
    alarm.resolution_reason = reason or "resolved_by_operator"
    if note:
        alarm.operator_note = note
    db.commit()
    db.refresh(alarm)
    logger.info("alarm_service: alarm %d resolved by %s", alarm_id, operator_id)
    return alarm


def link_alarm_to_outage(
    db: Session,
    alarm_id: int,
    outage_type: str,
    outage_id: int,
    operator_id: int,
    note: Optional[str] = None,
) -> Optional[models.AlarmEvent]:
    """Attach an alarm to an existing PON-port or area outage row."""
    alarm = db.get(models.AlarmEvent, alarm_id)
    if not alarm:
        return None

    now = datetime.now(timezone.utc)
    if outage_type == "pon_port":
        if not db.get(models.PONPortOutage, outage_id):
            raise ValueError("PON port outage not found")
        alarm.pon_port_outage_id = outage_id
    elif outage_type == "area":
        if not db.get(models.AreaOutage, outage_id):
            raise ValueError("Area outage not found")
        alarm.area_outage_id = outage_id
    else:
        raise ValueError("outage_type must be 'pon_port' or 'area'")

    alarm.acknowledged_by = alarm.acknowledged_by or operator_id
    alarm.acknowledged_at = alarm.acknowledged_at or now
    if note:
        alarm.operator_note = note
    db.commit()
    db.refresh(alarm)
    logger.info("alarm_service: alarm %d linked to %s outage %d", alarm_id, outage_type, outage_id)
    return alarm


# ─── State event tracking ─────────────────────────────────────────────────────

def record_state_change(
    db: Session,
    mac_address: str,
    olt_host: str,
    pon_port: Optional[str],
    onu_index: Optional[int],
    from_state: Optional[str],
    to_state: str,
    event_type: str,
    rx_power_dbm: Optional[float] = None,
    occurred_at: Optional[datetime] = None,
) -> None:
    """Write a state change row to onu_state_events (only called on actual transitions)."""
    if occurred_at is None:
        occurred_at = datetime.now(timezone.utc)
    evt = models.ONUStateEvent(
        mac_address=mac_address,
        olt_host=olt_host,
        pon_port=pon_port,
        onu_index=onu_index,
        event_type=event_type,
        from_state=from_state,
        to_state=to_state,
        rx_power_dbm=rx_power_dbm,
        occurred_at=occurred_at,
    )
    db.add(evt)
    # Flushed but not committed — caller commits after batch


# ─── Signal level classification ─────────────────────────────────────────────

def _signal_level(rx: Optional[float]) -> Optional[str]:
    if rx is None:
        return None
    if rx >= -20:
        return "excellent"
    if rx >= -24:
        return "good"
    if rx >= -27:
        return "weak"
    return "critical"


# ─── PON port outage correlation ─────────────────────────────────────────────

def check_pon_port_outage(
    db: Session,
    olt_host: str,
    pon_port: Optional[str],
    detected_at: datetime,
) -> Optional[models.PONPortOutage]:
    """
    Check if a PON port outage should be declared.
    Counts ONU_OFFLINE alarms on this olt_host+pon_port in the last
    PON_OUTAGE_WINDOW_SECONDS seconds. If ≥ PON_OUTAGE_MIN_ONUS and no
    open outage exists, create one.
    Returns the outage record if created or already open, else None.
    """
    if not pon_port:
        return None

    window_start = detected_at - timedelta(seconds=PON_OUTAGE_WINDOW_SECONDS)
    count = db.execute(
        text("""
            SELECT COUNT(DISTINCT mac_address) FROM alarm_events
            WHERE olt_host   = :host
              AND pon_port   = :port
              AND event_type IN ('ONU_OFFLINE', 'ONU_OFFLINE_GPON', 'DYING_GASP')
              AND received_at >= :since
        """),
        {"host": olt_host, "port": pon_port, "since": window_start},
    ).scalar() or 0

    if count < PON_OUTAGE_MIN_ONUS:
        return None

    # Check if an open PON port outage already exists
    existing = db.execute(
        text("""
            SELECT id FROM pon_port_outages
            WHERE olt_host  = :host
              AND pon_port  = :port
              AND status    = 'open'
            LIMIT 1
        """),
        {"host": olt_host, "port": pon_port},
    ).fetchone()

    if existing:
        # Update affected count
        db.execute(
            text("UPDATE pon_port_outages SET affected_count = :cnt WHERE id = :id"),
            {"cnt": count, "id": existing[0]},
        )
        db.commit()
        return db.get(models.PONPortOutage, existing[0])

    outage = models.PONPortOutage(
        olt_host=olt_host,
        pon_port=pon_port,
        status="open",
        affected_count=count,
        fault_type="UNKNOWN",
        detected_at=detected_at,
    )
    db.add(outage)
    db.commit()
    db.refresh(outage)
    logger.warning(
        "alarm_service: PON PORT OUTAGE declared — %s port %s (%d ONUs offline in %ds)",
        olt_host, pon_port, count, PON_OUTAGE_WINDOW_SECONDS,
    )
    return outage


def resolve_pon_port_outage_if_clear(
    db: Session,
    olt_host: str,
    pon_port: Optional[str],
    resolved_at: datetime,
) -> None:
    """
    Called when ONUs on a port come back online. If no more open ONU_OFFLINE
    alarms remain on this port, resolve the port outage.
    """
    if not pon_port:
        return
    remaining = db.execute(
        text("""
            SELECT COUNT(*) FROM alarm_events
            WHERE olt_host  = :host
              AND pon_port  = :port
              AND event_type IN ('ONU_OFFLINE', 'ONU_OFFLINE_GPON', 'DYING_GASP')
              AND status    = 'open'
        """),
        {"host": olt_host, "port": pon_port},
    ).scalar() or 0

    if remaining > 0:
        return

    rows = db.execute(
        text("""
            SELECT id, detected_at FROM pon_port_outages
            WHERE olt_host = :host AND pon_port = :port AND status = 'open'
        """),
        {"host": olt_host, "port": pon_port},
    ).fetchall()

    for row in rows:
        duration = int((resolved_at - row[1]).total_seconds()) if row[1] else None
        db.execute(
            text("""
                UPDATE pon_port_outages
                SET status = 'resolved', resolved_at = :rat, duration_seconds = :dur
                WHERE id = :id
            """),
            {"rat": resolved_at, "dur": duration, "id": row[0]},
        )
    if rows:
        db.commit()
        logger.info(
            "alarm_service: PON port outage resolved — %s port %s", olt_host, pon_port,
        )


# ─── Area outage detection (GPS + address fallback) ──────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in metres between two GPS points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _get_customer_coords(
    address: Optional[str],
    gps_lat: Optional[float],
    gps_lng: Optional[float],
    pon_port: Optional[str],
) -> Optional[Tuple[float, float]]:
    """
    Best-effort coordinates for a customer:
    1. GPS survey data (most accurate)
    2. Address keyword lookup (~300m accuracy)
    3. PON port cluster (~500m accuracy)
    """
    if gps_lat and gps_lng:
        return (gps_lat, gps_lng)
    if address:
        addr_upper = address.upper()
        for keyword, coords in _AREA_COORDS_FALLBACK.items():
            if keyword in addr_upper:
                return coords
    if pon_port and pon_port in _PORT_COORDS:
        return _PORT_COORDS[pon_port]
    return None


def check_area_outage(
    db: Session,
    olt_host: str,
    pon_port: Optional[str],
    detected_at: datetime,
) -> Optional[models.AreaOutage]:
    """
    Check if a geographic area outage should be declared.

    Fetches all ONU_OFFLINE alarms in the last AREA_OUTAGE_WINDOW_SECONDS seconds,
    resolves their customer GPS coordinates (with fallback), clusters them by
    distance, and creates an AreaOutage if ≥ AREA_OUTAGE_MIN_ONUS are within
    AREA_OUTAGE_RADIUS_M of each other.

    Returns created/existing AreaOutage or None.
    """
    window_start = detected_at - timedelta(seconds=AREA_OUTAGE_WINDOW_SECONDS)

    # Get recently offline ONUs with their customer info
    rows = db.execute(
        text("""
            SELECT DISTINCT a.mac_address, a.pon_port,
                   c.gps_lat, c.gps_lng, c.railwire_address,
                   ob.pon_port as binding_pon_port
            FROM alarm_events a
            LEFT JOIN onu_bindings ob ON ob.onu_identifier = a.mac_address
            LEFT JOIN customers c    ON c.username = ob.customer_id
            WHERE a.event_type IN ('ONU_OFFLINE', 'ONU_OFFLINE_GPON', 'DYING_GASP')
              AND a.received_at >= :since
              AND a.status      = 'open'
        """),
        {"since": window_start},
    ).fetchall()

    if len(rows) < AREA_OUTAGE_MIN_ONUS:
        return None

    # Build list of (mac, lat, lng) with best-effort coordinates
    points: List[Tuple[str, float, float]] = []
    for row in rows:
        mac, pon, gps_lat, gps_lng, address, binding_pon = row
        coords = _get_customer_coords(address, gps_lat, gps_lng, pon or binding_pon)
        if coords:
            points.append((mac, coords[0], coords[1]))

    if len(points) < AREA_OUTAGE_MIN_ONUS:
        return None

    # Simple clustering: find the largest group within AREA_OUTAGE_RADIUS_M
    best_cluster: List[Tuple[str, float, float]] = []
    for i, (mac_i, lat_i, lng_i) in enumerate(points):
        cluster = [(mac_i, lat_i, lng_i)]
        for j, (mac_j, lat_j, lng_j) in enumerate(points):
            if i == j:
                continue
            if _haversine_m(lat_i, lng_i, lat_j, lng_j) <= AREA_OUTAGE_RADIUS_M:
                cluster.append((mac_j, lat_j, lng_j))
        if len(cluster) > len(best_cluster):
            best_cluster = cluster

    if len(best_cluster) < AREA_OUTAGE_MIN_ONUS:
        return None

    # Compute centroid of cluster
    cent_lat = sum(p[1] for p in best_cluster) / len(best_cluster)
    cent_lng = sum(p[2] for p in best_cluster) / len(best_cluster)
    radius = max(
        _haversine_m(cent_lat, cent_lng, p[1], p[2]) for p in best_cluster
    )

    # Check for existing open area outage near same centroid
    existing_outages = db.execute(
        text("SELECT id, centroid_lat, centroid_lng FROM area_outages WHERE status = 'open'"),
    ).fetchall()
    for row in existing_outages:
        if row[1] and row[2]:
            if _haversine_m(cent_lat, cent_lng, row[1], row[2]) < AREA_OUTAGE_RADIUS_M:
                # Same area — update count only
                db.execute(
                    text("UPDATE area_outages SET affected_count = :cnt WHERE id = :id"),
                    {"cnt": len(best_cluster), "id": row[0]},
                )
                db.commit()
                return db.get(models.AreaOutage, row[0])

    # Resolve area name from address keywords if possible
    area_name = _guess_area_name(best_cluster, db)

    outage = models.AreaOutage(
        status="open",
        affected_count=len(best_cluster),
        centroid_lat=cent_lat,
        centroid_lng=cent_lng,
        radius_m=round(radius, 1),
        fault_type="POWER_CUT",
        area_name=area_name,
        detected_at=detected_at,
    )
    db.add(outage)
    db.commit()
    db.refresh(outage)
    logger.warning(
        "alarm_service: AREA OUTAGE declared — %d ONUs offline within %.0fm "
        "at (%.4f, %.4f) — %s",
        len(best_cluster), radius, cent_lat, cent_lng, area_name or "unknown area",
    )
    return outage


def _guess_area_name(
    cluster: List[Tuple[str, float, float]],
    db: Session,
) -> Optional[str]:
    """Try to get a human-readable area name from the cluster's customer addresses."""
    macs = [p[0] for p in cluster]
    rows = db.execute(
        text("""
            SELECT c.railwire_address FROM customers c
            JOIN onu_bindings ob ON ob.customer_id = c.username
            WHERE ob.onu_identifier = ANY(:macs)
              AND c.railwire_address IS NOT NULL
            LIMIT 5
        """),
        {"macs": macs},
    ).fetchall()
    if not rows:
        return None
    # Use the most common leading words from addresses
    from collections import Counter
    words: List[str] = []
    for row in rows:
        parts = (row[0] or "").upper().split()[:3]
        words.extend(parts)
    if not words:
        return None
    most_common = Counter(words).most_common(2)
    return " ".join(w for w, _ in most_common if w not in ("THE", "NEAR", "OPP", "AND"))


def resolve_area_outage_if_clear(db: Session, area_outage_id: int, resolved_at: datetime) -> None:
    """Resolve an area outage when all linked alarms are resolved."""
    row = db.execute(
        text("""
            SELECT COUNT(*) FROM alarm_events
            WHERE area_outage_id = :id AND status = 'open'
        """),
        {"id": area_outage_id},
    ).scalar() or 0

    if row > 0:
        return

    outage = db.get(models.AreaOutage, area_outage_id)
    if outage and outage.status == "open":
        outage.status = "resolved"
        outage.resolved_at = resolved_at
        if outage.detected_at:
            outage.duration_seconds = int((resolved_at - outage.detected_at).total_seconds())
        db.commit()


# ─── OLT health tracking ──────────────────────────────────────────────────────

STALE_THRESHOLD_SECONDS = 600  # 10 minutes without data = stale


def update_olt_health_snapshot(
    db: Session,
    olt_host: str,
    polled_at: datetime,
    *,
    collector: Optional[dict] = None,
    batch_size: Optional[int] = None,
) -> None:
    """
    Called after each successful snapshot batch ingest.
    Updates last_snapshot_at and sets status=ok. Clears stale_since.
    """
    collector = collector or {}
    db.execute(
        text("""
            INSERT INTO olt_health (
                olt_host, last_snapshot_at, status, stale_since,
                collector_id, collector_name, collector_hostname, collector_ip,
                collector_version, collector_started_at, last_collector_seen_at,
                last_batch_size, updated_at
            )
            VALUES (
                :host, :polled_at, 'ok', NULL,
                :collector_id, :collector_name, :collector_hostname, :collector_ip,
                :collector_version, :collector_started_at, :polled_at,
                :batch_size, NOW()
            )
            ON CONFLICT (olt_host) DO UPDATE SET
                last_snapshot_at       = EXCLUDED.last_snapshot_at,
                status                 = 'ok',
                stale_since            = NULL,
                collector_id           = COALESCE(EXCLUDED.collector_id, olt_health.collector_id),
                collector_name         = COALESCE(EXCLUDED.collector_name, olt_health.collector_name),
                collector_hostname     = COALESCE(EXCLUDED.collector_hostname, olt_health.collector_hostname),
                collector_ip           = COALESCE(EXCLUDED.collector_ip, olt_health.collector_ip),
                collector_version      = COALESCE(EXCLUDED.collector_version, olt_health.collector_version),
                collector_started_at   = COALESCE(EXCLUDED.collector_started_at, olt_health.collector_started_at),
                last_collector_seen_at = EXCLUDED.last_collector_seen_at,
                last_batch_size        = EXCLUDED.last_batch_size,
                updated_at             = NOW()
        """),
        {
            "host": olt_host,
            "polled_at": polled_at,
            "collector_id": collector.get("collector_id"),
            "collector_name": collector.get("collector_name"),
            "collector_hostname": collector.get("collector_hostname"),
            "collector_ip": collector.get("collector_ip"),
            "collector_version": collector.get("collector_version"),
            "collector_started_at": collector.get("collector_started_at"),
            "batch_size": batch_size,
        },
    )


def update_olt_health_trap(db: Session, olt_host: str, trap_at: datetime) -> None:
    """Called when a trap arrives from this OLT."""
    db.execute(
        text("""
            INSERT INTO olt_health (olt_host, last_trap_at, status, updated_at)
            VALUES (:host, :trap_at, 'ok', NOW())
            ON CONFLICT (olt_host) DO UPDATE SET
                last_trap_at = EXCLUDED.last_trap_at,
                status       = 'ok',
                updated_at   = NOW()
        """),
        {"host": olt_host, "trap_at": trap_at},
    )


def check_all_olt_health(db: Session) -> List[dict]:
    """
    Watchdog check: called every 5 minutes from background task.
    For each OLT, if last_snapshot_at is older than STALE_THRESHOLD_SECONDS,
    mark as stale and return the list of stale OLTs for alerting.
    """
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(seconds=STALE_THRESHOLD_SECONDS)

    rows = db.execute(
        text("SELECT olt_host, last_snapshot_at, status, stale_since FROM olt_health"),
    ).fetchall()

    alerts = []
    for row in rows:
        host, last_snap, current_status, stale_since = row
        if last_snap is None or last_snap < stale_cutoff:
            if current_status != "stale":
                # Just became stale
                db.execute(
                    text("""
                        UPDATE olt_health
                        SET status = 'stale', stale_since = :now, updated_at = :now
                        WHERE olt_host = :host
                    """),
                    {"host": host, "now": now},
                )
                stale_for = None
            else:
                stale_for = int((now - stale_since).total_seconds()) if stale_since else None
            alerts.append({
                "olt_host": host,
                "last_snapshot_at": last_snap.isoformat() if last_snap else None,
                "stale_for_seconds": stale_for,
            })
            logger.warning(
                "watchdog: OLT %s is STALE — last snapshot: %s",
                host, last_snap,
            )
        elif current_status == "stale":
            # Recovered — clear stale flag
            db.execute(
                text("UPDATE olt_health SET status='ok', stale_since=NULL WHERE olt_host=:host"),
                {"host": host},
            )

    if rows:
        db.commit()
    return alerts
