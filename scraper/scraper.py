"""
Rico Net — Railwire Scraper (v2)
=================================
Full-featured, fully-automated scraper with:
  • Free local CAPTCHA solving via ddddocr (no API key needed)
  • Run-history tracking in SQLite for the Command Center dashboard
  • No-delete policy: customers removed from Railwire → flagged, never deleted
  • Configurable anti-detection delays via config.json
  • MAC scrape checkpointing — resume after interruption
  • Data usage URLs stored in DB (not a CSV sidecar file)
  • SQLite WAL mode for concurrent read/write safety

Run order:
  python scraper.py --step session   # Force a fresh AI-login (saves session)
  python scraper.py --step csv       # Download CSV, import/refresh all customers
  python scraper.py --step details   # Scrape name + address for missing records
  python scraper.py --step mac       # Scrape MAC addresses (stealth, batched)
  python scraper.py --step all       # csv → details → mac in sequence
  python scraper.py --step daily     # Quick CSV re-sync

Requirements:
  pip install -r requirements.txt
  playwright install chromium
"""

import io
import asyncio
import random
import logging
import argparse
import sys
import os
import json
import csv
import re
from datetime import datetime
from pathlib import Path

import pandas as pd
import math
from sqlalchemy import (
    create_engine, Column, String, Float, Integer,
    DateTime, Boolean, Text, ForeignKey, text
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session
from sqlalchemy.sql import func
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

from runtime_paths import SCRAPER_DIR as SCRAPER_PATH, config_path, session_file

# Optional: stealth — makes Playwright undetectable
try:
    from playwright_stealth import Stealth
    HAS_STEALTH = True
except ImportError:
    HAS_STEALTH = False

# Optional: PIL for CAPTCHA preprocessing (used by session_manager)
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ── Configuration ─────────────────────────────────────────────────────────────

BASE_URL      = "https://tn.railwire.co.in"
LOGIN_URL     = f"{BASE_URL}/rlogin"
SUBS_URL      = f"{BASE_URL}/anpcntl/mysubscribers"
DETAIL_URL    = f"{BASE_URL}/anpcntl/subscriptiondetail"
DATAUSE_URL   = f"{BASE_URL}/anpcntl/currentmonthdatause"

# Credentials from Config
def load_config():
    path = config_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"accounts": [], "active_account": "", "mac_batch_size": 100, "scheduler_enabled": True}

app_config = load_config()
ANTHROPIC_KEY = app_config.get("anthropic_api_key", "") or os.getenv("ANTHROPIC_API_KEY", "")


def get_accounts() -> list:
    """All configured accounts with non-empty username+password. Drives multi-account scraping."""
    cfg = load_config()
    out = []
    for a in cfg.get("accounts", []):
        u = (a.get("username") or "").strip()
        p = (a.get("password") or "").strip()
        if u and p:
            out.append({"username": u, "password": p})
    return out


def _default_account() -> dict:
    """Pick the initial-binding account: active_account if set+valid, else the first account."""
    cfg = load_config()
    active = (cfg.get("active_account") or "").strip()
    accounts = get_accounts()
    if active:
        for a in accounts:
            if a["username"] == active:
                return a
    return accounts[0] if accounts else {"username": "", "password": ""}


# Module-level credential globals — mutated per-account by set_active_account() during main() loop.
# Initial values preserve legacy single-account behavior for any callers that import them.
_default = _default_account()
RW_USERNAME  = _default["username"]
RW_PASSWORD  = _default["password"]
_safe_admin  = RW_USERNAME if RW_USERNAME else "default"
SESSION_FILE = str(session_file(_safe_admin))


def set_active_account(username: str, password: str):
    """Re-bind the module credentials + session file for the given account.
    All step functions read these globals at call time, so re-binding before each
    per-account scrape switches the scraper to the new account cleanly."""
    global RW_USERNAME, RW_PASSWORD, _safe_admin, SESSION_FILE
    RW_USERNAME = username
    RW_PASSWORD = password
    _safe_admin = username if username else "default"
    SESSION_FILE = str(session_file(_safe_admin))

# Database — WAL mode for concurrent access safety
SCRAPER_DIR = str(SCRAPER_PATH)
DB_URL      = f"sqlite:///{SCRAPER_DIR}/rico_net.db?timeout=30"

# Anti-detection settings (read from config, fallback to defaults)
MAC_DELAY_MIN  = float(app_config.get("mac_delay_min", 20.0))
MAC_DELAY_MAX  = float(app_config.get("mac_delay_max", 35.0))
PAGE_DELAY_MIN = 1.5
PAGE_DELAY_MAX = 4.0
MAC_BATCH_SIZE = int(app_config.get("mac_batch_size", 100))

# Retries
MAX_RETRIES = 3

# ── Logging ───────────────────────────────────────────────────────────────────

def setup_logging(step: str):
    """Setup step-specific logging for better visibility."""
    # Root logger settings
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    
    # Clear existing handlers if any (to avoid duplicates)
    for handler in root.handlers[:]:
        root.removeHandler(handler)
        
    formatter = logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s")
    
    # Stream for console
    ch = logging.StreamHandler()
    ch.setFormatter(formatter)
    root.addHandler(ch)
    
    # Step-specific log file
    log_map = {
        "single": "single_scrape.log",
        "csv": "csv_sync.log",
        "mac": "mac_scrape.log",
        "details": "details_scrape.log",
        "session": "session_setup.log"
    }
    filename = log_map.get(step, "scraper.log")
    
    fh = logging.FileHandler(filename, encoding="utf-8")
    fh.setFormatter(formatter)
    root.addHandler(fh)
    
    return logging.getLogger("rico_scraper")

log = logging.getLogger("rico_scraper")

# ── Database ──────────────────────────────────────────────────────────────────

Base = declarative_base()

class Customer(Base):
    __tablename__ = "customers"

    railwire_id        = Column(Integer, primary_key=True)
    railwire_admin     = Column(String, default="default")
    username           = Column(String, unique=True, index=True)
    full_name          = Column(String)
    mobile_number      = Column(String)
    email              = Column(String)
    full_address       = Column(Text)
    plan_name          = Column(String)
    expiry_date        = Column(String)
    account_balance    = Column(Float, default=0.0)
    fallback_status    = Column(String)
    registration_date  = Column(String)
    gstin              = Column(String)
    subscription_type  = Column(String)
    last_topup         = Column(String)

    # From data usage page — THE bridge key
    mac_address        = Column(String, index=True)
    framed_ip          = Column(String)
    monthly_data_used_mb = Column(Float, default=0.0)
    data_remaining_gb  = Column(Float, default=0.0)
    datause_url        = Column(String)     # cached URL — avoids re-navigating detail page

    # Railwire presence tracking (no-delete policy)
    # "active" = in latest CSV | "not_found" = absent from latest CSV
    railwire_status    = Column(String, default="active", index=True)
    last_seen_in_railwire = Column(DateTime)

    # Status
    is_online          = Column(Boolean, default=False)
    account_status     = Column(String, default="Active")

    # OLT data — filled later by ONU mapping engine
    olt_id             = Column(Integer)
    pon_port           = Column(String)
    onu_index          = Column(Integer)

    # Meta
    mac_scraped_at     = Column(DateTime)
    detail_scraped_at  = Column(DateTime)
    last_synced_at     = Column(DateTime)
    created_at         = Column(DateTime, default=datetime.utcnow)

    # MAC scrape outcome tracking — needed for the data-quality state machine.
    # error_reason values: 'no_mac_on_page' | 'search_timeout' | 'detail_missing' | 'data_usage_link_missing' | 'navigation_error' | None
    mac_scrape_attempts   = Column(Integer, default=0)
    mac_last_attempt_at   = Column(DateTime)
    mac_last_error        = Column(String(60))

    audit_logs = relationship("ScraperAuditLog", back_populates="customer", cascade="all, delete-orphan")


class ScraperAuditLog(Base):
    """Every field change made by the scraper — full traceability."""
    __tablename__ = "scraper_audit_log"

    id          = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.railwire_id", ondelete="CASCADE"), nullable=False, index=True)
    action      = Column(String(50), nullable=False)
    field_name  = Column(String(50), nullable=True)
    old_value   = Column(Text, nullable=True)
    new_value   = Column(Text, nullable=True)
    changed_by  = Column(String(50), default="Scraper Engine")
    changed_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    customer = relationship("Customer", back_populates="audit_logs")


class ScraperRun(Base):
    """
    Every scraper job execution — success, failure, duration, counts.
    Powers the Run History panel in the Command Center dashboard.
    """
    __tablename__ = "scraper_runs"

    id                = Column(Integer, primary_key=True, index=True)
    step              = Column(String(20), nullable=False, index=True)  # csv|mac|details|daily|session|all
    triggered_by      = Column(String(20), default="scheduler")         # scheduler|manual|api
    railwire_admin    = Column(String(80), nullable=True, index=True)   # which account this run was for
    started_at        = Column(DateTime, default=datetime.utcnow, index=True)
    finished_at       = Column(DateTime, nullable=True)
    duration_s        = Column(Float, nullable=True)
    status            = Column(String(20), default="running", index=True)  # running|success|failed|partial|skipped
    records_processed = Column(Integer, default=0)
    records_created   = Column(Integer, default=0)
    records_updated   = Column(Integer, default=0)
    errors_count      = Column(Integer, default=0)
    error_message     = Column(Text, nullable=True)
    session_was_valid = Column(Boolean, nullable=True)
    notes             = Column(Text, nullable=True)


class ScraperHealth(Base):
    """
    Key-value health store — latest freshness timestamps, session status, counts.
    Polled by the Command Center dashboard every 30 seconds.
    """
    __tablename__ = "scraper_health"

    key        = Column(String(80), primary_key=True)
    value      = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


def get_db():
    engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})
    # Enable WAL mode for safe concurrent access between scraper + dashboard
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("PRAGMA synchronous=NORMAL"))
        conn.commit()
    # Create new tables (ScraperRun, ScraperHealth) if missing
    Base.metadata.create_all(engine)
    # Add new columns to existing tables if they don't exist yet
    _migrate_customers_table(engine)
    _migrate_scraper_runs_table(engine)
    return engine


def _migrate_customers_table(engine):
    """Add new columns introduced in scraper v2 to an existing DB without losing data."""
    new_columns = [
        ("datause_url",            "TEXT"),
        ("railwire_status",        "TEXT DEFAULT 'active'"),
        ("last_seen_in_railwire",  "DATETIME"),
        # MAC outcome tracking (v3 — for data-quality state machine)
        ("mac_scrape_attempts",    "INTEGER DEFAULT 0"),
        ("mac_last_attempt_at",    "DATETIME"),
        ("mac_last_error",         "TEXT"),
    ]
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(customers)")).fetchall()
        existing = {r[1] for r in rows}
        for col_name, col_def in new_columns:
            if col_name not in existing:
                conn.execute(text(f"ALTER TABLE customers ADD COLUMN {col_name} {col_def}"))
        conn.commit()


def _record_mac_attempt(session, sub_id: int, *, error_reason: str | None) -> None:
    """Bookkeeping after each MAC scrape attempt. `error_reason=None` means success
    (MAC was actually found). `error_reason='no_mac_on_page'` means the page was
    reached but had no MAC — different from a network/parse failure.

    Also bumps last_synced_at so sync_daemon's incremental sync picks up the
    failure tracking columns and propagates them to Postgres."""
    try:
        cust = session.get(Customer, sub_id)
        if not cust:
            return
        now = datetime.utcnow()
        cust.mac_scrape_attempts = (cust.mac_scrape_attempts or 0) + 1
        cust.mac_last_attempt_at = now
        cust.mac_last_error = error_reason   # None on success
        cust.last_synced_at = now            # ← so sync_daemon sees this row as changed
        session.commit()
    except Exception:
        try: session.rollback()
        except Exception: pass


def _migrate_scraper_runs_table(engine):
    """Multi-account tag column for scraper_runs. Safe to call repeatedly."""
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(scraper_runs)")).fetchall()
        existing = {r[1] for r in rows}
        if "railwire_admin" not in existing:
            conn.execute(text("ALTER TABLE scraper_runs ADD COLUMN railwire_admin TEXT"))
        conn.commit()


# ---------------------------------------------------------------------------
# Run tracking helpers
# ---------------------------------------------------------------------------

def run_start(session: Session, step: str, triggered_by: str = "scheduler", admin: str = None) -> int:
    """Insert a running ScraperRun and return its ID. `admin` tags the run with the railwire account."""
    run = ScraperRun(
        step=step,
        triggered_by=triggered_by,
        railwire_admin=admin,
        started_at=datetime.utcnow(),
        status="running",
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    _set_health(session, f"current_run_{step}", f"running since {datetime.utcnow().isoformat()}")
    if admin:
        _set_health(session, f"current_run_{step}_{admin}", f"running since {datetime.utcnow().isoformat()}")
    return run.id


def run_finish(session: Session, run_id: int, status: str = "success",
               records_processed: int = 0, records_created: int = 0,
               records_updated: int = 0, errors: int = 0,
               error_message: str = None, session_valid: bool = None,
               notes: str = None):
    """Mark a run as finished and update health keys."""
    now = datetime.utcnow()
    run = session.get(ScraperRun, run_id)
    if not run:
        return
    run.finished_at       = now
    run.duration_s        = (now - run.started_at).total_seconds() if run.started_at else None
    run.status            = status
    run.records_processed = records_processed
    run.records_created   = records_created
    run.records_updated   = records_updated
    run.errors_count      = errors
    run.error_message     = error_message
    run.session_was_valid = session_valid
    run.notes             = notes
    session.commit()

    ts = now.isoformat()
    _set_health(session, f"last_{run.step}_run_at", ts)
    _set_health(session, f"last_{run.step}_status", status)
    _set_health(session, f"current_run_{run.step}", "idle")
    if run.railwire_admin:
        _set_health(session, f"last_{run.step}_run_at_{run.railwire_admin}", ts)
        _set_health(session, f"last_{run.step}_status_{run.railwire_admin}", status)
        _set_health(session, f"current_run_{run.step}_{run.railwire_admin}", "idle")


def _set_health(session: Session, key: str, value: str):
    """Upsert a health key."""
    row = session.get(ScraperHealth, key)
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        session.add(ScraperHealth(key=key, value=value, updated_at=datetime.utcnow()))
    try:
        session.commit()
    except Exception:
        session.rollback()


def upsert_customer(session: Session, data: dict, step_name: str = "Scraper"):
    """Insert or update a customer record, with audit logging."""
    rid = data.get("railwire_id")
    if not rid:
        return

    existing = session.get(Customer, rid)
    if existing:
        # Track changes for audit log
        for k, v in data.items():
            if v is not None and k != "railwire_id":
                old_val = getattr(existing, k, None)
                if old_val != v:
                    audit = ScraperAuditLog(
                        customer_id=rid,
                        action="UPDATE",
                        field_name=k,
                        old_value=str(old_val) if old_val is not None else None,
                        new_value=str(v),
                        changed_by=step_name,
                    )
                    session.add(audit)
                setattr(existing, k, v)
        existing.last_synced_at = datetime.utcnow()
    else:
        data["last_synced_at"] = datetime.utcnow()
        session.add(Customer(**data))
        audit = ScraperAuditLog(
            customer_id=rid,
            action="CREATE",
            field_name="account",
            new_value="Created via scraper",
            changed_by=step_name,
        )
        session.add(audit)


# ── Helper: Human-like delay ──────────────────────────────────────────────────

async def human_delay(min_s: float = PAGE_DELAY_MIN, max_s: float = PAGE_DELAY_MAX):
    """Sleep a random duration to mimic human browsing."""
    delay = random.uniform(min_s, max_s)
    await asyncio.sleep(delay)


# ── Helper: Launch browser ────────────────────────────────────────────────────

async def launch_browser(pw, headless: bool = True, use_session: bool = True):
    """
    Launch a stealthy Chromium browser.
    If use_session is True, loads saved session from railwire_auth.json.
    """
    browser = await pw.chromium.launch(
        headless=headless,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
    )

    context_args = {
        "viewport": {"width": 1280, "height": 800},
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }

    # Load saved session if available
    if use_session and os.path.exists(SESSION_FILE):
        context_args["storage_state"] = SESSION_FILE
        log.info(f"📂 Loading saved session from {os.path.basename(SESSION_FILE)}")

    context = await browser.new_context(**context_args)
    page = await context.new_page()

    # Apply stealth if available
    if HAS_STEALTH:
        await Stealth().apply_stealth_async(page)
        log.info("🥷 Stealth mode activated")
    else:
        log.warning("⚠️  playwright_stealth not installed — running without stealth")

    return browser, context, page


# ── Step: Generate Session ────────────────────────────────────────────────────

async def step_session(headless: bool = True):
    """
    Create or renew the Railwire login session.
    Uses ddddocr (free, local, no API key) to solve the CAPTCHA automatically.
    Saves authenticated session → all subsequent runs reuse cookies without CAPTCHA.
    """
    log.info("=" * 60)
    log.info("SESSION SETUP (auto CAPTCHA)")
    log.info("=" * 60)

    if not RW_USERNAME or not RW_PASSWORD:
        log.error("No credentials in config.json. Add accounts[0].username and password.")
        return False

    from session_manager import SessionManager
    sm = SessionManager(RW_USERNAME, RW_PASSWORD, SESSION_FILE, ANTHROPIC_KEY)

    async with async_playwright() as pw:
        browser, context, page = await launch_browser(pw, headless=headless, use_session=False)

        log.info("Starting auto CAPTCHA login (ddddocr — free, local solver)...")
        success = await sm._auto_login(page)

        if success:
            # Close any portal popup
            try:
                close_btn = page.locator("button:has-text('Close'), .close, [data-dismiss='modal']").first
                if await close_btn.is_visible(timeout=2000):
                    await close_btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                pass

            await context.storage_state(path=SESSION_FILE)
            log.info("✅ Session saved to %s", SESSION_FILE)
            log.info("All future runs will reuse this session — no CAPTCHA needed!")
        else:
            log.error("❌ Could not establish a session.")

        await browser.close()
        return success


# ── Helper: Check session validity ────────────────────────────────────────────

async def check_session(page) -> bool:
    """Navigate to subscribers page and check if we're logged in."""
    try:
        await page.goto(SUBS_URL, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(2)

        # If we got redirected to login page, session is expired
        if "rlogin" in page.url or "login" in page.url.lower():
            return False

        # Check for the subscribers table
        try:
            await page.wait_for_selector("table", timeout=5000)
            return True
        except PWTimeout:
            return False

    except Exception:
        return False


# ── Step 1: Download and Import CSV ───────────────────────────────────────────

async def step_csv(page, session: Session):
    """Download the subscriber CSV via 'Download CSV' button and import to DB."""
    log.info("=" * 60)
    log.info("📋 STEP CSV: Downloading subscriber CSV")
    log.info("=" * 60)

    # Navigate to subscribers page
    await page.goto(SUBS_URL, wait_until="domcontentloaded")
    await human_delay(2.0, 4.0)

    # Click "Download CSV" button
    csv_path = None
    try:
        download_btn = page.locator("text=Download CSV")
        await download_btn.wait_for(state="visible", timeout=10000)
        log.info("📥 Found 'Download CSV' button, starting export...")

        async with page.expect_download() as download_info:
            await download_btn.click()

        download = await download_info.value
        csv_path = Path("subscribers.csv")
        await download.save_as(csv_path)
        file_size = os.path.getsize(csv_path)
        log.info(f"✅ CSV downloaded successfully: {csv_path} ({file_size / 1024:.1f} KB)")

    except Exception as e:
        log.error(f"❌ CSV download via button failed: {e}")
        return 0

    # Parse and import
    df = pd.read_csv(csv_path, encoding="utf-8", dtype=str)
    df.columns = df.columns.str.strip()  # Remove whitespace from column names
    df = df.fillna("")

    log.info(f"📊 CSV has {len(df)} rows, columns: {list(df.columns)}")

    def clean_str(val):
        """Clean a value from CSV, return empty string for NaN/None."""
        if pd.isna(val) or str(val).strip().lower() == 'nan':
            return ""
        return str(val).strip()

    imported = 0
    created = 0
    updated = 0

    for _, row in df.iterrows():
        try:
            username = clean_str(row.get("username", ""))
            if not username:
                continue

            # Build full name from firstname + lastname
            first_name = clean_str(row.get("firstname", ""))
            last_name = clean_str(row.get("lastname", ""))
            full_name = f"{first_name} {last_name}".strip()

            # Parse subscriber ID
            sub_id_raw = clean_str(row.get("subscriberid", "0"))
            try:
                sub_id = int(float(sub_id_raw)) if sub_id_raw else 0
            except (ValueError, TypeError):
                sub_id = 0

            if not sub_id:
                continue

            # Parse mobile number (handle float format like 9876543210.0)
            mobile_raw = row.get("mobileno", "")
            mobile = ""
            if not pd.isna(mobile_raw) and str(mobile_raw).strip():
                try:
                    mobile_float = float(mobile_raw)
                    if not math.isnan(mobile_float):
                        mobile = str(int(mobile_float))
                except (ValueError, TypeError):
                    mobile = clean_str(mobile_raw)

            # Parse balance
            bal_raw = row.get("balance", "0")
            try:
                balance = float(bal_raw) if not pd.isna(bal_raw) else 0.0
            except (ValueError, TypeError):
                balance = 0.0

            data = {
                "railwire_id":       sub_id,
                "railwire_admin":    _safe_admin,
                "username":          username,
                "full_name":         full_name if full_name else None,
                "mobile_number":     mobile if mobile else None,
                "email":             clean_str(row.get("email", "")) or None,
                "full_address":      clean_str(row.get("address", "")) or None,
                "plan_name":         clean_str(row.get("packagename", "")) or None,
                "expiry_date":       clean_str(row.get("expiry", "")) or None,
                "account_balance":   balance,
                "registration_date": clean_str(row.get("registrationdate", "")) or None,
                "gstin":             clean_str(row.get("gstin", "")) or None,
                "account_status":    clean_str(row.get("sub_status", "")) or "Active",
            }

            # Check if it's a create or update
            existing = session.get(Customer, sub_id)
            upsert_customer(session, data, step_name="CSV Sync")

            if existing:
                updated += 1
            else:
                created += 1
            imported += 1

        except Exception as e:
            log.warning(f"⚠️  Row parse error: {e}")

    session.commit()

    # ── No-delete policy: mark customers absent from this CSV as "not_found" ──
    seen_ids = set(
        sub_id
        for _, row in df.iterrows()
        for sub_id in [
            (lambda v: int(float(v)) if v and str(v).replace('.','').isdigit() else 0)(
                str(row.get("subscriberid","")).strip()
            )
        ]
        if sub_id
    )
    not_found_count = 0
    all_db_customers = session.query(Customer).filter(
        Customer.railwire_admin == _safe_admin
    ).all()
    for cust in all_db_customers:
        if cust.railwire_id not in seen_ids:
            if cust.railwire_status != "not_found":
                cust.railwire_status = "not_found"
                not_found_count += 1
                session.add(ScraperAuditLog(
                    customer_id=cust.railwire_id,
                    action="NOT_FOUND",
                    field_name="railwire_status",
                    old_value="active",
                    new_value="not_found",
                    changed_by="CSV Sync",
                ))
        else:
            if cust.railwire_status == "not_found":
                cust.railwire_status = "active"
            cust.last_seen_in_railwire = datetime.utcnow()

    session.commit()

    log.info("✅ SYNC COMPLETE: %d total records processed.", imported)
    log.info("   ∟ %d new customers added", created)
    log.info("   ∟ %d existing records updated", updated)
    if not_found_count:
        log.warning("   ∟ %d customers absent from Railwire CSV (marked not_found — NOT deleted)", not_found_count)

    # Update health metrics (aggregate keys kept for dashboard backward-compat)
    ts = datetime.utcnow().isoformat()
    _set_health(session, "last_csv_sync_at", ts)
    _set_health(session, "csv_total_in_railwire", str(len(seen_ids)))
    _set_health(session, "csv_not_found_count", str(not_found_count))
    # Per-account keys for multi-account visibility
    _set_health(session, f"last_csv_sync_at_{_safe_admin}", ts)
    _set_health(session, f"csv_total_in_railwire_{_safe_admin}", str(len(seen_ids)))
    _set_health(session, f"csv_not_found_count_{_safe_admin}", str(not_found_count))

    return imported


# ── Step 2: Scrape Subscriber Detail Pages ────────────────────────────────────

async def collect_subscriber_links(page) -> dict:
    """
    Collect all subscriber detail links from the paginated list.
    Returns dict of {railwire_id: detail_url}.
    """
    log.info("🔗 Collecting subscriber detail links...")

    await page.goto(SUBS_URL, wait_until="domcontentloaded")
    await human_delay(2.0, 4.0)

    links = {}
    page_num = 1
    prev_count = -1
    stale_pages = 0

    while True:
        rows = await page.locator("table tbody tr").all()
        for row in rows:
            try:
                link_el = row.locator("a").first
                href = await link_el.get_attribute("href")
                if href and "subscriptiondetail" in href:
                    id_match = re.search(r'/subscriptiondetail/(\d+)/', href)
                    if id_match:
                        sub_id = int(id_match.group(1))
                        full_url = href if href.startswith("http") else BASE_URL + href
                        links[sub_id] = full_url
            except Exception:
                continue

        # Stop if no new links found (pagination exhausted)
        if len(links) == prev_count:
            stale_pages += 1
            if stale_pages >= 2:
                log.info(f"📄 Pagination complete — no new links for 2 pages")
                break
        else:
            stale_pages = 0
        prev_count = len(links)

        # Safety: max 100 pages
        if page_num >= 100:
            log.warning("⚠️  Hit max page limit (100), stopping pagination")
            break

        # Try next page
        try:
            next_btn = page.locator("a.paginate_button.next").first
            next_class = await next_btn.get_attribute("class") or ""
            if "disabled" in next_class:
                break
            await next_btn.click()
            await asyncio.sleep(random.uniform(1.0, 2.0))
            page_num += 1
            if page_num % 10 == 0:
                log.info(f"  📄 Page {page_num}, collected {len(links)} links so far")
        except Exception:
            break

    log.info(f"✅ Collected {len(links)} subscriber URLs across {page_num} pages")
    return links


async def scrape_detail_page(page, railwire_id: int, url: str) -> dict:
    """Scrape name + address + extra fields from a subscriber detail page."""
    for attempt in range(MAX_RETRIES):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(random.uniform(0.3, 1.0))

            data = {}

            # Name
            try:
                name_el = page.locator("td:has-text('Name') + td, tr:has-text('Name') td:last-child").first
                data["full_name"] = (await name_el.inner_text()).strip()
            except Exception:
                pass

            # Address
            try:
                addr_el = page.locator("td:has-text('Address') + td, tr:has-text('Address') td:last-child").first
                data["full_address"] = (await addr_el.inner_text()).strip()
            except Exception:
                pass

            # Subscription type
            try:
                type_el = page.locator("td:has-text('Subscription Type') + td").first
                data["subscription_type"] = (await type_el.inner_text()).strip()
            except Exception:
                pass

            # Last topup
            try:
                topup_el = page.locator("td:has-text('Last Topup') + td").first
                data["last_topup"] = (await topup_el.inner_text()).strip()
            except Exception:
                pass

            # Get data usage URL from "Click Here" link
            try:
                datause_link = page.locator("tr:has-text('View Data usage') a, td:has-text('View Data usage') + td a").first
                href = await datause_link.get_attribute("href")
                if href:
                    data["_datause_url"] = href if href.startswith("http") else BASE_URL + href
            except Exception:
                pass

            data["detail_scraped_at"] = datetime.utcnow()
            return data

        except PWTimeout:
            log.warning(f"⚠️  Detail page timeout for ID {railwire_id}, attempt {attempt + 1}")
            if attempt < MAX_RETRIES - 1:
                await human_delay(2.0, 4.0)

    return {}


async def step_details(page, session: Session):
    """Scrape name + address for all customers missing this data."""
    log.info("=" * 60)
    log.info("📝 STEP DETAILS: Scraping subscriber detail pages")
    log.info("=" * 60)

    customers = session.execute(
        text("SELECT railwire_id, username FROM customers WHERE full_name IS NULL OR full_name = ''")
    ).fetchall()

    log.info(f"📋 Found {len(customers)} customers missing detail data")

    if not customers:
        log.info("✅ All customers already have detail data")
        return

    # Collect detail URLs from subscriber list
    links = await collect_subscriber_links(page)

    done = 0
    for customer in customers:
        sub_id = customer.railwire_id
        url = links.get(sub_id)

        if not url:
            continue

        detail_data = await scrape_detail_page(page, sub_id, url)

        if detail_data:
            # Cache datause URL in DB for MAC step
            if "_datause_url" in detail_data:
                datause_url = detail_data.pop("_datause_url")
                session.execute(
                    text("UPDATE customers SET datause_url=:url WHERE railwire_id=:id"),
                    {"url": datause_url, "id": sub_id}
                )

            detail_data["railwire_id"] = sub_id
            upsert_customer(session, detail_data, step_name="Detail Scraper")
            done += 1

        if done % 5 == 0 and done > 0:
            session.commit()
            log.info(f"  📊 Progress: {done}/{len(customers)} detail pages scraped")

        await human_delay()

    session.commit()
    log.info(f"✅ Detail scraping complete: {done} customers updated")


# ── Step 3: Scrape MAC Addresses ──────────────────────────────────────────────

async def scrape_mac_via_search(page, session: Session):
    """
    Scrape MAC addresses by searching for each subscriber on the list page,
    clicking through to their detail page, then to their data usage page.
    Uses the old scraper's proven search-based approach with human-like delays.
    """
    log.info("=" * 60)
    log.info("🔍 STEP MAC: Scraping MAC addresses (stealth mode)")
    log.info("=" * 60)

    # Per-account scope: each subprocess processes ONLY its own customers.
    # Without this filter, acc1 would try to scrape acc2 customers, which
    # Railwire correctly rejects with "Expected Result Not Found" (because
    # acc1's session can't see acc2's customers) — and my auto-draft logic
    # would then incorrectly flag those customers as removed from Railwire.
    customers = session.execute(
        text("""
            SELECT railwire_id, username FROM customers
            WHERE (mac_address IS NULL OR mac_address = '')
              AND (railwire_status IS NULL OR railwire_status != 'not_found')
              AND railwire_admin = :admin
        """),
        {"admin": _safe_admin},
    ).fetchall()

    total = len(customers)
    log.info(f"📋 Found {total} active customers missing MAC addresses")

    if not customers:
        log.info("✅ All active customers already have MAC addresses")
        return

    # Process in batches
    batch = customers[:MAC_BATCH_SIZE]
    log.info(f"🔄 Processing batch of {len(batch)} (out of {total} total)")

    # ── In-session cache only ─────────────────────────────────────────────────
    # The data-usage URL is tokenized (per-session); persisting it across
    # batches yields stale tokens that look like "no MAC on page" failures.
    # We start fresh each batch and only cache within this process.
    datause_urls: dict[int, str] = {}
    log.info("📂 Using fresh in-session data-usage URL cache (no cross-batch reuse)")

    # Migrate any remaining CSV sidecar into DB then remove the file
    datause_file = Path(SCRAPER_DIR) / "datause_urls.csv"
    if datause_file.exists():
        migrated = 0
        with open(datause_file, newline="") as f:
            for row in csv.reader(f):
                if len(row) >= 2:
                    try:
                        rid = int(row[0])
                        url = row[1]
                        if rid not in datause_urls and url:
                            datause_urls[rid] = url
                            session.execute(
                                text("UPDATE customers SET datause_url=:url WHERE railwire_id=:id"),
                                {"url": url, "id": rid}
                            )
                            migrated += 1
                    except Exception:
                        pass
        if migrated:
            session.commit()
            log.info("📂 Migrated %d URLs from CSV sidecar → DB", migrated)
        datause_file.rename(datause_file.with_suffix(".csv.migrated"))

    success_count = 0
    fail_count = 0
    mac_pattern = re.compile(r'([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}')

    for i, customer in enumerate(batch):
        sub_id = customer.railwire_id
        username = customer.username
        log.info(f"🔍 [{i + 1}/{len(batch)}] Processing: {username} (ID: {sub_id})")

        # Track the failure mode so the classifier can act on it later.
        attempt_error: str | None = None
        try:
            # Check if we have a pre-collected datause URL
            du_url = datause_urls.get(sub_id)

            if not du_url:
                # Primary path: subscriber-list search → click → detail page (with token).
                # Railwire's URLs need a per-session token, so we must navigate via
                # the subscribers list to get a valid link.
                # Fallback (untokened direct URL) returns "Your Expected Result Not Found"
                # for many customers, so it's only useful for ones the search can't find.
                nav_ok = False
                for nav_attempt in range(2):
                    try:
                        await page.goto(SUBS_URL, wait_until="domcontentloaded", timeout=30000)
                        nav_ok = True
                        break
                    except Exception as e:
                        log.warning(f"⚠️  goto SUBS_URL attempt {nav_attempt+1}: {type(e).__name__}: {str(e)[:60]}")
                        await asyncio.sleep(3)
                if not nav_ok:
                    _record_mac_attempt(session, sub_id, error_reason="navigation_error")
                    fail_count += 1
                    continue
                # SESSION-DEATH CHECK: a dead session redirects to /rlogin.
                if "/rlogin" in page.url or "/login" in page.url.lower():
                    log.error(f"⚠️  Session expired mid-batch (redirected to {page.url}) — aborting batch")
                    _record_mac_attempt(session, sub_id, error_reason="session_expired")
                    fail_count += 1
                    break

                # Wait for the DataTables search box to render
                try:
                    await page.wait_for_selector("input[type='search']", state="visible", timeout=30000)
                except Exception:
                    log.warning(f"⚠️  Subscribers list search box never appeared for {username}")
                    _record_mac_attempt(session, sub_id, error_reason="search_timeout")
                    fail_count += 1
                    continue
                await human_delay(1.5, 3.0)

                # Search for this customer (Inactive ones appear too if you search explicitly)
                search_ok = False
                for search_attempt in range(2):
                    try:
                        search_input = page.locator("input[type='search']")
                        await search_input.fill("", timeout=10000)
                        await search_input.fill(username, timeout=15000)
                        await human_delay(2.0, 3.5)
                        search_ok = True
                        break
                    except Exception as e:
                        log.warning(f"⚠️  Search fill attempt {search_attempt+1} for {username}: {type(e).__name__}")
                        try: await page.reload(wait_until="domcontentloaded", timeout=30000)
                        except Exception: pass
                        await asyncio.sleep(3)
                if not search_ok:
                    _record_mac_attempt(session, sub_id, error_reason="search_timeout")
                    fail_count += 1
                    continue

                # Find the customer's tokenised subscription link
                user_link = None
                try:
                    # First try matching by href containing the sub_id (most specific)
                    cand = page.locator(f"a[href*='/anpcntl/subscriptiondetail/{sub_id}/']").first
                    if await cand.count() > 0:
                        user_link = cand
                except Exception:
                    pass
                if user_link is None:
                    # Fall back to clicking by username text
                    try:
                        cand = page.locator(f"text={username}").first
                        if await cand.count() > 0:
                            user_link = cand
                    except Exception:
                        pass
                if user_link is None:
                    # FALLBACK: try direct URL (works for some customers)
                    log.info(f"  ↪  {username} not in search results; trying direct URL")
                    try:
                        await page.goto(f"{BASE_URL}/anpcntl/subscriptiondetail/{sub_id}/", wait_until="domcontentloaded", timeout=30000)
                    except Exception:
                        _record_mac_attempt(session, sub_id, error_reason="detail_missing")
                        fail_count += 1
                        continue
                else:
                    try:
                        await user_link.wait_for(state="visible", timeout=10000)
                        await human_delay(0.5, 1.5)
                        await user_link.click()
                        await human_delay(1.0, 2.5)
                    except Exception as e:
                        log.warning(f"⚠️  click subscriber link failed for {username}: {type(e).__name__}")
                        _record_mac_attempt(session, sub_id, error_reason="detail_missing")
                        fail_count += 1
                        continue

                # SESSION-DEATH CHECK after navigation
                if "/rlogin" in page.url or "/login" in page.url.lower():
                    _record_mac_attempt(session, sub_id, error_reason="session_expired")
                    fail_count += 1
                    log.error("⛔ Session expired — aborting batch")
                    break

                # Detect "Your Expected Result Not Found" — Railwire's signal that
                # the subscription id is unresolvable (often because token missing,
                # OR the customer was deleted). This is NOT no_mac_on_page.
                try:
                    body_now = await page.locator("body").inner_text()
                    if re.search(r"Expected\s+Result\s+Not\s+Found|Error\s+Was\s+Encountered", body_now, re.IGNORECASE):
                        log.warning(f"⚠️  Railwire returned 'Expected Result Not Found' for {username}")
                        _record_mac_attempt(session, sub_id, error_reason="detail_missing")
                        try:
                            cust_row = session.get(Customer, sub_id)
                            if cust_row and cust_row.railwire_status != "not_found":
                                cust_row.railwire_status = "not_found"
                                session.commit()
                        except Exception:
                            try: session.rollback()
                            except Exception: pass
                        fail_count += 1
                        continue
                except Exception:
                    pass

                # Wait for JS to render content before reading body — otherwise
                # the Subscriber-Expired check below may silently miss because
                # the body is still mostly empty at domcontentloaded time.
                try:
                    await page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    await asyncio.sleep(1.5)

                # Check page text for the "Subscriber Expired ... contact MSP" message
                # before clicking anything — this short-circuits long-expired customers.
                try:
                    detail_text = await page.locator("body").inner_text()
                    if re.search(r"Subscriber\s+Expired\s+more\s+than|reactivate this subscriber|Please contact to MSP", detail_text, re.IGNORECASE):
                        m = re.search(r"Expired\s+more\s+than\s+(\d+)\s*days?", detail_text, re.IGNORECASE)
                        days = m.group(1) if m else "?"
                        log.info(f"  ⏸  {username} expired more than {days} days — contact MSP to reactivate")
                        _record_mac_attempt(session, sub_id, error_reason="subscriber_expired")
                        fail_count += 1
                        continue
                except Exception:
                    pass

                await human_delay(1.0, 2.5)

                # Find the data-usage link, falling back to direct URL nav.
                # New customers without session history sometimes don't render the
                # link on the detail page at all, but the data-usage page itself
                # is accessible directly.
                link_navigated = False
                try:
                    usage_link = None
                    # Strategy 1: href containing /currentmonthdatause/{sub_id}
                    try:
                        cand = page.locator(f"a[href*='/anpcntl/currentmonthdatause/{sub_id}']").first
                        if await cand.count() > 0:
                            usage_link = cand
                    except Exception:
                        usage_link = None
                    if usage_link is None:
                        # Strategy 2: any link containing currentmonthdatause
                        try:
                            cand = page.locator("a[href*='/anpcntl/currentmonthdatause']").first
                            if await cand.count() > 0:
                                usage_link = cand
                        except Exception:
                            usage_link = None
                    if usage_link is None:
                        # Strategy 3: exact "Click Here" text (not "Go Back")
                        try:
                            cand = page.locator("text=/^\\s*Click\\s+Here\\s*$/i").first
                            if await cand.count() > 0:
                                usage_link = cand
                        except Exception:
                            usage_link = None

                    if usage_link is not None:
                        await usage_link.wait_for(state="visible", timeout=10000)
                        href = await usage_link.get_attribute("href")
                        if href:
                            candidate_url = href if href.startswith("http") else BASE_URL + href
                            # Validate: only cache if it actually points at the
                            # current-month-datause endpoint for THIS sub_id.
                            # Strategy 3 ("Click Here" text match) used to capture
                            # back-to-list links and pollute the cache.
                            if f"/anpcntl/currentmonthdatause/{sub_id}" in candidate_url:
                                du_url = candidate_url
                                datause_urls[sub_id] = du_url
                                session.execute(
                                    text("UPDATE customers SET datause_url=:url WHERE railwire_id=:id"),
                                    {"url": du_url, "id": sub_id}
                                )
                                session.commit()
                            else:
                                log.warning(f"  ⚠️  ignoring non-datause Click-Here link: {candidate_url[:80]}")
                        await usage_link.click()
                        link_navigated = True
                except Exception:
                    pass

                # Strategy 4 (FALLBACK): direct URL nav to /currentmonthdatause/{sub_id}/.
                # Works when the detail page doesn't expose the link (e.g. fresh
                # customers) but the data-usage page itself is accessible.
                if not link_navigated:
                    fallback_url = f"{BASE_URL}/anpcntl/currentmonthdatause/{sub_id}/"
                    log.info(f"  ↪  no Click-Here link on detail page; trying direct {fallback_url}")
                    try:
                        await page.goto(fallback_url, wait_until="domcontentloaded", timeout=30000)
                        # SESSION-DEATH CHECK
                        if "/rlogin" in page.url or "/login" in page.url.lower():
                            log.error(f"⚠️  Session expired on fallback nav (got {page.url}) — aborting batch")
                            _record_mac_attempt(session, sub_id, error_reason="session_expired")
                            fail_count += 1
                            break
                        # If Railwire redirected to subscribers list, customer
                        # likely has no session history → just no MAC available.
                        if "/anpcntl/currentmonthdatause/" not in page.url:
                            log.warning(f"⚠️  direct currentmonthdatause redirected for {username} (got {page.url})")
                            _record_mac_attempt(session, sub_id, error_reason="data_usage_link_missing")
                            fail_count += 1
                            continue
                    except Exception:
                        log.warning(f"⚠️  Direct currentmonthdatause load failed for {username}")
                        _record_mac_attempt(session, sub_id, error_reason="data_usage_link_missing")
                        fail_count += 1
                        continue
            else:
                # Navigate directly to cached data usage page (within-session cache only)
                try:
                    await page.goto(du_url, wait_until="domcontentloaded", timeout=15000)
                except Exception as e:
                    log.warning(f"  ⚠️  cached du_url nav failed for {username}: {type(e).__name__}; invalidating cache")
                    datause_urls.pop(sub_id, None)
                    session.execute(
                        text("UPDATE customers SET datause_url=NULL WHERE railwire_id=:id"),
                        {"id": sub_id},
                    )
                    session.commit()
                    _record_mac_attempt(session, sub_id, error_reason="navigation_error")
                    fail_count += 1
                    continue

                # Cached URL must land on the data-usage page. If it doesn't
                # (stale token, redirected to list, expected-result-not-found,
                # or session died), invalidate cache and DON'T penalise the
                # customer — they'll go through the search flow next batch.
                landed_url = page.url
                if "/rlogin" in landed_url or "/login" in landed_url.lower():
                    log.error(f"⚠️  Session expired on cached nav (got {landed_url}) — aborting batch")
                    _record_mac_attempt(session, sub_id, error_reason="session_expired")
                    fail_count += 1
                    break
                if "/anpcntl/currentmonthdatause/" not in landed_url:
                    log.warning(f"  ⚠️  cached du_url landed on wrong page ({landed_url[:80]}) — invalidating cache")
                    datause_urls.pop(sub_id, None)
                    session.execute(
                        text("UPDATE customers SET datause_url=NULL WHERE railwire_id=:id"),
                        {"id": sub_id},
                    )
                    session.commit()
                    _record_mac_attempt(session, sub_id, error_reason="data_usage_link_missing")
                    fail_count += 1
                    continue
                try:
                    body_check = await page.locator("body").inner_text()
                    if re.search(r"Expected\s+Result\s+Not\s+Found|Error\s+Was\s+Encountered", body_check, re.IGNORECASE):
                        log.warning(f"  ⚠️  cached du_url returned 'Expected Result Not Found' — invalidating cache")
                        datause_urls.pop(sub_id, None)
                        session.execute(
                            text("UPDATE customers SET datause_url=NULL WHERE railwire_id=:id"),
                            {"id": sub_id},
                        )
                        session.commit()
                        _record_mac_attempt(session, sub_id, error_reason="data_usage_link_missing")
                        fail_count += 1
                        continue
                except Exception:
                    pass

            # Wait for page to load
            await human_delay(1.0, 2.0)

            # SESSION-DEATH CHECK on the final page too — we might have been
            # redirected to /rlogin after clicking Click Here.
            if "/rlogin" in page.url or "/login" in page.url.lower():
                log.error(f"⚠️  Session expired (final page redirect to {page.url}) — aborting batch")
                _record_mac_attempt(session, sub_id, error_reason="session_expired")
                fail_count += 1
                break

            # Extract MAC address from full page text (proven reliable method)
            try:
                await page.wait_for_selector("table", timeout=5000)
            except PWTimeout:
                pass  # Table might not exist, but MAC could still be in body text

            page_text = await page.locator("body").inner_text()

            # Defense-in-depth: re-check Subscriber-Expired here too. Sometimes
            # the detail-page check missed because inner_text was read too
            # early or after a stray navigation. The expired message also
            # appears on the data-usage page, so a second check catches it.
            if re.search(r"Subscriber\s+Expired\s+more\s+than|reactivate this subscriber|Please contact to MSP", page_text, re.IGNORECASE):
                m = re.search(r"Expired\s+more\s+than\s+(\d+)\s*days?", page_text, re.IGNORECASE)
                days = m.group(1) if m else "?"
                log.info(f"  ⏸  {username} expired more than {days} days (caught at data-usage stage) — contact MSP")
                _record_mac_attempt(session, sub_id, error_reason="subscriber_expired")
                fail_count += 1
                continue

            mac_match = mac_pattern.search(page_text)

            mac_data = {"railwire_id": sub_id, "mac_scraped_at": datetime.utcnow()}

            if mac_match:
                mac = mac_match.group(0).lower().replace("-", ":")
                mac_data["mac_address"] = mac
                log.info(f"  ✅ MAC found: {mac}")
                success_count += 1
                attempt_error = None
            else:
                log.info(f"  ⏭️  No MAC found for {username}")
                fail_count += 1
                attempt_error = "no_mac_on_page"

            # Also try to extract framed IP
            ip_match = re.search(r'(100\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+)', page_text)
            if ip_match:
                mac_data["framed_ip"] = ip_match.group(1)

            # Extract data usage
            try:
                used_match = re.search(r'Data\s*used[^0-9]*([\d.]+)\s*(GB|MB|TB)', page_text, re.IGNORECASE)
                if used_match:
                    val = float(used_match.group(1))
                    unit = used_match.group(2).upper()
                    if unit == "GB": val *= 1024
                    elif unit == "TB": val *= 1024 * 1024
                    mac_data["monthly_data_used_mb"] = round(val, 2)
            except Exception:
                pass

            upsert_customer(session, mac_data, step_name="MAC Scraper")

            # Record outcome so the classifier can act on persistent failures vs
            # "page truly had no MAC".
            _record_mac_attempt(session, sub_id, error_reason=attempt_error)

            # Commit after every user to avoid long locks
            session.commit()
            if (i + 1) % 5 == 0:
                log.info(f"  📊 Batch progress: {success_count} MACs found, {fail_count} not found")

        except Exception as e:
            log.error(f"  ❌ Error processing {username}: {e}")
            _record_mac_attempt(session, sub_id, error_reason="navigation_error")
            fail_count += 1

        # Human-like delay between subscribers (CRITICAL for stealth)
        if i < len(batch) - 1:
            delay = random.uniform(MAC_DELAY_MIN, MAC_DELAY_MAX)
            log.info(f"  ⏳ Waiting {delay:.0f}s (anti-detection)...")
            await asyncio.sleep(delay)

    session.commit()
    log.info(f"✅ MAC scraping complete: {success_count} found, {fail_count} not found")

    # Print DB summary
    total_db = session.execute(text("SELECT COUNT(*) FROM customers")).scalar()
    with_mac = session.execute(
        text("SELECT COUNT(*) FROM customers WHERE mac_address IS NOT NULL AND mac_address != ''")
    ).scalar()
    log.info(f"📊 Database: {with_mac}/{total_db} customers have MAC addresses")


# ── Step 4: Daily Sync ────────────────────────────────────────────────────────

async def step_daily(page, session: Session):
    """Quick daily sync — re-download CSV to update plans, balances, statuses."""
    log.info("=" * 60)
    log.info("🔄 DAILY SYNC: Refreshing subscriber data from CSV")
    log.info("=" * 60)
    count = await step_csv(page, session)
    log.info(f"✅ Daily sync complete — {count} customers processed")


async def step_single(page, session: Session, username: str):
    """Scrape all available data (details + MAC) for a single subscriber."""
    log.info("=" * 60)
    log.info(f"👤 SINGLE SCRAPE: {username}")
    log.info("=" * 60)

    customer = session.query(Customer).filter(Customer.username == username).first()
    if not customer:
        log.error(f"❌ Customer {username} not found in database!")
        return

    sub_id = customer.railwire_id
    
    # 1. Scrape Details (Name, Address, DataUse URL)
    log.info(f"📝 Scraping details for {username}...")
    
    # Try constructing URL directly first
    url = f"{BASE_URL}/anpcntl/subscriptiondetail/{sub_id}/"
    
    detail_data = await scrape_detail_page(page, sub_id, url)
    
    if detail_data:
        detail_data["railwire_id"] = sub_id
        upsert_customer(session, detail_data, step_name="Single Scraper")
        try:
            session.commit()
            log.info(f"✅ Details updated for {username}")
        except Exception as e:
            session.rollback()
            log.warning(f"⚠️ SQL Commit failed (locked?): {e}")
    else:
        log.warning(f"⚠️ Could not scrape detail page for {username}")

    # 2. Scrape MAC — direct URL nav (works for Inactive too)
    log.info(f"🔍 Scraping MAC for {username}...")
    try:
        direct_detail = f"{BASE_URL}/anpcntl/subscriptiondetail/{sub_id}/"
        searched_detail = False
        try:
            await page.goto(SUBS_URL, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_selector("input[type='search']", state="visible", timeout=30000)
            search_input = page.locator("input[type='search']")
            await search_input.fill("", timeout=10000)
            await search_input.fill(username, timeout=15000)
            await human_delay(2.0, 3.5)
            user_link = None
            cand = page.locator(f"a[href*='/anpcntl/subscriptiondetail/{sub_id}/']").first
            if await cand.count() > 0:
                user_link = cand
            else:
                cand = page.locator(f"text={username}").first
                if await cand.count() > 0:
                    user_link = cand
            if user_link is not None:
                await user_link.wait_for(state="visible", timeout=10000)
                await user_link.click()
                searched_detail = True
                await human_delay(1.0, 2.5)
        except Exception as e:
            log.warning(f"subscriber-list token navigation failed for {username}: {type(e).__name__}")
        nav_ok = bool(searched_detail and "/subscriptiondetail/" in page.url)
        for nav_attempt in range(2):
            if nav_ok:
                break
            try:
                await page.goto(direct_detail, wait_until="domcontentloaded", timeout=30000)
                nav_ok = True
                break
            except Exception as e:
                log.warning(f"⚠️ goto detail attempt {nav_attempt+1}: {e}")
                await asyncio.sleep(3)
        if not nav_ok:
            _record_mac_attempt(session, sub_id, error_reason="navigation_error")
            raise RuntimeError("Could not load detail page")
        # SESSION-DEATH CHECK first (so we don't false-flag the customer as draft)
        if "/rlogin" in page.url or "/login" in page.url.lower():
            _record_mac_attempt(session, sub_id, error_reason="session_expired")
            raise RuntimeError(f"Session expired — page redirected to {page.url}. Run --step session.")
        if "/subscriptiondetail/" not in page.url:
            _record_mac_attempt(session, sub_id, error_reason="detail_missing")
            # Auto-promote to draft: Railwire no longer recognises this id
            try:
                cust_row = session.get(Customer, sub_id)
                if cust_row and cust_row.railwire_status != "not_found":
                    cust_row.railwire_status = "not_found"
                    session.commit()
            except Exception:
                try: session.rollback()
                except Exception: pass
            raise RuntimeError(f"/subscriptiondetail/{sub_id}/ didn't land on a detail page — flagged as draft")

        # Wait for the JS-rendered content to actually be in the DOM before
        # checking text. domcontentloaded fires too early — body may still be
        # empty/loading when we read it, causing the Subscriber-Expired check
        # to silently miss.
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            await asyncio.sleep(1.5)

        # Check for "Subscriber Expired ... contact MSP" before clicking anything
        try:
            detail_text = await page.locator("body").inner_text()
            if re.search(r"Subscriber\s+Expired\s+more\s+than|reactivate this subscriber|Please contact to MSP", detail_text, re.IGNORECASE):
                m = re.search(r"Expired\s+more\s+than\s+(\d+)\s*days?", detail_text, re.IGNORECASE)
                days = m.group(1) if m else "?"
                _record_mac_attempt(session, sub_id, error_reason="subscriber_expired")
                raise RuntimeError(f"Subscriber expired more than {days} days — contact MSP to reactivate")
        except RuntimeError:
            raise
        except Exception:
            pass

        await human_delay(1.0, 2.0)

        # Find data-usage link robustly; fall back to direct URL nav if missing.
        link_navigated = False
        try:
            usage_link = None
            try:
                cand = page.locator(f"a[href*='/anpcntl/currentmonthdatause/{sub_id}']").first
                if await cand.count() > 0:
                    usage_link = cand
            except Exception: pass
            if usage_link is None:
                try:
                    cand = page.locator("a[href*='/anpcntl/currentmonthdatause']").first
                    if await cand.count() > 0:
                        usage_link = cand
                except Exception: pass
            if usage_link is None:
                try:
                    cand = page.locator("text=/^\\s*Click\\s+Here\\s*$/i").first
                    if await cand.count() > 0:
                        usage_link = cand
                except Exception: pass
            if usage_link is not None:
                await usage_link.wait_for(state="visible", timeout=10000)
                href = await usage_link.get_attribute("href")
                candidate_url = href if href and href.startswith("http") else (BASE_URL + href if href else None)
                if candidate_url and f"/anpcntl/currentmonthdatause/{sub_id}" in candidate_url:
                    await page.goto(candidate_url, wait_until="domcontentloaded", timeout=30000)
                    link_navigated = True
                else:
                    log.warning(f"  ignoring non-datause Click-Here link: {(candidate_url or '')[:80]}")
        except Exception:
            pass

        if not link_navigated:
            fallback_url = f"{BASE_URL}/anpcntl/currentmonthdatause/{sub_id}/"
            log.info(f"  ↪  no Click-Here link; trying direct {fallback_url}")
            try:
                await page.goto(fallback_url, wait_until="domcontentloaded", timeout=30000)
                if "/anpcntl/currentmonthdatause/" not in page.url:
                    _record_mac_attempt(session, sub_id, error_reason="data_usage_link_missing")
                    raise RuntimeError(f"Direct currentmonthdatause redirected away (got {page.url})")
            except RuntimeError:
                raise
            except Exception as e:
                _record_mac_attempt(session, sub_id, error_reason="data_usage_link_missing")
                raise RuntimeError(f"Direct currentmonthdatause load failed: {type(e).__name__}")
        await human_delay(2.0, 3.5)

        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            await asyncio.sleep(1.5)
        await page.wait_for_selector("body", timeout=10000)
        page_text = await page.locator("body").inner_text()

        # Defense-in-depth: catch subscriber-expired here too, in case the
        # detail-page check missed it (timing race) and we landed on the
        # expired notice via the direct-URL fallback.
        if re.search(r"Subscriber\s+Expired\s+more\s+than|reactivate this subscriber|Please contact to MSP", page_text, re.IGNORECASE):
            m = re.search(r"Expired\s+more\s+than\s+(\d+)\s*days?", page_text, re.IGNORECASE)
            days = m.group(1) if m else "?"
            _record_mac_attempt(session, sub_id, error_reason="subscriber_expired")
            log.warning(f"⏸  {username} expired more than {days} days (caught at data-usage stage) — contact MSP")
            raise RuntimeError(f"Subscriber expired more than {days} days — contact MSP to reactivate")

        mac_pattern = re.compile(r'([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}')
        mac_match = mac_pattern.search(page_text)

        mac_data = {"railwire_id": sub_id, "mac_scraped_at": datetime.utcnow()}
        if mac_match:
            mac = mac_match.group(0).lower().replace("-", ":")
            mac_data["mac_address"] = mac
            log.info(f"✅ MAC found: {mac}")
            _record_mac_attempt(session, sub_id, error_reason=None)
        else:
            log.warning(f"⚠️ No MAC found on usage page for {username}")
            _record_mac_attempt(session, sub_id, error_reason="no_mac_on_page")

        # IP and Data Used
        ip_match = re.search(r'(100\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+)', page_text)
        if ip_match: mac_data["framed_ip"] = ip_match.group(1)
        
        used_match = re.search(r'Data\s*used[^0-9]*([\d.]+)\s*(GB|MB|TB)', page_text, re.IGNORECASE)
        if used_match:
            val = float(used_match.group(1))
            unit = used_match.group(2).upper()
            if unit == "GB": val *= 1024
            elif unit == "TB": val *= 1024 * 1024
            mac_data["monthly_data_used_mb"] = round(val, 2)
            
        upsert_customer(session, mac_data, step_name="Single Scraper")
        try:
            session.commit()
            log.info(f"✅ Data update complete for {username}")
        except Exception as e:
            session.rollback()
            log.warning(f"⚠️ SQL Commit failed (locked?): {e}")
        
    except Exception as e:
        log.error(f"❌ Failed to scrape MAC for {username}: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

async def _run_step_for_account(pw, step: str, engine, admin: str, username: str = None) -> bool:
    """Execute one step for the currently-bound account. Returns True if all stages succeeded."""
    if not os.path.exists(SESSION_FILE):
        log.error("❌ No saved session for account '%s' (expected %s)", admin, SESSION_FILE)
        log.error("   Run: python scraper.py --step session --account %s", admin)
        return False

    browser, context, page = await launch_browser(pw, headless=True, use_session=True)
    try:
        log.info("🔑 [%s] Checking session validity...", admin)
        session_valid = await check_session(page)

        if not session_valid:
            log.warning("⚠️ [%s] Session expired — attempting auto-refresh...", admin)
            try:
                await browser.close()
                await step_session(headless=True)
                browser, context, page = await launch_browser(pw, headless=True, use_session=True)
                session_valid = await check_session(page)
            except Exception as e:
                log.error("❌ [%s] Auto-refresh failed: %s", admin, e)
                session_valid = False

        if not session_valid:
            log.error("❌ [%s] Session invalid and auto-refresh failed. Re-generate with:", admin)
            log.error("   python scraper.py --step session --account %s", admin)
            return False

        log.info("✅ [%s] Session verified — proceeding", admin)

        ok = True
        with Session(engine) as session:
            if step in ("csv", "all"):
                run_id = run_start(session, "csv", triggered_by="cli", admin=admin)
                try:
                    result = await step_csv(page, session)
                    run_finish(session, run_id, status="success",
                               records_processed=result, session_valid=True,
                               notes=f"[{admin}] Imported {result} customers from CSV")
                    log.info("✅ [%s] STEP CSV COMPLETE — %d customers", admin, result)
                except Exception as e:
                    run_finish(session, run_id, status="failed",
                               error_message=str(e), session_valid=True,
                               notes=f"[{admin}] CSV failed")
                    log.error("❌ [%s] STEP CSV FAILED: %s", admin, e)
                    ok = False
                    if step != "all":
                        return False

            if step in ("details", "all"):
                run_id = run_start(session, "details", triggered_by="cli", admin=admin)
                try:
                    await step_details(page, session)
                    run_finish(session, run_id, status="success", session_valid=True,
                               notes=f"[{admin}] details ok")
                    log.info("✅ [%s] STEP DETAILS COMPLETE", admin)
                except Exception as e:
                    run_finish(session, run_id, status="failed",
                               error_message=str(e), session_valid=True,
                               notes=f"[{admin}] details failed")
                    log.error("❌ [%s] STEP DETAILS FAILED: %s", admin, e)
                    ok = False
                    if step != "all":
                        return False

            if step in ("mac", "all"):
                run_id = run_start(session, "mac", triggered_by="cli", admin=admin)
                try:
                    await scrape_mac_via_search(page, session)
                    run_finish(session, run_id, status="success", session_valid=True,
                               notes=f"[{admin}] mac batch ok")
                    log.info("✅ [%s] STEP MAC COMPLETE", admin)
                except Exception as e:
                    run_finish(session, run_id, status="failed",
                               error_message=str(e), session_valid=True,
                               notes=f"[{admin}] mac failed")
                    log.error("❌ [%s] STEP MAC FAILED: %s", admin, e)
                    ok = False
                    if step != "all":
                        return False

            if step == "daily":
                run_id = run_start(session, "daily", triggered_by="cli", admin=admin)
                try:
                    await step_daily(page, session)
                    run_finish(session, run_id, status="success", session_valid=True,
                               notes=f"[{admin}] daily ok")
                    log.info("✅ [%s] DAILY SYNC COMPLETE", admin)
                except Exception as e:
                    run_finish(session, run_id, status="failed",
                               error_message=str(e), session_valid=True,
                               notes=f"[{admin}] daily failed")
                    log.error("❌ [%s] DAILY SYNC FAILED: %s", admin, e)
                    ok = False

            if step == "single" and username:
                run_id = run_start(session, "single", triggered_by="cli", admin=admin)
                try:
                    await step_single(page, session, username)
                    run_finish(session, run_id, status="success", session_valid=True,
                               notes=f"[{admin}] Single scrape for {username}")
                    log.info("✅ [%s] SINGLE SCRAPE COMPLETE FOR %s", admin, username)
                except Exception as e:
                    run_finish(session, run_id, status="failed",
                               error_message=str(e), session_valid=True,
                               notes=f"[{admin}] single failed")
                    log.error("❌ [%s] SINGLE SCRAPE FAILED FOR %s: %s", admin, username, e)
                    ok = False

        return ok
    finally:
        try:
            await browser.close()
        except Exception:
            pass


def _resolve_accounts_for_run(step: str, username: str, account: str) -> list:
    """Figure out which account(s) the requested run should target."""
    all_accounts = get_accounts()
    if not all_accounts:
        return []

    if account:
        return [a for a in all_accounts if a["username"] == account]

    # --step single --username X → use that customer's railwire_admin
    if step == "single" and username:
        try:
            engine = get_db()
            with Session(engine) as session:
                cust = session.query(Customer).filter(Customer.username == username).first()
                if cust and cust.railwire_admin:
                    match = [a for a in all_accounts if a["username"] == cust.railwire_admin]
                    if match:
                        return match
        except Exception as e:
            log.warning("Could not resolve account for single-scrape of %s: %s", username, e)
        return all_accounts[:1]

    return all_accounts


async def main(step: str, username: str = None, visible: bool = False, account: str = None):
    # Setup step-specific logging FIRST
    global log
    log = setup_logging(step)

    accounts = _resolve_accounts_for_run(step, username, account)
    if not accounts:
        if account:
            log.error("❌ Account '%s' not found in config.json", account)
        else:
            log.error("❌ No accounts configured in config.json")
        return

    log.info("📒 Will run step '%s' for %d account(s): %s",
             step, len(accounts), ", ".join(a["username"] for a in accounts))

    # Session step is special: visible browser, no DB needed, renew each account
    if step == "session":
        for acc in accounts:
            set_active_account(acc["username"], acc["password"])
            log.info("=" * 60)
            log.info("SESSION SETUP for account: %s", acc["username"])
            log.info("=" * 60)
            try:
                await step_session(headless=not visible)
            except Exception as e:
                log.error("Session setup failed for %s: %s", acc["username"], e)
        return

    engine = get_db()

    # When 2+ accounts are configured and no specific account was requested,
    # run them in PARALLEL via subprocesses so each has its own module state
    # (set_active_account mutates globals; parallel within one process would race).
    # Each subprocess will recurse back into main() with --account X.
    parallel_eligible = (
        step != "session"
        and not username                  # single-customer scrape is a single-account op
        and not account                   # explicit --account: already targeted
        and len(accounts) > 1
        and os.environ.get("RICO_SCRAPER_SERIAL", "").lower() not in ("1", "true", "yes")
    )

    if parallel_eligible:
        log.info("▶ Running step '%s' for %d accounts IN PARALLEL via subprocesses", step, len(accounts))

        async def _run_subproc(acc_username: str) -> int:
            cmd = [sys.executable, os.path.abspath(__file__), "--step", step, "--account", acc_username]
            if username:
                cmd += ["--username", username]
            log.info("▶ [%s] launching subprocess: %s", acc_username, " ".join(cmd))
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env={**os.environ, "RICO_SCRAPER_SERIAL": "1", "PYTHONIOENCODING": "utf-8"},
            )
            # Stream the child's output line-by-line into our log with admin prefix
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text_line = line.decode("utf-8", errors="replace").rstrip()
                if text_line:
                    log.info("[%s] %s", acc_username, text_line)
            rc = await proc.wait()
            log.info("◀ [%s] subprocess exited rc=%d", acc_username, rc)
            return rc

        results = await asyncio.gather(*[_run_subproc(a["username"]) for a in accounts], return_exceptions=True)
        overall_ok = all(isinstance(r, int) and r == 0 for r in results)
        for acc, r in zip(accounts, results):
            if isinstance(r, Exception):
                log.error("[%s] subprocess raised: %s", acc["username"], r)
    else:
        overall_ok = True
        async with async_playwright() as pw:
            for acc in accounts:
                set_active_account(acc["username"], acc["password"])
                log.info("")
                log.info("=" * 60)
                log.info("▶️  Running step '%s' for account: %s", step, acc["username"])
                log.info("=" * 60)
                try:
                    ok = await _run_step_for_account(pw, step, engine, acc["username"], username=username)
                except Exception as e:
                    log.error("❌ [%s] Unhandled error: %s", acc["username"], e)
                    ok = False
                overall_ok = overall_ok and ok

    log.info("✅ ALL DONE — Scraper finished. (overall_ok=%s)", overall_ok)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rico Net Railwire Scraper (Ultimate)")
    parser.add_argument(
        "--step",
        choices=["session", "csv", "details", "mac", "all", "daily", "single"],
        default="all",
        help="Which step to run"
    )
    parser.add_argument("--username", help="Username for single-user scrape")
    parser.add_argument("--account", help="Run only this railwire account (defaults to all configured accounts)")
    parser.add_argument(
        "--visible",
        action="store_true",
        default=False,
        help="Show browser window (useful for debugging CAPTCHA solving)"
    )
    args = parser.parse_args()

    if not get_accounts():
        print("\n ERROR: No accounts configured.")
        print("Edit config.json or use the dashboard Settings page:")
        print('  {"accounts": [{"username": "YOUR_ID", "password": "YOUR_PASS"}], ...}\n')
        exit(1)

    asyncio.run(main(args.step, args.username, visible=args.visible, account=args.account))
