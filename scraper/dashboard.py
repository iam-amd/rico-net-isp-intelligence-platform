"""
Rico Net — Scraper Command Center (v2)
=======================================
FastAPI dashboard API serving the single-page Command Center UI.

New endpoints over v1:
  GET  /api/runs              — Scraper run history (ScraperRun table)
  GET  /api/health            — Real-time health key/value pairs
  GET  /api/quality           — Data quality scorecard (coverage stats)
  GET  /api/gaps              — Customers missing key data (MAC, detail, etc.)
  GET  /api/scheduler/heartbeat — Heartbeat JSON from scheduler daemon
  POST /api/config            — Now accepts all config fields including delay settings
  POST /api/action/generate-session — Triggers AI auto-login (no visible browser)
"""

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import func, text
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import json
import subprocess
import psutil
import pathlib
from datetime import datetime, timezone

from runtime_paths import config_path, scheduler_heartbeat_file
from scraper import get_db, Customer, ScraperAuditLog, ScraperRun, ScraperHealth

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Rico Net Scraper Command Center", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH      = str(config_path())
HEARTBEAT_FILE   = str(scheduler_heartbeat_file())
SCRAPER_LOG      = os.path.join(BASE_DIR, "scraper.log")
SCHEDULER_LOG    = os.path.join(BASE_DIR, "scheduler.log")
CSV_LOG          = os.path.join(BASE_DIR, "csv_scrape.log")
DETAILS_LOG      = os.path.join(BASE_DIR, "details_scrape.log")
MAC_LOG          = os.path.join(BASE_DIR, "mac_scrape.log")
SINGLE_LOG       = os.path.join(BASE_DIR, "single_scrape.log")

# ── DB session ────────────────────────────────────────────────────────────────

def get_dashboard_db():
    engine = get_db()
    with DBSession(engine) as db:
        yield db

# ── Schemas ───────────────────────────────────────────────────────────────────

class ConfigUpdate(BaseModel):
    accounts: List[Dict[str, str]]
    active_account: str
    mac_batch_size: int
    scheduler_enabled: bool
    # New fields (optional, defaults preserved if absent)
    anthropic_api_key: Optional[str] = None
    mac_delay_min: Optional[float] = None
    mac_delay_max: Optional[float] = None
    csv_hour: Optional[int] = None
    details_hour: Optional[int] = None
    mac_interval_hours: Optional[int] = None

# ── Helpers ───────────────────────────────────────────────────────────────────

def read_log_tail(log_path: str, lines: int = 300) -> List[str]:
    try:
        p = pathlib.Path(log_path)
        if not p.exists():
            return [f"[No log file at {log_path}]"]
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        return [l.rstrip("\n") for l in all_lines[-lines:]]
    except Exception as e:
        return [f"[Error reading log: {e}]"]


def customer_to_dict(c: Customer) -> dict:
    return {
        "railwire_id": c.railwire_id,
        "railwire_admin": getattr(c, "railwire_admin", None),
        "username": c.username,
        "full_name": c.full_name,
        "mobile_number": c.mobile_number,
        "email": c.email,
        "full_address": c.full_address,
        "plan_name": c.plan_name,
        "expiry_date": c.expiry_date,
        "account_balance": c.account_balance,
        "account_status": c.account_status,
        "railwire_status": getattr(c, "railwire_status", "active"),
        "mac_address": c.mac_address,
        "framed_ip": c.framed_ip,
        "monthly_data_used_mb": c.monthly_data_used_mb,
        "is_online": getattr(c, "is_online", None),
        "mac_scraped_at": c.mac_scraped_at.isoformat() if c.mac_scraped_at else None,
        "detail_scraped_at": c.detail_scraped_at.isoformat() if c.detail_scraped_at else None,
        "last_synced_at": c.last_synced_at.isoformat() if c.last_synced_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def run_to_dict(r: ScraperRun) -> dict:
    return {
        "id": r.id,
        "step": r.step,
        "status": r.status,
        "triggered_by": r.triggered_by,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "duration_s": r.duration_s,
        "records_processed": r.records_processed,
        "records_created": r.records_created,
        "records_updated": r.records_updated,
        "errors_count": r.errors_count,
        "error_message": r.error_message,
        "session_was_valid": r.session_was_valid,
        "notes": r.notes,
    }


def _is_process_running(script_name: str) -> tuple[bool, Optional[int]]:
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = " ".join(proc.info.get("cmdline") or [])
            if script_name in cmdline:
                return True, proc.info["pid"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return False, None


def _run_background(step: str, username: str = None):
    cmd = ["python", "scraper.py", "--step", step]
    if username:
        cmd += ["--username", username]
    subprocess.Popen(
        cmd,
        cwd=BASE_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
    )

# ── Config ────────────────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config():
    if not os.path.exists(CONFIG_PATH):
        return {
            "accounts": [], "active_account": "", "mac_batch_size": 100,
            "scheduler_enabled": True, "anthropic_api_key": "",
            "mac_delay_min": 20.0, "mac_delay_max": 35.0,
            "csv_hour": 2, "details_hour": 3, "mac_interval_hours": 2,
        }
    with open(CONFIG_PATH, "r") as f:
        cfg = json.load(f)
    # Mask secrets in response; callers can submit ***SET*** to keep existing values.
    if cfg.get("anthropic_api_key"):
        cfg["anthropic_api_key"] = "***SET***"
    for account in cfg.get("accounts", []):
        if account.get("password"):
            account["password"] = "***SET***"
    return cfg


@app.post("/api/config")
def save_config(update: ConfigUpdate):
    # Load existing config to merge (preserve fields not in schema)
    existing = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r") as f:
            existing = json.load(f)

    # Apply updates (skip None — means "don't change")
    existing_passwords = {
        account.get("username"): account.get("password", "")
        for account in existing.get("accounts", [])
        if account.get("username")
    }
    merged_accounts = []
    for account in update.accounts:
        item = dict(account)
        username = item.get("username")
        password = item.get("password", "")
        if password == "***SET***" and username in existing_passwords:
            item["password"] = existing_passwords[username]
        merged_accounts.append(item)

    existing.update({
        "accounts": merged_accounts,
        "active_account": update.active_account,
        "mac_batch_size": update.mac_batch_size,
        "scheduler_enabled": update.scheduler_enabled,
    })
    if update.anthropic_api_key is not None and update.anthropic_api_key != "***SET***":
        existing["anthropic_api_key"] = update.anthropic_api_key
    if update.mac_delay_min is not None:
        existing["mac_delay_min"] = update.mac_delay_min
    if update.mac_delay_max is not None:
        existing["mac_delay_max"] = update.mac_delay_max
    if update.csv_hour is not None:
        existing["csv_hour"] = update.csv_hour
    if update.details_hour is not None:
        existing["details_hour"] = update.details_hour
    if update.mac_interval_hours is not None:
        existing["mac_interval_hours"] = update.mac_interval_hours

    with open(CONFIG_PATH, "w") as f:
        json.dump(existing, f, indent=4)
    return {"status": "success", "message": "Config saved. Restart scheduler to apply schedule changes."}

# ── Customers ─────────────────────────────────────────────────────────────────

@app.get("/api/customers")
def get_customers(
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: DBSession = Depends(get_dashboard_db),
):
    q = db.query(Customer).order_by(Customer.username)
    total = q.count()
    customers = q.offset(offset).limit(limit).all()
    return {"total": total, "items": [customer_to_dict(c) for c in customers]}


@app.get("/api/customers/{username}")
def get_single_customer(username: str, db: DBSession = Depends(get_dashboard_db)):
    c = db.query(Customer).filter(Customer.username == username).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer_to_dict(c)


@app.get("/api/customers/{username}/audit")
def get_customer_audit(username: str, db: DBSession = Depends(get_dashboard_db)):
    c = db.query(Customer).filter(Customer.username == username).first()
    if not c:
        return []
    logs = (
        db.query(ScraperAuditLog)
        .filter(ScraperAuditLog.customer_id == c.railwire_id)
        .order_by(ScraperAuditLog.changed_at.desc())
        .all()
    )
    return [
        {
            "id": lg.id,
            "customer_id": username,
            "action": lg.action,
            "field_name": lg.field_name,
            "old_value": lg.old_value,
            "new_value": lg.new_value,
            "changed_by": lg.changed_by,
            "changed_at": lg.changed_at.isoformat() if lg.changed_at else None,
        }
        for lg in logs
    ]

# ── Metrics ───────────────────────────────────────────────────────────────────

@app.get("/api/metrics")
def get_metrics(db: DBSession = Depends(get_dashboard_db)):
    total      = db.query(Customer).count()
    active     = db.query(Customer).filter(Customer.account_status == "Active").count()
    with_mac   = db.query(Customer).filter(
        Customer.mac_address.isnot(None), Customer.mac_address != ""
    ).count()
    no_mac_active = db.query(Customer).filter(
        Customer.account_status == "Active",
        (Customer.mac_address.is_(None)) | (Customer.mac_address == ""),
    ).count()
    no_detail  = db.query(Customer).filter(Customer.detail_scraped_at.is_(None)).count()
    not_found  = db.query(Customer).filter(
        getattr(Customer, "railwire_status", None) != None,
        Customer.railwire_status == "not_found"
    ).count() if hasattr(Customer, "railwire_status") else 0

    mac_pct = round((with_mac / total * 100), 1) if total else 0
    return {
        "total_customers": total,
        "active_customers": active,
        "with_mac": with_mac,
        "mac_coverage_pct": mac_pct,
        "missing_mac_active": no_mac_active,
        "missing_detail": no_detail,
        "not_found_in_railwire": not_found,
    }

# ── Run History ───────────────────────────────────────────────────────────────

@app.get("/api/runs")
def get_runs(
    step: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    db: DBSession = Depends(get_dashboard_db),
):
    q = db.query(ScraperRun).order_by(ScraperRun.started_at.desc())
    if step:
        q = q.filter(ScraperRun.step == step)
    runs = q.limit(limit).all()
    return [run_to_dict(r) for r in runs]

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def get_health(db: DBSession = Depends(get_dashboard_db)):
    rows = db.query(ScraperHealth).all()
    return {r.key: {"value": r.value, "updated_at": r.updated_at.isoformat() if r.updated_at else None} for r in rows}

# ── Quality scorecard ─────────────────────────────────────────────────────────

@app.get("/api/quality")
def get_quality(db: DBSession = Depends(get_dashboard_db)):
    total     = db.query(Customer).count()
    if total == 0:
        return {"total": 0}

    with_mac      = db.query(Customer).filter(Customer.mac_address.isnot(None), Customer.mac_address != "").count()
    with_detail   = db.query(Customer).filter(Customer.detail_scraped_at.isnot(None)).count()
    with_name     = db.query(Customer).filter(Customer.full_name.isnot(None), Customer.full_name != "").count()
    with_address  = db.query(Customer).filter(Customer.full_address.isnot(None), Customer.full_address != "").count()
    with_email    = db.query(Customer).filter(Customer.email.isnot(None), Customer.email != "").count()
    with_mobile   = db.query(Customer).filter(Customer.mobile_number.isnot(None), Customer.mobile_number != "").count()

    def pct(n): return round(n / total * 100, 1)
    return {
        "total": total,
        "mac_coverage":     {"count": with_mac,     "pct": pct(with_mac)},
        "detail_coverage":  {"count": with_detail,  "pct": pct(with_detail)},
        "name_coverage":    {"count": with_name,     "pct": pct(with_name)},
        "address_coverage": {"count": with_address, "pct": pct(with_address)},
        "email_coverage":   {"count": with_email,   "pct": pct(with_email)},
        "mobile_coverage":  {"count": with_mobile,  "pct": pct(with_mobile)},
    }

# ── Gaps ──────────────────────────────────────────────────────────────────────

@app.get("/api/gaps")
def get_gaps(
    gap_type: str = Query("mac", description="mac | detail | name | address"),
    limit: int = Query(100, ge=1, le=1000),
    db: DBSession = Depends(get_dashboard_db),
):
    """Return customers missing specific data for gap-fill prioritization."""
    q = db.query(Customer).filter(Customer.account_status == "Active")

    if gap_type == "mac":
        q = q.filter(
            (Customer.mac_address.is_(None)) | (Customer.mac_address == "")
        ).order_by(Customer.last_synced_at.desc())
    elif gap_type == "detail":
        q = q.filter(Customer.detail_scraped_at.is_(None))
    elif gap_type == "name":
        q = q.filter((Customer.full_name.is_(None)) | (Customer.full_name == ""))
    elif gap_type == "address":
        q = q.filter((Customer.full_address.is_(None)) | (Customer.full_address == ""))
    else:
        raise HTTPException(status_code=400, detail="Unknown gap_type")

    total_gaps = q.count()
    items = q.limit(limit).all()
    return {
        "gap_type": gap_type,
        "total_gaps": total_gaps,
        "items": [{"username": c.username, "full_name": c.full_name, "plan_name": c.plan_name} for c in items],
    }

# ── Audit ─────────────────────────────────────────────────────────────────────

@app.get("/api/audit")
def get_global_audit(limit: int = 200, db: DBSession = Depends(get_dashboard_db)):
    logs = (
        db.query(ScraperAuditLog, Customer.username)
        .join(Customer, ScraperAuditLog.customer_id == Customer.railwire_id)
        .order_by(ScraperAuditLog.changed_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": lg.id, "customer_id": username, "action": lg.action,
            "field_name": lg.field_name, "old_value": lg.old_value,
            "new_value": lg.new_value, "changed_by": lg.changed_by,
            "changed_at": lg.changed_at.isoformat() if lg.changed_at else None,
        }
        for lg, username in logs
    ]

# ── Logs ──────────────────────────────────────────────────────────────────────

@app.get("/api/logs/{log_type}")
def get_log(log_type: str, lines: int = 300):
    log_map = {
        "scraper": SCRAPER_LOG, "scheduler": SCHEDULER_LOG,
        "csv": CSV_LOG, "details": DETAILS_LOG,
        "mac": MAC_LOG, "single": SINGLE_LOG,
    }
    path = log_map.get(log_type, SCRAPER_LOG)
    return {"lines": read_log_tail(path, lines), "file": os.path.basename(path)}

# ── Scheduler ────────────────────────────────────────────────────────────────

@app.get("/api/scheduler/status")
def get_scheduler_status():
    running, pid = _is_process_running("scheduler.py")
    hb = {}
    if os.path.exists(HEARTBEAT_FILE):
        try:
            with open(HEARTBEAT_FILE) as f:
                hb = json.load(f)
        except Exception:
            pass

    # Check if heartbeat is stale (> 3 min)
    stale = False
    if hb.get("ts"):
        try:
            last_ts = datetime.fromisoformat(hb["ts"])
            age_s = (datetime.now(timezone.utc) - last_ts).total_seconds()
            stale = age_s > 180
        except Exception:
            stale = True

    cfg = {}
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)

    return {
        "scheduler_running": running,
        "scheduler_pid": pid,
        "heartbeat": hb,
        "heartbeat_stale": stale,
        "scheduler_enabled": cfg.get("scheduler_enabled", True),
        "csv_hour": cfg.get("csv_hour", 2),
        "details_hour": cfg.get("details_hour", 3),
        "mac_interval_hours": cfg.get("mac_interval_hours", 2),
    }


@app.get("/api/scheduler/heartbeat")
def get_heartbeat():
    if not os.path.exists(HEARTBEAT_FILE):
        return {"status": "unknown", "message": "No heartbeat file found"}
    try:
        with open(HEARTBEAT_FILE) as f:
            return json.load(f)
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ── Process Status ────────────────────────────────────────────────────────────

@app.get("/api/scraper/status")
def get_scraper_status():
    running, pid = _is_process_running("scraper.py")
    step = None
    if running:
        for proc in psutil.process_iter(["pid", "cmdline"]):
            try:
                if proc.pid == pid:
                    cmdline = proc.info.get("cmdline") or []
                    for i, arg in enumerate(cmdline):
                        if arg == "--step" and i + 1 < len(cmdline):
                            step = cmdline[i + 1]
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    return {"running": running, "pid": pid, "step": step}

# ── Action Triggers ───────────────────────────────────────────────────────────

@app.post("/api/action/scrape-mac")
def trigger_mac():
    _run_background("mac")
    return {"status": "started", "message": "MAC scrape started in background"}


@app.post("/api/action/scrape-csv")
def trigger_csv():
    _run_background("csv")
    return {"status": "started", "message": "CSV sync started in background"}


@app.post("/api/action/scrape-details")
def trigger_details():
    _run_background("details")
    return {"status": "started", "message": "Details scrape started in background"}


@app.post("/api/action/scrape-all")
def trigger_all():
    _run_background("all")
    return {"status": "started", "message": "Full scrape (all steps) started in background"}


@app.post("/api/action/scrape-single/{username}")
def trigger_single(username: str):
    _run_background("single", username)
    return {"status": "started", "message": f"Refresh started for {username}"}


@app.post("/api/action/generate-session")
def trigger_session():
    """
    Trigger AI auto-login in background.
    With ANTHROPIC_KEY set, this is fully headless — no visible browser.
    """
    subprocess.Popen(
        ["python", "scraper.py", "--step", "session"],
        cwd=BASE_DIR,
        creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
    )
    return {
        "status": "started",
        "message": "AI session renewal started. Check logs for progress.",
    }

# ── Static / SPA ──────────────────────────────────────────────────────────────

static_dir = os.path.join(BASE_DIR, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
def serve_dashboard():
    return FileResponse(os.path.join(static_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn
    print("Rico Net Scraper Command Center -> http://localhost:5005")
    uvicorn.run("dashboard:app", host="0.0.0.0", port=5005, reload=True)
