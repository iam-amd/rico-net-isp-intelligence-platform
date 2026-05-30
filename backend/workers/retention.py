"""
Rico Net — Data Retention Worker
==================================
Runs as a background asyncio task on startup.

Schedule:
  • Every hour  → aggregate previous hour's onu_snapshots into onu_hourly
  • Every day   → aggregate previous day's onu_hourly into onu_daily
  • Every day   → purge onu_snapshots older than SNAPSHOT_RETAIN_DAYS (default 7)

Why aggregation:
  onu_snapshots grows at ~354 rows × 20 polls/hour = 7,080 rows/hour = 170k/day.
  Without retention this fills disk within weeks.
  onu_hourly keeps 90 days of signal trend data at ~354 × 24 × 90 = 763k rows (manageable).
  onu_daily keeps forever at ~354 × 365 = 130k rows/year (tiny).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from database import SessionLocal
from services import pipeline_runs

logger = logging.getLogger("rico_net.retention")

SNAPSHOT_RETAIN_DAYS = 7
HOURLY_RETAIN_DAYS = 90


async def _aggregate_hourly() -> int:
    """
    Aggregate onu_snapshots for all complete hours not yet in onu_hourly.
    Inserts rows for mac_address × hour buckets; skips already-aggregated hours.
    Returns number of hour-buckets written.
    """
    db = SessionLocal()
    try:
        result = db.execute(text("""
            INSERT INTO onu_hourly (mac_address, hour, avg_rx, min_rx, max_rx,
                                   avg_tx, online_pct, sample_count)
            SELECT
                mac_address,
                date_trunc('hour', polled_at) AS hour,
                AVG(rx_power_dbm)             AS avg_rx,
                MIN(rx_power_dbm)             AS min_rx,
                MAX(rx_power_dbm)             AS max_rx,
                AVG(tx_power_dbm)             AS avg_tx,
                100.0 * SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END)
                    / COUNT(*)                AS online_pct,
                COUNT(*)                      AS sample_count
            FROM onu_snapshots
            WHERE polled_at < date_trunc('hour', NOW())          -- only complete hours
              AND polled_at >= NOW() - INTERVAL ':days days'
            GROUP BY mac_address, date_trunc('hour', polled_at)
            ON CONFLICT (mac_address, hour) DO UPDATE SET
                avg_rx       = EXCLUDED.avg_rx,
                min_rx       = EXCLUDED.min_rx,
                max_rx       = EXCLUDED.max_rx,
                avg_tx       = EXCLUDED.avg_tx,
                online_pct   = EXCLUDED.online_pct,
                sample_count = EXCLUDED.sample_count
        """.replace(':days', str(SNAPSHOT_RETAIN_DAYS + 1))))
        db.commit()
        return result.rowcount
    except Exception as e:
        logger.error("aggregate_hourly failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()


async def _aggregate_daily() -> int:
    """Aggregate onu_hourly into onu_daily for all complete days not yet aggregated."""
    db = SessionLocal()
    try:
        result = db.execute(text("""
            INSERT INTO onu_daily (mac_address, day, avg_rx, min_rx, max_rx,
                                  avg_tx, online_pct, sample_count)
            SELECT
                mac_address,
                date_trunc('day', hour)::date AS day,
                AVG(avg_rx)                   AS avg_rx,
                MIN(min_rx)                   AS min_rx,
                MAX(max_rx)                   AS max_rx,
                AVG(avg_tx)                   AS avg_tx,
                AVG(online_pct)               AS online_pct,
                SUM(sample_count)             AS sample_count
            FROM onu_hourly
            WHERE hour < date_trunc('day', NOW())   -- only complete days
            GROUP BY mac_address, date_trunc('day', hour)::date
            ON CONFLICT (mac_address, day) DO UPDATE SET
                avg_rx       = EXCLUDED.avg_rx,
                min_rx       = EXCLUDED.min_rx,
                max_rx       = EXCLUDED.max_rx,
                avg_tx       = EXCLUDED.avg_tx,
                online_pct   = EXCLUDED.online_pct,
                sample_count = EXCLUDED.sample_count
        """))
        db.commit()
        return result.rowcount
    except Exception as e:
        logger.error("aggregate_daily failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()


async def _purge_snapshots() -> int:
    """Delete onu_snapshots older than SNAPSHOT_RETAIN_DAYS. Returns deleted count."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=SNAPSHOT_RETAIN_DAYS)
        result = db.execute(text(
            "DELETE FROM onu_snapshots WHERE polled_at < :cutoff"
        ), {"cutoff": cutoff})
        db.commit()
        n = result.rowcount
        if n:
            logger.info("purge_snapshots: deleted %d rows older than %s", n, cutoff.date())
        return n
    except Exception as e:
        logger.error("purge_snapshots failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()


async def _purge_hourly() -> int:
    """Delete onu_hourly older than HOURLY_RETAIN_DAYS."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=HOURLY_RETAIN_DAYS)
        result = db.execute(text(
            "DELETE FROM onu_hourly WHERE hour < :cutoff"
        ), {"cutoff": cutoff})
        db.commit()
        return result.rowcount
    except Exception as e:
        logger.error("purge_hourly failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()


async def retention_loop():
    """
    Background asyncio loop.
    - Runs hourly aggregation every 60 minutes.
    - Runs daily aggregation + purge once per day (at ~00:10).
    """
    # Initial run on startup — catch up any missed hours
    await asyncio.sleep(10)
    logger.info("retention_loop: startup catch-up aggregation")
    run_id = pipeline_runs.start("retention")
    try:
        h = await _aggregate_hourly()
        d = await _aggregate_daily()
        logger.info("retention_loop: startup: %d hourly buckets, %d daily buckets written", h, d)
        pipeline_runs.finish(run_id, status="success", records=h + d,
                             notes=f"startup hourly={h} daily={d}")
    except Exception as exc:
        pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])
        raise

    last_daily = datetime.now(timezone.utc).date()

    while True:
        await asyncio.sleep(3600)  # wake every hour

        run_id = pipeline_runs.start("retention")
        try:
            h = await _aggregate_hourly()
            logger.info("retention_loop: hourly aggregation: %d buckets", h)

            today = datetime.now(timezone.utc).date()
            extras = ""
            if today != last_daily:
                last_daily = today
                d = await _aggregate_daily()
                ps = await _purge_snapshots()
                ph = await _purge_hourly()
                logger.info(
                    "retention_loop: daily tasks — %d daily buckets, "
                    "purged %d snapshots, %d hourly rows",
                    d, ps, ph
                )
                extras = f" daily={d} purged_snap={ps} purged_hourly={ph}"
            pipeline_runs.finish(run_id, status="success", records=h,
                                 notes=f"hourly={h}{extras}")
        except Exception as exc:
            logger.exception("retention_loop: cycle failed")
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])
