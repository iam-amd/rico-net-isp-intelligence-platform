"""Background worker — confidence decay.

A binding marked `verified` 6 months ago carries the same weight as one
verified yesterday — but only if the underlying physical reality hasn't
changed. Customers swap routers, splices age, devices break. Without a
decay clock, the system slowly accumulates stale "truths".

Rules (applied every ~24h):
  verified → probable     when last_verified_at < NOW() - 60 days
  probable → guess        when last_verified_at < NOW() - 180 days

A binding bumped back into "verified" the next time it's confirmed on the
PON MAC table (the engine handles that automatically). So decay is a
gentle background pressure, not a destructive operation.

Wired from main.py.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import text

from database import SessionLocal
from services import pipeline_runs
from services.activity_log import emit as activity_emit, SEVERITY_INFO

logger = logging.getLogger("rico_net.confidence_decay")

# Run once per day by default.
INTERVAL_SEC = int(os.environ.get("CONFIDENCE_DECAY_INTERVAL_SEC", "86400"))


def decay_once() -> dict:
    """Apply decay rules; returns counters per transition."""
    counts = {"verified_to_probable": 0, "probable_to_guess": 0}
    db = SessionLocal()
    try:
        # verified → probable (60+ days old)
        rows = db.execute(text("""
            UPDATE onu_bindings
            SET confidence = 'probable'
            WHERE is_active = TRUE
              AND confidence = 'verified'
              AND (verified_at IS NULL OR verified_at < NOW() - INTERVAL '60 days')
              AND binding_source IN ('field_scan', 'tech_scan', 'sticker_scan', 'manual')
            RETURNING customer_id, mac_address
        """)).mappings().all()
        counts["verified_to_probable"] = len(rows)
        for r in rows:
            # Translate customer_id -> username for the activity feed
            # onu_bindings.customer_id IS the username (VARCHAR FK), not numeric id
            uname = r["customer_id"]
            activity_emit(
                db,
                category="binding.confidence_decayed",
                severity=SEVERITY_INFO,
                actor="confidence_decay",
                customer_username=uname,
                summary=(
                    f"{uname or r['customer_id']}: confidence verified → probable "
                    f"(no fresh verification in 60+ days)"
                ),
                payload={"mac": r["mac_address"], "transition": "verified→probable"},
            )

        # probable → guess (180+ days old)
        rows = db.execute(text("""
            UPDATE onu_bindings
            SET confidence = 'guess'
            WHERE is_active = TRUE
              AND confidence = 'probable'
              AND (verified_at IS NULL OR verified_at < NOW() - INTERVAL '180 days')
              AND binding_source IN ('field_scan', 'tech_scan', 'sticker_scan', 'manual')
            RETURNING customer_id, mac_address
        """)).mappings().all()
        counts["probable_to_guess"] = len(rows)
        for r in rows:
            # onu_bindings.customer_id IS the username (VARCHAR FK), not numeric id
            uname = r["customer_id"]
            activity_emit(
                db,
                category="binding.confidence_decayed",
                severity=SEVERITY_INFO,
                actor="confidence_decay",
                customer_username=uname,
                summary=(
                    f"{uname or r['customer_id']}: confidence probable → guess "
                    f"(no fresh verification in 180+ days)"
                ),
                payload={"mac": r["mac_address"], "transition": "probable→guess"},
            )

        db.commit()
    finally:
        db.close()
    return counts


async def decay_loop():
    """Nightly: 1h delay so it doesn't race startup migration tasks."""
    await asyncio.sleep(3600)
    while True:
        run_id = pipeline_runs.start("confidence_decay")
        try:
            counts = decay_once()
            total = sum(counts.values())
            logger.info(
                "confidence_decay: v→p=%d p→g=%d (total=%d)",
                counts["verified_to_probable"], counts["probable_to_guess"], total,
            )
            pipeline_runs.finish(
                run_id, status="success", records=total,
                notes=(
                    f"verified_to_probable={counts['verified_to_probable']} "
                    f"probable_to_guess={counts['probable_to_guess']}"
                ),
            )
        except Exception as exc:
            logger.exception("confidence_decay: cycle failed")
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])

        await asyncio.sleep(INTERVAL_SEC)
