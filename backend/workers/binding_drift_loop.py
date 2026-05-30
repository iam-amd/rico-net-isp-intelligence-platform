"""Background worker — binding-drift monitor.

Every BINDING_DRIFT_INTERVAL_SEC (default 300 = 5 minutes), scans for the
binding anomalies the engine itself doesn't catch in line:

  - position_changed >= 3 times in 24h (flap_detected)
  - same MAC bound to 2+ active customers (duplicate_mac)
  - Railwire MAC absent from every OLT for >14 days (mac_typo_suspected)
  - verified bindings offline > 7d (stale_verification)

Each finding writes/refreshes a `binding_alerts` row and emits an
`alert.raised` row in `activity_events` so the operator sees it on
/pipeline.

Wired from main.py via register_startup_events().
"""
import asyncio
import logging
import os

from database import SessionLocal
from services import pipeline_runs
from services.binding_drift_monitor import scan

logger = logging.getLogger("rico_net.binding_drift_loop")

INTERVAL_SEC = int(os.environ.get("BINDING_DRIFT_INTERVAL_SEC", "300"))


async def drift_loop():
    """Scan for binding drift every INTERVAL_SEC."""
    # Wait longer than binding_reconciler so we don't compete on startup.
    await asyncio.sleep(180)
    while True:
        run_id = pipeline_runs.start("binding_drift_monitor")
        try:
            db = SessionLocal()
            try:
                r = scan(db)
            finally:
                db.close()
            total = (
                r.flap_alerts + r.duplicate_alerts
                + r.mac_typo_alerts + r.stale_verification_alerts
            )
            logger.info(
                "binding_drift: new_alerts=%d (flap=%d dup=%d typo=%d stale=%d) auto_resolved=%d",
                total, r.flap_alerts, r.duplicate_alerts,
                r.mac_typo_alerts, r.stale_verification_alerts, r.auto_resolved,
            )
            pipeline_runs.finish(
                run_id, status="success", records=total,
                notes=(
                    f"flap={r.flap_alerts} dup={r.duplicate_alerts} "
                    f"typo={r.mac_typo_alerts} stale={r.stale_verification_alerts} "
                    f"auto_resolved={r.auto_resolved}"
                ),
            )
        except Exception as exc:
            logger.exception("binding_drift_monitor: cycle failed")
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])

        await asyncio.sleep(INTERVAL_SEC)
