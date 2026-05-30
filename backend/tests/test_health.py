"""
Smoke tests â€” root and health-check endpoints.
These require no authentication and verify the server is alive.
"""


def test_root_returns_online(client):
    """GET / should return 200 with status 'Online'."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "Online"


def test_healthz_returns_ok(client):
    """GET /healthz should return 200 with status 'ok' (proves DB is reachable)."""
    response = client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_noc_customer_mac_matching_is_exact_only():
    """Railwire-to-SNMP customer matching must not use MAC offset guesses."""
    from types import SimpleNamespace

    from services.noc_service import _fuzzy_find_customer

    exact_customer = SimpleNamespace(username="exact")
    offset_customer = SimpleNamespace(username="offset")
    index = {
        "8C:C7:C3:30:AC": [
            (0x60, exact_customer, "8C:C7:C3:30:AC:60"),
            (0x69, offset_customer, "8C:C7:C3:30:AC:69"),
        ]
    }

    assert _fuzzy_find_customer(index, "8C:C7:C3:30:AC:60") is exact_customer
    assert _fuzzy_find_customer(index, "8C:C7:C3:30:AC:61") is None


def test_noc_system_health_returns_components(client, auth_headers, admin_token):
    """GET /noc/system-health should return the production dependency health model."""
    response = client.get("/noc/system-health", headers=auth_headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert data["overall_status"] in {"ok", "warning", "critical", "unknown"}
    assert isinstance(data["components"], list)
    assert any(component["name"] == "Backend API" for component in data["components"])
    assert all("operator_action" in component for component in data["components"])
    backup = next(component for component in data["components"] if component["name"] == "Backup & Restore")
    assert backup["details"]["temp_restore"] in {"passed", "skipped", ""}
    assert "off_host_copy" in backup["details"]
    assert "scheduled_task" in backup["details"]


def test_noc_system_health_marks_stale_collector_and_olt(client, auth_headers, admin_token, db):
    """System Health should make stale collector/OLT conditions visible to operators."""
    from datetime import datetime, timedelta, timezone

    import models

    collector_id = "pytest-stale-collector"
    olt_host = "pytest-stale-olt"
    stale_at = datetime.now(timezone.utc) - timedelta(hours=2)

    db.query(models.OLTHealth).filter(models.OLTHealth.olt_host == olt_host).delete()
    db.query(models.CollectorHealth).filter(models.CollectorHealth.collector_id == collector_id).delete()
    db.commit()

    db.add(models.CollectorHealth(
        collector_id=collector_id,
        collector_name="pytest stale collector",
        collector_hostname="pytest-stale-host",
        last_heartbeat_at=stale_at,
        last_snapshot_at=stale_at,
        last_status="idle",
        last_message="pytest stale heartbeat",
        configured_olts=[olt_host],
        last_batch_total=0,
        heartbeat_count=1,
    ))
    db.add(models.OLTHealth(
        olt_host=olt_host,
        last_snapshot_at=stale_at,
        status="stale",
        stale_since=stale_at,
        collector_id=collector_id,
        collector_name="pytest stale collector",
        collector_hostname="pytest-stale-host",
        last_collector_seen_at=stale_at,
        last_batch_size=0,
    ))
    db.commit()

    try:
        response = client.get("/noc/system-health", headers=auth_headers(admin_token))
        assert response.status_code == 200
        components = response.json()["components"]

        collector = next(c for c in components if c["name"] == "pytest stale collector" and c["category"] == "collector")
        olt = next(c for c in components if c["name"] == f"OLT {olt_host}")

        assert collector["status"] == "critical"
        assert collector["details"]["collector_id"] == collector_id
        assert olt["status"] == "critical"
        assert olt["details"]["collector_id"] == collector_id
    finally:
        db.query(models.OLTHealth).filter(models.OLTHealth.olt_host == olt_host).delete()
        db.query(models.CollectorHealth).filter(models.CollectorHealth.collector_id == collector_id).delete()
        db.commit()


def test_noc_summary_blocks_live_metrics_when_olt_feed_stale(client, auth_headers, admin_token, monkeypatch):
    """NOC summary should hide live Mbps when the OLT poll source is stale."""
    from services import noc_service

    monkeypatch.setattr(noc_service, "OLT_FRESH_CRITICAL_SECONDS", -1)

    response = client.get("/noc/summary", headers=auth_headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert data["live_data_available"] is False
    assert data["data_is_stale"] is True
    assert data["metrics_are_last_known"] is True
    assert data["downstream_mbps"] is None
    assert data["upstream_mbps"] is None
    assert data["source_status"] in {"stale", "unavailable"}
    assert "live" in data["freshness_message"].lower()


def test_scraper_scheduler_health_message_reports_stale_heartbeat(tmp_path, monkeypatch):
    """A stale scheduler heartbeat should not show a misleading healthy message."""
    import json
    from datetime import datetime, timedelta, timezone

    from services import noc_service

    monkeypatch.setenv("RICO_SCRAPER_RUNTIME_DIR", str(tmp_path))
    heartbeat_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    (tmp_path / "scheduler_heartbeat.json").write_text(
        json.dumps({
            "ts": heartbeat_at.isoformat(),
            "status": "running",
            "message": "Scheduler running normally",
            "pid": 123,
        }),
        encoding="utf-8",
    )

    component = noc_service._read_scraper_heartbeat(datetime.now(timezone.utc))

    assert component["status"] == "critical"
    assert "stale" in component["message"].lower()
    assert "running normally" not in component["message"]
    assert "control panel" in component["operator_action"].lower()


def test_noc_global_search_returns_result_shape(client, auth_headers, admin_token):
    """GET /noc/global-search should return a stable search response shape."""
    response = client.get("/noc/global-search?q=zz&limit=3", headers=auth_headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "total" in data
    assert isinstance(data["results"], list)


def test_noc_global_search_accepts_colon_mac_query(client, auth_headers, admin_token):
    """MAC fragments with colons should not crash global search."""
    response = client.get("/noc/global-search?q=8c%3A13&limit=5", headers=auth_headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "total" in data
    assert isinstance(data["results"], list)


def test_noc_customer_dna_returns_profile_shape(client, auth_headers, admin_token, db):
    """GET /noc/customers/{username}/dna should return the operator profile shape."""
    import pytest

    import models

    customer = db.query(models.Customer).first()
    if not customer:
        pytest.skip("no customers available in test database")

    response = client.get(f"/noc/customers/{customer.username}/dna", headers=auth_headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert data["customer"]["username"] == customer.username
    assert "health" in data
    assert "links" in data
    assert "provenance" in data
    assert isinstance(data["provenance"], list)
    assert "audit_log" in data
    assert isinstance(data["audit_log"], list)
    assert isinstance(data["alarms"], list)
    assert isinstance(data["tickets"], list)


def test_noc_customer_dna_exposes_binding_confidence_and_onu_freshness(client, auth_headers, admin_token, db):
    """Customer DNA should show the operator match source/confidence and live-data freshness."""
    from datetime import datetime, timezone
    import uuid

    import models

    suffix = uuid.uuid4().hex[:12].upper()
    username = f"pytest_dna_{suffix}"
    mac = ":".join(suffix[i:i + 2] for i in range(0, 12, 2))

    db.add(models.Customer(
        username=username,
        first_name="DNA",
        last_name="Freshness",
        phone="9000000000",
        status="Active",
        balance=0,
    ))
    db.add(models.ONULatest(
        mac_address=mac,
        olt_host="pytest-dna-olt",
        pon_port="0/7",
        onu_index=7,
        status="online",
        rx_power_dbm=-19.5,
        polled_at=datetime.now(timezone.utc),
    ))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=mac,
        olt_host="pytest-dna-olt",
        pon_port="0/7",
        onu_index=7,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    ))
    db.add(models.CustomerAuditLog(
        customer_id=username,
        action="SURVEY",
        field_name="sticker_photo_url",
        old_value=None,
        new_value="/uploads/test/sticker.jpg",
        changed_by="pytest-tech",
    ))
    db.commit()

    try:
        response = client.get(f"/noc/customers/{username}/dna", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["binding"]["confidence"] == "verified"
        assert data["binding"]["binding_source"] == "field_scan"
        assert data["onu"]["mac_address"] == mac
        assert data["onu"]["age_seconds"] is not None
        assert data["onu"]["stale"] is False
        assert data["health"]["flags"]["stale_live_onu"] is False
        assert data["health"]["decision"] in {"dispatch", "monitor"}
        assert data["audit_log"][0]["action"] == "SURVEY"
        assert data["audit_log"][0]["field_name"] == "sticker_photo_url"
        assert data["audit_log"][0]["changed_by"] == "pytest-tech"
    finally:
        db.query(models.CustomerAuditLog).filter(models.CustomerAuditLog.customer_id == username).delete()
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == mac).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_noc_customer_dna_never_uses_stale_legacy_mac_when_binding_differs(client, auth_headers, admin_token, db):
    """A verified binding must win over legacy customer MAC and reused OLT slot data."""
    from datetime import datetime, timezone

    import models

    username = "pytest-binding-spine"
    binding_mac = "AA:BB:CC:00:00:57"
    legacy_mac = "AA:BB:CC:00:00:60"

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_([binding_mac, legacy_mac])).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="Binding",
        last_name="Spine",
        phone="9000000001",
        status="Active",
        balance=0,
        mac_address=legacy_mac,
        olt_host="pytest-spine-olt",
        pon_port="0/6",
        onu_index=6,
    ))
    db.add(models.ONULatest(
        mac_address=binding_mac,
        olt_host="pytest-spine-olt",
        pon_port="0/6",
        onu_index=6,
        status="online",
        rx_power_dbm=-18.5,
        polled_at=datetime.now(timezone.utc),
    ))
    db.add(models.ONULatest(
        mac_address=legacy_mac,
        olt_host="pytest-spine-olt",
        pon_port="0/6",
        onu_index=6,
        status="online",
        rx_power_dbm=-27.5,
        polled_at=datetime.now(timezone.utc),
    ))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=binding_mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=binding_mac,
        olt_host="pytest-spine-olt",
        pon_port="0/6",
        onu_index=6,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    ))
    db.commit()

    try:
        response = client.get(f"/noc/customers/{username}/dna", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["binding"]["mac_address"] == binding_mac
        assert data["onu"]["mac_address"] == binding_mac
        assert data["onu"]["rx_power_dbm"] == -18.5
        assert legacy_mac not in data["health"]["identity_values"]

        stale_onu = client.get(f"/noc/onus/{legacy_mac}", headers=auth_headers(admin_token))
        assert stale_onu.status_code == 200
        stale_data = stale_onu.json()
        assert stale_data["binding_id"] is None
        assert stale_data["customer_id"] is None
        assert stale_data["customer_match_source"] != "trusted_binding"
    finally:
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_([binding_mac, legacy_mac])).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_customer_dna_treats_railwire_mac_as_discovery_clue_without_binding(client, auth_headers, admin_token, db):
    """Without a verified binding, Railwire MAC must not become live customer status."""
    from datetime import datetime, timezone

    import models

    username = "pytest-railwire-clue"
    railwire_mac = "AA:BB:CC:00:01:60"

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.ONULatest).filter(models.ONULatest.mac_address == railwire_mac).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="Railwire",
        last_name="Clue",
        phone="9000000021",
        status="Active",
        balance=0,
        mac_address=railwire_mac,
    ))
    db.add(models.ONULatest(
        mac_address=railwire_mac,
        olt_host="pytest-railwire-olt",
        pon_port="0/3",
        onu_index=3,
        status="online",
        rx_power_dbm=-17.5,
        polled_at=datetime.now(timezone.utc),
    ))
    db.commit()

    try:
        response = client.get(f"/noc/customers/{username}/dna", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["binding"] is None
        assert data["onu"] is None
        assert data["health"]["flags"]["no_trusted_binding"] is True
        assert data["health"]["flags"]["no_live_onu"] is True
        assert data["health"]["decision"] == "review_identity"
        assert railwire_mac not in data["health"]["identity_values"]
        conflict_kinds = {item["kind"] for item in data["identity_conflicts"]}
        assert "missing_trusted_binding" in conflict_kinds
        assert "railwire_mac_discovery_clue" in conflict_kinds
    finally:
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == railwire_mac).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_onu_detail_does_not_promote_railwire_mac_to_customer_link(client, auth_headers, admin_token, db):
    """ONU detail can expose a Railwire clue, but not as a trusted customer link."""
    from datetime import datetime, timezone

    import models

    username = "pytest-onu-railwire-clue"
    railwire_mac = "AA:BB:CC:00:01:61"

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.ONULatest).filter(models.ONULatest.mac_address == railwire_mac).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="ONU",
        last_name="Clue",
        phone="9000000022",
        status="Active",
        balance=0,
        mac_address=railwire_mac,
    ))
    db.add(models.ONULatest(
        mac_address=railwire_mac,
        olt_host="pytest-railwire-olt",
        pon_port="0/4",
        onu_index=4,
        status="online",
        rx_power_dbm=-16.5,
        polled_at=datetime.now(timezone.utc),
    ))
    db.commit()

    try:
        response = client.get(f"/noc/onus/{railwire_mac}", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["customer_id"] is None
        assert data["binding_id"] is None
        assert data["customer_match_source"] == "railwire_discovery_clue"
    finally:
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == railwire_mac).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_engine_live_refresh_uses_verified_binding_position(client, auth_headers, admin_token, db, monkeypatch):
    """Live SNMP refresh must use onu_bindings, not Railwire/customer_dna cache."""
    from datetime import datetime, timezone

    import models
    from services.olt_engine.types import OpticalData
    from services import olt_engine, olt_registry

    username = "pytest-engine-live-binding"
    verified_mac = "AA:BB:CC:00:01:57"
    called = {}

    class FakeAdapter:
        def get_position_live(self, pon_port, onu_index):
            called["pon_port"] = pon_port
            called["onu_index"] = onu_index
            return OpticalData(
                status="online",
                rx_power_dbm=-18.25,
                tx_power_dbm=2.1,
                polled_at=datetime.now(timezone.utc),
            )

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="Engine",
        last_name="Live",
        phone="9000000023",
        status="Active",
        balance=0,
        mac_address="AA:BB:CC:00:01:60",
    ))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=verified_mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=verified_mac,
        olt_host="pytest-binding-olt",
        pon_port="0/6",
        onu_index=6,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    ))
    db.commit()

    monkeypatch.setattr(olt_registry, "list_active", lambda db: [])
    monkeypatch.setattr(olt_engine, "optical_adapter_for", lambda host: FakeAdapter())

    try:
        response = client.get(f"/engine/customer/{username}/live", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["binding_identity"] == verified_mac
        assert data["olt_host"] == "pytest-binding-olt"
        assert called == {"pon_port": "0/6", "onu_index": 6}
    finally:
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_customer_dna_repairs_index_drift_when_verified_onu_moves(client, auth_headers, admin_token, db):
    """If the verified ONT is live elsewhere, opening DNA repairs the binding."""
    from datetime import datetime, timezone

    import models

    username = "pytest-index-drift"
    verified_mac = "B0:A7:B9:79:D6:72"
    old_slot_mac = "B0:A7:B9:79:D6:99"
    now = datetime.now(timezone.utc)

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_([verified_mac, old_slot_mac])).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="Index",
        last_name="Drift",
        phone="9000000031",
        status="Active",
        balance=0,
        mac_address="AA:AA:AA:AA:AA:31",
    ))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=verified_mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=verified_mac,
        olt_host="10.10.10.100",
        pon_port="0/5",
        onu_index=27,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=now,
    ))
    db.add(models.ONULatest(
        mac_address=verified_mac,
        olt_host="10.10.10.100",
        pon_port="0/5",
        onu_index=31,
        status="online",
        rx_power_dbm=-17.93,
        polled_at=now,
    ))
    db.add(models.ONULatest(
        mac_address=old_slot_mac,
        olt_host="10.10.10.100",
        pon_port="0/5",
        onu_index=27,
        status="online",
        rx_power_dbm=-19.5,
        polled_at=now,
    ))
    db.commit()

    try:
        response = client.get(f"/noc/customers/{username}/dna", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["onu"]["mac_address"] == verified_mac
        assert data["onu"]["onu_index"] == 31
        conflict_kinds = {c["kind"] for c in data["identity_conflicts"]}
        assert "binding_position_changed" not in conflict_kinds
        assert "binding_slot_changed" not in conflict_kinds
        binding = db.query(models.ONUBinding).filter(
            models.ONUBinding.customer_id == username,
            models.ONUBinding.is_active.is_(True),
        ).one()
        db.refresh(binding)
        assert binding.onu_index == 31
    finally:
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_([verified_mac, old_slot_mac])).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_binding_reconciler_moves_verified_binding_by_ont_identity(db):
    """Verified customer bindings follow ONT MAC/serial, not stale ONU index."""
    from datetime import datetime, timezone

    import models
    from services.binding_reconciler import reconcile_bindings_from_onu_latest

    username = "pytest-binding-auto-follow"
    verified_mac = "B0:A7:B9:79:D7:72"
    old_slot_mac = "B0:A7:B9:79:D7:99"
    now = datetime.now(timezone.utc)

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_([verified_mac, old_slot_mac])).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="Auto",
        last_name="Follow",
        phone="9000000032",
        status="Active",
        balance=0,
        mac_address="AA:AA:AA:AA:AA:32",
    ))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=verified_mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=verified_mac,
        olt_host="10.10.10.100",
        pon_port="0/5",
        onu_index=27,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=now,
    ))
    db.add(models.ONULatest(
        mac_address=verified_mac,
        olt_host="10.10.10.100",
        pon_port="0/5",
        onu_index=31,
        status="online",
        rx_power_dbm=-17.93,
        polled_at=now,
    ))
    db.add(models.ONULatest(
        mac_address=old_slot_mac,
        olt_host="10.10.10.100",
        pon_port="0/5",
        onu_index=27,
        status="online",
        rx_power_dbm=-19.5,
        polled_at=now,
    ))
    db.commit()

    try:
        result = reconcile_bindings_from_onu_latest(db, apply=True)
        assert result.verified_identity_matches >= 1
        assert result.position_updated >= 1

        binding = db.query(models.ONUBinding).filter(
            models.ONUBinding.customer_id == username,
            models.ONUBinding.is_active.is_(True),
        ).one()
        assert binding.mac_address == verified_mac
        assert binding.pon_port == "0/5"
        assert binding.onu_index == 31
        assert binding.confidence == "verified"
    finally:
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_([verified_mac, old_slot_mac])).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_customer_dna_hides_unsupported_gpon_customer_bandwidth(client, auth_headers, admin_token, db):
    """GPON .210 live optical data is valid, but per-customer Mbps is unsupported."""
    from datetime import datetime, timedelta, timezone

    import models

    username = "pytest-gpon-bandwidth"
    mac = "AA:BB:CC:21:00:10"
    now = datetime.now(timezone.utc)

    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
    db.query(models.ONUSnapshot).filter(models.ONUSnapshot.mac_address == mac).delete()
    db.query(models.ONULatest).filter(models.ONULatest.mac_address == mac).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(username=username, first_name="GPON", status="Active", balance=0))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=mac,
        onu_type="gpon",
        primary_identifier_type="mac",
        mac_address=mac,
        olt_host="10.10.10.210",
        pon_port="1/2",
        onu_index=10,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=now,
    ))
    db.add(models.ONULatest(
        mac_address=mac,
        olt_host="10.10.10.210",
        pon_port="1/2",
        onu_index=10,
        status="online",
        rx_power_dbm=-18.5,
        polled_at=now,
    ))
    for offset, rx_delta in [(60, 50_000_000), (0, 80_000_000)]:
        db.add(models.ONUSnapshot(
            mac_address=mac,
            olt_host="10.10.10.210",
            pon_port="1/2",
            onu_index=10,
            status="online",
            rx_power_dbm=-18.5,
            rx_bytes_delta=rx_delta,
            tx_bytes_delta=rx_delta // 2,
            polled_at=now - timedelta(seconds=offset),
        ))
    db.commit()

    try:
        response = client.get(f"/noc/customers/{username}/dna", headers=auth_headers(admin_token))
        assert response.status_code == 200
        data = response.json()
        assert data["onu"]["olt_host"] == "10.10.10.210"
        assert data["olt_capability"]["has_customer_bandwidth"] is False
        assert data["bandwidth"]["supported"] is False
        assert data["bandwidth"]["rx_mbps"] is None
        assert "not reliable per-customer traffic counters" in data["bandwidth"]["reason"]
    finally:
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.ONUSnapshot).filter(models.ONUSnapshot.mac_address == mac).delete()
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == mac).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_system_health_reports_configured_olt_capabilities(client, auth_headers, admin_token):
    response = client.get("/noc/system-health", headers=auth_headers(admin_token))

    assert response.status_code == 200
    data = response.json()
    olt_components = {
        component["name"]: component
        for component in data["components"]
        if component["name"].startswith("OLT ")
    }
    for host in ("10.10.10.100", "10.10.10.200", "10.10.10.210"):
        component = olt_components[f"OLT {host}"]
        capability = component["details"]["capability"]
        assert capability["host"] == host
        assert "has_customer_bandwidth" in capability
        assert "binding_match_note" in capability


def test_field_team_monitor_returns_all_active_status_shape(client, auth_headers, admin_token):
    """GET /field-team/monitor should expose technician GPS health for NOC."""
    response = client.get("/field-team/monitor?hours=24", headers=auth_headers(admin_token))
    assert response.status_code == 200
    data = response.json()
    assert "technicians" in data
    assert "live" in data
    assert "stale" in data
    assert "missing" in data
    assert isinstance(data["technicians"], list)


def test_collector_heartbeat_ingest_records_status(client, db):
    """POST /ingest/collector-heartbeat should accept Pi collector status."""
    from sqlalchemy import text

    from services.collector_auth_service import upsert_collector_credential

    collector_id = "pytest-collector"
    token = "pytest-collector-token"
    upsert_collector_credential(db, collector_id=collector_id, token=token)
    db.execute(text("DELETE FROM collector_health WHERE collector_id = :collector_id"), {"collector_id": collector_id})
    db.commit()
    try:
        response = client.post(
            "/ingest/collector-heartbeat",
            headers={"X-Collector-Id": collector_id, "X-Ingest-Token": token},
            json={
                "collector_id": collector_id,
                "collector_name": "pytest collector",
                "collector_hostname": "pytest-host",
                "collector_version": "test",
                "status": "idle",
                "message": "test heartbeat",
                "backend_url": "http://testserver",
                "configured_olts": ["10.0.0.1"],
                "last_batch_total": 0,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["collector_id"] == collector_id
    finally:
        db.execute(text("DELETE FROM collector_health WHERE collector_id = :collector_id"), {"collector_id": collector_id})
        db.execute(text("DELETE FROM collector_credentials WHERE collector_id = :collector_id"), {"collector_id": collector_id})
        db.commit()


def test_ingest_verify_accepts_collector_token(client, db):
    """GET /ingest/verify should validate a per-collector token without writing data."""
    from sqlalchemy import text

    from services.collector_auth_service import upsert_collector_credential

    collector_id = "pytest-verify"
    token = "pytest-verify-token"
    upsert_collector_credential(db, collector_id=collector_id, token=token)
    try:
        response = client.get(
            "/ingest/verify",
            headers={"X-Collector-Id": collector_id, "X-Ingest-Token": token},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["collector_id"] == collector_id
    finally:
        db.execute(text("DELETE FROM collector_credentials WHERE collector_id = :collector_id"), {"collector_id": collector_id})
        db.commit()


def test_ingest_verify_rejects_bad_token(client):
    """GET /ingest/verify should reject a wrong Pi ingest token."""
    response = client.get(
        "/ingest/verify",
        headers={"X-Collector-Id": "pytest-missing", "X-Ingest-Token": "not-the-token"},
    )
    assert response.status_code == 401


def test_ingest_verify_rejects_legacy_token_without_collector(client):
    """Legacy shared token is not accepted unless explicitly enabled."""
    from config.settings import settings

    response = client.get("/ingest/verify", headers={"X-Ingest-Token": settings.OLT_PROXY_TOKEN})
    assert response.status_code == 401


def test_ocr_live_identity_matches_gpon_serial(db):
    """OCR live validation should match GPON serials stored as SN:<serial>."""
    from datetime import datetime, timezone

    import models
    from routers.collection import _apply_ocr_live_identity

    serial = "GPON00ABCD12"
    observed_key = f"SN:{serial}"
    db.query(models.ONULatest).filter(models.ONULatest.mac_address == observed_key).delete()
    db.commit()
    db.add(
        models.ONULatest(
            mac_address=observed_key,
            olt_host="pytest-olt",
            pon_port="1/1",
            onu_index=7,
            status="online",
            polled_at=datetime.now(timezone.utc),
        )
    )
    db.commit()

    try:
        result = {
            "gpon_sn": serial,
            "onu_identifier": serial,
            "ont_serial_number": None,
            "mac_address": None,
        }
        _apply_ocr_live_identity(db, result)
        assert result["identity_in_database"] is True
        assert result["identity_match_type"] == "serial"
        assert result["identity_status"] == "online"
        assert result["identity_olt_host"] == "pytest-olt"
        assert result["identity_pon_port"] == "1/1"
        assert result["identity_onu_index"] == 7
        assert result["mac_in_database"] is False
    finally:
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == observed_key).delete()
        db.commit()
