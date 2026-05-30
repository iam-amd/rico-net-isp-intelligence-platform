"""
Background worker — keeps onu_bindings in sync with the live OLT data the
poller writes to onu_latest. Runs every BINDING_RECONCILE_INTERVAL_SEC
(default 300 = 5 minutes).

Self-healing: if a customer's ONU re-registers at a different index, this
loop will see the new (port, idx) on its next pass and update the binding
automatically.

Wired from main.py:
    asyncio.create_task(reconcile_loop())
"""
import asyncio
import logging
import os

from database import SessionLocal
from services.binding_reconciler import (
    reconcile_bindings_from_onu_latest,
    summary_lines,
)
from services import pipeline_runs

logger = logging.getLogger("rico_net.binding_reconciler")

INTERVAL_SEC = int(os.environ.get("BINDING_RECONCILE_INTERVAL_SEC", "300"))


async def reconcile_loop():
    """Reconcile binding positions every INTERVAL_SEC."""
    # Small startup grace so the OLT poller has at least one cycle in.
    await asyncio.sleep(90)
    while True:
        run_id = pipeline_runs.start("binding_reconciler")
        try:
            db = SessionLocal()
            try:
                result = reconcile_bindings_from_onu_latest(db, apply=True)
            finally:
                db.close()

            if result.position_filled or result.position_updated or result.verified_conflicts:
                logger.info(
                    "binding_reconciler: verified=%d railwire=%d filled=%d updated=%d conflicts=%d",
                    result.verified_identity_matches, result.direct_matches,
                    result.position_filled, result.position_updated, result.verified_conflicts,
                )
            else:
                logger.debug(
                    "binding_reconciler: no changes (verified=%d railwire=%d)",
                    result.verified_identity_matches, result.direct_matches,
                )

            pipeline_runs.finish(
                run_id,
                status="success",
                records=result.verified_identity_matches + result.direct_matches,
                notes=(
                    f"verified={result.verified_identity_matches} railwire={result.direct_matches} "
                    f"filled={result.position_filled} updated={result.position_updated} "
                    f"conflicts={result.verified_conflicts}"
                ),
            )
        except Exception as exc:
            logger.exception("binding_reconciler: cycle failed")
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])

        await asyncio.sleep(INTERVAL_SEC)
