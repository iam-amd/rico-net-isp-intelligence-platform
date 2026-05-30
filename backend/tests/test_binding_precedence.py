"""
Binding-first diagnosis tests.
"""
from datetime import datetime, timezone

import models
from services import diagnosis_service


def _customer(username: str, mac_address: str | None = None) -> models.Customer:
    return models.Customer(
        username=username,
        first_name=username,
        last_name="Test",
        phone="9000000000",
        status="Active",
        balance=0,
        mac_address=mac_address,
    )


def test_diagnosis_uses_active_binding_before_legacy_customer_mac(db):
    legacy = _customer("zz_legacy_binding_test", mac_address="AA:BB:CC:00:10:01")
    trusted = _customer("zz_trusted_binding_test")
    db.add_all([legacy, trusted])
    db.flush()

    binding = models.ONUBinding(
        customer_id=trusted.username,
        onu_identifier="SN-BINDING-TEST",
        onu_type="gpon",
        primary_identifier_type="serial",
        serial_number="SN-BINDING-TEST",
        olt_host="test-olt",
        pon_port="0/1",
        onu_index=7,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    )
    db.add(binding)
    db.flush()

    alarm = models.AlarmEvent(
        mac_address="AA:BB:CC:00:10:01",
        event_type="ONU_OFFLINE",
        olt_host="test-olt",
        pon_port="0/1",
        onu_index=7,
        payload={"status": "offline"},
        received_at=datetime.now(timezone.utc),
        status="open",
    )
    db.add(alarm)
    db.flush()

    try:
        ticket = diagnosis_service.process_alarm(db, alarm)
        assert ticket is not None
        assert ticket.customer_id == trusted.username
    finally:
        if alarm.auto_ticket_id:
            ticket_row = db.get(models.Ticket, alarm.auto_ticket_id)
            if ticket_row:
                db.delete(ticket_row)
        db.delete(alarm)
        db.delete(binding)
        db.delete(legacy)
        db.delete(trusted)
        db.commit()
