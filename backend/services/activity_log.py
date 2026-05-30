"""Unified activity log.

Every notable thing that happens in the data pipeline emits one row to the
`activity_events` table via `emit(...)`. The /pipeline activity feed reads
from this table, filtered by category.

Categories (keep this list authoritative — UI maps them to icons/colours):

  CUSTOMER
    customer.new_in_csv          — appeared in latest CSV import
    customer.removed_from_csv    — vanished from CSV (flagged draft)
    customer.field_updated       — phone / plan / address changed

  SCRAPER
    scraper.mac_found            — MAC successfully captured
    scraper.mac_failed           — MAC scrape attempt failed; reason in payload
    scraper.subscriber_expired   — page reported subscriber expired
    scraper.session_renewed      — auto-login produced a fresh session

  BINDING (changes to where the customer lives on the OLT)
    binding.resolved             — customer found on an OLT for the first time
    binding.unresolved           — customer was bound, now we can't find them
    binding.position_changed     — same customer, different (olt|port|index)
    binding.confidence_changed   — confidence tier shifted (e.g. verified→probable)
    binding.device_swap_detected — slot's MAC changed; suggests new device
    binding.slot_vacated         — slot is now empty (device removed)

  ALERT
    alert.raised                 — new binding_alert opened
    alert.acknowledged           — operator marked it ack
    alert.resolved               — operator resolved it (note in payload)

  OLT
    olt.unreachable              — health flipped to unreachable / stale
    olt.recovered                — came back online after being unreachable

  SYSTEM
    system.worker_failed         — a backend worker crashed
    system.migration_applied     — alembic migration ran

The emit() helper is safe to call from any context — it never raises and
never blocks the caller's transaction. If activity_events isn't writable
(rare), we log and move on so the calling worker stays healthy.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("rico_net.activity_log")


SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"


def emit(
    db: Session,
    *,
    category: str,
    summary: str,
    severity: str = SEVERITY_INFO,
    actor: Optional[str] = None,
    customer_username: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    """Append one row to activity_events. Never raises."""
    try:
        db.execute(
            text("""
                INSERT INTO activity_events
                    (category, severity, actor, customer_username, summary, payload)
                VALUES
                    (:category, :severity, :actor, :customer_username, :summary,
                     CAST(:payload AS JSONB))
            """),
            {
                "category": category[:40],
                "severity": severity[:16],
                "actor": (actor or None) and actor[:80],
                "customer_username": (customer_username or None) and customer_username[:128],
                "summary": summary,
                "payload": json.dumps(payload) if payload is not None else None,
            },
        )
    except Exception as e:
        # Never let activity-logging break the caller's transaction. Just log.
        log.warning("activity_log.emit failed (category=%s): %s", category, e)


def emit_many(db: Session, events: list[dict]) -> None:
    """Batch insert helper. Each dict uses the same kwargs as emit()."""
    if not events:
        return
    rows = []
    for e in events:
        rows.append({
            "category": str(e.get("category", "system.unknown"))[:40],
            "severity": str(e.get("severity", SEVERITY_INFO))[:16],
            "actor": (e.get("actor") or None) and str(e["actor"])[:80],
            "customer_username": (e.get("customer_username") or None) and str(e["customer_username"])[:128],
            "summary": str(e.get("summary", "")),
            "payload": json.dumps(e["payload"]) if e.get("payload") is not None else None,
        })
    try:
        db.execute(
            text("""
                INSERT INTO activity_events
                    (category, severity, actor, customer_username, summary, payload)
                VALUES
                    (:category, :severity, :actor, :customer_username, :summary,
                     CAST(:payload AS JSONB))
            """),
            rows,
        )
    except Exception as e:
        log.warning("activity_log.emit_many failed (%d events): %s", len(rows), e)
