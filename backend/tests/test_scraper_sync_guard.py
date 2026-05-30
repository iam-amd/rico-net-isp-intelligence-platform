import os
import sys
import uuid
from datetime import datetime, timezone

import models


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCRAPER_DIR = os.path.join(ROOT_DIR, "scraper")
if SCRAPER_DIR not in sys.path:
    sys.path.insert(0, SCRAPER_DIR)

from sync_daemon import SyncDaemon  # noqa: E402


def _daemon_without_init() -> SyncDaemon:
    return SyncDaemon.__new__(SyncDaemon)


def test_scraper_mac_sync_does_not_overwrite_verified_binding(db):
    suffix = uuid.uuid4().hex[:10]
    username = f"pytest_scraper_guard_{suffix}"
    verified_mac = "AA:BB:CC:DD:EE:01"
    railwire_mac = "AA:BB:CC:DD:EE:99"

    db.add(models.Customer(
        username=username,
        first_name="Scraper",
        last_name="Guard",
        phone="9000000000",
        status="Active",
    ))
    db.add(models.ONUBinding(
        customer_id=username,
        onu_identifier=verified_mac,
        onu_type="epon",
        primary_identifier_type="mac",
        mac_address=verified_mac,
        binding_source="field_scan",
        confidence="verified",
        is_active=True,
        verified_at=datetime.now(timezone.utc),
    ))
    db.commit()

    try:
        daemon = _daemon_without_init()
        with db.bind.begin() as conn:
            daemon._sync_onu_binding(conn, username, railwire_mac, datetime.now(timezone.utc))

        db.expire_all()
        bindings = db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).all()
        assert len(bindings) == 1
        assert bindings[0].binding_source == "field_scan"
        assert bindings[0].mac_address == verified_mac
        assert bindings[0].onu_identifier == verified_mac
    finally:
        db.rollback()
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()


def test_scraper_records_per_customer_sync_state(db):
    suffix = uuid.uuid4().hex[:10]
    username = f"pytest_sync_state_{suffix}"
    now = datetime.now(timezone.utc)

    db.add(models.Customer(
        username=username,
        first_name="Sync",
        last_name="State",
        phone="9000000000",
        status="Active",
    ))
    db.commit()

    try:
        daemon = _daemon_without_init()
        with db.bind.begin() as conn:
            daemon._record_customer_sync_state(
                conn,
                username=username,
                csv_synced_at=now,
                details_synced_at=now,
                mac_synced_at=now,
                source_updated_at=now,
                status="success",
                error=None,
                now=now,
            )

        db.expire_all()
        state = db.get(models.CustomerSyncState, username)
        assert state is not None
        assert state.source == "railwire_scraper"
        assert state.last_status == "success"
        assert state.error_count == 0
        assert state.last_csv_synced_at is not None
        assert state.last_details_synced_at is not None
        assert state.last_mac_synced_at is not None
    finally:
        db.rollback()
        db.query(models.CustomerSyncState).filter(models.CustomerSyncState.customer_id == username).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()
