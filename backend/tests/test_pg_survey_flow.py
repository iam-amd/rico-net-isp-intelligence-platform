"""PG field-survey workflow tests."""
import io
import os
import uuid
from datetime import datetime, timedelta, timezone


def test_pg_building_create_accepts_missing_owner(client, auth_headers, admin_token, db):
    import models

    building_id = f"pytest_pg_{uuid.uuid4().hex[:10]}"
    try:
        response = client.post(
            "/pg/buildings",
            headers=auth_headers(admin_token),
            json={
                "id": building_id,
                "name": "Pytest Avita",
                "pg_type": "Gents",
                "gps_lat": 12.8234,
                "gps_lng": 80.0441,
            },
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["id"] == building_id
        assert data["owner_name"] == "Unknown"
    finally:
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.commit()


def test_survey_map_plots_pg_building_once_not_room_customers(client, auth_headers, admin_token, db):
    import models

    suffix = uuid.uuid4().hex[:10]
    normal_username = f"pytest_map_normal_{suffix}"
    pg_username = f"pytest_map_pg_{suffix}"
    building_id = f"pytest_map_pg_{suffix}"
    floor_id = f"pytest_map_floor_{suffix}"
    room_id = f"pytest_map_room_{suffix}"

    try:
        db.add(models.Customer(
            username=normal_username,
            first_name="Normal",
            phone="9000000000",
            gps_lat=12.821,
            gps_lng=80.041,
        ))
        db.add(models.Customer(
            username=pg_username,
            first_name="PG",
            phone="9000000001",
            gps_lat=12.822,
            gps_lng=80.042,
        ))
        db.add(models.PGBuilding(
            id=building_id,
            name="Map Test PG",
            pg_type="Mixed",
            owner_name="Owner",
            gps_lat=12.823,
            gps_lng=80.043,
        ))
        db.add(models.PGFloor(
            id=floor_id,
            building_id=building_id,
            floor_number=1,
        ))
        db.add(models.PGRoom(
            id=room_id,
            building_id=building_id,
            floor_id=floor_id,
            room_number="101",
            status="done",
            connection_type="individual",
            username=pg_username,
        ))
        db.commit()

        response = client.get("/collection/survey/map", headers=auth_headers(admin_token))
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        usernames = {item["username"] for item in items}
        pg_items = [item for item in items if item.get("item_type") == "pg_building" and item.get("building_id") == building_id]

        assert normal_username in usernames
        assert pg_username not in usernames
        assert len(pg_items) == 1
        assert pg_items[0]["gps_lat"] == 12.823
        assert pg_items[0]["room_count"] == 1
        assert pg_items[0]["customer_count"] == 1
    finally:
        db.query(models.PGRoom).filter(models.PGRoom.id == room_id).delete()
        db.query(models.PGFloor).filter(models.PGFloor.id == floor_id).delete()
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.query(models.Customer).filter(models.Customer.username.in_([normal_username, pg_username])).delete(synchronize_session=False)
        db.commit()


def test_pg_bulk_sync_stale_identity_change_requires_review(client, auth_headers, admin_token, db):
    import models

    suffix = uuid.uuid4().hex[:10]
    building_id = f"pytest_pg_review_{suffix}"
    floor_id = f"pytest_floor_review_{suffix}"
    room_id = f"pytest_room_review_{suffix}"

    try:
        db.add(models.PGBuilding(
            id=building_id,
            name="Review PG",
            pg_type="Mixed",
            owner_name="Owner",
        ))
        db.add(models.PGFloor(
            id=floor_id,
            building_id=building_id,
            floor_number=1,
        ))
        db.add(models.PGRoom(
            id=room_id,
            building_id=building_id,
            floor_id=floor_id,
            room_number="201",
            status="done",
            connection_type="individual",
            username="current_user",
            mac_address="AA:BB:CC:00:20:01",
            updated_at=datetime.now(timezone.utc),
        ))
        db.commit()

        stale_collected_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        response = client.post(
            "/pg/sync",
            headers=auth_headers(admin_token),
            json={
                "buildings": [],
                "floors": [],
                "router_groups": [],
                "rooms": [{
                    "id": room_id,
                    "building_id": building_id,
                    "floor_id": floor_id,
                    "room_number": "201",
                    "status": "done",
                    "connection_type": "individual",
                    "username": "offline_user",
                    "mac_address": "AA:BB:CC:00:20:02",
                    "collected_at": stale_collected_at,
                    "change_reason": "offline edit from old phone state",
                }],
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["review_required"] == 1

        db.expire_all()
        room = db.query(models.PGRoom).filter_by(id=room_id).one()
        assert room.username == "current_user"
        assert room.mac_address == "AA:BB:CC:00:20:01"
        assert room.status == "flagged"

        reviews_response = client.get(
            "/pg/room-reviews",
            headers=auth_headers(admin_token),
        )
        assert reviews_response.status_code == 200, reviews_response.text
        review = next(r for r in reviews_response.json() if r["entity_id"] == room_id)
        assert review["action"] == "review_required"
        assert review["after_data"]["proposed"]["username"] == "offline_user"

        apply_response = client.post(
            f"/pg/rooms/{room_id}/reviews/{review['id']}/apply",
            params={"reason": "verified field evidence"},
            headers=auth_headers(admin_token),
        )
        assert apply_response.status_code == 200, apply_response.text
        assert apply_response.json()["username"] == "offline_user"

        db.expire_all()
        room = db.query(models.PGRoom).filter_by(id=room_id).one()
        assert room.username == "offline_user"
        assert room.mac_address == "AA:BB:CC:00:20:02"
    finally:
        db.query(models.PGChangeEvent).filter(
            models.PGChangeEvent.entity_id == room_id
        ).delete(synchronize_session=False)
        db.query(models.PGRoom).filter_by(id=room_id).delete()
        db.query(models.PGFloor).filter_by(id=floor_id).delete()
        db.query(models.PGBuilding).filter_by(id=building_id).delete()
        db.commit()


def test_pg_room_conflict_move_and_revert(client, auth_headers, admin_token, db):
    import models

    suffix = uuid.uuid4().hex[:10]
    building_id = f"pytest_pg_{suffix}"
    floor_id = f"pytest_floor_{suffix}"
    old_room_id = f"pytest_old_{suffix}"
    new_room_id = f"pytest_new_{suffix}"
    username = f"pytest_pg_user_{suffix}"

    try:
        db.add(models.Customer(
            username=username,
            first_name="Pytest",
            last_name="PG",
            phone="0000000000",
            plan_name="Test Plan",
            status="Active",
        ))
        db.add(models.PGBuilding(
            id=building_id,
            name="Pytest Conflict PG",
            pg_type="Gents",
            owner_name="Unknown",
        ))
        db.add(models.PGFloor(id=floor_id, building_id=building_id, floor_number=1))
        db.add(models.PGRoom(
            id=old_room_id,
            building_id=building_id,
            floor_id=floor_id,
            room_number="101",
            status="done",
            connection_type="individual",
            username=username,
        ))
        db.add(models.PGRoom(
            id=new_room_id,
            building_id=building_id,
            floor_id=floor_id,
            room_number="102",
            status="pending",
            connection_type="none",
        ))
        db.commit()

        conflict_response = client.get(
            f"/pg/rooms/{new_room_id}/conflicts",
            headers=auth_headers(admin_token),
            params={"username": username},
        )
        assert conflict_response.status_code == 200, conflict_response.text
        conflicts = conflict_response.json()["conflicts"]
        assert any(c["room_id"] == old_room_id for c in conflicts)

        move_response = client.post(
            f"/pg/rooms/{new_room_id}/resolve-conflicts",
            headers=auth_headers(admin_token),
            json={"username": username, "reason": "pytest verified move to new room"},
        )
        assert move_response.status_code == 200, move_response.text
        assert move_response.json()["updated_rooms"] == 1

        db.expire_all()
        old_room = db.query(models.PGRoom).filter_by(id=old_room_id).one()
        assert old_room.username is None

        history_response = client.get(
            f"/pg/rooms/{old_room_id}/history",
            headers=auth_headers(admin_token),
        )
        assert history_response.status_code == 200, history_response.text
        history = history_response.json()
        event = next(e for e in history if e["action"] == "conflict_unlink")

        revert_response = client.post(
            f"/pg/rooms/{old_room_id}/history/{event['id']}/revert",
            headers=auth_headers(admin_token),
            params={"reason": "pytest revert accidental move"},
        )
        assert revert_response.status_code == 200, revert_response.text
        assert revert_response.json()["username"] == username
    finally:
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_pg_building_photo_upload_updates_photo_url(client, auth_headers, admin_token, db):
    import models

    building_id = f"pytest_pg_photo_{uuid.uuid4().hex[:10]}"
    try:
        db.add(models.PGBuilding(
            id=building_id,
            name="Pytest Photo PG",
            pg_type="Mixed",
            owner_name="Unknown",
        ))
        db.commit()

        response = client.post(
            f"/pg/buildings/{building_id}/photo",
            headers=auth_headers(admin_token),
            files={"file": ("building.jpg", io.BytesIO(b"fake image bytes"), "image/jpeg")},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["photo_url"].startswith(f"/uploads/pg/{building_id}/building/")

        db.expire_all()
        building = db.query(models.PGBuilding).filter_by(id=building_id).one()
        assert building.photo_url == data["photo_url"]
    finally:
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.commit()


def test_pg_room_create_endpoint_writes_history(client, auth_headers, admin_token, db):
    import models

    suffix = uuid.uuid4().hex[:10]
    building_id = f"pytest_pg_room_api_{suffix}"
    floor_id = f"pytest_floor_api_{suffix}"
    room_id = f"pytest_room_api_{suffix}"
    try:
        db.add(models.PGBuilding(
            id=building_id,
            name="Pytest Room API PG",
            pg_type="Mixed",
            owner_name="Unknown",
        ))
        db.add(models.PGFloor(id=floor_id, building_id=building_id, floor_number=0))
        db.commit()

        response = client.post(
            "/pg/rooms",
            headers=auth_headers(admin_token),
            json={
                "id": room_id,
                "building_id": building_id,
                "floor_id": floor_id,
                "room_number": "G1",
                "status": "pending",
                "connection_type": "none",
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["id"] == room_id

        history_response = client.get(
            f"/pg/rooms/{room_id}/history",
            headers=auth_headers(admin_token),
        )
        assert history_response.status_code == 200, history_response.text
        assert any(event["action"] == "create" for event in history_response.json())
    finally:
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.commit()


def test_pg_room_survey_creates_trusted_onu_binding(client, auth_headers, admin_token, db):
    import models

    suffix = uuid.uuid4().hex[:10]
    building_id = f"pytest_pg_bind_{suffix}"
    floor_id = f"pytest_floor_bind_{suffix}"
    room_id = f"pytest_room_bind_{suffix}"
    username = f"pytest_pg_bind_user_{suffix}"
    serial = f"GPON{suffix[:8].upper()}"
    onu_key = f"SN:{serial}"

    try:
        db.add(models.Customer(
            username=username,
            first_name="Pytest",
            phone="0000000000",
            plan_name="Test Plan",
            status="Active",
        ))
        db.add(models.PGBuilding(
            id=building_id,
            name="Pytest Binding PG",
            pg_type="Mixed",
            owner_name="Unknown",
        ))
        db.add(models.PGFloor(id=floor_id, building_id=building_id, floor_number=1))
        db.add(models.ONULatest(
            mac_address=onu_key,
            olt_host="10.10.10.100",
            pon_port="gpon0/1",
            onu_index=7,
            status="online",
            rx_power_dbm=-20.5,
            polled_at=datetime.now(timezone.utc),
        ))
        db.commit()

        response = client.post(
            "/pg/rooms",
            headers=auth_headers(admin_token),
            json={
                "id": room_id,
                "building_id": building_id,
                "floor_id": floor_id,
                "room_number": "101",
                "status": "done",
                "connection_type": "individual",
                "username": username,
                "ont_serial": serial,
                "mac_address": "8CC7C330AC57",
                "ont_model": "HG323DAC",
                "ont_sticker_photo_url": f"/uploads/pg/{room_id}/ont_sticker.jpg",
            },
        )
        assert response.status_code == 201, response.text

        db.expire_all()
        binding = db.query(models.ONUBinding).filter_by(customer_id=username, is_active=True).one()
        assert binding.binding_source == "pg_survey"
        assert binding.confidence == "verified"
        assert binding.onu_identifier == serial
        assert binding.primary_identifier_type == "serial"
        assert binding.olt_host == "10.10.10.100"
        assert binding.pon_port == "gpon0/1"
        assert binding.onu_index == 7

        customer = db.query(models.Customer).filter_by(username=username).one()
        assert customer.ont_serial_number == serial
        assert customer.olt_host is None
        assert customer.pon_port is None
        assert customer.onu_index is None
        assert customer.mac_address is None
        assert customer.sticker_photo_url.endswith("ont_sticker.jpg")
    finally:
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == onu_key).delete()
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_pg_room_router_sticker_fields_sync_to_customer_without_onu_binding(client, auth_headers, admin_token, db):
    import models

    suffix = uuid.uuid4().hex[:10]
    building_id = f"pytest_pg_router_{suffix}"
    floor_id = f"pytest_floor_router_{suffix}"
    room_id = f"pytest_room_router_{suffix}"
    username = f"pytest_pg_router_user_{suffix}"

    try:
        db.add(models.Customer(
            username=username,
            first_name="Pytest",
            phone="0000000000",
            plan_name="Test Plan",
            status="Active",
        ))
        db.add(models.PGBuilding(
            id=building_id,
            name="Pytest Router PG",
            pg_type="Mixed",
            owner_name="Unknown",
        ))
        db.add(models.PGFloor(id=floor_id, building_id=building_id, floor_number=1))
        db.commit()

        response = client.post(
            "/pg/rooms",
            headers=auth_headers(admin_token),
            json={
                "id": room_id,
                "building_id": building_id,
                "floor_id": floor_id,
                "room_number": "102",
                "status": "done",
                "connection_type": "individual",
                "username": username,
                "router_mac_address": "C0-06-C3-95-40-A8",
                "router_serial": "22143Q4066334",
                "router_model": "Archer C24",
                "router_sticker_photo_url": f"/uploads/pg/{room_id}/router_sticker.jpg",
            },
        )
        assert response.status_code == 201, response.text

        db.expire_all()
        assert db.query(models.ONUBinding).filter_by(customer_id=username, is_active=True).count() == 0
        customer = db.query(models.Customer).filter_by(username=username).one()
        assert customer.router_mac_address == "C0:06:C3:95:40:A8"
        assert customer.router_serial == "22143Q4066334"
        assert customer.router_model == "Archer C24"
        assert customer.router_sticker_photo_url.endswith("router_sticker.jpg")
    finally:
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_pg_room_existing_photo_ocr_uses_stored_room_photo(
    client,
    auth_headers,
    admin_token,
    db,
    monkeypatch,
):
    import models
    import routers.collection as collection_router
    import services.ocr_service as ocr_service
    from config.settings import settings

    suffix = uuid.uuid4().hex[:10]
    building_id = f"pytest_pg_ocr_{suffix}"
    floor_id = f"pytest_floor_ocr_{suffix}"
    room_id = f"pytest_room_ocr_{suffix}"
    rel_url = f"/uploads/pg/{room_id}/sticker_test.jpg"
    disk_dir = os.path.join(settings.UPLOAD_DIR, "pg", room_id)
    disk_path = os.path.join(disk_dir, "sticker_test.jpg")

    def fake_extract(image_bytes: bytes):
        assert image_bytes == b"stored sticker bytes"
        return {
            "mac_address": "8CC7C330AC57",
            "gpon_sn": None,
            "onu_identifier": "8CC7C330AC57",
            "ont_model": "NL-E8-C",
            "confidence": "high",
        }

    try:
        db.add(models.PGBuilding(
            id=building_id,
            name="Pytest Existing OCR PG",
            pg_type="Mixed",
            owner_name="Unknown",
        ))
        db.add(models.PGFloor(id=floor_id, building_id=building_id, floor_number=0))
        db.add(models.PGRoom(
            id=room_id,
            building_id=building_id,
            floor_id=floor_id,
            room_number="G2",
            status="pending",
            connection_type="none",
            photo_urls=f'["{rel_url}"]',
        ))
        db.commit()

        os.makedirs(disk_dir, exist_ok=True)
        with open(disk_path, "wb") as f:
            f.write(b"stored sticker bytes")

        monkeypatch.setattr(ocr_service, "extract_sticker_data", fake_extract)
        monkeypatch.setattr(
            collection_router,
            "_apply_ocr_live_identity",
            lambda _db, result: {**result, "identity_in_database": False},
        )

        response = client.post(
            f"/pg/rooms/{room_id}/ocr-existing-photo",
            headers=auth_headers(admin_token),
            json={"photo_url": rel_url},
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["photo_url"] == rel_url
        assert data["mac_address"] == "8CC7C330AC57"
        assert data["ont_model"] == "NL-E8-C"
    finally:
        if os.path.exists(disk_path):
            try:
                os.remove(disk_path)
            except PermissionError:
                pass
        db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).delete()
        db.commit()
