import os

import models
from config.settings import settings
from services import media_audit_service


TEST_USER = "zz_media_audit_customer"
TEST_TICKET_FILE = "/uploads/pytest_media_audit/ticket-proof.jpg"
TEST_MISSING_FILE = "/uploads/pytest_media_audit/missing-sticker.jpg"
TEST_ORPHAN_REL = "pytest_media_audit/orphan.bin"


def _disk_path(rel: str) -> str:
    return os.path.join(settings.UPLOAD_DIR, rel)


def _cleanup(db):
    db.query(models.TicketMedia).filter(models.TicketMedia.file_path == TEST_TICKET_FILE).delete(synchronize_session=False)
    db.query(models.Ticket).filter(models.Ticket.customer_id == TEST_USER).delete(synchronize_session=False)
    db.query(models.Customer).filter(models.Customer.username == TEST_USER).delete(synchronize_session=False)
    for rel in [TEST_TICKET_FILE.removeprefix("/uploads/"), TEST_ORPHAN_REL]:
        path = _disk_path(rel)
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
    try:
        os.rmdir(_disk_path("pytest_media_audit"))
    except OSError:
        pass
    db.commit()


def test_media_audit_reports_referenced_missing_and_orphan_files(db):
    _cleanup(db)
    try:
        os.makedirs(_disk_path("pytest_media_audit"), exist_ok=True)
        with open(_disk_path(TEST_TICKET_FILE.removeprefix("/uploads/")), "wb") as f:
            f.write(b"ticket")
        with open(_disk_path(TEST_ORPHAN_REL), "wb") as f:
            f.write(b"orphan")

        customer = models.Customer(
            username=TEST_USER,
            first_name="Media",
            last_name="Audit",
            phone="9000000000",
            status="Active",
            balance=0,
            sticker_photo_url=TEST_MISSING_FILE,
        )
        db.add(customer)
        db.flush()
        ticket = models.Ticket(
            customer_id=TEST_USER,
            issue_type="Media",
            priority="Normal",
            status="Open",
        )
        db.add(ticket)
        db.flush()
        db.add(models.TicketMedia(
            ticket_id=ticket.id,
            file_path=TEST_TICKET_FILE,
            filename="ticket-proof.jpg",
            file_type="image/jpeg",
        ))
        db.commit()

        audit = media_audit_service.get_media_audit(db)
        missing_urls = {item["url"] for item in audit["missing_files"]}
        orphan_urls = {item["url"] for item in audit["orphan_files"]}

        assert TEST_MISSING_FILE in missing_urls
        assert f"/uploads/{TEST_ORPHAN_REL}" in orphan_urls
        assert TEST_TICKET_FILE not in missing_urls
        assert audit["summary"]["missing_files"] >= 1
        assert audit["summary"]["orphan_files"] >= 1
    finally:
        _cleanup(db)


def test_media_audit_endpoint_requires_admin_and_returns_summary(client, auth_headers, admin_token):
    response = client.get("/noc/media-audit?include_orphans=false", headers=auth_headers(admin_token))
    assert response.status_code == 200
    body = response.json()
    assert "summary" in body
    assert "missing_files" in body
