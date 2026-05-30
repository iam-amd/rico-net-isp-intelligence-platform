"""
Rico Net API — Main Application Entry Point
=============================================
Pure composition: wires together middleware, routes, and startup tasks.
All business logic lives in services/, middleware in middleware/, migrations in workers/.
"""
import asyncio
import logging
import os
import sys

# Load .env into os.environ so non-pydantic readers (e.g. snmp_runner) see it.
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    load_dotenv(_env_path)
except ImportError:
    pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import models
from config.settings import settings
from database import engine
from middleware.error_handlers import register_error_handlers
from middleware.rate_limiter import register_rate_limiter
from middleware.security_headers import SecurityHeadersMiddleware
from workers.migration_tasks import register_startup_events
from workers.retention import retention_loop
from workers.prediction_runner import prediction_loop
from workers.binding_reconciler_loop import reconcile_loop
from workers.engine_reconcile_loop import engine_reconcile_loop
from workers.binding_drift_loop import drift_loop
from workers.confidence_decay_loop import decay_loop
from workers.identity_sync_loop import identity_sync_loop

from routers import auth, customers, diagnostics, inventory, network_nodes, phone_lookup, technicians, tickets
from routers.audit import router as audit_router
from routers.collection import router as collection_router
from routers.field_team import router as field_team_router
from routers.ingest import router as ingest_router
from routers.noc import router as noc_router
from routers.pole_groups import router as pole_groups_router
from routers.ws import router as ws_router
from routers.pg import router as pg_router
from routers.engine import router as engine_router
from routers.admin_olts import router as admin_olts_router
from routers.pipeline import router as pipeline_router

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("rico_net")

# =============================================================================
# DATABASE TABLES
# =============================================================================

if settings.RUN_CREATE_ALL_ON_STARTUP:
    logger.warning(
        "RUN_CREATE_ALL_ON_STARTUP is enabled. This is a legacy repair mode; "
        "normal deployments must run Alembic migrations instead."
    )
    models.Base.metadata.create_all(bind=engine)
else:
    logger.info("Skipping Base.metadata.create_all; schema is managed by Alembic.")

# =============================================================================
# APP
# =============================================================================

app = FastAPI(title="Rico Net API", version="4.0.0")

# Middleware
register_rate_limiter(app)

# CORS origins come from settings.CORS_ALLOW_ORIGINS (.env, comma-separated).
# The fallback only contains localhost ports for dev convenience — production
# Tailscale / public origins MUST be added to .env, never hardcoded here.
_DEV_CORS_DEFAULTS = [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3001", "http://127.0.0.1:3001",
    "http://localhost:3002", "http://127.0.0.1:3002",
    "http://localhost:8081", "http://127.0.0.1:8081",
    "http://localhost:8082", "http://127.0.0.1:8082",
    "http://localhost:19006", "http://127.0.0.1:19006",
    "http://localhost:4000", "http://127.0.0.1:4000",
    "http://localhost:5173", "http://127.0.0.1:5173",
]
cors_origins = (
    [o.strip() for o in settings.CORS_ALLOW_ORIGINS.split(",") if o.strip()]
    if settings.CORS_ALLOW_ORIGINS
    else _DEV_CORS_DEFAULTS
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)

register_error_handlers(app)

# Startup migrations
register_startup_events(app)


@app.on_event("startup")
async def _start_background_workers():
    asyncio.create_task(retention_loop())
    asyncio.create_task(prediction_loop())
    asyncio.create_task(_olt_watchdog_loop())
    asyncio.create_task(reconcile_loop())
    asyncio.create_task(engine_reconcile_loop())
    asyncio.create_task(drift_loop())
    asyncio.create_task(decay_loop())
    asyncio.create_task(identity_sync_loop())
    logger.info("Background workers started: retention_loop, prediction_loop, olt_watchdog, binding_reconciler, engine_reconcile, binding_drift, confidence_decay, identity_sync")
    # Pre-warm OCR model in background so the first sticker scan is fast
    asyncio.create_task(_warm_ocr())


async def _olt_watchdog_loop():
    """
    Runs every 5 minutes. Checks olt_health for stale OLTs (no snapshot >10min).
    If stale: fires OLT_STALE alarm and pushes WebSocket alert to NOC clients.
    """
    await asyncio.sleep(60)  # 60s grace period on startup before first check
    while True:
        try:
            from database import SessionLocal
            from services import alarm_service
            from services.ws_manager import ws_manager

            db = SessionLocal()
            try:
                stale_olts = alarm_service.check_all_olt_health(db)
                if stale_olts:
                    for entry in stale_olts:
                        logger.warning(
                            "watchdog: OLT %s STALE — last snapshot: %s (stale for %ss)",
                            entry["olt_host"],
                            entry["last_snapshot_at"],
                            entry.get("stale_for_seconds"),
                        )
                    if ws_manager.connection_count("noc") > 0:
                        await ws_manager.broadcast("noc", {
                            "type": "olt_stale_alert",
                            "data": stale_olts,
                        })
            finally:
                db.close()
        except Exception as exc:
            logger.error("olt_watchdog_loop error: %s", exc)

        await asyncio.sleep(300)  # 5 minutes


async def _warm_ocr():
    """Load the EasyOCR model on startup so the first scan request doesn't timeout."""
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _load_ocr_sync)
    except Exception as e:
        logger.warning("[OCR] Pre-warm failed (non-fatal): %s", e)


def _load_ocr_sync():
    try:
        from services.ocr_service import _get_reader
        _get_reader()
        logger.info("[OCR] Model pre-warmed and ready.")
    except Exception as e:
        logger.warning("[OCR] Could not pre-warm: %s", e)

# Routes
app.include_router(auth.router)
app.include_router(customers.router)
app.include_router(tickets.router)
app.include_router(technicians.router)
app.include_router(inventory.router)
app.include_router(phone_lookup.router)
app.include_router(diagnostics.router)
app.include_router(network_nodes.router)
app.include_router(audit_router)
app.include_router(collection_router)
app.include_router(pole_groups_router)
app.include_router(field_team_router)
app.include_router(ingest_router)
app.include_router(noc_router)
app.include_router(ws_router)
app.include_router(pg_router)
app.include_router(engine_router)
app.include_router(admin_olts_router)
app.include_router(pipeline_router)

# Static files
_UPLOAD_DIR = settings.UPLOAD_DIR
os.makedirs(_UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOAD_DIR), name="uploads")


# =============================================================================
# ROOT & HEALTH CHECK
# =============================================================================

@app.get("/")
def read_root():
    return {"system": "Rico Net v4", "status": "Online"}


@app.get("/healthz")
def healthz():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.error("Health check failed: database unreachable")
        raise HTTPException(status_code=503, detail="Database connectivity check failed")
    return {"status": "ok"}


# =============================================================================
# STARTUP LOG
# =============================================================================

logger.info("Rico Net API v4.0.0 starting up")
logger.info("CORS origins: %s", cors_origins)
logger.info("Upload directory: %s", _UPLOAD_DIR)
logger.info("Registered routers: auth, customers, tickets, technicians, inventory, phone_lookup, diagnostics, network_nodes, audit, collection, pole_groups, field_team, ingest, noc, ws, pg, engine")
logger.info("Services: diagnosis_service, ingest_service (auto-diagnosis hooked), retention_loop (background)")
