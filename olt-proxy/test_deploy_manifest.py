import json
from argparse import Namespace
from pathlib import Path

from fastapi.testclient import TestClient

from deploy_manifest import RUNTIME_FILES, bootstrap_files, runtime_files, validate_manifest
from olt_poller import _can_run_without_hardware, _login_credentials_configured, _transport_needs_login_credentials
import trap_receiver
from trap_receiver import _collector_auth_configured
import proxy
from proxy import _proxy_token_matches


def test_runtime_manifest_contains_only_existing_safe_files():
    files = runtime_files()
    assert "proxy.py" in files
    assert "olt_poller.py" in files
    assert "trap_receiver.py" in files
    assert validate_manifest(files) == []


def test_runtime_manifest_excludes_probe_debug_and_runtime_artifacts():
    names = [Path(name).name.lower() for name in RUNTIME_FILES]
    assert not any(name.startswith("_debug") for name in names)
    assert not any(name.startswith("probe_") for name in names)
    assert not any(name.endswith("_results.txt") for name in names)
    assert not any(".tmp" in name for name in names)


def test_bootstrap_manifest_is_explicit_and_safe():
    files = bootstrap_files()
    assert "snmp_audit.py" in files
    assert "_find_optical_oids.py" not in files
    assert validate_manifest(files) == []


def test_validate_manifest_rejects_probe_names():
    problems = validate_manifest(["probe_final_200.py", "_debug_gpon210.py"], root=Path(__file__).parent)
    assert len(problems) == 2


def test_preflight_requires_login_credentials_for_telnet_or_web_transport():
    assert _transport_needs_login_credentials("snmp", "none") is False
    assert _transport_needs_login_credentials("snmp", "telnet") is True
    assert _transport_needs_login_credentials("web", "none") is True
    assert _login_credentials_configured("olt-user", "secret") is True
    assert _login_credentials_configured("", "secret") is False
    assert _login_credentials_configured("olt-user", "") is False


def test_poller_only_allows_hardwareless_preflight_without_olt_connectivity():
    assert _can_run_without_hardware(Namespace(preflight=True, skip_olt_connectivity=True)) is True
    assert _can_run_without_hardware(Namespace(preflight=True, skip_olt_connectivity=False)) is False
    assert _can_run_without_hardware(Namespace(preflight=False, skip_olt_connectivity=True)) is False


def test_trap_preflight_requires_collector_identity_and_token():
    assert _collector_auth_configured("collector-token", "collector-id") is True
    assert _collector_auth_configured("", "collector-id") is False
    assert _collector_auth_configured("collector-token", "") is False


def test_trap_retry_queue_keeps_failed_and_later_events(monkeypatch, tmp_path):
    queue_path = tmp_path / "trap_retry_queue.jsonl"
    queue_path.write_text(
        json.dumps({"id": 1}) + "\n"
        + json.dumps({"id": 2}) + "\n"
        + json.dumps({"id": 3}) + "\n",
        encoding="utf-8",
    )

    def fake_post(event):
        return event["id"] == 1

    monkeypatch.setattr(trap_receiver, "RETRY_QUEUE_PATH", str(queue_path))
    monkeypatch.setattr(trap_receiver, "_post_alarm_once", fake_post)

    sent, remaining = trap_receiver._drain_retry_queue_once()

    assert sent == 1
    assert remaining == 2
    kept = [json.loads(line)["id"] for line in queue_path.read_text(encoding="utf-8").splitlines()]
    assert kept == [2, 3]


def test_proxy_rejects_empty_or_missing_proxy_token(monkeypatch):
    import config

    monkeypatch.setattr(config, "PROXY_TOKEN", "")
    assert _proxy_token_matches(None) is False
    assert _proxy_token_matches("") is False

    monkeypatch.setattr(config, "PROXY_TOKEN", "secret-token")
    assert _proxy_token_matches(None) is False
    assert _proxy_token_matches("wrong") is False
    assert _proxy_token_matches("secret-token") is True


def test_proxy_healthz_never_contacts_olt(monkeypatch):
    import config

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("healthz must not contact OLT hardware")

    monkeypatch.setattr(config, "ALLOW_OLT_HARDWARE_ACCESS", False)
    monkeypatch.setattr(config, "ALLOW_OLT_REBOOT_COMMANDS", False)
    monkeypatch.setattr(proxy.olt, "get_all_onus", fail_if_called, raising=False)

    response = TestClient(proxy.app).get("/healthz")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["olt_reachable"] is False
    assert data["onu_count"] == 0
    assert data["hardware_access_enabled"] is False
    assert data["reboot_commands_enabled"] is False


def test_proxy_blocks_olt_endpoint_when_hardware_access_disabled(monkeypatch):
    import config

    monkeypatch.setattr(config, "PROXY_TOKEN", "secret-token")
    monkeypatch.setattr(config, "ALLOW_OLT_HARDWARE_ACCESS", False)

    response = TestClient(proxy.app).post(
        "/olt/fetch",
        json={"mac_address": "8C:C7:C3:D2:39:CB"},
        headers={"X-Proxy-Token": "secret-token"},
    )

    assert response.status_code == 423
    assert "OLT hardware access is disabled" in response.json()["detail"]
