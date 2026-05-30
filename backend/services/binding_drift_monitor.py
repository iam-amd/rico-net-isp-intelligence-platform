"""Binding-drift monitor.

Scans for the binding anomalies the engine itself doesn't catch in line:

  flap_detected            — ONU's position_changed >= 3 times in 24h
  duplicate_mac            — same MAC bound to 2+ customers (active rows)
  mac_typo_suspected       — Railwire MAC absent from every OLT for >14 days
  stale_verification       — verified binding offline > 7d (signals re-verify)

Each finding writes (or refreshes) a row in `binding_alerts` and emits a
matching `alert.raised` row in `activity_events`. Dedup is by `dedup_key`
so re-running the monitor doesn't multiply alerts.

Runs every 5 min via workers/binding_drift_loop.py.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import List

from sqlalchemy import text
from sqlalchemy.orm import Session

from .activity_log import emit as activity_emit, SEVERITY_WARNING, SEVERITY_CRITICAL

logger = logging.getLogger("rico_net.binding_drift")


@dataclass
class DriftScanResult:
    flap_alerts: int = 0
    duplicate_alerts: int = 0
    mac_typo_alerts: int = 0
    stale_verification_alerts: int = 0
    profile_incomplete_alerts: int = 0
    serial_missing_alerts: int = 0
    auto_resolved: int = 0


def scan(db: Session) -> DriftScanResult:
    """Run all drift checks, raise/refresh binding_alerts, return counters.

    Pipeline's job = data integrity. We do NOT alert on operational events
    (ONU offline, dying_gasp, etc.) — those belong on the NOC dashboard.
    """
    result = DriftScanResult()
    # Data-integrity detectors only:
    result.duplicate_alerts          = _detect_duplicate_macs(db)
    result.mac_typo_alerts           = _detect_mac_typos(db)
    result.stale_verification_alerts = _detect_stale_verifications(db)
    result.profile_incomplete_alerts = _detect_profile_incomplete(db)
    result.serial_missing_alerts     = _detect_serial_missing(db)
    # Flap is borderline operational, but it CAN indicate data instability —
    # keep but tightened (already requires 2+ distinct positions).
    result.flap_alerts               = _detect_flapping(db)
    result.auto_resolved             = _auto_resolve_obsolete(db)
    db.commit()
    return result


def _detect_profile_incomplete(db: Session) -> int:
    """Customer is linked but their customers row is missing position/model.

    After every engine cycle the enricher should fill these. If they're still
    empty 1 hour later, something is wrong (engine didn't run, or enricher
    failed, or customer is a special case).
    """
    rows = db.execute(text("""
        SELECT c.username
        FROM customers c
        JOIN customer_dna d ON d.username = c.username
        WHERE d.link_status = 'linked'
          AND d.last_verified_at < NOW() - INTERVAL '1 hour'
          AND (
              c.olt_host IS NULL OR c.olt_host = ''
              OR c.pon_port IS NULL OR c.pon_port = ''
              OR c.onu_index IS NULL
          )
        LIMIT 200
    """)).mappings().all()
    n = 0
    for r in rows:
        u = r["username"]
        if _upsert_alert(
            db,
            category="profile_incomplete",
            severity=SEVERITY_WARNING,
            summary=f"{u}: customer is linked on OLT but profile row missing position/model fields",
            suggested_action="Run profile enricher manually, or check if engine reconcile is actually completing cycles.",
            customer_username=u,
            current_state={"action": "run_enricher"},
            dedup_key=f"profile_incomplete:{u}",
        ):
            n += 1
    return n


def _detect_serial_missing(db: Session) -> int:
    """Linked customer has no ONT serial captured — needs field scan.

    The serial is captured by:
      - PG room sticker scan (mobile field tech)
      - OCR sticker scan on customer detail
      - Manual entry

    Without serial, we can't survive a device swap with continuity. Surface
    these so field techs know who to scan first.

    NOTE: we only flag customers who don't have a serial AFTER they've been
    linked for 7+ days — fresh linkages are still expected to be unscanned.
    """
    rows = db.execute(text("""
        SELECT c.username
        FROM customers c
        JOIN customer_dna d ON d.username = c.username
        WHERE d.link_status = 'linked'
          AND d.linked_at < NOW() - INTERVAL '7 days'
          AND (c.ont_serial_number IS NULL OR c.ont_serial_number = '')
        LIMIT 500
    """)).mappings().all()
    n = 0
    for r in rows:
        u = r["username"]
        if _upsert_alert(
            db,
            category="serial_capture_pending",
            severity="info",  # not actionable in software — needs field visit
            summary=f"{u}: customer linked 7+ days, ONT serial not captured (needs sticker scan)",
            suggested_action="Schedule field tech sticker scan during next visit. Serial gives us device-swap continuity that MAC matching alone cannot.",
            customer_username=u,
            current_state={"needs": "ont_serial_number"},
            dedup_key=f"serial_pending:{u}",
        ):
            n += 1
    return n


# ─── Detectors ─────────────────────────────────────────────────────────────

def _detect_flapping(db: Session) -> int:
    """Real flap: position changed to ≥2 distinct positions, ≥3 times in 24h.

    The distinct-positions filter rules out engine-side churn (same MAC bouncing
    between adapter and fallback) which logs position_changed repeatedly without
    the actual slot changing — that's not a real flap.
    """
    rows = db.execute(text("""
        SELECT username,
               COUNT(*) AS n,
               COUNT(DISTINCT to_value) AS distinct_positions
        FROM engine_state_changes
        WHERE change_type = 'position_changed'
          AND occurred_at > NOW() - INTERVAL '24 hours'
        GROUP BY username
        HAVING COUNT(*) >= 3 AND COUNT(DISTINCT to_value) >= 2
    """)).mappings().all()
    if len(rows) > 10:
        logger.warning(
            "suppressing %d flap alerts from one scan; likely reconcile/parser churn, not physical fiber flap",
            len(rows),
        )
        return 0
    n = 0
    for r in rows:
        u = r["username"]
        dedup = f"flap:{u}:24h"
        summary = f"{u}: ONU has changed position {r['n']} times in 24h (possible bad splice / loose connector)"
        action = (
            "Inspect the fiber path: check splice, connector, splitter port. "
            "Flapping signals physical-layer instability."
        )
        if _upsert_alert(
            db,
            category="flap_detected",
            severity=SEVERITY_WARNING,
            summary=summary,
            suggested_action=action,
            customer_username=u,
            current_state={"position_changes_24h": int(r["n"])},
            dedup_key=dedup,
        ):
            n += 1
    return n


def _detect_duplicate_macs(db: Session) -> int:
    """Same MAC bound to 2+ active customers → duplicate_mac."""
    rows = db.execute(text("""
        SELECT UPPER(b.mac_address) AS mac,
               array_agg(c.username ORDER BY b.last_seen DESC) AS usernames,
               COUNT(*) AS occupants
        FROM onu_bindings b
        JOIN customers c ON c.username = b.customer_id
        WHERE b.is_active = TRUE
          AND c.status = 'Active'
          AND COALESCE(c.mac_last_error, '') NOT IN ('no_mac_on_page', 'data_usage_link_missing', 'subscriber_expired')
          AND b.mac_address IS NOT NULL
          AND b.mac_address <> ''
        GROUP BY UPPER(b.mac_address)
        HAVING COUNT(*) > 1
    """)).mappings().all()
    n = 0
    for r in rows:
        mac = r["mac"]
        users = list(r["usernames"]) if r["usernames"] is not None else []
        dedup = f"duplicate_mac:{mac}"
        summary = (
            f"MAC {mac} is bound to {len(users)} customers: {', '.join(users[:5])}"
            + (" …" if len(users) > 5 else "")
        )
        action = (
            "Two customers cannot share one ONU. Decide which customer is "
            "actually using this device; remove or correct the other binding."
        )
        if _upsert_alert(
            db,
            category="duplicate_mac",
            severity=SEVERITY_CRITICAL,
            summary=summary,
            suggested_action=action,
            customer_username=users[0] if users else None,
            current_state={"mac": mac, "customers": users},
            dedup_key=dedup,
        ):
            n += 1
    return n


def _detect_mac_typos(db: Session) -> int:
    """Customer's Railwire MAC absent from every OLT for >14 days → mac_typo_suspected.

    Filters out genuinely-never-installed customers (those whose MAC was scraped
    *recently* from Railwire — fresh data, just no install yet). We focus on
    customers whose MAC has been stable for >14 days but never appeared.
    """
    # The customers.mac_last_attempt_at column (migration 029) is the most
    # reliable "we tried to verify this MAC" timestamp on the Postgres side.
    # Fall back to created_at for customers we've never attempted (those are
    # likely too new to flag anyway, so the > 14 days filter excludes them).
    # Exclusions:
    #   - olt4_likely: customer's MAC is valid but on an OLT we haven't connected yet.
    #     They live in their own data_pipeline_status bucket; not a typo.
    #   - complete / unbound_mac_drift: customer has an active binding via stale_pon_mac
    #     or near-match; the MAC isn't a typo, just temporarily offline.
    rows = db.execute(text("""
        SELECT c.username, UPPER(c.mac_address) AS mac,
               COALESCE(c.mac_last_attempt_at, c.created_at) AS mac_age_ts
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
        WHERE c.status = 'Active'
          AND c.mac_address IS NOT NULL
          AND c.mac_address <> ''
          AND COALESCE(c.mac_last_attempt_at, c.created_at) IS NOT NULL
          AND COALESCE(c.mac_last_attempt_at, c.created_at) < NOW() - INTERVAL '14 days'
          AND COALESCE(d.data_pipeline_status, '') NOT IN
              ('olt4_likely', 'complete', 'unbound_mac_drift', 'draft',
               'subscriber_expired', 'subscriber_inactive')
          AND NOT EXISTS (
              SELECT 1 FROM onu_latest l
              WHERE UPPER(l.mac_address) = UPPER(c.mac_address)
                AND l.polled_at > NOW() - INTERVAL '24 hours'
          )
          AND NOT EXISTS (
              SELECT 1 FROM orphan_onus o
              WHERE UPPER(o.mac_address) = UPPER(c.mac_address)
                AND o.last_seen_at > NOW() - INTERVAL '24 hours'
          )
        LIMIT 500
    """)).mappings().all()
    n = 0
    for r in rows:
        u = r["username"]
        dedup = f"mac_typo:{u}"
        summary = (
            f"{u}: Railwire MAC {r['mac']} has not appeared on any OLT in 14+ days "
            f"(last seen in scraper {r['mac_age_ts']})"
        )
        action = (
            "Likely causes: (1) MAC typo in Railwire, (2) customer never installed, "
            "(3) device replaced but Railwire not updated. Compare against orphan_onus "
            "in the customer's area — may have the real MAC."
        )
        if _upsert_alert(
            db,
            category="mac_typo_suspected",
            severity=SEVERITY_WARNING,
            summary=summary,
            suggested_action=action,
            customer_username=u,
            current_state={"railwire_mac": r["mac"], "scraped_at": str(r["mac_age_ts"])},
            dedup_key=dedup,
        ):
            n += 1
    return n


def _detect_stale_verifications(db: Session) -> int:
    """Verified bindings that have been offline > 7 days.

    A binding marked `verified` 6 months ago is no longer trustworthy if the
    customer's ONU hasn't actually been seen for a week — the customer may
    have swapped devices and forgotten to tell us.
    """
    rows = db.execute(text("""
        SELECT c.username, b.mac_address, b.verified_at,
               b.olt_host, b.pon_port, b.onu_index, b.binding_source
        FROM onu_bindings b
        JOIN customers c ON c.username = b.customer_id
        WHERE b.is_active = TRUE
          AND b.confidence = 'verified'
          AND b.binding_source IN ('field_scan', 'tech_scan', 'sticker_scan', 'manual')
          AND (b.verified_at IS NULL OR b.verified_at < NOW() - INTERVAL '7 days')
          AND NOT EXISTS (
              SELECT 1 FROM onu_latest l
              WHERE UPPER(l.mac_address) = UPPER(b.mac_address)
                AND l.polled_at > NOW() - INTERVAL '7 days'
          )
        LIMIT 500
    """)).mappings().all()
    n = 0
    for r in rows:
        u = r["username"]
        dedup = f"stale_verify:{u}"
        summary = (
            f"{u}: verified binding (MAC {r['mac_address']}) hasn't been seen "
            f"on OLT in 7+ days (verified {r['verified_at']})"
        )
        action = (
            "If customer is genuinely offline, leave alone. If they're online "
            "with a new device, the binding is stale — schedule re-verify."
        )
        if _upsert_alert(
            db,
            category="stale_verification",
            severity=SEVERITY_WARNING,
            summary=summary,
            suggested_action=action,
            customer_username=u,
            current_state={
                "mac": r["mac_address"],
                "olt": r["olt_host"],
                "port": r["pon_port"],
                "idx": r["onu_index"],
                "verified_at": str(r["verified_at"]) if r["verified_at"] else None,
                "binding_source": r["binding_source"],
            },
            dedup_key=dedup,
        ):
            n += 1
    return n


def _auto_resolve_obsolete(db: Session) -> int:
    """Auto-close alerts whose root condition no longer applies.

    Today: device_swap_detected alerts where the customer's binding has been
    updated to the new MAC. Lets the inbox shrink without admin clicks for
    self-healing cases.
    """
    resolved = db.execute(text("""
        UPDATE binding_alerts ba
        SET status = 'auto_resolved',
            resolved_at = NOW(),
            resolved_by = 'system:auto',
            resolution_note = 'New occupant matches a current binding in customer_dna'
        WHERE ba.status = 'open'
          AND ba.category = 'device_swap_detected'
          AND EXISTS (
              SELECT 1
              FROM customer_dna d
              WHERE d.username = ba.customer_username
                AND UPPER(COALESCE(d.optical_mac, '')) = UPPER(
                    COALESCE((ba.current_state ->> 'new_mac')::text, '')
                )
                AND d.link_status = 'linked'
          )
        RETURNING id, customer_username, current_state
    """)).mappings().all()
    for r in resolved:
        activity_emit(
            db,
            category="alert.auto_resolved",
            severity="info",
            actor="binding_drift_monitor",
            customer_username=r["customer_username"],
            summary=f"Auto-resolved swap alert for {r['customer_username']} (binding now points at new MAC)",
            payload=_safe_payload(r["current_state"]),
        )

    resolved_duplicates = db.execute(text("""
        UPDATE binding_alerts ba
        SET status = 'auto_resolved',
            resolved_at = NOW(),
            resolved_by = 'system:auto',
            resolution_note = 'Duplicate no longer has 2+ current MAC-proof claimants; inactive/expired/no-MAC recheck rows are treated as stale history.'
        WHERE ba.status = 'open'
          AND ba.category = 'duplicate_mac'
          AND (
              SELECT COUNT(*)
              FROM onu_bindings b
              JOIN customers c ON c.username = b.customer_id
              WHERE b.is_active = TRUE
                AND c.status = 'Active'
                AND COALESCE(c.mac_last_error, '') NOT IN ('no_mac_on_page', 'data_usage_link_missing', 'subscriber_expired')
                AND UPPER(b.mac_address) = UPPER(COALESCE(ba.current_state ->> 'mac', ''))
          ) <= 1
        RETURNING id, customer_username, current_state
    """)).mappings().all()
    for r in resolved_duplicates:
        activity_emit(
            db,
            category="alert.auto_resolved",
            severity="info",
            actor="binding_drift_monitor",
            customer_username=r["customer_username"],
            summary=f"Auto-resolved duplicate MAC alert for {r['customer_username']} (only one serviceable claimant remains)",
            payload=_safe_payload(r["current_state"]),
        )

    resolved_profiles = db.execute(text("""
        UPDATE binding_alerts ba
        SET status = 'auto_resolved',
            resolved_at = NOW(),
            resolved_by = 'system:auto',
            resolution_note = 'Profile fields are now filled from customer_dna/customer profile enricher.'
        WHERE ba.status = 'open'
          AND ba.category = 'profile_incomplete'
          AND EXISTS (
              SELECT 1
              FROM customers c
              WHERE c.username = ba.customer_username
                AND c.olt_host IS NOT NULL AND c.olt_host <> ''
                AND c.pon_port IS NOT NULL AND c.pon_port <> ''
                AND c.onu_index IS NOT NULL
          )
        RETURNING id, customer_username, current_state
    """)).mappings().all()
    for r in resolved_profiles:
        activity_emit(
            db,
            category="alert.auto_resolved",
            severity="info",
            actor="binding_drift_monitor",
            customer_username=r["customer_username"],
            summary=f"Auto-resolved profile incomplete alert for {r['customer_username']}",
            payload=_safe_payload(r["current_state"]),
        )

    resolved_stale = db.execute(text("""
        UPDATE binding_alerts ba
        SET status = 'auto_resolved',
            resolved_at = NOW(),
            resolved_by = 'system:auto',
            resolution_note = 'Verified binding alert is obsolete: MAC was seen recently or customer is now linked to a different current MAC.'
        WHERE ba.status = 'open'
          AND ba.category = 'stale_verification'
          AND (EXISTS (
              SELECT 1
              FROM onu_latest l
              WHERE UPPER(l.mac_address) = UPPER(COALESCE(ba.current_state ->> 'mac', ''))
                AND l.polled_at > NOW() - INTERVAL '7 days'
          )
          OR EXISTS (
              SELECT 1
              FROM customer_dna d
              WHERE d.username = ba.customer_username
                AND d.link_status = 'linked'
                AND d.optical_mac IS NOT NULL
                AND UPPER(d.optical_mac) <> UPPER(COALESCE(ba.current_state ->> 'mac', ''))
          ))
        RETURNING id, customer_username, current_state
    """)).mappings().all()
    for r in resolved_stale:
        activity_emit(
            db,
            category="alert.auto_resolved",
            severity="info",
            actor="binding_drift_monitor",
            customer_username=r["customer_username"],
            summary=f"Auto-resolved stale verification alert for {r['customer_username']}",
            payload=_safe_payload(r["current_state"]),
        )

    resolved_flaps = db.execute(text("""
        UPDATE binding_alerts ba
        SET status = 'auto_resolved',
            resolved_at = NOW(),
            resolved_by = 'system:auto',
            resolution_note = 'Suppressed flap-alert burst; many simultaneous position changes indicate reconcile/parser churn, not individual fiber flaps.'
        WHERE ba.status = 'open'
          AND ba.category = 'flap_detected'
          AND (
              SELECT COUNT(*)
              FROM binding_alerts x
              WHERE x.status = 'open'
                AND x.category = 'flap_detected'
                AND x.opened_at > NOW() - INTERVAL '12 hours'
          ) > 10
        RETURNING id, customer_username, current_state
    """)).mappings().all()
    for r in resolved_flaps:
        activity_emit(
            db,
            category="alert.auto_resolved",
            severity="info",
            actor="binding_drift_monitor",
            customer_username=r["customer_username"],
            summary=f"Auto-resolved burst flap alert for {r['customer_username']}",
            payload=_safe_payload(r["current_state"]),
        )

    return (
        len(resolved)
        + len(resolved_duplicates)
        + len(resolved_profiles)
        + len(resolved_stale)
        + len(resolved_flaps)
    )


# ─── Upsert helper ────────────────────────────────────────────────────────

_COOLDOWN_HOURS = 24  # don't re-fire an alert with the same dedup_key for N hours after resolution


def _upsert_alert(
    db: Session,
    *,
    category: str,
    severity: str,
    summary: str,
    suggested_action: str,
    customer_username: str | None,
    current_state: dict,
    dedup_key: str,
) -> bool:
    """Insert/refresh an alert. Returns True on fresh insert.

    Cooldown: if the same dedup_key was resolved in the last _COOLDOWN_HOURS
    hours, refuse to re-create the alert. Otherwise operators get the same
    drift firing back as soon as they close it. They can still see history
    via the resolved row + activity feed.
    """
    # Cooldown check
    recent_resolved = db.execute(text("""
        SELECT 1 FROM binding_alerts
        WHERE dedup_key = :dedup
          AND status IN ('auto_resolved', 'resolved')
          AND resolved_at > NOW() - (INTERVAL '1 hour' * :hours)
        LIMIT 1
    """), {"dedup": dedup_key, "hours": _COOLDOWN_HOURS}).fetchone()
    if recent_resolved:
        return False

    payload_json = json.dumps(current_state)
    row = db.execute(text("""
        INSERT INTO binding_alerts
            (category, severity, summary, suggested_action,
             customer_username, current_state, dedup_key, status)
        VALUES
            (:category, :severity, :summary, :action,
             :cust, CAST(:state AS JSONB), :dedup, 'open')
        ON CONFLICT (dedup_key) WHERE status = 'open' AND dedup_key IS NOT NULL DO UPDATE
        SET severity        = EXCLUDED.severity,
            summary         = EXCLUDED.summary,
            suggested_action= EXCLUDED.suggested_action,
            current_state   = EXCLUDED.current_state,
            updated_at      = NOW()
        RETURNING (xmax = 0) AS inserted, id
    """), {
        "category": category, "severity": severity,
        "summary": summary, "action": suggested_action,
        "cust": customer_username,
        "state": payload_json,
        "dedup": dedup_key,
    }).fetchone()
    if row and row.inserted:
        activity_emit(
            db,
            category="alert.raised",
            severity=severity,
            actor="binding_drift_monitor",
            customer_username=customer_username,
            summary=f"[{category}] {summary}",
            payload={"alert_id": row.id, "category": category, "state": current_state},
        )
        return True
    return False


def _safe_payload(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except Exception:
        return {"raw": str(value)[:500]}
