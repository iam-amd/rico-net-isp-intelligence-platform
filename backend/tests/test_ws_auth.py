"""
WebSocket auth tests for NOC/alarm channels.
"""
import pytest
from starlette.websockets import WebSocketDisconnect


def test_ws_noc_accepts_admin_subprotocol_token(client, admin_token):
    with client.websocket_connect(
        "/ws/noc",
        subprotocols=["rico-jwt", admin_token],
    ) as websocket:
        assert websocket.accepted_subprotocol == "rico-jwt"
        websocket.send_text("ping")


def test_ws_noc_rejects_field_tech_token(client, tech_token):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(
            "/ws/noc",
            subprotocols=["rico-jwt", tech_token],
        ):
            pass
    assert exc.value.code == 4001


def test_ws_alarms_rejects_legacy_query_token(client, admin_token):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/alarms?token={admin_token}"):
            pass
    assert exc.value.code == 4001
