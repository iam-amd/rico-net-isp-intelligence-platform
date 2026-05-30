"""
Rico Net - OLT Ingest Router
============================
Receives ONU snapshot batches and alarm events from OLT collectors.

Authentication:
  - Preferred: X-Collector-Id + X-Ingest-Token checked against
    collector_credentials.token_hash.
  - Legacy: shared OLT_PROXY_TOKEN only when ALLOW_LEGACY_INGEST_TOKEN=true.

All business logic lives in services/ingest_service.py.
After each ingest, broadcasts real-time updates to WebSocket clients.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

import database
from config.settings import settings
from middleware.rate_limiter import limit
from schemas.ingest import (
    AlarmEventCreate,
    AlarmEventResponse,
    CollectorHeartbeat,
    CollectorHeartbeatResponse,
    ONUSnapshotBatch,
    ONUSnapshotBatchResponse,
)
from services import collector_auth_service, ingest_service


logger = logging.getLogger("rico_net.ingest")

router = APIRouter(
    prefix="/ingest",
    tags=["Ingest"],
)

_INGEST_RATE = f"{settings.INGEST_RATE_LIMIT_PER_MIN}/minute"


def _verify_ingest_token(
    db: Session = Depends(database.get_db),
    x_ingest_token: str = Header(...),
    x_collector_id: str | None = Header(default=None),
) -> str | None:
    if x_collector_id:
        if collector_auth_service.verify_collector_token(db, x_collector_id, x_ingest_token):
            return x_collector_id
        logger.warning("Ingest request rejected: bad token for collector_id=%s", x_collector_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ingest token",
        )

    if settings.ALLOW_LEGACY_INGEST_TOKEN:
        if not settings.OLT_PROXY_TOKEN:
            logger.error("Legacy OLT_PROXY_TOKEN is not configured")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ingest endpoint not configured on server",
            )
        if x_ingest_token == settings.OLT_PROXY_TOKEN:
            logger.warning(
                "Accepted legacy ingest token without X-Collector-Id. "
                "Create collector_credentials and disable ALLOW_LEGACY_INGEST_TOKEN."
            )
            return None

    logger.warning("Ingest request rejected: missing collector credential")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid ingest token",
    )


@router.get(
    "/verify",
    summary="Verify that the backend is accepting the configured ingest token",
)
@limit(_INGEST_RATE)
def verify_ingest_token(
    request: Request,
    collector_id: str | None = Depends(_verify_ingest_token),
):
    """Read-only ingest preflight endpoint for Raspberry Pi collectors."""
    return {
        "status": "ok",
        "collector_id": collector_id,
        "message": "Ingest token accepted",
    }


async def _broadcast_noc_update() -> None:
    """Background task: push updated NOC summary to all WebSocket NOC clients."""
    from database import SessionLocal
    from services import noc_service
    from services.ws_manager import ws_manager

    db = SessionLocal()
    try:
        summary = noc_service.get_network_summary(db)
        if summary.get("last_poll") and hasattr(summary["last_poll"], "isoformat"):
            summary["last_poll"] = summary["last_poll"].isoformat()
        if ws_manager.connection_count("noc") > 0:
            await ws_manager.broadcast("noc", {"type": "summary_update", "data": summary})
    except Exception as exc:
        logger.warning("NOC WS broadcast failed: %s", exc)
    finally:
        db.close()


async def _broadcast_alarm(alarm_data: dict) -> None:
    """Background task: push new alarm to all WebSocket alarm clients."""
    from services.ws_manager import ws_manager

    try:
        if ws_manager.connection_count("alarms") > 0:
            await ws_manager.broadcast("alarms", {"type": "new_alarm", "data": alarm_data})
    except Exception as exc:
        logger.warning("Alarm WS broadcast failed: %s", exc)


@router.post(
    "/onu-snapshots",
    response_model=ONUSnapshotBatchResponse,
    summary="Bulk-insert ONU snapshots from OLT poller",
)
@limit(_INGEST_RATE)
async def ingest_onu_snapshots(
    request: Request,
    batch: ONUSnapshotBatch,
    db: Session = Depends(database.get_db),
    _: str | None = Depends(_verify_ingest_token),
):
    result = ingest_service.insert_onu_snapshots(db, batch)
    asyncio.create_task(_broadcast_noc_update())
    logger.info("Ingested %d ONU snapshots", result["inserted"])
    return result


@router.post(
    "/collector-heartbeat",
    response_model=CollectorHeartbeatResponse,
    summary="Record OLT collector heartbeat even when no snapshots are produced",
)
@limit(_INGEST_RATE)
async def collector_heartbeat(
    request: Request,
    heartbeat: CollectorHeartbeat,
    db: Session = Depends(database.get_db),
    _: str | None = Depends(_verify_ingest_token),
):
    result = ingest_service.record_collector_heartbeat(db, heartbeat)
    asyncio.create_task(_broadcast_noc_update())
    logger.info("Collector heartbeat: %s status=%s", heartbeat.collector_id, heartbeat.status)
    return result


@router.post(
    "/alarm-event",
    response_model=AlarmEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a single alarm event (trap or poller-detected fault)",
)
@limit(_INGEST_RATE)
async def ingest_alarm_event(
    request: Request,
    event: AlarmEventCreate,
    db: Session = Depends(database.get_db),
    _: str | None = Depends(_verify_ingest_token),
):
    alarm = ingest_service.insert_alarm_event(db, event)
    alarm_data = {
        "id": alarm.id,
        "mac_address": alarm.mac_address,
        "event_type": alarm.event_type,
        "olt_host": alarm.olt_host,
        "pon_port": alarm.pon_port,
        "onu_index": alarm.onu_index,
        "status": alarm.status,
        "received_at": alarm.received_at.isoformat() if alarm.received_at else None,
    }
    asyncio.create_task(_broadcast_alarm(alarm_data))
    logger.info("Alarm event recorded: id=%d type=%s mac=%s", alarm.id, event.event_type, event.mac_address)
    return alarm
