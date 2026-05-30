"""Background worker — ONU identity sync from Pi.

Calls Pi proxy's /olt/scan once per hour to capture ONT serial numbers
(SN doesn't change unless the device is physically replaced, so once/hour
is plenty). Updates onu_latest.ont_serial_number which the customer
profile enricher then propagates to customers.ont_serial_number.

Why an hourly cadence: SN is stable per device. The high-frequency 60s
SNMP poll captures volatile data (online/offline, rx_power). SN doesn't
need to be in that hot path.
"""
import asyncio
import logging
import os

from database import SessionLocal
from services import pipeline_runs
from services.onu_identity_sync import sync_identity_from_pi

logger = logging.getLogger("rico_net.identity_sync_loop")

INTERVAL_SEC = int(os.environ.get("ONU_IDENTITY_SYNC_INTERVAL_SEC", "3600"))  # 1 hour default


async def identity_sync_loop():
    # Wait a few minutes after startup so the first engine + Pi poll cycles
    # finish before we trigger a heavy Telnet scan.
    await asyncio.sleep(120)
    while True:
        run_id = pipeline_runs.start("onu_identity_sync")
        try:
            db = SessionLocal()
            try:
                r = sync_identity_from_pi(db, timeout=180)
            finally:
                db.close()
            logger.info(
                "identity_sync: scanned=%d sn_updates=%d model_updates=%d",
                r["scanned"], r["sn_updates"], r["model_updates"],
            )
            pipeline_runs.finish(
                run_id, status="success",
                records=r["sn_updates"] + r["model_updates"],
                notes=f"scanned={r['scanned']} sn={r['sn_updates']} model={r['model_updates']}",
            )
        except Exception as exc:
            logger.exception("identity_sync: cycle failed")
            pipeline_runs.finish(run_id, status="failed", error=str(exc)[:500])

        await asyncio.sleep(INTERVAL_SEC)
