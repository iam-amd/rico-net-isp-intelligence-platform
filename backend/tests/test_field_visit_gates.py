import uuid

import models
from middleware.auth import create_access_token


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _customer(username: str, **kwargs):
    data = {
        "username": username,
        "first_name": "Visit",
        "last_name": "Gate",
        "phone": "9000000001",
        "status": "Active",
    }
    data.update(kwargs)
    return models.Customer(**data)


def test_link_onu_requires_photo_or_ocr_proof(client, db, tech_token):
    username = f"pytest_visit_no_proof_{uuid.uuid4().hex[:8]}"
    try:
        db.add(_customer(username))
        db.commit()

        response = client.post(
            "/field-team/link-onu",
            headers=_headers(tech_token),
            json={"onu_mac": "AA:BB:CC:00:00:01", "customer_username": username},
        )

        assert response.status_code == 422
        assert "sticker_photo_url or ocr_response_id" in response.text
    finally:
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_link_onu_requires_gps_when_customer_location_is_known(client, db, tech_token):
    username = f"pytest_visit_gps_{uuid.uuid4().hex[:8]}"
    try:
        db.add(_customer(username, gps_lat=12.9, gps_lng=79.7))
        db.commit()

        response = client.post(
            "/field-team/link-onu",
            headers=_headers(tech_token),
            json={
                "onu_mac": "AA:BB:CC:00:00:02",
                "customer_username": username,
                "sticker_photo_url": "/uploads/proof.jpg",
            },
        )

        assert response.status_code == 422
        assert "requires GPS" in response.text
    finally:
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_senior_reboot_requires_open_assigned_ticket(client, db):
    username = f"pytest_reboot_gate_{uuid.uuid4().hex[:8]}"
    senior_username = f"senior_{uuid.uuid4().hex[:8]}"
    token = create_access_token({"sub": senior_username})
    try:
        db.add(_customer(username))
        db.add(models.Technician(
            username=senior_username,
            full_name="Senior Gate",
            role="Senior Tech",
            is_active=1,
        ))
        db.commit()

        response = client.post(
            f"/field-team/reboot/{username}",
            headers=_headers(token),
        )

        assert response.status_code == 403
        assert "open ticket assigned" in response.text
    finally:
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.query(models.Technician).filter(models.Technician.username == senior_username).delete()
        db.commit()
