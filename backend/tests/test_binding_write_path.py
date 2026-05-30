from datetime import datetime, timezone
import uuid

import models
from services import collection_service


def _customer(username: str, **kwargs):
    data = {
        "username": username,
        "first_name": "Binding",
        "last_name": "WritePath",
        "phone": "9000000000",
        "status": "Active",
        "mac_address": "AA:AA:AA:AA:AA:AA",
        "olt_host": "legacy-olt",
        "pon_port": "legacy-port",
        "onu_index": 99,
    }
    data.update(kwargs)
    return models.Customer(**data)


def test_field_collection_writes_binding_without_overwriting_legacy_customer_columns(db):
    suffix = uuid.uuid4().hex[:12].upper()
    username = f"pytest_bind_field_{suffix}"
    collector_id = 99901
    campaign_id = None
    assignment_id = None
    mac = ":".join(suffix[i:i + 2] for i in range(0, 12, 2))

    try:
        db.add(_customer(username))
        db.add(models.Technician(id=collector_id, username=f"tech_{suffix}", full_name="Test Tech"))
        campaign = models.CollectionCampaign(name=f"pytest campaign {suffix}", status="active")
        db.add(campaign)
        db.flush()
        campaign_id = campaign.id
        assignment = models.CollectionAssignment(
            campaign_id=campaign.id,
            collector_id=collector_id,
            customer_id=username,
            status="pending",
        )
        db.add(assignment)
        db.add(models.ONULatest(
            mac_address=mac,
            olt_host="olt-live",
            pon_port="0/2",
            onu_index=12,
            status="online",
            polled_at=datetime.now(timezone.utc),
        ))
        db.commit()
        assignment_id = assignment.id

        result = collection_service.submit_collection(
            db,
            assignment_id=assignment_id,
            collector_id=collector_id,
            gps_lat=12.1,
            gps_lng=79.7,
            gps_accuracy_m=8,
            onu_identifier=mac,
            ont_mac_address=mac,
            sticker_photo_url="/uploads/test/sticker.jpg",
        )

        assert result["status"] == "ok"
        db.expire_all()
        binding = db.query(models.ONUBinding).filter_by(customer_id=username, is_active=True).one()
        assert binding.mac_address == mac
        assert binding.olt_host == "olt-live"
        assert binding.pon_port == "0/2"
        assert binding.onu_index == 12

        customer = db.query(models.Customer).filter_by(username=username).one()
        assert customer.mac_address == "AA:AA:AA:AA:AA:AA"
        assert customer.olt_host == "legacy-olt"
        assert customer.pon_port == "legacy-port"
        assert customer.onu_index == 99

        gps_provenance = db.get(models.CustomerFieldProvenance, (username, "gps_lat"))
        sticker_provenance = db.get(models.CustomerFieldProvenance, (username, "sticker_photo_url"))
        assert gps_provenance is not None
        assert gps_provenance.source == "field_survey"
        assert gps_provenance.writer == f"tech_{suffix}"
        assert sticker_provenance is not None
        assert sticker_provenance.evidence_ref == "/uploads/test/sticker.jpg"
    finally:
        db.rollback()
        db.query(models.ONULatest).filter(models.ONULatest.mac_address == mac).delete()
        if assignment_id:
            db.query(models.CollectionAssignment).filter(models.CollectionAssignment.id == assignment_id).delete()
        if campaign_id:
            db.query(models.CollectionCampaign).filter(models.CollectionCampaign.id == campaign_id).delete()
        db.query(models.CustomerFieldProvenance).filter(models.CustomerFieldProvenance.customer_id == username).delete()
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.query(models.Technician).filter(models.Technician.id == collector_id).delete()
        db.commit()


def test_admin_correction_writes_binding_without_overwriting_legacy_customer_columns(db):
    suffix = uuid.uuid4().hex[:12].upper()
    username = f"pytest_bind_admin_{suffix}"
    admin_id = 99902
    manual_mac_raw = uuid.uuid4().hex[:12].upper()
    manual_mac = ":".join(manual_mac_raw[i:i + 2] for i in range(0, 12, 2))

    try:
        db.add(_customer(username))
        db.add(models.Technician(id=admin_id, username=f"admin_{suffix}", full_name="Test Admin", role="Admin"))
        db.commit()

        result = collection_service.admin_correct_binding(
            db,
            customer_id=username,
            admin_id=admin_id,
            onu_identifier=manual_mac_raw,
            onu_type="epon",
            olt_host="manual-olt",
            pon_port="0/3",
            confidence="verified",
            notes="manual correction",
        )

        assert result["status"] == "ok"
        db.expire_all()
        binding = db.query(models.ONUBinding).filter_by(customer_id=username, is_active=True).one()
        assert binding.mac_address == manual_mac
        assert binding.olt_host == "manual-olt"
        assert binding.pon_port == "0/3"

        customer = db.query(models.Customer).filter_by(username=username).one()
        assert customer.mac_address == "AA:AA:AA:AA:AA:AA"
        assert customer.olt_host == "legacy-olt"
        assert customer.pon_port == "legacy-port"
        assert customer.onu_index == 99

        audit_fields = {
            row.field_name: row
            for row in db.query(models.CustomerAuditLog)
            .filter(
                models.CustomerAuditLog.customer_id == username,
                models.CustomerAuditLog.action == "ADMIN_BINDING_CORRECTION",
            )
            .all()
        }
        assert audit_fields["onu_binding.mac_address"].new_value == manual_mac
        assert audit_fields["onu_binding.olt_host"].new_value == "manual-olt"
        assert audit_fields["onu_binding.pon_port"].new_value == "0/3"
    finally:
        db.rollback()
        db.query(models.CustomerAuditLog).filter(models.CustomerAuditLog.customer_id == username).delete()
        db.query(models.CustomerFieldProvenance).filter(models.CustomerFieldProvenance.customer_id == username).delete()
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id == username).delete()
        db.query(models.Customer).filter(models.Customer.username == username).delete()
        db.query(models.Technician).filter(models.Technician.id == admin_id).delete()
        db.commit()
