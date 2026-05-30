"""
NOC alarm operator action tests.
"""
from datetime import datetime, timedelta, timezone

import models


def _create_alarm(db, suffix: str) -> models.AlarmEvent:
    suffix_map = {
        "ACK": "aa:bb:cc:00:00:01",
        "SUPPRESS": "aa:bb:cc:00:00:02",
        "RESOLVE": "aa:bb:cc:00:00:03",
    }
    alarm = models.AlarmEvent(
        mac_address=suffix_map[suffix],
        event_type="ONU_OFFLINE",
        olt_host="test-olt",
        pon_port="0/1",
        onu_index=1,
        payload={"test": True},
        received_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        status="open",
        occurrence_count=1,
        last_seen=datetime.now(timezone.utc),
    )
    db.add(alarm)
    db.commit()
    db.refresh(alarm)
    return alarm


def test_alarm_acknowledge_records_operator(client, auth_headers, admin_token, db):
    alarm = _create_alarm(db, "ACK")
    try:
        response = client.post(
            f"/noc/alarms/{alarm.id}/ack",
            json={"note": "operator saw it"},
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == alarm.id
        assert data["status"] == "open"
        assert data["acknowledged_at"] is not None

        db.refresh(alarm)
        assert alarm.acknowledged_by is not None
        assert alarm.operator_note == "operator saw it"
    finally:
        db.delete(alarm)
        db.commit()


def test_alarm_suppress_sets_until_and_status(client, auth_headers, admin_token, db):
    alarm = _create_alarm(db, "SUPPRESS")
    until = datetime.now(timezone.utc) + timedelta(hours=1)
    try:
        response = client.post(
            f"/noc/alarms/{alarm.id}/suppress",
            json={
                "suppressed_until": until.isoformat(),
                "reason": "planned maintenance",
            },
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "suppressed"
        assert data["suppressed_until"] is not None

        db.refresh(alarm)
        assert alarm.status == "suppressed"
        assert alarm.resolution_reason == "planned maintenance"
    finally:
        db.delete(alarm)
        db.commit()


def test_alarm_resolve_sets_duration(client, auth_headers, admin_token, db):
    alarm = _create_alarm(db, "RESOLVE")
    try:
        response = client.post(
            f"/noc/alarms/{alarm.id}/resolve",
            json={"reason": "verified restored"},
            headers=auth_headers(admin_token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "resolved"
        assert data["resolved_at"] is not None

        db.refresh(alarm)
        assert alarm.status == "resolved"
        assert alarm.duration_seconds is not None
        assert alarm.resolution_reason == "verified restored"
    finally:
        db.delete(alarm)
        db.commit()


def test_seeded_noc_alarm_flow_visible_linkable_and_resolvable(client, auth_headers, admin_token, db):
    """Seeded NOC flow: alarm visible in feed, operator links outage, then resolves it."""
    alarm = models.AlarmEvent(
        mac_address="aa:bb:cc:00:00:10",
        event_type="ONU_OFFLINE",
        olt_host="test-olt",
        pon_port="0/9",
        onu_index=10,
        payload={"test": "seeded-noc-flow"},
        received_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        status="open",
        occurrence_count=1,
        last_seen=datetime.now(timezone.utc),
    )
    outage = models.PONPortOutage(
        olt_host="test-olt",
        pon_port="0/9",
        status="open",
        affected_count=3,
        fault_type="PON_FIBER_CUT",
        detected_at=datetime.now(timezone.utc) - timedelta(minutes=2),
    )
    db.add_all([alarm, outage])
    db.commit()
    db.refresh(alarm)
    db.refresh(outage)

    try:
        feed = client.get(
            f"/noc/alarms?status=open&mac={alarm.mac_address}",
            headers=auth_headers(admin_token),
        )
        assert feed.status_code == 200
        feed_body = feed.json()
        assert feed_body["total"] >= 1
        assert any(item["id"] == alarm.id for item in feed_body["alarms"])

        ack = client.post(
            f"/noc/alarms/{alarm.id}/ack",
            json={"note": "seeded flow acknowledged"},
            headers=auth_headers(admin_token),
        )
        assert ack.status_code == 200
        assert ack.json()["acknowledged_at"] is not None

        linked = client.post(
            f"/noc/alarms/{alarm.id}/link-outage",
            json={
                "outage_type": "pon_port",
                "outage_id": outage.id,
                "note": "linked during seeded NOC flow",
            },
            headers=auth_headers(admin_token),
        )
        assert linked.status_code == 200
        assert linked.json()["pon_port_outage_id"] == outage.id

        resolved = client.post(
            f"/noc/alarms/{alarm.id}/resolve",
            json={"reason": "seeded flow restored", "note": "closed from test flow"},
            headers=auth_headers(admin_token),
        )
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"

        db.refresh(alarm)
        assert alarm.status == "resolved"
        assert alarm.pon_port_outage_id == outage.id
        assert alarm.resolution_reason == "seeded flow restored"
    finally:
        db.delete(alarm)
        db.delete(outage)
        db.commit()
