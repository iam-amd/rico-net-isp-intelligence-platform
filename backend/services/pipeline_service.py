"""Pipeline health aggregator — backs the /pipeline monitor page.

Pulls per-stage health from every system the data flow touches:

  Stage 1: Railwire Ingest      → scraper SQLite scraper_runs (per railwire_admin)
  Stage 2: Sync to Postgres     → scraper SQLite scraper_health + Postgres customer_sync_state
  Stage 3: OLT Binding Reconcile → Postgres engine_reconcile_runs
  Stage 4: SNMP Live Poll       → Postgres olt_health (per OLT)

Plus coverage scorecards (% of active customers complete at each stage) and
gap counts (who's stuck where) so the UI can drill in.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from services import olt_registry, data_quality


# ─── SLO thresholds (seconds) ────────────────────────────────────────────────

SLO = {
    "ingest":  {"warn": 30 * 3600, "critical": 48 * 3600},   # daily-ish
    "sync":    {"warn":      300,  "critical": 30 * 60},     # 5min / 30min
    "binding": {"warn":   30 * 60, "critical": 90 * 60},     # 30min / 90min
    "snmp":    {"warn":      300,  "critical": 15 * 60},     # 5min / 15min
    "worker":  {"warn":        2,  "critical":         4},   # multipliers on expected_interval
}


# Expected cycle interval (seconds) per worker_name. Drives SLO checks.
WORKER_INTERVALS = {
    "binding_reconciler":  300,
    "engine_reconcile":    600,
    "binding_drift_monitor": 300,
    "confidence_decay":   3600,
    "onu_identity_sync":  3600,
    "retention":          3600,
    "prediction_runner": 86400,
}


# ─── helpers ─────────────────────────────────────────────────────────────────


def _as_utc(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        # sqlite returns ISO strings; trim trailing 'Z'
        s = str(value).strip().rstrip("Z")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _age_seconds(now: datetime, last: Optional[datetime]) -> Optional[int]:
    if last is None:
        return None
    return int((now - last).total_seconds())


def _status_from_age(age: Optional[int], warn: int, critical: int) -> str:
    if age is None:
        return "unknown"
    if age >= critical:
        return "red"
    if age >= warn:
        return "amber"
    return "green"


def _stage(
    *, key: str, name: str, category: str, status: str,
    last_success_at: Optional[datetime], age_seconds: Optional[int],
    details: Dict[str, Any], slo_key: str, hint: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "key": key,
        "name": name,
        "category": category,
        "status": status,
        "last_success_at": last_success_at.isoformat() if last_success_at else None,
        "age_seconds": age_seconds,
        "slo": {
            "warn_after_sec": SLO[slo_key]["warn"],
            "critical_after_sec": SLO[slo_key]["critical"],
        },
        "details": details,
        "operator_hint": hint,
    }


# ─── scraper SQLite access ───────────────────────────────────────────────────


def _scraper_sqlite_path() -> Optional[str]:
    """Locate the scraper rico_net.db. Returns None if not found."""
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scraper", "rico_net.db"))
    if os.path.exists(repo_path):
        return repo_path
    runtime_dir = os.getenv("RICO_SCRAPER_RUNTIME_DIR")
    if runtime_dir and os.path.exists(os.path.join(runtime_dir, "rico_net.db")):
        return os.path.join(runtime_dir, "rico_net.db")
    return None


def _open_scraper() -> Optional[sqlite3.Connection]:
    path = _scraper_sqlite_path()
    if not path:
        return None
    try:
        # Open read-only via URI so we never write or block the scraper.
        uri = f"file:{path}?mode=ro&cache=shared"
        conn = sqlite3.connect(uri, uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None


def _list_known_admins(sconn: sqlite3.Connection) -> List[str]:
    """All railwire_admin values seen in scraper_runs OR customers SQLite."""
    out = set()
    try:
        cur = sconn.execute("SELECT DISTINCT railwire_admin FROM scraper_runs WHERE railwire_admin IS NOT NULL AND railwire_admin != ''")
        for (a,) in cur.fetchall():
            if a:
                out.add(a)
    except sqlite3.Error:
        pass
    try:
        cur = sconn.execute("SELECT DISTINCT railwire_admin FROM customers WHERE railwire_admin IS NOT NULL AND railwire_admin != ''")
        for (a,) in cur.fetchall():
            if a and a != "default":
                out.add(a)
    except sqlite3.Error:
        pass
    return sorted(out)


def _ingest_stage_for_account(sconn: sqlite3.Connection, admin: str, now: datetime) -> Dict[str, Any]:
    """Build one Stage-1 entry for the given railwire_admin."""
    # Last successful run of each step
    steps: Dict[str, Dict[str, Any]] = {}
    cur = sconn.execute("""
        SELECT step, MAX(finished_at) AS last_at
        FROM scraper_runs
        WHERE railwire_admin = ? AND status = 'success' AND finished_at IS NOT NULL
        GROUP BY step
    """, (admin,))
    for row in cur.fetchall():
        steps[row["step"]] = {"last_success_at": row["last_at"]}

    # Last attempt (success or fail) for hints
    cur = sconn.execute("""
        SELECT step, finished_at, status, records_processed, error_message
        FROM scraper_runs
        WHERE railwire_admin = ?
        ORDER BY started_at DESC LIMIT 1
    """, (admin,))
    last_attempt = cur.fetchone()

    # Per-account customer counts from scraper SQLite
    counts = {}
    try:
        c = sconn.execute(
            "SELECT COUNT(*) AS total, "
            " SUM(CASE WHEN mac_address IS NOT NULL AND mac_address != '' THEN 1 ELSE 0 END) AS with_mac, "
            " SUM(CASE WHEN railwire_status = 'not_found' THEN 1 ELSE 0 END) AS archived "
            "FROM customers WHERE railwire_admin = ?", (admin,)
        ).fetchone()
        counts = dict(c) if c else {}
    except sqlite3.Error:
        pass

    # Overall last success = most recent of csv/details/mac
    last_success_at = None
    for step in ("csv", "details", "mac"):
        ts = _as_utc(steps.get(step, {}).get("last_success_at"))
        if ts and (last_success_at is None or ts > last_success_at):
            last_success_at = ts

    age = _age_seconds(now, last_success_at)
    status = _status_from_age(age, SLO["ingest"]["warn"], SLO["ingest"]["critical"])

    # If last attempt failed and was recent, downgrade status
    if last_attempt and last_attempt["status"] == "failed":
        status = "amber" if status == "green" else status

    hint = None
    if status == "red":
        hint = f"Run `python scraper.py --step all --account {admin}` and check session validity."
    elif status == "amber" and last_attempt and last_attempt["status"] == "failed":
        hint = f"Last attempt failed: {(last_attempt['error_message'] or '')[:120]}"
    elif age is None:
        hint = f"No successful runs yet for {admin}. Run: python scraper.py --step session --account {admin}"

    return _stage(
        key=f"ingest_{admin}",
        name=f"Railwire Ingest ({admin})",
        category="ingest",
        status=status,
        last_success_at=last_success_at,
        age_seconds=age,
        slo_key="ingest",
        details={
            "railwire_admin": admin,
            "steps": {
                step: {"last_success_at": _as_utc(steps.get(step, {}).get("last_success_at")).isoformat()
                       if steps.get(step, {}).get("last_success_at") else None}
                for step in ("csv", "details", "mac")
            },
            "last_attempt": dict(last_attempt) if last_attempt else None,
            **counts,
        },
        hint=hint,
    )


def _sync_stage(sconn: Optional[sqlite3.Connection], db: Session, now: datetime) -> Dict[str, Any]:
    """Stage 2: scraper SQLite → Postgres sync_daemon health."""
    # Watermark file age (most reliable freshness signal)
    repo_wm = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scraper", ".sync_watermark"))
    runtime_dir = os.getenv("RICO_SCRAPER_RUNTIME_DIR")
    if not runtime_dir:
        local = os.getenv("LOCALAPPDATA")
        runtime_dir = os.path.join(local, "RicoNet", "scraper") if local else ""
    runtime_wm = os.path.join(runtime_dir, ".sync_watermark") if runtime_dir else ""
    watermark_path = runtime_wm if runtime_wm and os.path.exists(runtime_wm) else repo_wm

    watermark_mtime = None
    watermark_value = None
    if os.path.exists(watermark_path):
        try:
            watermark_mtime = datetime.fromtimestamp(os.path.getmtime(watermark_path), timezone.utc)
            with open(watermark_path) as f:
                watermark_value = f.read().strip() or None
        except Exception:
            pass

    # customer_sync_state aggregates
    sync_state = {}
    try:
        row = db.execute(text("""
            SELECT
                COUNT(*) AS rows,
                MAX(last_synced_at) AS latest_synced_at,
                SUM(CASE WHEN last_status = 'error' THEN 1 ELSE 0 END) AS errors,
                MAX(error_count) AS max_error_count
            FROM customer_sync_state
        """)).mappings().first()
        if row:
            sync_state = dict(row)
    except Exception:
        pass

    latest_sync = _as_utc(sync_state.get("latest_synced_at")) if sync_state else None
    last_success_at = max(filter(None, [watermark_mtime, latest_sync]), default=None)
    age = _age_seconds(now, last_success_at)
    status = _status_from_age(age, SLO["sync"]["warn"], SLO["sync"]["critical"])
    if sync_state.get("errors") and int(sync_state.get("errors") or 0) > 0 and status == "green":
        status = "amber"

    hint = None
    if status == "red":
        hint = "Sync daemon may be stopped. Start: `python scraper/sync_daemon.py`"
    elif sync_state.get("errors", 0):
        hint = f"{sync_state['errors']} customer(s) have sync errors — check customer_sync_state."

    return _stage(
        key="sync",
        name="Scraper -> Postgres Sync",
        category="sync",
        status=status,
        last_success_at=last_success_at,
        age_seconds=age,
        slo_key="sync",
        details={
            "watermark_value": watermark_value,
            "watermark_path": watermark_path,
            "watermark_mtime": watermark_mtime.isoformat() if watermark_mtime else None,
            "customer_sync_state_rows": int(sync_state.get("rows") or 0),
            "customer_sync_errors": int(sync_state.get("errors") or 0),
            "latest_customer_sync_at": latest_sync.isoformat() if latest_sync else None,
        },
        hint=hint,
    )


def _binding_stage(db: Session, now: datetime) -> Dict[str, Any]:
    """Stage 3: OLT Binding Reconcile (engine_reconcile_runs)."""
    last_attempt = db.execute(text("""
        SELECT id, started_at, finished_at, duration_seconds, ok,
               customers_total, customers_resolved, customers_unmatched,
               unified_mac_count, changes_count, error
        FROM engine_reconcile_runs
        ORDER BY started_at DESC LIMIT 1
    """)).mappings().first()

    last_run = db.execute(text("""
        SELECT id, started_at, finished_at, duration_seconds, ok,
               customers_total, customers_resolved, customers_unmatched,
               unified_mac_count, changes_count, error
        FROM engine_reconcile_runs
        WHERE finished_at IS NOT NULL AND ok = TRUE
        ORDER BY finished_at DESC LIMIT 1
    """)).mappings().first()

    if not last_run:
        return _stage(
            key="binding", name="OLT Binding Reconcile", category="binding",
            status="unknown", last_success_at=None, age_seconds=None,
            slo_key="binding",
            details={
                "never_run": True,
                "last_attempt_id": last_attempt["id"] if last_attempt else None,
                "last_attempt_ok": last_attempt["ok"] if last_attempt else None,
                "last_attempt_error": (last_attempt["error"] or "")[:240] if last_attempt and last_attempt["error"] else None,
            },
            hint="Reconcile loop never completed. Check workers/engine_reconcile_loop.py and POST /engine/reconcile.",
        )

    last_success_at = _as_utc(last_run["finished_at"]) if last_run["ok"] else None
    age = _age_seconds(now, last_success_at)
    status = _status_from_age(age, SLO["binding"]["warn"], SLO["binding"]["critical"])
    last_attempt_failed = bool(last_attempt and last_attempt["finished_at"] and last_attempt["ok"] is False)
    last_attempt_running = bool(last_attempt and last_attempt["finished_at"] is None)
    if last_attempt_failed and status == "green":
        status = "amber"

    hint = None
    if status == "red":
        hint = "Reconcile loop has not completed recently. Inspect engine_reconcile_loop logs."
    elif last_attempt_failed:
        hint = f"Last full engine attempt failed: {(last_attempt['error'] or '')[:160]}"
    elif last_attempt_running:
        hint = "Full engine reconcile is currently running."

    return _stage(
        key="binding",
        name="OLT Binding Reconcile",
        category="binding",
        status=status,
        last_success_at=last_success_at,
        age_seconds=age,
        slo_key="binding",
        details={
            "run_id": last_run["id"],
            "duration_seconds": last_run["duration_seconds"],
            "customers_total": last_run["customers_total"],
            "customers_resolved": last_run["customers_resolved"],
            "customers_unmatched": last_run["customers_unmatched"],
            "unified_mac_count": last_run["unified_mac_count"],
            "changes_count": last_run["changes_count"],
            "last_success_run_id": last_run["id"],
            "last_attempt_id": last_attempt["id"] if last_attempt else None,
            "last_attempt_ok": last_attempt["ok"] if last_attempt else None,
            "last_attempt_finished_at": (
                _as_utc(last_attempt["finished_at"]).isoformat()
                if last_attempt and last_attempt["finished_at"] else None
            ),
            "last_attempt_error": (last_attempt["error"] or "")[:240] if last_attempt and last_attempt["error"] else None,
        },
        hint=hint,
    )


def _snmp_stages(db: Session, now: datetime) -> List[Dict[str, Any]]:
    """Stage 4: one entry per registered (enabled) OLT — uses olt_health.last_snapshot_at."""
    out: List[Dict[str, Any]] = []
    configs = olt_registry.list_active(db)
    cfg_by_host = {c.host: c for c in configs}

    # olt_health is keyed by olt_host; left join so registry-but-no-health OLTs still appear
    rows = db.execute(text("""
        SELECT olt_host, last_snapshot_at, last_trap_at, status, snapshot_count_24h
        FROM olt_health
    """)).mappings().all()
    health_by_host = {r["olt_host"]: dict(r) for r in rows}
    fresh_rows = db.execute(text("""
        SELECT olt_host, COUNT(*) AS fresh_onus_24h
        FROM onu_latest
        WHERE polled_at > NOW() - INTERVAL '24 hours'
        GROUP BY olt_host
    """)).mappings().all()
    fresh_by_host = {r["olt_host"]: int(r["fresh_onus_24h"] or 0) for r in fresh_rows}

    for cfg in configs:
        h = health_by_host.get(cfg.host) or {}
        last_snap = _as_utc(h.get("last_snapshot_at"))
        age = _age_seconds(now, last_snap)
        # Per-OLT SLO — slow OLTs (e.g. .210 V1.4.8R) get a wider warn window.
        status = _status_from_age(age, cfg.snmp_slo_warn_sec, cfg.snmp_slo_critical_sec)
        if h.get("status") == "unreachable" and status == "green":
            status = "red"

        hint = None
        if status == "red":
            hint = f"Pi poller hasn't pushed snapshots for {cfg.host} in over {cfg.snmp_slo_critical_sec // 60}min. Check olt-poller service on Pi."
        elif status == "amber":
            hint = f"{cfg.host} polled {age // 60}min ago — its SLO is {cfg.snmp_slo_warn_sec // 60}min. {cfg.firmware} is slow under load; this is usually transient."

        out.append(_stage(
            key=f"snmp_{cfg.host}",
            name=f"SNMP Poll: {cfg.name}",
            category="snmp",
            status=status,
            last_success_at=last_snap,
            age_seconds=age,
            slo_key="snmp",
            details={
                "olt_host": cfg.host,
                "olt_name": cfg.name,
                "pon_tech": cfg.pon_tech,
                "vendor": cfg.vendor,
                "firmware": cfg.firmware,
                "last_trap_at": _as_utc(h.get("last_trap_at")).isoformat() if h.get("last_trap_at") else None,
                "olt_health_status": h.get("status"),
                "snapshot_count_24h": h.get("snapshot_count_24h"),
                "fresh_onus_24h": fresh_by_host.get(cfg.host, 0),
                "enabled": cfg.enabled,
                "slo_warn_sec": cfg.snmp_slo_warn_sec,
                "slo_critical_sec": cfg.snmp_slo_critical_sec,
            },
            hint=hint,
        ))
        # Override the default SLO with the per-OLT one
        out[-1]["slo"] = {"warn_after_sec": cfg.snmp_slo_warn_sec, "critical_after_sec": cfg.snmp_slo_critical_sec}

    # Also flag any olt_health rows for OLTs NOT in the registry
    for host, h in health_by_host.items():
        if host in cfg_by_host:
            continue
        last_snap = _as_utc(h.get("last_snapshot_at"))
        age = _age_seconds(now, last_snap)
        out.append(_stage(
            key=f"snmp_{host}",
            name=f"SNMP Poll: {host} (unregistered)",
            category="snmp",
            status="amber",
            last_success_at=last_snap,
            age_seconds=age,
            slo_key="snmp",
            details={
                "olt_host": host,
                "olt_health_status": h.get("status"),
                "unregistered": True,
            },
            hint=f"OLT {host} is pushing snapshots but isn't in olt_registry. POST /admin/olts/ to add it.",
        ))

    return out


def _workers_section(db: Session, now: datetime) -> List[Dict[str, Any]]:
    """Backend worker cycle health from pipeline_runs."""
    out: List[Dict[str, Any]] = []
    try:
        rows = db.execute(text("""
            SELECT DISTINCT ON (worker_name)
                worker_name, started_at, finished_at, duration_seconds, status,
                records_processed, notes, error
            FROM pipeline_runs
            ORDER BY worker_name, finished_at DESC NULLS LAST, started_at DESC
        """)).mappings().all()
    except Exception:
        return out

    by_name = {r["worker_name"]: dict(r) for r in rows}

    # Iterate the canonical list so workers that have NEVER run still appear.
    for name, expected in WORKER_INTERVALS.items():
        r = by_name.get(name)
        last_finished = _as_utc(r["finished_at"]) if r else None
        last_started  = _as_utc(r["started_at"])  if r else None
        last_success  = last_finished if (r and r.get("status") == "success") else None
        age = _age_seconds(now, last_finished or last_started)

        warn_after = expected * SLO["worker"]["warn"]
        critical_after = expected * SLO["worker"]["critical"]
        status = _status_from_age(age, warn_after, critical_after)
        if r and r.get("status") == "failed" and status == "green":
            status = "amber"
        if r is None:
            status = "unknown"

        hint = None
        if status == "red":
            hint = f"{name} has not completed a cycle in {age // 60}m+. Check backend logs."
        elif r and r.get("status") == "failed":
            hint = f"Last cycle failed: {(r.get('error') or '')[:120]}"

        out.append({
            "worker_name": name,
            "expected_interval_sec": expected,
            "last_finished_at": last_finished.isoformat() if last_finished else None,
            "last_started_at":  last_started.isoformat()  if last_started  else None,
            "last_status": r.get("status") if r else None,
            "duration_seconds": r.get("duration_seconds") if r else None,
            "records_processed": r.get("records_processed") if r else None,
            "notes": r.get("notes") if r else None,
            "age_seconds": age,
            "status": status,
            "slo": {"warn_after_sec": warn_after, "critical_after_sec": critical_after},
            "operator_hint": hint,
        })

    # Also show any worker_name that's in pipeline_runs but not in WORKER_INTERVALS
    for name, r in by_name.items():
        if name in WORKER_INTERVALS:
            continue
        last_finished = _as_utc(r["finished_at"])
        out.append({
            "worker_name": name,
            "expected_interval_sec": None,
            "last_finished_at": last_finished.isoformat() if last_finished else None,
            "last_started_at":  _as_utc(r["started_at"]).isoformat() if r["started_at"] else None,
            "last_status": r.get("status"),
            "duration_seconds": r.get("duration_seconds"),
            "records_processed": r.get("records_processed"),
            "notes": r.get("notes"),
            "age_seconds": _age_seconds(now, last_finished),
            "status": "unknown",
            "slo": None,
            "operator_hint": "Unrecognized worker — not in WORKER_INTERVALS.",
        })

    return out


def _coverage_and_gaps(db: Session) -> Tuple[Dict[str, int], Dict[str, int]]:
    """Compute coverage scorecard + gap counters for active customers."""
    # Pure collector view: total customers scraped from Railwire, MAC discovered,
    # OLT binding established, drafts (gone from Railwire). No "Active" filter —
    # the scraper preserves everything it sees, including paused/expired plans.
    row = db.execute(text("""
        SELECT
            COUNT(*)                                                                       AS total,
            COUNT(*) FILTER (WHERE c.mac_address IS NOT NULL AND c.mac_address != '')      AS with_mac,
            COUNT(*) FILTER (WHERE d.link_status = 'linked')                               AS with_binding,
            COUNT(*) FILTER (WHERE c.railwire_status = 'not_found')                        AS draft,
            COUNT(*) FILTER (WHERE COALESCE(c.railwire_status, 'active') = 'active'
                              AND (c.mac_address IS NULL OR c.mac_address = ''))           AS missing_mac,
            COUNT(*) FILTER (WHERE COALESCE(c.railwire_status, 'active') = 'active'
                              AND c.mac_address IS NOT NULL AND c.mac_address != ''
                              AND (d.link_status IS DISTINCT FROM 'linked'))               AS missing_binding
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
    """)).mappings().first()

    row = dict(row or {})
    coverage = {
        "total":        int(row.get("total") or 0),
        "with_mac":     int(row.get("with_mac") or 0),
        "with_binding": int(row.get("with_binding") or 0),
        "draft":        int(row.get("draft") or 0),
    }
    gaps = {
        "missing_mac":     int(row.get("missing_mac") or 0),
        "missing_binding": int(row.get("missing_binding") or 0),
        "draft":           int(row.get("draft") or 0),
    }
    return coverage, gaps


def _truth_summary(db: Session, coverage: Dict[str, int]) -> Dict[str, Any]:
    """One compact answer to: can we trust today's customer-to-ONU map?"""
    row = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE c.status = 'Active') AS active_customers,
            COUNT(*) FILTER (WHERE c.status = 'Active'
                              AND c.mac_address IS NOT NULL AND c.mac_address <> '') AS active_with_mac,
            COUNT(*) FILTER (WHERE d.link_status = 'linked') AS linked_customers,
            COUNT(*) FILTER (WHERE d.binding_source = 'pon_mac_table') AS live_pon_matches,
            COUNT(*) FILTER (WHERE d.binding_source = 'stale_pon_mac') AS held_from_history,
            COUNT(*) FILTER (WHERE d.confidence = 'verified') AS verified_links,
            COUNT(*) FILTER (WHERE d.confidence = 'probable') AS probable_links,
            COUNT(*) FILTER (WHERE d.data_pipeline_status = 'olt4_likely') AS missing_olt_likely,
            COUNT(*) FILTER (WHERE d.data_pipeline_status = 'unbound_unknown') AS unknown_unbound,
            COUNT(*) FILTER (WHERE d.data_pipeline_status = 'no_mac_in_portal') AS no_mac_in_portal
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
    """)).mappings().first()
    alerts = db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical') AS critical_alerts,
            COUNT(*) FILTER (WHERE status = 'open' AND category = 'duplicate_mac') AS duplicate_mac_alerts,
            COUNT(*) FILTER (WHERE status = 'open' AND category = 'profile_incomplete') AS profile_incomplete_alerts
        FROM binding_alerts
    """)).mappings().first()
    orphan_rows = db.execute(text("""
        WITH unknown_rows AS (
            SELECT o.*
            FROM orphan_onus o
            WHERE o.last_seen_at > NOW() - INTERVAL '24 hours'
              AND NOT EXISTS (
                  SELECT 1 FROM customers c
                  WHERE c.mac_address IS NOT NULL
                    AND c.mac_address <> ''
                    AND UPPER(c.mac_address) = UPPER(o.mac_address)
              )
              AND NOT EXISTS (
                  SELECT 1 FROM onu_bindings b
                  WHERE b.is_active = TRUE
                    AND b.mac_address IS NOT NULL
                    AND b.mac_address <> ''
                    AND UPPER(b.mac_address) = UPPER(o.mac_address)
              )
              AND NOT EXISTS (
                  SELECT 1 FROM customer_dna d
                  WHERE d.link_status = 'linked'
                    AND d.optical_mac IS NOT NULL
                    AND d.optical_mac <> ''
                    AND UPPER(d.optical_mac) = UPPER(o.mac_address)
              )
        ),
        unknown_slots AS (
            SELECT DISTINCT u.olt_host, u.pon_port, u.onu_index
            FROM unknown_rows u
            WHERE NOT EXISTS (
                SELECT 1 FROM customer_dna d
                WHERE d.link_status = 'linked'
                  AND d.olt_host = u.olt_host
                  AND d.pon_port = u.pon_port
                  AND d.onu_index = u.onu_index
            )
            AND NOT EXISTS (
                SELECT 1 FROM onu_bindings b
                WHERE b.is_active = TRUE
                  AND b.olt_host = u.olt_host
                  AND b.pon_port = u.pon_port
                  AND b.onu_index = u.onu_index
            )
        )
        SELECT olt_host, COUNT(*) AS cnt
        FROM unknown_slots
        GROUP BY olt_host
        ORDER BY olt_host
    """)).mappings().all()
    orphan_mac_rows = db.execute(text("""
        SELECT COUNT(*) AS cnt
        FROM orphan_onus o
        WHERE o.last_seen_at > NOW() - INTERVAL '24 hours'
          AND NOT EXISTS (
              SELECT 1 FROM customers c
              WHERE c.mac_address IS NOT NULL
                AND c.mac_address <> ''
                AND UPPER(c.mac_address) = UPPER(o.mac_address)
          )
          AND NOT EXISTS (
              SELECT 1 FROM onu_bindings b
              WHERE b.is_active = TRUE
                AND b.mac_address IS NOT NULL
                AND b.mac_address <> ''
                AND UPPER(b.mac_address) = UPPER(o.mac_address)
          )
          AND NOT EXISTS (
              SELECT 1 FROM customer_dna d
              WHERE d.link_status = 'linked'
                AND d.optical_mac IS NOT NULL
                AND d.optical_mac <> ''
                AND UPPER(d.optical_mac) = UPPER(o.mac_address)
          )
    """)).scalar() or 0
    olt_slot_rows = db.execute(text("""
        SELECT
            COUNT(DISTINCT olt_host || '|' || pon_port || '|' || onu_index)
              FILTER (WHERE polled_at > NOW() - INTERVAL '24 hours'
                      AND olt_host IS NOT NULL AND pon_port IS NOT NULL AND onu_index IS NOT NULL)
              AS fresh_slots_24h,
            COUNT(DISTINCT olt_host || '|' || pon_port || '|' || onu_index)
              FILTER (WHERE COALESCE(status, 'online') = 'online'
                      AND olt_host IS NOT NULL AND pon_port IS NOT NULL AND onu_index IS NOT NULL)
              AS online_slots
        FROM onu_latest
    """)).mappings().first() or {}
    connected = db.execute(text("SELECT COUNT(*) FROM olt_registry WHERE enabled = TRUE")).scalar() or 0
    expected_total = int(os.getenv("RICO_EXPECTED_OLT_COUNT", "5"))

    r = dict(row or {})
    a = dict(alerts or {})
    active_with_mac = int(r.get("active_with_mac") or 0)
    linked = int(r.get("linked_customers") or 0)
    duplicate_mac_alerts = int(a.get("duplicate_mac_alerts") or 0)
    missing_olt_likely = int(r.get("missing_olt_likely") or 0)
    unknown_unbound = int(r.get("unknown_unbound") or 0)
    no_mac = int(r.get("no_mac_in_portal") or 0)
    hard_blocks = duplicate_mac_alerts + unknown_unbound + no_mac

    if duplicate_mac_alerts:
        verdict = "conflicted"
        next_action = "Resolve duplicate MAC alerts first; they can map two customers to one device."
    elif missing_olt_likely:
        verdict = "usable_with_missing_olts"
        next_action = "Use the current 3-OLT map, then connect the remaining OLTs to clear the likely-missing group."
    elif hard_blocks:
        verdict = "needs_investigation"
        next_action = "Investigate no-MAC and unknown-unbound customers before treating coverage as complete."
    else:
        verdict = "usable"
        next_action = "Map is operationally usable; continue survey for GPS, serial, and physical proof."

    return {
        "verdict": verdict,
        "next_action": next_action,
        "connected_olts": int(connected),
        "expected_olts": expected_total,
        "active_customers": int(r.get("active_customers") or 0),
        "active_with_mac": active_with_mac,
        "linked_customers": linked,
        "match_rate_pct": round((linked / active_with_mac) * 100, 1) if active_with_mac else 0.0,
        "live_pon_matches": int(r.get("live_pon_matches") or 0),
        "held_from_history": int(r.get("held_from_history") or 0),
        "verified_links": int(r.get("verified_links") or 0),
        "probable_links": int(r.get("probable_links") or 0),
        "missing_olt_likely": missing_olt_likely,
        "unknown_unbound": unknown_unbound,
        "no_mac_in_portal": no_mac,
        "critical_alerts": int(a.get("critical_alerts") or 0),
        "duplicate_mac_alerts": duplicate_mac_alerts,
        "profile_incomplete_alerts": int(a.get("profile_incomplete_alerts") or 0),
        "orphan_onus_24h": sum(int(r["cnt"] or 0) for r in orphan_rows),
        "orphan_mac_rows_24h": int(orphan_mac_rows),
        "olt_slots_seen_24h": int(olt_slot_rows.get("fresh_slots_24h") or 0),
        "olt_online_slots": int(olt_slot_rows.get("online_slots") or 0),
        "orphan_onus_by_olt": [dict(r) for r in orphan_rows],
        "total_customers": coverage.get("total", 0),
    }


def per_account_stats(db: Session) -> List[Dict[str, Any]]:
    """One row per Railwire account with its own total/with_mac/with_binding/draft counts."""
    rows = db.execute(text("""
        SELECT COALESCE(c.railwire_admin, '(untagged)')                                       AS account,
               COUNT(*)                                                                       AS total,
               COUNT(*) FILTER (WHERE c.mac_address IS NOT NULL AND c.mac_address != '')      AS with_mac,
               COUNT(*) FILTER (WHERE d.link_status = 'linked')                               AS with_binding,
               COUNT(*) FILTER (WHERE c.railwire_status = 'not_found')                        AS draft,
               COUNT(*) FILTER (WHERE COALESCE(c.railwire_status, 'active') = 'active'
                                 AND (c.mac_address IS NULL OR c.mac_address = ''))           AS missing_mac,
               COUNT(*) FILTER (WHERE COALESCE(c.railwire_status, 'active') = 'active'
                                 AND c.mac_address IS NOT NULL AND c.mac_address != ''
                                 AND (d.link_status IS DISTINCT FROM 'linked'))               AS missing_binding
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
        GROUP BY COALESCE(c.railwire_admin, '(untagged)')
        ORDER BY total DESC
    """)).mappings().all()
    return [dict(r) for r in rows]


# ─── Public API ──────────────────────────────────────────────────────────────


def get_pipeline_health(db: Session) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    sconn = _open_scraper()

    stages: List[Dict[str, Any]] = []

    # Stage 1 — Railwire Ingest, one card per known account
    if sconn:
        admins = _list_known_admins(sconn)
        if not admins:
            stages.append(_stage(
                key="ingest_none", name="Railwire Ingest", category="ingest",
                status="unknown", last_success_at=None, age_seconds=None, slo_key="ingest",
                details={"never_ran": True},
                hint="No scraper runs recorded. Run: python scraper.py --step session",
            ))
        else:
            for admin in admins:
                stages.append(_ingest_stage_for_account(sconn, admin, now))
    else:
        stages.append(_stage(
            key="ingest_unavailable", name="Railwire Ingest", category="ingest",
            status="unknown", last_success_at=None, age_seconds=None, slo_key="ingest",
            details={"scraper_sqlite": "not found"},
            hint="Scraper SQLite (rico_net.db) not reachable from backend.",
        ))

    # Stage 2 — Sync to Postgres
    stages.append(_sync_stage(sconn, db, now))

    # Stage 3 — Binding Reconcile
    stages.append(_binding_stage(db, now))

    # Stage 4 — SNMP per OLT
    stages.extend(_snmp_stages(db, now))

    if sconn:
        try: sconn.close()
        except Exception: pass

    coverage, gaps = _coverage_and_gaps(db)
    truth_summary = _truth_summary(db, coverage)
    per_account = per_account_stats(db)
    workers = _workers_section(db, now)
    state_breakdown = data_quality.get_state_breakdown(db)

    # Roll-up: stages + workers both count
    worst = "green"
    for s in stages + workers:
        st = s["status"]
        if st == "red":
            worst = "red"; break
        if st == "amber" and worst != "red":
            worst = "amber"
        if st == "unknown" and worst == "green":
            worst = "unknown"

    return {
        "generated_at": now.isoformat(),
        "overall_status": worst,
        "stages": stages,
        "workers": workers,
        "coverage": coverage,
        "truth_summary": truth_summary,
        "per_account": per_account,
        "gaps": gaps,
        "state_breakdown": state_breakdown,
    }


# ─── Gap drill-downs ─────────────────────────────────────────────────────────


# ─── Customers table (per-account drill-in) ──────────────────────────────────


def list_customers(
    db: Session,
    *,
    account: Optional[str] = None,
    q: Optional[str] = None,
    has_mac: Optional[bool] = None,
    link_status: Optional[str] = None,
    pipeline_state: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    """Paginated customer list with the per-account tag + binding status, for the /pipeline page table."""
    limit = max(1, min(int(limit), 1000))
    offset = max(0, int(offset))

    where: List[str] = []
    params: Dict[str, Any] = {"limit": limit, "offset": offset}

    if account:
        where.append("c.railwire_admin = :account")
        params["account"] = account
    if q:
        where.append(
            "(LOWER(c.username) LIKE :q "
            "OR LOWER(c.first_name) LIKE :q "
            "OR LOWER(c.last_name) LIKE :q "
            "OR c.phone LIKE :q "
            "OR LOWER(c.mac_address) LIKE :q)"
        )
        params["q"] = f"%{q.lower().strip()}%"
    if has_mac is True:
        where.append("c.mac_address IS NOT NULL AND c.mac_address <> ''")
    elif has_mac is False:
        where.append("(c.mac_address IS NULL OR c.mac_address = '')")
    if link_status in ("linked", "unlinked"):
        where.append("COALESCE(d.link_status, 'unlinked') = :link_status")
        params["link_status"] = link_status
    if pipeline_state:
        where.append("d.data_pipeline_status = :ps")
        params["ps"] = pipeline_state

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = db.execute(
        text(f"SELECT COUNT(*) FROM customers c LEFT JOIN customer_dna d ON d.username = c.username {where_sql}"),
        params,
    ).scalar() or 0

    rows = db.execute(text(f"""
        SELECT
            c.username, c.first_name, c.last_name, c.phone, c.email,
            c.plan_name, c.expiry_date, c.balance,
            c.status, c.connection_status, c.last_seen_online,
            c.mac_address, c.railwire_admin,
            c.mac_scrape_attempts, c.mac_last_error,
            d.link_status, d.olt_host, d.pon_port, d.onu_index,
            d.status AS onu_status, d.polled_at, d.rx_power_dbm,
            d.binding_source, d.confidence,
            d.data_pipeline_status, d.last_diagnosis
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
        {where_sql}
        ORDER BY c.username
        LIMIT :limit OFFSET :offset
    """), params).mappings().all()

    accounts = db.execute(text("""
        SELECT COALESCE(railwire_admin, '(untagged)') AS account, COUNT(*) AS cnt
        FROM customers
        GROUP BY railwire_admin
        ORDER BY cnt DESC
    """)).mappings().all()

    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "filters": {"account": account, "q": q, "has_mac": has_mac, "link_status": link_status},
        "accounts": [dict(r) for r in accounts],
        "customers": [dict(r) for r in rows],
    }


_GAP_QUERIES: Dict[str, str] = {
    "missing_mac": """
        SELECT c.username, c.first_name, c.last_name, c.phone, c.plan_name,
               c.expiry_date, c.connection_status, c.railwire_admin
        FROM customers c
        WHERE c.status = 'Active' AND (c.mac_address IS NULL OR c.mac_address = '')
        ORDER BY c.username
        LIMIT :limit OFFSET :offset
    """,
    "missing_binding": """
        SELECT c.username, c.first_name, c.last_name, c.phone, c.mac_address,
               d.link_status, d.unlink_reason, d.binding_source, d.last_verified_at,
               c.railwire_admin
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
        WHERE c.status = 'Active'
              AND c.mac_address IS NOT NULL AND c.mac_address != ''
              AND (d.link_status IS DISTINCT FROM 'linked')
        ORDER BY c.username
        LIMIT :limit OFFSET :offset
    """,
    "stale_onu": """
        SELECT c.username, c.first_name, c.last_name, c.mac_address,
               d.olt_host, d.pon_port, d.onu_index, d.polled_at, d.status,
               d.last_verified_at, c.railwire_admin
        FROM customers c
        JOIN customer_dna d ON d.username = c.username
        WHERE c.status = 'Active' AND d.link_status = 'linked'
              AND (d.polled_at IS NULL OR d.polled_at < NOW() - INTERVAL '15 minutes')
        ORDER BY d.polled_at NULLS FIRST, c.username
        LIMIT :limit OFFSET :offset
    """,
    "draft": """
        SELECT c.username, c.first_name, c.last_name, c.phone, c.plan_name,
               c.expiry_date, c.railwire_status, c.connection_status,
               c.last_seen_online, c.railwire_admin
        FROM customers c
        WHERE c.railwire_status = 'not_found'
        ORDER BY c.username
        LIMIT :limit OFFSET :offset
    """,
}


# ─── Scraper logs (tailing live files) ───────────────────────────────────────


_LOG_FILES: Dict[str, str] = {
    "scraper":     "scraper.log",
    "csv":         "csv_sync.log",
    "mac":         "mac_scrape.log",
    "details":     "details_scrape.log",
    "scheduler":   "scheduler.log",
    "session":     "session_setup.log",
    "single":      "single_scrape.log",
    "sync_daemon": "sync_daemon.log",
    "actions":     "pipeline_actions.log",   # written by the FastAPI handlers below
}


def _actions_log_path() -> str:
    return os.path.join(_scraper_dir(), _LOG_FILES["actions"])


def log_action(
    *,
    action: str,
    customer: Optional[str] = None,
    account: Optional[str] = None,
    user: Optional[str] = None,
    status: str = "info",
    details: Optional[str] = None,
) -> None:
    """Append one structured line to pipeline_actions.log so the UI can tail it.
    Format: ISO-ts | STATUS | ACTION | by=user | acc=account | cust=username | details
    """
    try:
        import datetime as _dt
        ts = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        parts = [ts, status.upper(), action]
        if user:     parts.append(f"by={user}")
        if account:  parts.append(f"acc={account}")
        if customer: parts.append(f"cust={customer}")
        if details:  parts.append(details)
        line = " | ".join(parts)
        path = _actions_log_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        # Never break the API on a logging failure
        pass


def _scraper_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "scraper"))


def tail_log(log_type: str, lines: int = 200, account: Optional[str] = None) -> Dict[str, Any]:
    """Tail one of the scraper log files. Optional [<account>] filter pulls only matching lines."""
    if log_type not in _LOG_FILES:
        return {"error": f"unknown log type '{log_type}'", "valid": sorted(_LOG_FILES.keys())}
    path = os.path.join(_scraper_dir(), _LOG_FILES[log_type])
    if not os.path.exists(path):
        return {"log_type": log_type, "path": path, "exists": False, "lines": []}

    lines = max(1, min(int(lines), 5000))
    try:
        # Read whole file (logs are bounded; for very large files we could seek)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
    except Exception as exc:
        return {"log_type": log_type, "path": path, "error": str(exc), "lines": []}

    if account:
        marker = f"[{account}]"
        filtered = [ln for ln in all_lines if marker in ln]
    else:
        filtered = all_lines

    out = filtered[-lines:] if len(filtered) > lines else filtered
    return {
        "log_type": log_type,
        "path": path,
        "exists": True,
        "total_lines": len(all_lines),
        "matched_lines": len(filtered),
        "returned_lines": len(out),
        "lines": [ln.rstrip("\n") for ln in out],
    }


# ─── Scraper run history (from scraper SQLite) ───────────────────────────────


# ─── User action recorder (Postgres) ─────────────────────────────────────────


def record_action_start(
    db: Session, *, action: str, customer: Optional[str], account: Optional[str],
    step: Optional[str], triggered_by: str, pid: Optional[int] = None,
) -> int:
    """Insert a 'start' row in pipeline_user_actions and return its id."""
    row = db.execute(text("""
        INSERT INTO pipeline_user_actions
            (action, customer, account, step, triggered_by, status, pid)
        VALUES (:a, :c, :acc, :s, :u, 'start', :p)
        RETURNING id
    """), {"a": action, "c": customer, "acc": account, "s": step,
           "u": triggered_by, "p": pid}).fetchone()
    db.commit()
    return int(row[0]) if row else 0


def record_action_finish(
    db: Session, action_id: int, *, status: str,
    result_summary: Optional[str] = None, error_message: Optional[str] = None,
) -> None:
    """Update a previously-started row with the final status + result."""
    if not action_id:
        return
    db.execute(text("""
        UPDATE pipeline_user_actions
           SET finished_at    = NOW(),
               duration_ms    = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
               status         = :s,
               result_summary = :r,
               error_message  = :e
         WHERE id = :id
    """), {"id": action_id, "s": status,
           "r": (result_summary or None)[:2000] if result_summary else None,
           "e": (error_message or None)[:2000] if error_message else None})
    db.commit()


def list_user_actions(db: Session, *, account: Optional[str] = None,
                      action: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    where: List[str] = []
    params: Dict[str, Any] = {"limit": max(1, min(int(limit), 1000))}
    if account:
        where.append("account = :acc")
        params["acc"] = account
    if action:
        where.append("action = :ac")
        params["ac"] = action
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(text(f"""
        SELECT id, action, customer, account, step, triggered_by,
               started_at, finished_at, duration_ms, status,
               result_summary, error_message, pid
        FROM pipeline_user_actions
        {where_sql}
        ORDER BY started_at DESC LIMIT :limit
    """), params).mappings().all()
    return [dict(r) for r in rows]


def list_activity(db: Session, *, account: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    """Merged activity feed: scraper subprocess runs (SQLite scraper_runs) +
    user-triggered actions (Postgres pipeline_user_actions). Sorted by time desc."""
    limit = max(1, min(int(limit), 500))

    # User actions from Postgres
    user_rows = list_user_actions(db, account=account, limit=limit)
    user_items = [
        {
            "source": "user",
            "id": f"u{r['id']}",
            "kind": r["action"],
            "step": r["step"],
            "account": r["account"],
            "customer": r["customer"],
            "triggered_by": r["triggered_by"],
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "finished_at": r["finished_at"].isoformat() if r["finished_at"] else None,
            "duration_seconds": (r["duration_ms"] / 1000.0) if r["duration_ms"] else None,
            "status": r["status"],
            "result_summary": r["result_summary"],
            "error_message": r["error_message"],
            "pid": r["pid"],
        }
        for r in user_rows
    ]

    # Scheduler runs from scraper SQLite
    sched_items: List[Dict[str, Any]] = []
    sconn = _open_scraper()
    if sconn:
        try:
            where: List[str] = []
            params: List[Any] = []
            if account:
                where.append("railwire_admin = ?")
                params.append(account)
            where_sql = ("WHERE " + " AND ".join(where)) if where else ""
            cur = sconn.execute(
                f"""SELECT id, step, triggered_by, railwire_admin, started_at, finished_at,
                           duration_s, status, records_processed, notes, error_message
                    FROM scraper_runs {where_sql}
                    ORDER BY started_at DESC LIMIT ?""",
                (*params, limit),
            )
            for r in cur.fetchall():
                sched_items.append({
                    "source": "scheduler" if (r["triggered_by"] or "") == "scheduler" else "cli",
                    "id": f"s{r['id']}",
                    "kind": f"scrape:{r['step']}",
                    "step": r["step"],
                    "account": r["railwire_admin"],
                    "customer": None,
                    "triggered_by": r["triggered_by"] or "scheduler",
                    "started_at": r["started_at"],
                    "finished_at": r["finished_at"],
                    "duration_seconds": r["duration_s"],
                    "status": r["status"],
                    "result_summary": r["notes"],
                    "error_message": r["error_message"],
                    "pid": None,
                    "records_processed": r["records_processed"],
                })
        except sqlite3.Error:
            pass
        finally:
            try: sconn.close()
            except Exception: pass

    # Backend workers from pipeline_runs (engine_reconcile, binding_reconciler,
    # retention, prediction_runner) — the cycles you can't see anywhere else.
    worker_items: List[Dict[str, Any]] = []
    # Skip if filtering by railwire account — workers aren't per-account.
    if not account:
        try:
            rows = db.execute(text("""
                SELECT id, worker_name, started_at, finished_at,
                       duration_seconds, status, records_processed, notes, error
                FROM pipeline_runs
                ORDER BY started_at DESC LIMIT :n
            """), {"n": limit}).mappings().all()
            for r in rows:
                worker_items.append({
                    "source": "worker",
                    "id": f"w{r['id']}",
                    "kind": r["worker_name"],
                    "step": r["worker_name"],
                    "account": None,
                    "customer": None,
                    "triggered_by": "auto",
                    "started_at": r["started_at"].isoformat() if r["started_at"] else None,
                    "finished_at": r["finished_at"].isoformat() if r["finished_at"] else None,
                    "duration_seconds": r["duration_seconds"],
                    "status": r["status"],
                    "result_summary": r["notes"],
                    "error_message": r["error"],
                    "pid": None,
                    "records_processed": r["records_processed"],
                })
        except Exception:
            pass

    # Merge + sort
    merged = sorted(
        user_items + sched_items + worker_items,
        key=lambda x: x["started_at"] or "",
        reverse=True,
    )[:limit]

    # Account histogram for chips
    histogram: Dict[str, int] = {}
    for it in merged:
        acc = it["account"] or "(untagged)"
        histogram[acc] = histogram.get(acc, 0) + 1
    accounts = [{"account": a, "cnt": c} for a, c in sorted(histogram.items(), key=lambda x: -x[1])]

    return {
        "limit": limit,
        "count": len(merged),
        "filters": {"account": account},
        "accounts": accounts,
        "items": merged,
    }


# ─── Cache-first Bind (Option B) ─────────────────────────────────────────────


def bind_customer_cached(db: Session, username: str) -> Dict[str, Any]:
    """Cache-first bind: look up the customer's MAC in already-collected OLT
    data (customer_dna, orphan_onus, onu_bindings). Does NOT walk the OLT live.

    Returns a small payload with:
      ok: True/False
      message: human-readable description
      position: "olt/port/onu" if bound
      binding_source: where the position came from
      data_age_seconds: how stale the source is
    """
    cust = db.execute(
        text("SELECT username, mac_address FROM customers WHERE username = :u"),
        {"u": username},
    ).mappings().first()
    if not cust:
        return {"ok": False, "status_code": 404, "message": f"customer {username} not found"}
    if not cust["mac_address"]:
        return {
            "ok": False, "status_code": 400,
            "message": f"customer {username} has no MAC scraped yet — run the MAC scrape first",
        }

    mac_norm = (cust["mac_address"] or "").upper().replace("-", ":").replace(".", ":").strip()

    # 1) Already in customer_dna with a position?
    dna = db.execute(text("""
        SELECT olt_host, pon_port, onu_index, binding_source, confidence,
               link_status, last_verified_at, last_reconciled_at
        FROM customer_dna WHERE username = :u
    """), {"u": username}).mappings().first()

    if dna and dna["olt_host"] and dna["pon_port"] is not None and dna["onu_index"] is not None:
        # We already have a position — refresh confidence and return.
        age = None
        if dna["last_reconciled_at"]:
            age = (datetime.now(timezone.utc) - _as_utc(dna["last_reconciled_at"])).total_seconds()
        return {
            "ok": True,
            "message": (
                f"Already bound to {dna['olt_host']}/{dna['pon_port']}:{dna['onu_index']} "
                f"(source={dna['binding_source']}, confidence={dna['confidence']}, "
                f"data age ~{int(age) if age else '?'}s)"
            ),
            "position": f"{dna['olt_host']}/{dna['pon_port']}/{dna['onu_index']}",
            "olt_host": dna["olt_host"],
            "pon_port": dna["pon_port"],
            "onu_index": dna["onu_index"],
            "binding_source": dna["binding_source"],
            "confidence": dna["confidence"],
            "link_status": dna["link_status"],
            "data_age_seconds": int(age) if age else None,
            "source": "customer_dna",
        }

    # 2) Look for the MAC in orphan_onus (OLT saw it but no customer claimed yet)
    orphan = db.execute(text("""
        SELECT mac_address, olt_host, pon_port, onu_index, last_seen_at
        FROM orphan_onus
        WHERE UPPER(mac_address) = :m
        ORDER BY last_seen_at DESC LIMIT 1
    """), {"m": mac_norm}).mappings().first()

    if orphan:
        # Write the binding into customer_dna using the cached position.
        now = datetime.now(timezone.utc)
        db.execute(text("""
            INSERT INTO customer_dna (username, railwire_mac, olt_host, pon_port, onu_index,
                                     optical_mac, binding_source, confidence,
                                     link_status, linked_at, last_verified_at,
                                     last_reconciled_at, updated_at)
            VALUES (:u, :mac, :olt, :port, :idx, :mac, 'cached_lookup', 'probable',
                    'linked', :now, :now, :now, :now)
            ON CONFLICT (username) DO UPDATE SET
                railwire_mac      = EXCLUDED.railwire_mac,
                olt_host          = EXCLUDED.olt_host,
                pon_port          = EXCLUDED.pon_port,
                onu_index         = EXCLUDED.onu_index,
                optical_mac       = EXCLUDED.optical_mac,
                binding_source    = EXCLUDED.binding_source,
                confidence        = EXCLUDED.confidence,
                link_status       = EXCLUDED.link_status,
                linked_at         = COALESCE(customer_dna.linked_at, EXCLUDED.linked_at),
                last_verified_at  = EXCLUDED.last_verified_at,
                last_reconciled_at= EXCLUDED.last_reconciled_at,
                updated_at        = EXCLUDED.updated_at
        """), {"u": username, "mac": mac_norm, "olt": orphan["olt_host"],
               "port": orphan["pon_port"], "idx": orphan["onu_index"], "now": now})
        db.commit()
        age = (now - _as_utc(orphan["last_seen_at"])).total_seconds()
        return {
            "ok": True,
            "message": (
                f"Bound from orphan_onus → {orphan['olt_host']}/{orphan['pon_port']}:{orphan['onu_index']} "
                f"(OLT saw this MAC {int(age)}s ago)"
            ),
            "position": f"{orphan['olt_host']}/{orphan['pon_port']}/{orphan['onu_index']}",
            "olt_host": orphan["olt_host"],
            "pon_port": orphan["pon_port"],
            "onu_index": orphan["onu_index"],
            "binding_source": "cached_lookup",
            "confidence": "probable",
            "link_status": "linked",
            "data_age_seconds": int(age),
            "source": "orphan_onus",
        }

    # 3) Pi poller's onu_latest — the OLT has THIS MAC live right now
    live = db.execute(text("""
        SELECT olt_host, pon_port, onu_index, polled_at
        FROM onu_latest
        WHERE UPPER(mac_address) = :m
        ORDER BY polled_at DESC LIMIT 1
    """), {"m": mac_norm}).mappings().first()

    if live and live["olt_host"]:
        now = datetime.now(timezone.utc)
        db.execute(text("""
            INSERT INTO customer_dna (username, railwire_mac, olt_host, pon_port, onu_index,
                                     optical_mac, binding_source, confidence,
                                     link_status, linked_at, last_verified_at,
                                     last_reconciled_at, updated_at)
            VALUES (:u, :mac, :olt, :port, :idx, :mac, 'cached_lookup', 'probable',
                    'linked', :now, :now, :now, :now)
            ON CONFLICT (username) DO UPDATE SET
                railwire_mac      = EXCLUDED.railwire_mac,
                olt_host          = EXCLUDED.olt_host,
                pon_port          = EXCLUDED.pon_port,
                onu_index         = EXCLUDED.onu_index,
                optical_mac       = EXCLUDED.optical_mac,
                binding_source    = EXCLUDED.binding_source,
                confidence        = EXCLUDED.confidence,
                link_status       = EXCLUDED.link_status,
                linked_at         = COALESCE(customer_dna.linked_at, EXCLUDED.linked_at),
                last_verified_at  = EXCLUDED.last_verified_at,
                last_reconciled_at= EXCLUDED.last_reconciled_at,
                updated_at        = EXCLUDED.updated_at
        """), {"u": username, "mac": mac_norm, "olt": live["olt_host"],
               "port": live["pon_port"], "idx": live["onu_index"], "now": now})
        db.commit()
        age = (now - _as_utc(live["polled_at"])).total_seconds() if live["polled_at"] else None
        return {
            "ok": True,
            "message": (
                f"Bound from onu_latest (Pi live data) → {live['olt_host']}/{live['pon_port']}:{live['onu_index']} "
                f"(polled {int(age)}s ago)" if age else f"Bound from onu_latest → {live['olt_host']}/{live['pon_port']}:{live['onu_index']}"
            ),
            "position": f"{live['olt_host']}/{live['pon_port']}/{live['onu_index']}",
            "olt_host": live["olt_host"], "pon_port": live["pon_port"], "onu_index": live["onu_index"],
            "binding_source": "cached_lookup", "confidence": "probable",
            "link_status": "linked",
            "data_age_seconds": int(age) if age else None,
            "source": "onu_latest",
        }

    # 4) Older onu_bindings row (e.g. from a previous reconcile or field scan)
    fb = db.execute(text("""
        SELECT olt_host, pon_port, onu_index, binding_source, verified_at
        FROM onu_bindings
        WHERE customer_id = :u AND is_active = TRUE
              AND olt_host IS NOT NULL AND pon_port IS NOT NULL AND onu_index IS NOT NULL
        ORDER BY verified_at DESC NULLS LAST LIMIT 1
    """), {"u": username}).mappings().first()

    if fb:
        age = (datetime.now(timezone.utc) - _as_utc(fb["verified_at"])).total_seconds() if fb["verified_at"] else None
        return {
            "ok": True,
            "message": (
                f"Bound from onu_bindings (historical) → {fb['olt_host']}/{fb['pon_port']}:{fb['onu_index']} "
                f"(verified {int(age) if age else '?'}s ago via {fb['binding_source']})"
            ),
            "position": f"{fb['olt_host']}/{fb['pon_port']}/{fb['onu_index']}",
            "olt_host": fb["olt_host"], "pon_port": fb["pon_port"], "onu_index": fb["onu_index"],
            "binding_source": fb["binding_source"], "confidence": "probable",
            "data_age_seconds": int(age) if age else None,
            "source": "onu_bindings",
        }

    # No match anywhere — tell the user when next reconcile will retry.
    next_cycle = db.execute(text("""
        SELECT EXTRACT(EPOCH FROM (NOW() - MAX(finished_at))) AS since
        FROM engine_reconcile_runs WHERE finished_at IS NOT NULL
    """)).scalar()
    interval_sec = 600  # ENGINE_RECONCILE_INTERVAL_SEC default
    eta = max(0, interval_sec - int(since_or_0(next_cycle)))
    return {
        "ok": False, "status_code": 200,
        "message": (
            f"MAC {mac_norm} not currently visible on any OLT in our cached data. "
            f"Next engine reconcile in ~{eta // 60}m {eta % 60}s — it'll retry then. "
            f"Or click Scrape to re-verify the MAC from Railwire."
        ),
    }


def since_or_0(value):
    try: return float(value) if value is not None else 0.0
    except Exception: return 0.0


# ─── Scraper trigger (subprocess) ─────────────────────────────────────────────

import subprocess  # noqa: E402  (kept here to localize the subprocess usage)


_VALID_STEPS = {"csv", "details", "mac", "all", "daily", "single"}


def trigger_scrape(*, account: Optional[str], step: str, username: Optional[str] = None) -> Dict[str, Any]:
    """Launch scraper.py as a detached subprocess. Returns the launch result.
    No output is captured here — the scraper writes to its own log files which
    /pipeline/logs already tails in real time.
    """
    if step not in _VALID_STEPS:
        return {"ok": False, "error": f"invalid step '{step}'", "valid": sorted(_VALID_STEPS)}

    scraper_dir = _scraper_dir()
    script = os.path.join(scraper_dir, "scraper.py")
    if not os.path.exists(script):
        return {"ok": False, "error": f"scraper.py not found at {script}"}

    cmd = ["python", script, "--step", step]
    if account:
        cmd += ["--account", account]
    if username:
        cmd += ["--username", username]

    try:
        # Fully detached so the subprocess outlives the request handler.
        # Windows: CREATE_NEW_PROCESS_GROUP + DETACHED_PROCESS; POSIX: start_new_session.
        creation = 0
        if os.name == "nt":
            DETACHED_PROCESS = 0x00000008
            CREATE_NEW_PROCESS_GROUP = 0x00000200
            creation = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(
            cmd,
            cwd=scraper_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            close_fds=True,
            creationflags=creation if os.name == "nt" else 0,
            start_new_session=(os.name != "nt"),
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        return {"ok": True, "pid": proc.pid, "cmd": cmd}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "cmd": cmd}


def list_scraper_runs(account: Optional[str] = None, step: Optional[str] = None,
                      status: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    """Return latest scraper_runs from scraper SQLite, optionally filtered by railwire_admin/step/status."""
    sconn = _open_scraper()
    if not sconn:
        return {"runs": [], "error": "scraper SQLite not reachable"}
    limit = max(1, min(int(limit), 1000))
    where: List[str] = []
    params: List[Any] = []
    if account:
        where.append("railwire_admin = ?")
        params.append(account)
    if step:
        where.append("step = ?")
        params.append(step)
    if status:
        where.append("status = ?")
        params.append(status)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    try:
        cur = sconn.execute(
            f"""SELECT id, step, triggered_by, railwire_admin, started_at, finished_at,
                       duration_s, status, records_processed, records_created, records_updated,
                       errors_count, error_message, notes
                FROM scraper_runs {where_sql}
                ORDER BY started_at DESC LIMIT ?""",
            (*params, limit),
        )
        rows = cur.fetchall()
        # Build account histogram for the chips
        admins = {}
        for r in sconn.execute(
            "SELECT railwire_admin, COUNT(*) FROM scraper_runs GROUP BY railwire_admin"
        ).fetchall():
            admins[r[0] or "(untagged)"] = r[1]
        sconn.close()
    except sqlite3.Error as exc:
        try: sconn.close()
        except Exception: pass
        return {"runs": [], "error": str(exc)}

    return {
        "limit": limit,
        "filters": {"account": account, "step": step, "status": status},
        "accounts": [{"account": a, "cnt": c} for a, c in sorted(admins.items(), key=lambda x: -x[1])],
        "runs": [
            {
                "id": r["id"], "step": r["step"], "triggered_by": r["triggered_by"],
                "railwire_admin": r["railwire_admin"],
                "started_at": r["started_at"], "finished_at": r["finished_at"],
                "duration_s": r["duration_s"], "status": r["status"],
                "records_processed": r["records_processed"],
                "records_created": r["records_created"],
                "records_updated": r["records_updated"],
                "errors_count": r["errors_count"],
                "error_message": r["error_message"],
                "notes": r["notes"],
            }
            for r in rows
        ],
    }


def get_gap_customers(db: Session, gap_type: str, limit: int = 200, offset: int = 0) -> Dict[str, Any]:
    sql = _GAP_QUERIES.get(gap_type)
    if not sql:
        return {"error": f"Unknown gap_type '{gap_type}'", "valid": sorted(_GAP_QUERIES.keys())}
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    rows = db.execute(text(sql), {"limit": limit, "offset": offset}).mappings().all()
    return {
        "gap_type": gap_type,
        "limit": limit,
        "offset": offset,
        "count": len(rows),
        "customers": [dict(r) for r in rows],
    }


# ─── Binding-alert inbox ──────────────────────────────────────────────────

def list_binding_alerts(
    db: Session,
    *,
    status: str = "open",
    category: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    """List binding_alerts rows. status='all' returns every state."""
    where = []
    params: Dict[str, Any] = {"limit": min(max(1, limit), 500)}
    if status and status != "all":
        where.append("status = :status")
        params["status"] = status
    if category:
        where.append("category = :category")
        params["category"] = category
    if severity:
        where.append("severity = :severity")
        params["severity"] = severity
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(text(f"""
        SELECT id, category, severity, summary, suggested_action,
               customer_username, olt_host, pon_port, onu_index,
               current_state, dedup_key, status, opened_at, updated_at,
               resolved_at, resolved_by, resolution_note
        FROM binding_alerts
        {where_sql}
        ORDER BY
            CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            opened_at DESC
        LIMIT :limit
    """), params).mappings().all()
    return {"count": len(rows), "alerts": [dict(r) for r in rows]}


def binding_alert_stats(db: Session) -> Dict[str, Any]:
    rows = db.execute(text("""
        SELECT category, severity, status, COUNT(*) AS cnt
        FROM binding_alerts
        GROUP BY 1, 2, 3
    """)).mappings().all()
    return {"breakdown": [dict(r) for r in rows]}


def confirm_device_swap(
    db: Session,
    *,
    alert_id: int,
    actor: str,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """For a device_swap_detected alert: rebind prior customer to the new MAC.

    Steps (single transaction):
      1) Load alert row + verify it's open and of correct category
      2) Read current_state.new_mac / prior_customer
      3) Deactivate existing customer's onu_bindings rows for the old MAC
      4) Insert new onu_bindings (binding_source=device_swap_confirmed,
         confidence=verified, verified_by_user_id=actor lookup, verified_at=now)
      5) Touch customer_dna so next /engine read shows fresh truth
      6) Mark alert resolved, write activity_event
    """
    row = db.execute(text("""
        SELECT id, category, status, customer_username,
               olt_host, pon_port, onu_index, current_state
        FROM binding_alerts WHERE id = :id
    """), {"id": alert_id}).mappings().fetchone()
    if not row:
        return {"ok": False, "error": "Alert not found"}
    if row["status"] != "open":
        return {"ok": False, "error": f"Alert is {row['status']}, not open"}
    if row["category"] != "device_swap_detected":
        return {"ok": False, "error": f"Alert category is {row['category']}, not device_swap_detected"}

    state = row["current_state"] or {}
    if isinstance(state, str):
        import json as _json
        try:
            state = _json.loads(state)
        except Exception:
            state = {}

    new_mac = (state.get("new_mac") or "").upper()
    prior_user = row["customer_username"] or state.get("prior_customer")
    if not new_mac or not prior_user:
        return {"ok": False, "error": "Alert missing new_mac or prior_customer"}

    # Verify the customer exists. onu_bindings.customer_id stores the username
    # (VARCHAR FK), not the numeric customers.id, so we use the username directly.
    cust = db.execute(text("SELECT username FROM customers WHERE username = :u"),
                      {"u": prior_user}).fetchone()
    if not cust:
        return {"ok": False, "error": f"Customer {prior_user} not found"}
    cust_id = prior_user

    olt = row["olt_host"]; port = row["pon_port"]; idx = row["onu_index"]

    # Deactivate any active rows for this customer on a different MAC.
    db.execute(text("""
        UPDATE onu_bindings
        SET is_active = FALSE, deactivated_reason = :reason
        WHERE customer_id = :cid AND is_active = TRUE
          AND UPPER(COALESCE(mac_address, '')) <> :mac
    """), {"cid": cust_id, "mac": new_mac, "reason": f"device_swap alert#{alert_id}"})

    # Resolve technician id if actor matches a technicians row (for verified_by_user_id)
    actor_id = db.execute(
        text("SELECT id FROM technicians WHERE username = :u"),
        {"u": actor},
    ).fetchone()
    actor_id = actor_id[0] if actor_id else None

    # Upsert a new active row for the new MAC. Schema: customer_id + onu_identifier
    # uniqueness lives in collection_service; here we just insert + active.
    db.execute(text("""
        INSERT INTO onu_bindings
            (customer_id, mac_address, onu_identifier, olt_host, pon_port, onu_index,
             binding_source, confidence, is_active, first_seen, last_seen,
             verified_at, verified_by_user_id, deactivated_reason)
        VALUES
            (:cid, :mac, :mac, :olt, :port, :idx,
             'device_swap_confirmed', 'verified', TRUE, NOW(), NOW(),
             NOW(), :actor_id, NULL)
    """), {
        "cid": cust_id, "mac": new_mac,
        "olt": olt, "port": port, "idx": int(idx) if idx is not None else None,
        "actor_id": actor_id,
    })

    # Touch customer_dna so the next reconcile sees the fresh truth even
    # before the next 10-min cycle. We update optical_mac + last_verified_at;
    # the engine will re-derive everything else on the next pass.
    db.execute(text("""
        UPDATE customer_dna
        SET optical_mac = :mac,
            olt_host = :olt, pon_port = :port, onu_index = :idx,
            binding_source = 'device_swap_confirmed',
            confidence = 'verified',
            link_status = 'linked',
            last_verified_at = NOW(),
            linked_at = COALESCE(linked_at, NOW()),
            updated_at = NOW()
        WHERE username = :u
    """), {
        "mac": new_mac, "olt": olt, "port": port,
        "idx": int(idx) if idx is not None else None,
        "u": prior_user,
    })

    db.execute(text("""
        UPDATE binding_alerts
        SET status = 'resolved',
            resolved_at = NOW(),
            resolved_by = :actor,
            resolution_note = COALESCE(:note, 'Confirmed via one-click swap'),
            updated_at = NOW()
        WHERE id = :id
    """), {"id": alert_id, "actor": actor, "note": note})

    _emit_activity(
        db,
        category="alert.resolved",
        severity="info",
        actor=actor,
        customer_username=prior_user,
        summary=f"Device swap confirmed: {prior_user} now bound to {new_mac}",
        payload={"alert_id": alert_id, "olt": olt, "port": port, "idx": idx, "new_mac": new_mac},
    )

    db.commit()
    return {
        "ok": True,
        "alert_id": alert_id,
        "customer": prior_user,
        "new_mac": new_mac,
        "olt_host": olt,
        "pon_port": port,
        "onu_index": idx,
    }


def ack_alert(db: Session, *, alert_id: int, actor: str, note: Optional[str]) -> Dict[str, Any]:
    row = db.execute(text("""
        UPDATE binding_alerts
        SET status = 'ack', updated_at = NOW(), resolution_note = :note
        WHERE id = :id AND status = 'open'
        RETURNING id, customer_username, category
    """), {"id": alert_id, "note": note}).mappings().fetchone()
    if not row:
        return {"ok": False, "error": "Alert not found or not open"}
    _emit_activity(
        db, category="alert.acknowledged", severity="info", actor=actor,
        customer_username=row["customer_username"],
        summary=f"Alert #{alert_id} acknowledged by {actor}",
        payload={"alert_id": alert_id, "category": row["category"]},
    )
    db.commit()
    return {"ok": True, "alert_id": alert_id}


def dismiss_alert(db: Session, *, alert_id: int, actor: str, note: str) -> Dict[str, Any]:
    row = db.execute(text("""
        UPDATE binding_alerts
        SET status = 'resolved', updated_at = NOW(),
            resolved_at = NOW(), resolved_by = :actor,
            resolution_note = :note
        WHERE id = :id AND status IN ('open', 'ack')
        RETURNING id, customer_username, category
    """), {"id": alert_id, "actor": actor, "note": note}).mappings().fetchone()
    if not row:
        return {"ok": False, "error": "Alert not found or already resolved"}
    _emit_activity(
        db, category="alert.dismissed", severity="info", actor=actor,
        customer_username=row["customer_username"],
        summary=f"Alert #{alert_id} dismissed by {actor}: {note}",
        payload={"alert_id": alert_id, "category": row["category"], "note": note},
    )
    db.commit()
    return {"ok": True, "alert_id": alert_id}


# ─── Activity event feed ───────────────────────────────────────────────────

# Operational event categories belong on /noc, not /pipeline. Pipeline's job
# is data accuracy + completeness. Filter these out by default.
_OPERATIONAL_CATEGORIES = (
    "binding.online_to_offline",
    "binding.offline_to_online",
    "binding.dying_gasp",
)


def list_activity_events(
    db: Session,
    *,
    category: Optional[str] = None,
    category_prefix: Optional[str] = None,
    customer_username: Optional[str] = None,
    severity: Optional[str] = None,
    since_minutes: Optional[int] = None,
    include_operational: bool = False,
    limit: int = 200,
) -> Dict[str, Any]:
    where = []
    params: Dict[str, Any] = {"limit": min(max(1, limit), 1000)}
    if category:
        where.append("category = :category"); params["category"] = category
    if category_prefix:
        where.append("category LIKE :cat_prefix"); params["cat_prefix"] = f"{category_prefix}%"
    if customer_username:
        where.append("customer_username = :cust"); params["cust"] = customer_username
    if severity:
        where.append("severity = :severity"); params["severity"] = severity
    if since_minutes:
        where.append(f"ts > NOW() - INTERVAL '{int(since_minutes)} minutes'")
    # Operational events go to NOC, not pipeline — exclude by default
    if not include_operational and not category and not category_prefix:
        where.append(
            "category NOT IN (" + ",".join(f"'{c}'" for c in _OPERATIONAL_CATEGORIES) + ")"
        )
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = db.execute(text(f"""
        SELECT id, ts, category, severity, actor, customer_username, summary, payload
        FROM activity_events
        {where_sql}
        ORDER BY ts DESC, id DESC
        LIMIT :limit
    """), params).mappings().all()
    return {"count": len(rows), "events": [dict(r) for r in rows]}


def get_profile_completeness(db: Session) -> Dict[str, Any]:
    """Profile completeness KPI for /pipeline. Tells you what % of linked
    customers have each identity field populated."""
    from .customer_profile_enricher import get_completeness_stats
    return get_completeness_stats(db)


# ─── Admin override actions (every change audit-logged) ──────────────────

import re as _re
_MAC_RE = _re.compile(r"^[0-9a-fA-F]{2}([:\-][0-9a-fA-F]{2}){5}$")


def _normalize_mac(mac: str) -> Optional[str]:
    if not mac:
        return None
    m = mac.strip().lower().replace("-", ":")
    if not _MAC_RE.match(m):
        # Try compact 12-hex form too
        compact = mac.strip().replace(":", "").replace("-", "").lower()
        if len(compact) == 12 and all(c in "0123456789abcdef" for c in compact):
            m = ":".join(compact[i:i+2] for i in range(0, 12, 2))
        else:
            return None
    return m


def admin_edit_customer_mac(
    db: Session,
    *,
    username: str,
    new_mac: str,
    actor: str,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Admin-edits the customer's MAC. Audits + re-runs binding reconciler.

    Returns ok=False if the MAC is invalid or the customer doesn't exist.
    """
    nm = _normalize_mac(new_mac)
    if not nm:
        return {"ok": False, "error": f"Invalid MAC format: {new_mac!r}"}

    cust = db.execute(
        text("SELECT username, mac_address FROM customers WHERE username=:u"),
        {"u": username},
    ).fetchone()
    if not cust:
        return {"ok": False, "error": f"Customer {username} not found"}

    old_mac = cust[1]
    if old_mac and old_mac.lower() == nm:
        return {"ok": True, "noop": True, "mac": nm,
                "message": "MAC unchanged"}

    # Duplicate-MAC guard — refuse to assign a MAC already on another customer
    conflict = db.execute(text("""
        SELECT username FROM customers
        WHERE UPPER(mac_address) = UPPER(:m) AND username <> :u
        LIMIT 1
    """), {"m": nm, "u": username}).fetchone()
    if conflict:
        return {"ok": False, "error": f"MAC {nm} is already bound to customer {conflict[0]}"}

    # Apply the change
    db.execute(text("""
        UPDATE customers
        SET mac_address = :m, updated_at = NOW()
        WHERE username = :u
    """), {"m": nm, "u": username})

    # Audit row
    db.execute(text("""
        INSERT INTO customer_audit_log
            (customer_id, action, field_name, old_value, new_value, changed_by, changed_at)
        VALUES
            (:u, 'UPDATE', 'mac_address', :old, :new, :who, NOW())
    """), {"u": username, "old": old_mac, "new": nm, "who": actor})

    # Activity event so the feed shows the change
    _emit_activity(
        db,
        category="customer.mac_admin_changed",
        severity="warning",
        actor=actor,
        customer_username=username,
        summary=f"Admin {actor} changed MAC for {username}: {old_mac or '(none)'} → {nm}"
                + (f" ({note})" if note else ""),
        payload={"old_mac": old_mac, "new_mac": nm, "note": note},
    )

    db.commit()

    # Trigger immediate binding reconcile for THIS customer (in-process, fast)
    try:
        from .binding_reconciler import reconcile_bindings_from_onu_latest
        r = reconcile_bindings_from_onu_latest(db, apply=True)
        reconcile_summary = {
            "direct_matches": r.direct_matches,
            "position_filled": r.position_filled,
            "position_updated": r.position_updated,
        }
    except Exception as e:
        reconcile_summary = {"error": str(e)[:200]}

    return {
        "ok": True,
        "username": username,
        "old_mac": old_mac,
        "new_mac": nm,
        "reconcile": reconcile_summary,
    }


def admin_force_verify_binding(
    db: Session,
    *,
    username: str,
    actor: str,
    note: str,
) -> Dict[str, Any]:
    """Mark the customer's current binding as physically verified by admin.

    Sets confidence='verified', binding_source='manual', verified_at=now.
    Use after physical sticker confirmation.
    """
    cust = db.execute(
        text("""
            SELECT c.mac_address, d.olt_host, d.pon_port, d.onu_index, d.optical_mac
            FROM customers c
            LEFT JOIN customer_dna d ON d.username=c.username
            WHERE c.username=:u
        """), {"u": username},
    ).mappings().fetchone()
    if not cust:
        return {"ok": False, "error": f"Customer {username} not found"}
    if not (cust["olt_host"] and cust["pon_port"] and cust["onu_index"] is not None):
        return {"ok": False, "error": f"{username} is not currently linked — cannot force-verify"}

    # Look up technician id (for verified_by_user_id)
    tech = db.execute(
        text("SELECT id FROM technicians WHERE username=:u"),
        {"u": actor},
    ).fetchone()
    actor_id = tech[0] if tech else None

    # Deactivate any other bindings for this customer on different MACs
    db.execute(text("""
        UPDATE onu_bindings
        SET is_active=FALSE, deactivated_reason='admin_force_verify_supersede'
        WHERE customer_id=:u AND is_active=TRUE
          AND UPPER(COALESCE(mac_address,''))
              <> UPPER(COALESCE(:m,''))
    """), {"u": username, "m": cust["optical_mac"] or cust["mac_address"]})

    # Insert (or refresh) the verified binding
    db.execute(text("""
        INSERT INTO onu_bindings
            (customer_id, mac_address, onu_identifier, olt_host, pon_port, onu_index,
             binding_source, confidence, is_active, first_seen, last_seen,
             verified_at, verified_by_user_id)
        VALUES
            (:u, :mac, :mac, :olt, :port, :idx,
             'manual', 'verified', TRUE, NOW(), NOW(), NOW(), :aid)
    """), {
        "u": username, "mac": cust["optical_mac"] or cust["mac_address"],
        "olt": cust["olt_host"], "port": cust["pon_port"],
        "idx": int(cust["onu_index"]), "aid": actor_id,
    })

    # Touch customer_dna so it reflects new confidence
    db.execute(text("""
        UPDATE customer_dna
        SET binding_source='manual', confidence='verified',
            last_verified_at=NOW(), updated_at=NOW()
        WHERE username=:u
    """), {"u": username})

    _emit_activity(
        db,
        category="binding.admin_force_verified",
        severity="info",
        actor=actor,
        customer_username=username,
        summary=f"Admin {actor} force-verified binding for {username} "
                f"({cust['olt_host']} {cust['pon_port']}/{cust['onu_index']}): {note}",
        payload={"olt": cust["olt_host"], "port": cust["pon_port"],
                 "idx": cust["onu_index"], "note": note},
    )

    db.commit()
    return {
        "ok": True,
        "username": username,
        "olt_host": cust["olt_host"],
        "pon_port": cust["pon_port"],
        "onu_index": cust["onu_index"],
        "confidence": "verified",
        "binding_source": "manual",
    }


def admin_dismiss_investigation(
    db: Session,
    *,
    case_id: str,
    actor: str,
    note: str,
) -> Dict[str, Any]:
    """Record the dismissal of an investigation case in activity_events.

    Cases are detector-derived (computed live), so 'dismissal' is purely a
    note for the audit trail. The case will reappear if the underlying
    condition persists — that's intentional. To make it stick, fix the
    underlying issue first.
    """
    _emit_activity(
        db,
        category="investigation.dismissed",
        severity="info",
        actor=actor,
        customer_username=None,
        summary=f"Admin {actor} dismissed investigation case {case_id}: {note}",
        payload={"case_id": case_id, "note": note},
    )
    db.commit()
    return {"ok": True, "case_id": case_id}


def activity_categories(db: Session) -> Dict[str, Any]:
    rows = db.execute(text("""
        SELECT category, COUNT(*) AS cnt,
               MAX(ts) AS last_seen,
               COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '24 hours') AS cnt_24h
        FROM activity_events
        GROUP BY 1
        ORDER BY 1
    """)).mappings().all()
    return {"categories": [dict(r) for r in rows]}


def _emit_activity(db: Session, **kwargs) -> None:
    """Local re-export — same signature as services.activity_log.emit().
    Inlined here so we don't add a hard import loop with the router."""
    try:
        from .activity_log import emit as _emit
        _emit(db, **kwargs)
    except Exception:
        pass
