"""
Prediction Runner — nightly worker (2 AM)
==========================================
Runs prediction_service.run_predictions() once per day.
Registered as a background task in main.py startup.
"""
import asyncio
import logging
from datetime import datetime, timezone

from database import SessionLocal
from services import prediction_service, pipeline_runs

logger = logging.getLogger("rico_net.prediction_runner")


async def prediction_loop() -> None:
    """Run predictions nightly at 2:00 AM local time."""
    logger.info("prediction_runner: background loop started")
    while True:
        now = datetime.now()
        # Target: 02:00 AM
        target_hour = 2
        seconds_until_2am = ((target_hour - now.hour - 1) % 24) * 3600 + (60 - now.minute) * 60 + (60 - now.second)
        if seconds_until_2am > 86400:
            seconds_until_2am -= 86400

        logger.info("prediction_runner: next run in %.1f hours", seconds_until_2am / 3600)
        await asyncio.sleep(seconds_until_2am)

        # Run predictions
        logger.info("prediction_runner: starting nightly prediction run")
        run_id = pipeline_runs.start("prediction_runner")
        db = None
        try:
            db = SessionLocal()
            result = prediction_service.run_predictions(db)
            logger.info("prediction_runner: done — %s", result)
            pipeline_runs.finish(run_id, status="success",
                                 records=(result.get("count") if isinstance(result, dict) else None),
                                 notes=str(result)[:500])
        except Exception as exc:
            logger.error("prediction_runner: failed — %s", exc, exc_info=True)
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])
        finally:
            try:
                if db is not None:
                    db.close()
            except Exception:
                pass

        # Sleep 1 hour to avoid re-running immediately
        await asyncio.sleep(3600)
