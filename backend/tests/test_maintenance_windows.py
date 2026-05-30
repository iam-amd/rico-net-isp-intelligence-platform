"""NOC maintenance window suppression tests."""
from datetime import datetime, timedelta, timezone

import models
from services import alarm_service


def _delete_test_rows(db):
    db.query(models.AlarmEvent).filter(
        models.AlarmEvent.mac_address.in_([
            "aa:bb:cc:17:00:01",
            "aa:bb:cc:17:00:02",
        ])
    ).delete(synchronize_session=False)
    db.query(models.OLTMaintenanceWindow).filter(
        models.OLTMaintenanceWindow.olt_host == "test-maint-olt"
    ).delete(synchronize_session=False)
    db.commit()


def test_maintenance_window_suppresses_matching_lifecycle_alarm(db):
    _delete_test_rows(db)
    now = datetime.now(timezone.utc)
    window = alarm_service.create_maintenance_window(
        db,
        olt_host="test-maint-olt",
        pon_port="0/1",
        starts_at=now - timedelta(minutes=5),
        ends_at=now + timedelta(minutes=55),
        reason="firmware reboot",
        created_by=1,
    )

    try:
        alarm = alarm_service.open_alarm(
            db,
            mac_address="aa:bb:cc:17:00:01",
            event_type="ONU_OFFLINE",
            olt_host="test-maint-olt",
            pon_port="0/1",
            onu_index=1,
            payload={"source": "test"},
            received_at=now,
        )

        assert alarm.status == "suppressed"
        assert alarm.suppressed_until == window.ends_at
        assert alarm.resolution_reason == "maintenance_window"
        assert alarm.payload["maintenance_window_id"] == window.id
        assert alarm.operator_note == "firmware reboot"
    finally:
        _delete_test_rows(db)


def test_maintenance_window_does_not_suppress_other_pon_port(db):
    _delete_test_rows(db)
    now = datetime.now(timezone.utc)
    alarm_service.create_maintenance_window(
        db,
        olt_host="test-maint-olt",
        pon_port="0/1",
        starts_at=now - timedelta(minutes=5),
        ends_at=now + timedelta(minutes=55),
        reason="port 1 work only",
        created_by=1,
    )

    try:
        alarm = alarm_service.open_alarm(
            db,
            mac_address="aa:bb:cc:17:00:02",
            event_type="ONU_OFFLINE",
            olt_host="test-maint-olt",
            pon_port="0/2",
            onu_index=2,
            payload={"source": "test"},
            received_at=now,
        )

        assert alarm.status == "open"
        assert alarm.suppressed_until is None
        assert alarm.resolution_reason is None
    finally:
        _delete_test_rows(db)


def test_noc_maintenance_window_api_create_list_cancel(client, auth_headers, admin_token, db):
    _delete_test_rows(db)
    now = datetime.now(timezone.utc)
    try:
        create_response = client.post(
            "/noc/maintenance-windows",
            headers=auth_headers(admin_token),
            json={
                "olt_host": "test-maint-olt",
                "pon_port": "0/3",
                "starts_at": (now + timedelta(minutes=10)).isoformat(),
                "ends_at": (now + timedelta(hours=1)).isoformat(),
                "reason": "api test",
            },
        )
        assert create_response.status_code == 200
        created = create_response.json()
        assert created["olt_host"] == "test-maint-olt"
        assert created["pon_port"] == "0/3"
        assert created["is_active"] is True

        list_response = client.get(
            "/noc/maintenance-windows?active_only=false&include_expired=true",
            headers=auth_headers(admin_token),
        )
        assert list_response.status_code == 200
        assert any(item["id"] == created["id"] for item in list_response.json()["windows"])

        cancel_response = client.post(
            f"/noc/maintenance-windows/{created['id']}/cancel",
            headers=auth_headers(admin_token),
        )
        assert cancel_response.status_code == 200
        assert cancel_response.json()["is_active"] is False
    finally:
        _delete_test_rows(db)
