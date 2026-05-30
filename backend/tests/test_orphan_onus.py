from datetime import datetime, timedelta, timezone

import models
from services import noc_service


TEST_MACS = [
    "AA:BB:CC:10:20:01",
    "AA:BB:CC:10:20:02",
    "AA:BB:CC:10:20:03",
    "AA:BB:CC:10:20:04",
]
TEST_USERS = [
    "zz_orphan_inactive",
    "zz_orphan_active",
    "zz_orphan_expired",
]


def _cleanup(db):
    db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id.in_(TEST_USERS)
    ).delete(synchronize_session=False)
    db.query(models.ONULatest).filter(
        models.ONULatest.mac_address.in_(TEST_MACS)
    ).delete(synchronize_session=False)
    db.query(models.Customer).filter(
        models.Customer.username.in_(TEST_USERS)
    ).delete(synchronize_session=False)
    db.commit()


def _customer(username: str, status: str, expiry_date=None) -> models.Customer:
    return models.Customer(
        username=username,
        first_name=username,
        last_name="Test",
        phone="9000000000",
        status=status,
        expiry_date=expiry_date,
        balance=0,
    )


def _onu(mac: str, status: str = "online") -> models.ONULatest:
    return models.ONULatest(
        mac_address=mac,
        olt_host="test-olt",
        pon_port="0/1",
        onu_index=int(mac[-2:], 16),
        status=status,
        rx_power_dbm=-19.5,
        tx_power_dbm=2.0,
        temperature_c=41.0,
        voltage_mv=3300,
        dying_gasp=False,
        polled_at=datetime.now(timezone.utc),
    )


def _binding(customer_id: str, mac: str) -> models.ONUBinding:
    return models.ONUBinding(
        customer_id=customer_id,
        onu_identifier=mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=mac,
        olt_host="test-olt",
        pon_port="0/1",
        onu_index=int(mac[-2:], 16),
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    )


def test_orphan_onu_report_flags_missing_inactive_and_expired_customers(db):
    _cleanup(db)
    try:
        expired_at = datetime.now(timezone.utc) - timedelta(days=1)
        db.add_all([
            _customer("zz_orphan_inactive", "Inactive"),
            _customer("zz_orphan_active", "Active"),
            _customer("zz_orphan_expired", "Active", expiry_date=expired_at),
            _onu(TEST_MACS[0]),
            _onu(TEST_MACS[1]),
            _onu(TEST_MACS[2]),
            _onu(TEST_MACS[3]),
        ])
        db.flush()
        db.add_all([
            _binding("zz_orphan_inactive", TEST_MACS[1]),
            _binding("zz_orphan_active", TEST_MACS[2]),
            _binding("zz_orphan_expired", TEST_MACS[3]),
        ])
        db.commit()

        report = noc_service.get_orphan_onus(db)
        by_mac = {item["mac_address"]: item for item in report["onus"]}

        assert by_mac[TEST_MACS[0]]["reason"] == "missing_customer"
        assert by_mac[TEST_MACS[1]]["reason"] == "inactive_customer"
        assert TEST_MACS[2] not in by_mac
        assert by_mac[TEST_MACS[3]]["reason"] == "expired_customer"
        assert report["summary"]["missing_customer"] >= 1
        assert report["summary"]["inactive_customer"] >= 1
        assert report["summary"]["expired_customer"] >= 1
    finally:
        _cleanup(db)


def test_unlinked_onus_respects_trusted_binding(db):
    _cleanup(db)
    try:
        db.add_all([
            _customer("zz_orphan_active", "Active"),
            _onu(TEST_MACS[2]),
        ])
        db.flush()
        db.add(_binding("zz_orphan_active", TEST_MACS[2]))
        db.commit()

        unlinked = noc_service.get_unlinked_onus(db)
        assert TEST_MACS[2] not in {item["mac_address"] for item in unlinked}
    finally:
        _cleanup(db)


def test_orphan_onu_endpoint_returns_seeded_orphan(client, auth_headers, admin_token, db):
    _cleanup(db)
    try:
        db.add(_onu(TEST_MACS[0]))
        db.commit()

        res = client.get("/noc/orphan-onus", headers=auth_headers(admin_token))
        assert res.status_code == 200
        body = res.json()
        seeded = [item for item in body["onus"] if item["mac_address"] == TEST_MACS[0]]
        assert seeded
        assert seeded[0]["reason"] == "missing_customer"
    finally:
        _cleanup(db)
