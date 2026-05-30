"""
Rico Net WebSocket Router
=========================
Two channels:
  /ws/noc    - network summary pushed after every ONU snapshot batch
  /ws/alarms - individual alarm events pushed as they arrive

Auth: browser clients pass the JWT through Sec-WebSocket-Protocol:
  ["rico-jwt", "<jwt>"]

Only Admin and Senior Tech users can subscribe to NOC/alarm firehose channels.
"""
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt

from database import SessionLocal
import models
from config.settings import settings
from services.ws_manager import ws_manager

router = APIRouter(prefix="/ws", tags=["WebSocket"])
logger = logging.getLogger("rico_net.ws")

NOC_ALLOWED_ROLES = {"Admin", "Senior Tech"}
WS_AUTH_PROTOCOL = "rico-jwt"


def _token_from_subprotocol(websocket: WebSocket) -> tuple[Optional[str], Optional[str]]:
    raw = websocket.headers.get("sec-websocket-protocol", "")
    protocols = [item.strip() for item in raw.split(",") if item.strip()]
    if WS_AUTH_PROTOCOL not in protocols:
        return None, None

    idx = protocols.index(WS_AUTH_PROTOCOL)
    if idx + 1 >= len(protocols):
        return None, WS_AUTH_PROTOCOL

    return protocols[idx + 1], WS_AUTH_PROTOCOL


def _authorized_noc_user(token: str) -> bool:
    db = SessionLocal()
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username = payload.get("sub")
        if not username:
            return False

        user = db.query(models.Technician).filter(models.Technician.username == username).first()
        return bool(user and user.is_active == 1 and user.role in NOC_ALLOWED_ROLES)
    except JWTError:
        return False
    except Exception as exc:
        logger.warning("WS auth lookup failed: %s", exc)
        return False
    finally:
        db.close()


@router.websocket("/noc")
async def ws_noc(websocket: WebSocket):
    """NOC summary channel."""
    token, accept_protocol = _token_from_subprotocol(websocket)
    if not token or not _authorized_noc_user(token):
        await websocket.close(code=4001)
        return

    await ws_manager.connect("noc", websocket, subprotocol=accept_protocol)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect("noc", websocket)
    except Exception:
        ws_manager.disconnect("noc", websocket)


@router.websocket("/alarms")
async def ws_alarms(websocket: WebSocket):
    """Alarm channel."""
    token, accept_protocol = _token_from_subprotocol(websocket)
    if not token or not _authorized_noc_user(token):
        await websocket.close(code=4001)
        return

    await ws_manager.connect("alarms", websocket, subprotocol=accept_protocol)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect("alarms", websocket)
    except Exception:
        ws_manager.disconnect("alarms", websocket)
