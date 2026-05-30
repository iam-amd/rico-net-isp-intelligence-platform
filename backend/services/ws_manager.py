"""
Rico Net — WebSocket Manager
==============================
In-process pub/sub hub for real-time NOC Dashboard updates.
No Redis needed at current scale. Singleton imported across the app.
"""
import logging
from typing import Dict, Set

from fastapi import WebSocket

logger = logging.getLogger("rico_net.ws_manager")


class WSManager:
    """Thread-safe (asyncio-safe) WebSocket pub/sub hub."""

    def __init__(self):
        self._channels: Dict[str, Set[WebSocket]] = {
            "noc": set(),
            "alarms": set(),
        }

    async def connect(self, channel: str, ws: WebSocket, subprotocol: str | None = None) -> None:
        await ws.accept(subprotocol=subprotocol)
        self._channels.setdefault(channel, set()).add(ws)
        logger.debug("WS connected channel=%s connections=%d", channel, len(self._channels[channel]))

    def disconnect(self, channel: str, ws: WebSocket) -> None:
        self._channels.get(channel, set()).discard(ws)
        logger.debug("WS disconnected channel=%s", channel)

    async def broadcast(self, channel: str, data: dict) -> None:
        """Send JSON to all clients on a channel. Silently drops dead connections."""
        sockets = list(self._channels.get(channel, set()))
        if not sockets:
            return
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._channels[channel].discard(ws)

    def connection_count(self, channel: str) -> int:
        return len(self._channels.get(channel, set()))


# Singleton — import this everywhere
ws_manager = WSManager()
