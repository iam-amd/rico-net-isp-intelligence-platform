"""
Async worker — runs olt_engine.reconcile_all() periodically so customer_dna
stays fresh. Default cadence 10 minutes (env: ENGINE_RECONCILE_INTERVAL_SEC).
First run is delayed 5 minutes after startup to give OLT poller a head start.
"""
import asyncio
import logging
import os

from database import SessionLocal
from services import olt_engine, pipeline_runs, data_quality

logger = logging.getLogger("rico_net.engine_reconcile_loop")

INTERVAL_SEC      = int(os.environ.get("ENGINE_RECONCILE_INTERVAL_SEC", "600"))
STARTUP_DELAY_SEC = int(os.environ.get("ENGINE_RECONCILE_STARTUP_DELAY_SEC", "300"))


async def engine_reconcile_loop():
    await asyncio.sleep(STARTUP_DELAY_SEC)
    while True:
        run_id = pipeline_runs.start("engine_reconcile")
        db = None
        try:
            db = SessionLocal()
            try:
                # Reconcile is sync + slow (~3 min) — run in executor.
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, olt_engine.reconcile_all, db)
                logger.info(
                    "engine reconcile cycle: %d customers upserted in %.1fs — %s",
                    result.get("customers_upserted", 0),
                    result.get("duration_seconds", 0),
                    result.get("resolved_by_source"),
                )
                # Re-classify every customer using the freshly-reconciled data.
                # Cheap (Postgres-only, no SNMP), runs in the same DB session.
                try:
                    state_counts = data_quality.classify_all(db)
                    logger.info("data_quality.classify_all: %s", state_counts)
                except Exception:
                    logger.exception("data_quality.classify_all failed")

                pipeline_runs.finish(
                    run_id, status="success",
                    records=result.get("customers_total"),
                    notes=f"resolved={result.get('resolved_by_source')} changes={result.get('changes_count')}",
                )
            finally:
                db.close()
        except Exception as exc:
            logger.exception("engine reconcile cycle failed")
            if db is not None:
                try:
                    db.rollback()
                    olt_engine.mark_latest_unfinished_run_failed(db, str(exc))
                except Exception:
                    logger.exception("failed to mark engine reconcile run as failed")
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])

        await asyncio.sleep(INTERVAL_SEC)
