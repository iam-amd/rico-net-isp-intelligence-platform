"""Runtime path helpers for Railwire scraper state.

Code stays in the repo; credentials, sessions, and mutable settings live in a
machine-local runtime directory by default.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Optional


SCRAPER_DIR = Path(__file__).resolve().parent


def runtime_dir() -> Path:
    configured = os.getenv("RICO_SCRAPER_RUNTIME_DIR")
    if configured:
        path = Path(configured).expanduser()
    else:
        base = os.getenv("LOCALAPPDATA")
        path = Path(base) / "RicoNet" / "scraper" if base else Path.home() / ".rico" / "scraper"
    path.mkdir(parents=True, exist_ok=True)
    return path


def config_path() -> Path:
    path = Path(os.getenv("RICO_SCRAPER_CONFIG", runtime_dir() / "config.json")).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    legacy = SCRAPER_DIR / "config.json"
    if not path.exists() and legacy.exists():
        shutil.copy2(legacy, path)
    return path


def session_file(active_account: Optional[str]) -> Path:
    safe_admin = active_account or "default"
    path = runtime_dir() / f"railwire_auth_{safe_admin}.json"
    legacy = SCRAPER_DIR / f"railwire_auth_{safe_admin}.json"
    if not path.exists() and legacy.exists():
        shutil.copy2(legacy, path)
    return path


def captcha_debug_dir() -> Path:
    path = runtime_dir() / "captcha_debug"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sync_watermark_file() -> Path:
    return runtime_dir() / ".sync_watermark"


def scheduler_heartbeat_file() -> Path:
    return runtime_dir() / "scheduler_heartbeat.json"
