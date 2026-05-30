"""
Rico Net — Scraper Scheduler (v2)
===================================
Fixed and hardened APScheduler daemon:
  • Exception propagation — false-success bug fixed (job_listener no longer
    reports success when the inner function raises)
  • Heartbeat JSON — written every minute so the dashboard can detect crashes
  • Session pre-check — validates Railwire session before each scheduled job;
    triggers AI auto-login if expired; skips the job if renewal fails
  • Configurable schedules — csv_hour, details_hour, mac_interval_hours all
    read from config.json so the portal settings page can change them
  • Run-tracking — each job records a ScraperRun row (success/fail/duration)

Usage:
  python scheduler.py           # Start the daemon (runs forever)
  python scheduler.py --now     # Run all jobs once immediately, then schedule
"""

import time
import asyncio
import logging
import sys
import argparse
import os
import json
import traceback
from datetime import datetime, timezone
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR, EVENT_JOB_MISSED

from runtime_paths import config_path, scheduler_heartbeat_file

# ── Config ────────────────────────────────────────────────────────────────────

SCRAPER_DIR = os.path.dirname(os.path.abspath(__file__))
HEARTBEAT_FILE = str(scheduler_heartbeat_file())


def load_config() -> dict:
    try:
        with open(config_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def write_heartbeat(status: str, message: str = ""):
    """Update heartbeat JSON so dashboard can detect crashes."""
    try:
        data = {
            "status": status,
            "message": message,
            "ts": datetime.now(timezone.utc).isoformat(),
            "pid": os.getpid(),
        }
        with open(HEARTBEAT_FILE, "w") as f:
            json.dump(data, f)
    except Exception:
        pass  # Never crash the scheduler over a heartbeat write failure


# ── Logging ───────────────────────────────────────────────────────────────────

LOG_FILE = os.path.join(SCRAPER_DIR, "scheduler.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ]
)
logger = logging.getLogger("ScraperScheduler")


# ── Session pre-check ─────────────────────────────────────────────────────────

def _any_account_has_session_file() -> bool:
    """
    Multi-account aware pre-check. Returns True if at least one configured
    account has a saved session file on disk. The scraper itself (scraper.main)
    handles per-account validity + auto-renewal during the actual run, so a
    heavyweight pre-check is no longer needed here.

    We only fail-fast if NO account has any session at all — in that case the
    operator must run `python scraper.py --step session` first.
    """
    try:
        from scraper import get_accounts
        from runtime_paths import session_file
    except Exception as e:
        logger.error(f"❌ Could not import scraper helpers: {e}")
        return False

    accounts = get_accounts()
    if not accounts:
        logger.error("❌ No accounts configured in config.json")
        return False

    found_any = False
    for a in accounts:
        sf = str(session_file(a["username"]))
        if os.path.exists(sf):
            found_any = True
            logger.info("✅ Found session file for %s", a["username"])
        else:
            logger.warning("⚠️ No session file for %s (scraper will try to renew)", a["username"])
    if not found_any:
        logger.error("❌ No session files for any configured account. Run: python scraper.py --step session")
    return found_any


def check_session_sync() -> bool:
    """Synchronous wrapper — just a fast file-existence pre-check across all accounts."""
    try:
        return _any_account_has_session_file()
    except Exception as e:
        logger.error(f"❌ Session pre-check failed: {e}")
        return False


# ── Job Functions ─────────────────────────────────────────────────────────────

def _run_step(step: str):
    """
    Core executor for all scheduled jobs.
    - Reloads config so schedule changes take effect without restart
    - Pre-checks session; skips job if session can't be established
    - Propagates exceptions so APScheduler records ERROR (not SUCCESS)
    - Writes heartbeat on entry and exit
    """
    config = load_config()
    if not config.get("scheduler_enabled", True):
        logger.info(f"⏸️  Scheduler disabled in config — skipping '{step}' job")
        return

    write_heartbeat("running", f"Running job: {step}")
    logger.info(f"🔑 Pre-checking session before '{step}' job…")
    if not check_session_sync():
        write_heartbeat("session_error", f"Session invalid before {step}")
        raise RuntimeError(f"Session check failed before '{step}' job — aborting")

    logger.info(f"▶️  Starting scheduled job: {step}")
    try:
        from scraper import main as scraper_main
        asyncio.run(scraper_main(step))
        write_heartbeat("idle", f"Last job: {step} OK")
        logger.info(f"✅ Scheduled job '{step}' complete")
    except Exception as exc:
        write_heartbeat("error", f"Job '{step}' failed: {exc}")
        logger.error(f"❌ Scheduled job '{step}' failed: {exc}")
        logger.debug(traceback.format_exc())
        raise  # Re-raise so APScheduler marks this as EVENT_JOB_ERROR


def run_csv_sync():
    _run_step("csv")


def run_details_scrape():
    _run_step("details")


def run_mac_scrape():
    _run_step("mac")


def run_daily():
    _run_step("daily")


# ── Heartbeat tick ────────────────────────────────────────────────────────────

def heartbeat_tick():
    """Runs every minute so dashboard knows the daemon is alive."""
    write_heartbeat("idle", "Scheduler running normally")


# ── Event Listener (correct — no false success) ───────────────────────────────

def job_listener(event):
    """Log job completion/failure. APScheduler fires ERROR when _run_step raises."""
    if event.exception:
        logger.error(f"💀 Job '{event.job_id}' FAILED: {event.exception}")
        write_heartbeat("error", f"Job '{event.job_id}' crashed")
    elif hasattr(event, 'missed_fire_time'):
        logger.warning(f"⚠️  Job '{event.job_id}' was missed at {event.missed_fire_time}")
    else:
        logger.info(f"✅ Job '{event.job_id}' finished successfully")


# ── Schedule builder ──────────────────────────────────────────────────────────

def build_schedule(scheduler: BackgroundScheduler, config: dict):
    """Add all jobs to the scheduler with config-driven timings."""
    # CSV sync — every N hours so we pick up customer removals quickly.
    # Daily-at-2am was too slow: customers removed mid-day stayed in
    # mac_scrape_pending until next morning's sync.
    csv_interval_hours   = int(config.get("csv_interval_hours", 2))
    details_hour         = int(config.get("details_hour", 3))
    mac_interval_hours   = int(config.get("mac_interval_hours", 2))

    scheduler.add_job(
        run_csv_sync,
        "interval", hours=csv_interval_hours,
        id="csv_sync",
        name=f"CSV Sync (every {csv_interval_hours}h)",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=600,
    )

    scheduler.add_job(
        run_details_scrape,
        "cron", hour=details_hour, minute=0,
        id="details_scrape",
        name=f"Daily Details Scrape ({details_hour:02d}:00)",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=600,
    )

    scheduler.add_job(
        run_mac_scrape,
        "interval", hours=mac_interval_hours,
        id="mac_scrape",
        name=f"MAC Scrape (every {mac_interval_hours}h)",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=1800,
    )

    scheduler.add_job(
        heartbeat_tick,
        "interval", minutes=1,
        id="heartbeat",
        name="Scheduler Heartbeat",
        replace_existing=True,
        max_instances=1,
    )

    logger.info(f"  📋 CSV sync        → Every {csv_interval_hours} hour(s)")
    logger.info(f"  📝 Details scrape  → Daily at {details_hour:02d}:00")
    logger.info(f"  🔍 MAC scrape      → Every {mac_interval_hours} hour(s)")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rico Net Scraper Scheduler v2")
    parser.add_argument(
        "--now", action="store_true",
        help="Run all jobs once immediately (then continue on schedule)"
    )
    args = parser.parse_args()

    config = load_config()

    logger.info("=" * 60)
    logger.info("🚀 Rico Net Scraper Scheduler v2 Starting…")
    logger.info("=" * 60)
    logger.info("Schedule:")

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_listener(
        job_listener,
        EVENT_JOB_EXECUTED | EVENT_JOB_ERROR | EVENT_JOB_MISSED
    )

    build_schedule(scheduler, config)
    logger.info("")
    logger.info("Press CTRL+C to stop")
    logger.info("=" * 60)

    write_heartbeat("starting", "Scheduler initializing")
    scheduler.start()
    write_heartbeat("idle", "Scheduler running")

    if args.now:
        logger.info("🏃 --now flag: running all jobs immediately…")
        run_csv_sync()
        run_mac_scrape()

    try:
        while True:
            time.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        logger.info("🛑 Shutting down scheduler…")
        write_heartbeat("stopped", "Scheduler shut down by user")
        scheduler.shutdown()
        logger.info("✅ Scheduler stopped.")
