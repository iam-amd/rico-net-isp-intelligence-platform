#!/usr/bin/env python3
"""
Seamless Scraper Startup — Runs all components together

Components:
1. Sync Daemon (continuous SQLite → PostgreSQL sync) [background]
2. Scheduler (24/7 automated scraping) [background]
3. Dashboard API (admin panel on :5005) [foreground]

All components run in parallel. Logs from each go to separate files + console.
Ctrl+C stops all components gracefully.
"""

import subprocess
import sys
import time
import logging
from pathlib import Path
from typing import List
import signal
import os

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [STARTUP] - %(message)s'
)
logger = logging.getLogger(__name__)

# Process list for cleanup
processes: List[subprocess.Popen] = []


def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    logger.info("\n⏹️  Shutting down all components...")
    for proc in processes:
        if proc.poll() is None:  # Still running
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    logger.info("✓ All components stopped")
    sys.exit(0)


def start_sync_daemon():
    """Start the auto-sync daemon"""
    logger.info("🔄 Starting Sync Daemon (SQLite ↔ PostgreSQL)...")
    try:
        proc = subprocess.Popen(
            [sys.executable, 'sync_daemon.py'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(proc)
        logger.info("✓ Sync Daemon started (PID: %d)" % proc.pid)
        return proc
    except Exception as e:
        logger.error(f"Failed to start Sync Daemon: {e}")
        return None


def start_scheduler():
    """Start the 24/7 scraper scheduler"""
    logger.info("⏰ Starting Scheduler (24/7 automation)...")
    try:
        proc = subprocess.Popen(
            [sys.executable, 'scheduler.py'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(proc)
        logger.info("✓ Scheduler started (PID: %d)" % proc.pid)
        return proc
    except Exception as e:
        logger.error(f"Failed to start Scheduler: {e}")
        return None


def start_dashboard():
    """Start the admin dashboard API"""
    logger.info("📊 Starting Dashboard API (http://localhost:5005)...")
    try:
        proc = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'dashboard:app', '--host', '0.0.0.0', '--port', '5005', '--reload'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        processes.append(proc)
        logger.info("✓ Dashboard API started (PID: %d)" % proc.pid)
        return proc
    except Exception as e:
        logger.error(f"Failed to start Dashboard: {e}")
        return None


def monitor_processes():
    """Monitor process health and log output"""
    import select

    try:
        while True:
            for proc in processes:
                if proc.stdout:
                    try:
                        # Non-blocking read
                        line = proc.stdout.readline()
                        if line:
                            logger.info(f"[{proc.pid}] {line.strip()}")
                    except:
                        pass

                # Check if process died
                if proc.poll() is not None:
                    logger.warning(f"⚠️  Process {proc.pid} died with code {proc.returncode}")

            time.sleep(0.1)
    except KeyboardInterrupt:
        raise


def main():
    logger.info("=" * 70)
    logger.info("🚀 RICO NET SCRAPER — SEAMLESS STARTUP")
    logger.info("=" * 70)

    # Verify dependencies
    try:
        import playwright
        import sqlalchemy
        import fastapi
        logger.info("✓ All dependencies found")
    except ImportError as e:
        logger.error(f"Missing dependency: {e}")
        logger.error("Run: pip install -r requirements.txt")
        sys.exit(1)

    # Register signal handler
    signal.signal(signal.SIGINT, signal_handler)

    # Start all components
    logger.info("\n📦 Starting components...")
    time.sleep(1)

    sync_proc = start_sync_daemon()
    time.sleep(2)

    scheduler_proc = start_scheduler()
    time.sleep(2)

    dashboard_proc = start_dashboard()
    time.sleep(3)

    logger.info("\n" + "=" * 70)
    logger.info("✓ ALL COMPONENTS RUNNING")
    logger.info("=" * 70)
    logger.info("")
    logger.info("📊 Dashboard:  http://localhost:5005")
    logger.info("⏰ Scheduler:   Running (logs in scheduler.log)")
    logger.info("🔄 Sync:       Running (logs in sync_daemon.log)")
    logger.info("📝 Scraper:    Running (logs in scraper.log)")
    logger.info("")
    logger.info("Press Ctrl+C to stop all components")
    logger.info("=" * 70 + "\n")

    # Monitor and keep running
    try:
        while True:
            for proc in processes:
                if proc.poll() is not None:
                    logger.warning(f"Process {proc.pid} exited unexpectedly")
                    signal_handler(None, None)
            time.sleep(5)
    except KeyboardInterrupt:
        signal_handler(None, None)


if __name__ == '__main__':
    main()
