from datetime import datetime, timezone

import models


TEST_USER = "zz_shift_brief_customer"
TEST_MAC = "AA:BB:CC:70:80:90"


def _cleanup(db):
    db.query(models.AlarmEvent).filter(models.AlarmEvent.mac_address == TEST_MAC).delete(synchronize_session=False)
    db.query(models.Ticket).filter(models.Ticket.customer_id == TEST_USER).delete(synchronize_session=False)
    db.query(models.Customer).filter(models.Customer.username == TEST_USER).delete(synchronize_session=False)
    db.commit()


def test_shift_brief_endpoint_includes_handoff_actions(client, auth_headers, admin_token, db):
    _cleanup(db)
    try:
        customer = models.Customer(
            username=TEST_USER,
            first_name="Shift",
            last_name="Brief",
            phone="9000000000",
            status="Active",
            balance=0,
        )
        db.add(customer)
        db.flush()
        ticket = models.Ticket(
            customer_id=TEST_USER,
            issue_type="Fiber",
            priority="High",
            status="Open",
            description="shift brief test ticket",
        )
        db.add(ticket)
        db.flush()
        db.add(models.AlarmEvent(
            mac_address=TEST_MAC,
            event_type="ONU_OFFLINE",
            received_at=datetime.now(timezone.utc),
            status="open",
            auto_ticket_id=ticket.id,
        ))
        db.commit()

        res = client.get("/noc/shift-brief?hours=12", headers=auth_headers(admin_token))
        assert res.status_code == 200
        body = res.json()
        assert body["window_hours"] == 12
        assert body["alarms"]["open_total"] >= 1
        assert body["tickets"]["open"] >= 1
        assert body["handoff_actions"]
    finally:
        _cleanup(db)
