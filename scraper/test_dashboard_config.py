import importlib
import json
import sys

from fastapi.testclient import TestClient


def _load_dashboard(monkeypatch, tmp_path):
    monkeypatch.setenv("RICO_SCRAPER_RUNTIME_DIR", str(tmp_path))
    sys.modules.pop("dashboard", None)
    return importlib.import_module("dashboard")


def test_config_endpoint_masks_account_password(monkeypatch, tmp_path):
    dashboard = _load_dashboard(monkeypatch, tmp_path)
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({
            "accounts": [{"username": "railwire-user", "password": "secret-password"}],
            "active_account": "railwire-user",
            "anthropic_api_key": "secret-api-key",
            "mac_batch_size": 100,
            "scheduler_enabled": True,
        }),
        encoding="utf-8",
    )

    response = TestClient(dashboard.app).get("/api/config")

    assert response.status_code == 200
    data = response.json()
    assert data["accounts"][0]["password"] == "***SET***"
    assert data["anthropic_api_key"] == "***SET***"


def test_config_save_preserves_masked_account_password(monkeypatch, tmp_path):
    dashboard = _load_dashboard(monkeypatch, tmp_path)
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({
            "accounts": [{"username": "railwire-user", "password": "secret-password"}],
            "active_account": "railwire-user",
            "anthropic_api_key": "secret-api-key",
            "mac_batch_size": 100,
            "scheduler_enabled": True,
        }),
        encoding="utf-8",
    )
    client = TestClient(dashboard.app)
    masked = client.get("/api/config").json()
    masked["mac_interval_hours"] = 6

    response = client.post("/api/config", json=masked)

    assert response.status_code == 200
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["accounts"][0]["password"] == "secret-password"
    assert saved["anthropic_api_key"] == "secret-api-key"
    assert saved["mac_interval_hours"] == 6
