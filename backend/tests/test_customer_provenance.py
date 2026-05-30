from datetime import datetime, timezone

import models
from services.customer_provenance_service import record_field_writes


def test_customer_field_provenance_records_latest_source(db):
    username = "pytest_provenance_source"
    db.query(models.CustomerFieldProvenance).filter(models.CustomerFieldProvenance.customer_id == username).delete()
    db.query(models.Customer).filter(models.Customer.username == username).delete()
    db.commit()

    db.add(models.Customer(
        username=username,
        first_name="Prov",
        phone="9000000000",
        status="Active",
    ))
    db.commit()

    try:
        now = datetime.now(timezone.utc)
        record_field_writes(
            db,
            customer_id=username,
            field_names=["plan_name", "expiry_date"],
            source="railwire_scraper",
            writer="sync_daemon",
            verified_at=now,
            updated_at=now,
        )
        db.commit()

        plan = db.get(models.CustomerFieldProvenance, (username, "plan_name"))
        expiry = db.get(models.CustomerFieldProvenance, (username, "expiry_date"))
        assert plan.source == "railwire_scraper"
        assert plan.source_rank == 60
        assert plan.writer == "sync_daemon"
        assert expiry.source == "railwire_scraper"

        record_field_writes(
            db,
            customer_id=username,
            field_names=["plan_name"],
            source="admin",
            writer="admin",
            evidence_ref="manual-check",
            verified_at=now,
            updated_at=now,
        )
        db.commit()

        db.expire_all()
        plan = db.get(models.CustomerFieldProvenance, (username, "plan_name"))
        assert plan.source == "admin"
        assert plan.source_rank == 80
        assert plan.evidence_ref == "manual-check"
    finally:
        db.query(models.CustomerFieldProvenance).filter(models.CustomerFieldProvenance.customer_id == username).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.commit()
