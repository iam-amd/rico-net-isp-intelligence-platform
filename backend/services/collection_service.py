"""
Rico Net — Collection Service (Operation Bridge the Gap)
=========================================================
Field data collection campaign for linking customers to their ONU devices
and capturing GPS + contact enrichment on-site.

Core flows:
- Campaign create → distribute assignments round-robin across collectors
- Collector pulls my-assignments → submits (atomic write to bindings+customer+log)
- Admin monitors progress, reviews issues, resolves duplicates, applies corrections

All writes go through this service. Every state change is appended to
collection_log for the full audit trail.
"""
import logging
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import models
from services.customer_provenance_service import record_field_writes
from services.onu_binding_service import build_binding_identity, normalize_mac


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two GPS points in metres."""
    R = 6371000.0
    rlat1 = math.radians(lat1)
    rlat2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

logger = logging.getLogger("rico_net.collection_service")

# Confidence thresholds
GPS_WARN_ACCURACY_M = 50.0  # > this triggers low_gps_accuracy issue
MIN_ONU_ID_LEN = 4

_PHONE_CLEAN_RE = re.compile(r"[^\d+]")


# Identifier normalisation lives in onu_binding_service (normalize_mac /
# normalize_serial / build_binding_identity). Use those helpers — never reinvent
# MAC/serial parsing here.


def _lookup_onu_latest(db: Session, mac: str) -> Optional[models.ONULatest]:
    """Find the ONU in the live-poll table by MAC, case-insensitive."""
    return db.query(models.ONULatest).filter(
        func.upper(models.ONULatest.mac_address) == mac.upper()
    ).first()


def _sync_alt_phones(db: Session, customer_username: str, phones: List[str]) -> int:
    """
    Upsert alt phone numbers into customer_phones.
    Dedupes, cleans, and ignores anything already linked to this customer.
    Returns the number of new rows inserted.
    """
    if not phones:
        return 0
    existing = {
        row[0]
        for row in db.query(models.CustomerPhone.phone_number)
        .filter(models.CustomerPhone.customer_id == customer_username)
        .all()
    }
    inserted = 0
    for raw in phones:
        if not raw:
            continue
        cleaned = _PHONE_CLEAN_RE.sub("", raw).strip()
        if not cleaned or cleaned in existing:
            continue
        # Uniqueness is global — skip if another customer owns this number
        clash = db.query(models.CustomerPhone).filter_by(phone_number=cleaned).first()
        if clash:
            continue
        db.add(models.CustomerPhone(
            customer_id=customer_username,
            phone_number=cleaned,
            label="alt",
            is_primary=False,
        ))
        existing.add(cleaned)
        inserted += 1
    return inserted


# ---------------------------------------------------------------------------
# Audit log helper
# ---------------------------------------------------------------------------

def _log(
    db: Session,
    *,
    action: str,
    campaign_id: Optional[int] = None,
    assignment_id: Optional[int] = None,
    customer_id: Optional[str] = None,
    collector_id: Optional[int] = None,
    message: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> None:
    """Append an entry to collection_log. Never raises — logs on failure."""
    try:
        entry = models.CollectionLog(
            campaign_id=campaign_id,
            assignment_id=assignment_id,
            customer_id=customer_id,
            collector_id=collector_id,
            action=action,
            message=message,
            payload=payload,
        )
        db.add(entry)
        # caller commits
    except Exception as e:
        logger.warning("collection_log insert failed: %s", e)


# ---------------------------------------------------------------------------
# Campaign lifecycle
# ---------------------------------------------------------------------------

def create_campaign(
    db: Session,
    *,
    name: str,
    description: Optional[str],
    include_all_customers: bool,
    customer_usernames: Optional[List[str]],
    created_by: int,
) -> models.CollectionCampaign:
    """Create a campaign. Assignments are created separately via distribute_assignments."""
    if include_all_customers:
        target = db.query(func.count(models.Customer.username)).scalar() or 0
    else:
        target = len(customer_usernames or [])

    campaign = models.CollectionCampaign(
        name=name,
        description=description,
        status="active",
        target_count=target,
        completed_count=0,
        skipped_count=0,
        created_by=created_by,
        started_at=datetime.now(timezone.utc),
    )
    db.add(campaign)
    db.flush()  # get id

    _log(
        db,
        action="campaign_created",
        campaign_id=campaign.id,
        collector_id=created_by,
        message=f"Campaign '{name}' created with target={target}",
        payload={"include_all": include_all_customers, "target_count": target},
    )
    db.commit()
    db.refresh(campaign)
    return campaign


def distribute_assignments(
    db: Session,
    *,
    campaign_id: int,
    collector_ids: List[int],
    created_by: int,
    only_customer_usernames: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Distribute customers round-robin across collectors.
    Skips customers that already have an assignment in this campaign.
    """
    campaign = db.query(models.CollectionCampaign).filter_by(id=campaign_id).first()
    if not campaign:
        raise ValueError(f"Campaign {campaign_id} not found")

    # Validate collectors
    techs = db.query(models.Technician).filter(
        models.Technician.id.in_(collector_ids),
        models.Technician.is_active == 1,
    ).all()
    if len(techs) != len(collector_ids):
        found = {t.id for t in techs}
        missing = set(collector_ids) - found
        raise ValueError(f"Inactive or unknown technicians: {sorted(missing)}")

    # Existing assignments in this campaign
    existing = {
        row[0] for row in db.query(models.CollectionAssignment.customer_id).filter_by(
            campaign_id=campaign_id
        ).all()
    }

    # Candidate customer list
    if only_customer_usernames:
        candidates = [u for u in only_customer_usernames if u not in existing]
    else:
        all_users = [
            row[0] for row in db.query(models.Customer.username).all()
        ]
        candidates = [u for u in all_users if u not in existing]

    # Round-robin assign
    created = 0
    for idx, cust_username in enumerate(candidates):
        collector = collector_ids[idx % len(collector_ids)]
        row = models.CollectionAssignment(
            campaign_id=campaign_id,
            collector_id=collector,
            customer_id=cust_username,
            status="pending",
        )
        db.add(row)
        created += 1

    _log(
        db,
        action="assignments_distributed",
        campaign_id=campaign_id,
        collector_id=created_by,
        message=f"Distributed {created} assignments across {len(collector_ids)} collectors",
        payload={"collectors": collector_ids, "count": created},
    )
    db.commit()
    return {"created": created, "collectors": len(collector_ids)}


# ---------------------------------------------------------------------------
# Collector view
# ---------------------------------------------------------------------------

def list_my_assignments(
    db: Session,
    *,
    collector_id: int,
    status_filter: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return assignments for a collector, joined with customer info."""
    q = db.query(
        models.CollectionAssignment,
        models.Customer,
    ).join(
        models.Customer,
        models.Customer.username == models.CollectionAssignment.customer_id,
    ).filter(
        models.CollectionAssignment.collector_id == collector_id,
    )

    if status_filter:
        q = q.filter(models.CollectionAssignment.status == status_filter)

    q = q.order_by(
        models.CollectionAssignment.status.asc(),  # pending first alphabetically
        models.CollectionAssignment.assigned_at.asc(),
    )

    # Need existing binding hint
    existing_bindings = {
        row[0]: row[1]
        for row in db.query(
            models.ONUBinding.customer_id,
            models.ONUBinding.onu_identifier,
        ).all()
    }

    results = []
    tech_names = {
        t.id: t.full_name
        for t in db.query(models.Technician).filter(
            models.Technician.id == collector_id
        ).all()
    }
    collector_name = tech_names.get(collector_id)

    for assignment, customer in q.all():
        results.append({
            "id": assignment.id,
            "campaign_id": assignment.campaign_id,
            "collector_id": assignment.collector_id,
            "collector_name": collector_name,
            "customer_id": customer.username,
            "customer_name": f"{customer.first_name or ''} {customer.last_name or ''}".strip() or None,
            "customer_phone": customer.phone,
            "customer_address": customer.railwire_address,
            "status": assignment.status,
            "skip_reason": assignment.skip_reason,
            "attempts": assignment.attempts,
            "assigned_at": assignment.assigned_at,
            "completed_at": assignment.completed_at,
            "already_has_binding": customer.username in existing_bindings,
            "current_mac_address": customer.mac_address,
            "customer_lat": customer.gps_lat or customer.geo_lat,
            "customer_lng": customer.gps_lng or customer.geo_long,
        })
    return results


# ---------------------------------------------------------------------------
# Submission (the main atomic write)
# ---------------------------------------------------------------------------

def submit_collection(
    db: Session,
    *,
    assignment_id: int,
    collector_id: int,
    gps_lat: Optional[float],
    gps_lng: Optional[float],
    gps_accuracy_m: Optional[float],
    onu_identifier: Optional[str] = None,
    ont_serial_number: Optional[str] = None,
    ont_mac_address: Optional[str] = None,
    ont_model: Optional[str] = None,
    device_setup: Optional[str] = None,
    sticker_photo_url: Optional[str] = None,
    ont_sticker_data: Optional[Dict[str, Any]] = None,
    router_sticker_photo_url: Optional[str] = None,
    router_mac_address: Optional[str] = None,
    wifi_ssid: Optional[str] = None,
    wifi_password: Optional[str] = None,
    alt_phones: Optional[List[str]] = None,
    notes: Optional[str] = None,
    install_photo_url: Optional[str] = None,
    router_model: Optional[str] = None,
    router_serial: Optional[str] = None,
    router_sticker_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Simplified collector submission.

    Writes atomically:
      - GPS + last_surveyed_at on customer
      - ONU binding (if identifier was captured)
      - Alt phones into customer_phones
      - Auto-mapped olt_host / pon_port / onu_index from onu_latest (EPON only)

    No identifier → assignment marked `partial` for admin follow-up.
    Identifier given → assignment marked `done` or `needs_review`.
    """
    assignment = db.query(models.CollectionAssignment).filter_by(id=assignment_id).first()
    if not assignment:
        return {
            "status": "error",
            "assignment_id": assignment_id,
            "message": f"Assignment {assignment_id} not found",
            "warnings": [],
        }

    if assignment.collector_id != collector_id:
        return {
            "status": "error",
            "assignment_id": assignment_id,
            "message": "This assignment belongs to another collector",
            "warnings": [],
        }

    customer = db.query(models.Customer).filter_by(username=assignment.customer_id).first()
    if not customer:
        return {
            "status": "error",
            "assignment_id": assignment_id,
            "message": f"Customer {assignment.customer_id} not found",
            "warnings": [],
        }

    warnings: List[str] = []
    now = datetime.now(timezone.utc)

    if gps_accuracy_m is not None and gps_accuracy_m > GPS_WARN_ACCURACY_M:
        warnings.append(f"low_gps_accuracy:{gps_accuracy_m:.0f}m")

    # Parse sticker/OCR identity. GPON is serial-first; EPON is MAC-first.
    identity = build_binding_identity(
        onu_identifier=onu_identifier,
        ont_serial_number=ont_serial_number,
        ont_mac_address=ont_mac_address,
    )
    identifier_clean: Optional[str] = identity["onu_identifier"]
    onu_type_clean: Optional[str] = identity["onu_type"]
    primary_identifier_type: Optional[str] = identity["primary_identifier_type"]
    serial_clean: Optional[str] = identity["serial_number"]
    mac_clean: Optional[str] = identity["mac_address"]
    if identifier_clean and len(identifier_clean) < MIN_ONU_ID_LEN:
        warnings.append("short_identifier")
        identifier_clean = None
        onu_type_clean = None
        primary_identifier_type = None

    partial = identifier_clean is None

    # Duplicate detection — only when we have an identifier
    duplicate_of: Optional[str] = None
    if identifier_clean:
        existing_binding = db.query(models.ONUBinding).filter(
            models.ONUBinding.is_active.is_(True),
            models.ONUBinding.onu_identifier == identifier_clean,
            models.ONUBinding.onu_type == onu_type_clean,
            models.ONUBinding.customer_id != customer.username,
        ).first()
        if existing_binding:
            duplicate_of = existing_binding.customer_id
            warnings.append(f"duplicate_of:{duplicate_of}")

    # Auto-lookup OLT details from live poll table.
    # EPON: keyed by MAC address directly.
    # GPON: OLT poller stores serial with "SN:" prefix (e.g. "SN:GPON00508E6A").
    auto_olt_host: Optional[str] = None
    auto_pon_port: Optional[str] = None
    auto_onu_index: Optional[int] = None
    if identifier_clean and primary_identifier_type == "mac" and mac_clean:
        latest = _lookup_onu_latest(db, mac_clean)
        if latest:
            auto_olt_host = latest.olt_host
            auto_pon_port = latest.pon_port
            auto_onu_index = latest.onu_index
        else:
            warnings.append("no_olt_match")
    elif identifier_clean and primary_identifier_type == "serial" and serial_clean:
        latest = _lookup_onu_latest(db, f"SN:{serial_clean}") or _lookup_onu_latest(db, serial_clean)
        if latest:
            auto_olt_host = latest.olt_host
            auto_pon_port = latest.pon_port
            auto_onu_index = latest.onu_index
        else:
            warnings.append("no_olt_match")

    # Capture "before" snapshot for customer audit log
    from services import customer_service as _cs  # local import to avoid cycles
    existing_active_binding = db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id == customer.username,
        models.ONUBinding.is_active.is_(True),
    ).first()
    binding_snapshot: Dict[str, Any] = {}
    if existing_active_binding:
        binding_snapshot = {
            "onu_identifier": existing_active_binding.onu_identifier,
            "onu_type": existing_active_binding.onu_type,
            "primary_identifier_type": existing_active_binding.primary_identifier_type,
            "serial_number": existing_active_binding.serial_number,
            "mac_address": existing_active_binding.mac_address,
            "olt_host": existing_active_binding.olt_host,
            "pon_port": existing_active_binding.pon_port,
            "onu_index": existing_active_binding.onu_index,
            "confidence": existing_active_binding.confidence,
        }
    audit_snapshot: Dict[str, Any] = {
        "gps_lat": customer.gps_lat,
        "gps_lng": customer.gps_lng,
        "gps_accuracy_m": customer.gps_accuracy_m,
        "mac_address": customer.mac_address,
        "olt_host": customer.olt_host,
        "pon_port": customer.pon_port,
        "onu_index": customer.onu_index,
        "install_photo_url": customer.install_photo_url,
        "device_setup": customer.device_setup,
        "sticker_photo_url": customer.sticker_photo_url,
        "ont_serial_number": customer.ont_serial_number,
        "ont_model": customer.ont_model,
        "ont_sticker_data": customer.ont_sticker_data,
        "router_sticker_photo_url": customer.router_sticker_photo_url,
        "router_mac_address": customer.router_mac_address,
        "router_model": customer.router_model,
        "router_serial": customer.router_serial,
        "router_sticker_data": customer.router_sticker_data,
    }

    try:
        # 1. GPS + survey timestamp — always written
        if gps_lat is not None and gps_lng is not None:
            customer.gps_lat = gps_lat
            customer.gps_lng = gps_lng
            customer.gps_accuracy_m = gps_accuracy_m
        elif customer.gps_lat is None or customer.gps_lng is None:
            warnings.append("missing_gps")
        customer.last_surveyed_at = now
        if install_photo_url:
            customer.install_photo_url = install_photo_url
        normalized_setup = (device_setup or "").strip()
        if normalized_setup in {"single_ont", "onu_router"}:
            customer.device_setup = normalized_setup
        if sticker_photo_url:
            customer.sticker_photo_url = sticker_photo_url
        if ont_sticker_data:
            customer.ont_sticker_data = ont_sticker_data
        if ont_serial_number:
            customer.ont_serial_number = ont_serial_number.strip().upper()
        elif serial_clean:
            customer.ont_serial_number = serial_clean
        if ont_model:
            customer.ont_model = ont_model.strip()
        if router_sticker_photo_url:
            customer.router_sticker_photo_url = router_sticker_photo_url
        if router_mac_address:
            customer.router_mac_address = normalize_mac(router_mac_address) or router_mac_address.strip().upper()
        if router_model:
            customer.router_model = router_model.strip()
        if router_serial:
            customer.router_serial = router_serial.strip()
        if router_sticker_data:
            customer.router_sticker_data = router_sticker_data
        if wifi_ssid:
            customer.wifi_ssid = wifi_ssid.strip()
        if wifi_password:
            customer.wifi_password = wifi_password.strip()

        # 2. Alt phones — always written when provided
        phones_added = _sync_alt_phones(db, customer.username, alt_phones or [])

        binding: Optional[models.ONUBinding] = None

        # 3. ONU binding — only when identifier captured
        if identifier_clean:
            binding = existing_active_binding
            if binding:
                binding.onu_identifier = identifier_clean
                binding.onu_type = onu_type_clean
                binding.primary_identifier_type = primary_identifier_type
                binding.serial_number = serial_clean
                binding.mac_address = mac_clean
                if auto_olt_host:
                    binding.olt_host = auto_olt_host
                if auto_pon_port:
                    binding.pon_port = auto_pon_port
                if auto_onu_index is not None:
                    binding.onu_index = auto_onu_index
                binding.binding_source = "field_scan"
                binding.confidence = "verified" if not warnings else "probable"
                binding.last_seen = now
                binding.verified_at = now
                binding.verified_by_user_id = collector_id
                binding.is_active = True
                binding.deactivated_at = None
                binding.deactivated_reason = None
                binding.sticker_photo_url = customer.sticker_photo_url
                binding.notes = notes
            else:
                binding = models.ONUBinding(
                    customer_id=customer.username,
                    onu_identifier=identifier_clean,
                    onu_type=onu_type_clean,
                    primary_identifier_type=primary_identifier_type,
                    serial_number=serial_clean,
                    mac_address=mac_clean,
                    olt_host=auto_olt_host,
                    pon_port=auto_pon_port,
                    onu_index=auto_onu_index,
                    binding_source="field_scan",
                    confidence="verified" if not warnings else "probable",
                    verified_at=now,
                    verified_by_user_id=collector_id,
                    sticker_photo_url=customer.sticker_photo_url,
                    notes=notes,
                )
                db.add(binding)

            # Keep physical identity on Customer, but do not mirror network
            # placement into legacy customer columns. ONUBinding is the
            # authoritative customer-to-ONU spine.
            if primary_identifier_type == "serial" and serial_clean:
                customer.ont_serial_number = serial_clean

        review_warnings = [
            w for w in warnings
            if not w.startswith("no_olt_match")
        ]
        if binding_snapshot and identifier_clean:
            previous_identifier = binding_snapshot.get("onu_identifier")
            if previous_identifier and previous_identifier != identifier_clean:
                review_warnings.append(
                    f"identifier_changed:{previous_identifier}->{identifier_clean}"
                )

        # 4. Assignment status
        if partial:
            assignment.status = "partial"
        elif review_warnings:
            assignment.status = "needs_review"
        else:
            assignment.status = "done"
        assignment.completed_at = now
        assignment.attempts = (assignment.attempts or 0) + 1

        # 5. Campaign counters
        campaign = db.query(models.CollectionCampaign).filter_by(
            id=assignment.campaign_id
        ).first()
        if campaign:
            campaign.completed_count = (campaign.completed_count or 0) + 1

        # 6. Audit log
        if partial:
            log_message = "Partial submission (GPS only, sticker unreadable)"
        else:
            log_message = f"Submitted {onu_type_clean}:{identifier_clean}"
            if warnings:
                log_message += f" (warnings: {','.join(warnings)})"
        _log(
            db,
            action="submitted_partial" if partial else "submitted",
            campaign_id=assignment.campaign_id,
            assignment_id=assignment.id,
            customer_id=customer.username,
            collector_id=collector_id,
            message=log_message,
            payload={
                "onu_identifier": identifier_clean,
                "onu_type": onu_type_clean,
                "primary_identifier_type": primary_identifier_type,
                "serial_number": serial_clean,
                "mac_address": mac_clean,
                "gps_accuracy_m": gps_accuracy_m,
                "gps_lat": customer.gps_lat,
                "gps_lng": customer.gps_lng,
                "submitted_gps_lat": gps_lat,
                "submitted_gps_lng": gps_lng,
                "duplicate_of": duplicate_of,
                "auto_olt_host": auto_olt_host,
                "auto_pon_port": auto_pon_port,
                "phones_added": phones_added,
                "warnings": warnings,
                "review_warnings": review_warnings,
                "partial": partial,
                "binding_before": binding_snapshot or None,
                "binding_after": {
                    "onu_identifier": binding.onu_identifier if binding else None,
                    "onu_type": binding.onu_type if binding else None,
                    "primary_identifier_type": binding.primary_identifier_type if binding else None,
                    "serial_number": binding.serial_number if binding else None,
                    "mac_address": binding.mac_address if binding else None,
                    "olt_host": binding.olt_host if binding else None,
                    "pon_port": binding.pon_port if binding else None,
                    "onu_index": binding.onu_index if binding else None,
                    "confidence": binding.confidence if binding else None,
                } if binding else None,
            },
        )

        # 7. Customer-level audit log — record every field that actually changed
        collector = db.query(models.Technician).filter_by(id=collector_id).first()
        changed_by = collector.username if collector else f"tech#{collector_id}"
        field_changes: list[Dict[str, Any]] = []
        for field, old_val in audit_snapshot.items():
            new_val = getattr(customer, field, None)
            if old_val != new_val:
                field_changes.append({
                    "field_name": field,
                    "old_value": old_val,
                    "new_value": new_val,
                })
        if field_changes:
            _cs.write_customer_audit(
                db,
                customer_id=customer.username,
                changes=field_changes,
                changed_by=changed_by,
                action="SURVEY",
            )
            record_field_writes(
                db,
                customer_id=customer.username,
                field_names=[change["field_name"] for change in field_changes],
                source="field_survey",
                writer=changed_by,
                evidence_ref=sticker_photo_url or install_photo_url,
                verified_at=now,
                notes="Mobile field collection submission",
                updated_at=now,
            )

        if binding:
            binding_changes: list[Dict[str, Any]] = []
            for field in (
                "onu_identifier",
                "onu_type",
                "primary_identifier_type",
                "serial_number",
                "mac_address",
                "olt_host",
                "pon_port",
                "onu_index",
                "confidence",
            ):
                old_val = binding_snapshot.get(field)
                new_val = getattr(binding, field, None)
                if old_val != new_val:
                    binding_changes.append({
                        "field_name": f"onu_binding.{field}",
                        "old_value": old_val,
                        "new_value": new_val,
                    })
            if binding_changes:
                _cs.write_customer_audit(
                    db,
                    customer_id=customer.username,
                    changes=binding_changes,
                    changed_by=changed_by,
                    action="SURVEY_BINDING",
                )

        db.commit()
        if binding:
            db.refresh(binding)

        if partial:
            status = "partial"
            message = "Partial — GPS recorded, sticker pending"
        elif duplicate_of:
            status = "duplicate"
            message = f"Submitted — identifier already bound to {duplicate_of}"
        elif review_warnings:
            status = "ok"
            message = "Submitted — flagged for admin review"
        else:
            status = "ok"
            message = "Submission saved"

        return {
            "status": status,
            "assignment_id": assignment.id,
            "binding_id": binding.id if binding else None,
            "message": message,
            "duplicate_of": duplicate_of,
            "warnings": warnings,
            "review_warnings": review_warnings,
        }
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("submit_collection DB error: %s", e)
        _log(
            db,
            action="failed",
            assignment_id=assignment_id,
            customer_id=customer.username,
            collector_id=collector_id,
            message=f"DB error: {e}",
        )
        db.commit()
        return {
            "status": "error",
            "assignment_id": assignment_id,
            "message": "Database error — please retry",
            "warnings": [],
        }


def skip_assignment(
    db: Session,
    *,
    assignment_id: int,
    collector_id: int,
    reason: str,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Mark assignment as skipped (no-home, no-access, etc.)."""
    assignment = db.query(models.CollectionAssignment).filter_by(id=assignment_id).first()
    if not assignment:
        return {"status": "error", "message": "Assignment not found"}

    if assignment.collector_id != collector_id:
        return {"status": "error", "message": "Not your assignment"}

    assignment.status = "skipped"
    assignment.skip_reason = reason
    assignment.completed_at = datetime.now(timezone.utc)
    assignment.attempts = (assignment.attempts or 0) + 1

    campaign = db.query(models.CollectionCampaign).filter_by(
        id=assignment.campaign_id
    ).first()
    if campaign:
        campaign.skipped_count = (campaign.skipped_count or 0) + 1

    _log(
        db,
        action="skipped",
        campaign_id=assignment.campaign_id,
        assignment_id=assignment.id,
        customer_id=assignment.customer_id,
        collector_id=collector_id,
        message=f"Skipped: {reason}",
        payload={"reason": reason, "notes": notes},
    )
    db.commit()
    return {"status": "ok", "message": "Assignment skipped"}


# ---------------------------------------------------------------------------
# Admin monitoring — progress
# ---------------------------------------------------------------------------

def list_campaigns(db: Session) -> List[Dict[str, Any]]:
    rows = db.query(models.CollectionCampaign).order_by(
        models.CollectionCampaign.created_at.desc()
    ).all()
    result = []
    for c in rows:
        pending = db.query(func.count(models.CollectionAssignment.id)).filter(
            models.CollectionAssignment.campaign_id == c.id,
            models.CollectionAssignment.status == "pending",
        ).scalar() or 0
        result.append(_campaign_to_dict(c, pending_count=pending))
    return result


def get_campaign_progress(db: Session, campaign_id: int) -> Dict[str, Any]:
    campaign = db.query(models.CollectionCampaign).filter_by(id=campaign_id).first()
    if not campaign:
        raise ValueError(f"Campaign {campaign_id} not found")

    pending = db.query(func.count(models.CollectionAssignment.id)).filter(
        models.CollectionAssignment.campaign_id == campaign_id,
        models.CollectionAssignment.status == "pending",
    ).scalar() or 0

    # Per-collector aggregates
    collector_rows = db.execute(text("""
        SELECT
            ca.collector_id,
            t.full_name,
            COUNT(*) AS assigned,
            SUM(CASE WHEN ca.status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN ca.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN ca.status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN ca.status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
            AVG(EXTRACT(EPOCH FROM (ca.completed_at - ca.assigned_at))/60)
                FILTER (WHERE ca.completed_at IS NOT NULL) AS avg_min,
            MAX(ca.completed_at) AS last_activity
        FROM collection_assignments ca
        LEFT JOIN technicians t ON t.id = ca.collector_id
        WHERE ca.campaign_id = :cid
        GROUP BY ca.collector_id, t.full_name
        ORDER BY assigned DESC
    """), {"cid": campaign_id}).fetchall()

    collectors = [
        {
            "collector_id": r[0],
            "collector_name": r[1],
            "assigned": int(r[2] or 0),
            "done": int(r[3] or 0),
            "skipped": int(r[4] or 0),
            "pending": int(r[5] or 0),
            "avg_minutes_per_record": round(float(r[7]), 1) if r[7] is not None else None,
            "last_activity_at": r[8],
        }
        for r in collector_rows
    ]

    # Recent activity
    activity = db.query(
        models.CollectionLog, models.Technician.full_name,
    ).outerjoin(
        models.Technician, models.Technician.id == models.CollectionLog.collector_id,
    ).filter(
        models.CollectionLog.campaign_id == campaign_id,
    ).order_by(
        models.CollectionLog.created_at.desc(),
    ).limit(50).all()

    recent = []
    for entry, full_name in activity:
        recent.append({
            "id": entry.id,
            "campaign_id": entry.campaign_id,
            "assignment_id": entry.assignment_id,
            "customer_id": entry.customer_id,
            "collector_id": entry.collector_id,
            "collector_name": full_name,
            "action": entry.action,
            "message": entry.message,
            "payload": entry.payload,
            "created_at": entry.created_at,
        })

    # Issue + duplicate counts
    issue_count = db.query(func.count(models.CollectionAssignment.id)).filter(
        models.CollectionAssignment.campaign_id == campaign_id,
        models.CollectionAssignment.status == "needs_review",
    ).scalar() or 0

    duplicate_count = _count_duplicate_identifiers(db)

    return {
        "campaign": _campaign_to_dict(campaign, pending_count=pending),
        "collectors": collectors,
        "recent_activity": recent,
        "issue_count": int(issue_count),
        "duplicate_count": int(duplicate_count),
    }


def _campaign_to_dict(
    c: models.CollectionCampaign, pending_count: int = 0,
) -> Dict[str, Any]:
    total = c.target_count or 0
    done = (c.completed_count or 0) + (c.skipped_count or 0)
    progress = round((done / total) * 100, 1) if total else 0.0
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "status": c.status,
        "target_count": c.target_count or 0,
        "completed_count": c.completed_count or 0,
        "skipped_count": c.skipped_count or 0,
        "pending_count": pending_count,
        "progress_pct": progress,
        "created_at": c.created_at,
        "started_at": c.started_at,
        "ended_at": c.ended_at,
    }


# ---------------------------------------------------------------------------
# Admin monitoring — issues + duplicates + corrections
# ---------------------------------------------------------------------------

def list_issues(db: Session, campaign_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Assignments that completed but were flagged needs_review.
    Typical reasons: low GPS accuracy, duplicate identifier, low confidence.
    """
    q = db.query(
        models.CollectionAssignment,
        models.Customer,
        models.Technician,
        models.ONUBinding,
    ).join(
        models.Customer,
        models.Customer.username == models.CollectionAssignment.customer_id,
    ).outerjoin(
        models.Technician,
        models.Technician.id == models.CollectionAssignment.collector_id,
    ).outerjoin(
        models.ONUBinding,
        models.ONUBinding.customer_id == models.CollectionAssignment.customer_id,
    ).filter(
        models.CollectionAssignment.status == "needs_review",
    )

    if campaign_id:
        q = q.filter(models.CollectionAssignment.campaign_id == campaign_id)

    q = q.order_by(models.CollectionAssignment.completed_at.desc()).limit(500)

    items = []
    for assignment, customer, tech, binding in q.all():
        cust_name = f"{customer.first_name or ''} {customer.last_name or ''}".strip() or None
        issue_type = "low_confidence"
        detail = "Flagged for review"
        if customer.gps_accuracy_m and customer.gps_accuracy_m > GPS_WARN_ACCURACY_M:
            issue_type = "low_gps_accuracy"
            detail = f"GPS accuracy {customer.gps_accuracy_m:.0f}m (threshold {GPS_WARN_ACCURACY_M:.0f}m)"

        items.append({
            "assignment_id": assignment.id,
            "customer_id": customer.username,
            "customer_name": cust_name,
            "collector_id": tech.id if tech else None,
            "collector_name": tech.full_name if tech else None,
            "issue_type": issue_type,
            "detail": detail,
            "onu_identifier": binding.onu_identifier if binding else None,
            "gps_accuracy_m": customer.gps_accuracy_m,
            "created_at": assignment.completed_at or assignment.assigned_at,
            # Sticker photos — admin uses these to visually verify extracted MAC
            "sticker_photo_url": customer.sticker_photo_url,
            "router_sticker_photo_url": customer.router_sticker_photo_url,
            "ont_model": customer.ont_model,
            "router_model": customer.router_model,
        })
    return items


def _count_duplicate_identifiers(db: Session) -> int:
    row = db.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT onu_identifier, onu_type
            FROM onu_bindings
            WHERE is_active = TRUE
            GROUP BY onu_identifier, onu_type
            HAVING COUNT(*) > 1
        ) t
    """)).scalar() or 0
    return int(row)


def list_duplicates(db: Session) -> List[Dict[str, Any]]:
    """Identifiers that are bound to more than one customer — needs resolution."""
    rows = db.execute(text("""
        SELECT onu_identifier, onu_type, ARRAY_AGG(customer_id) AS customer_ids, COUNT(*) AS cnt
        FROM onu_bindings
        WHERE is_active = TRUE
        GROUP BY onu_identifier, onu_type
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
    """)).fetchall()
    return [
        {
            "onu_identifier": r[0],
            "onu_type": r[1],
            "customer_ids": list(r[2] or []),
            "count": int(r[3]),
        }
        for r in rows
    ]


def admin_correct_binding(
    db: Session,
    *,
    customer_id: str,
    admin_id: int,
    onu_identifier: Optional[str] = None,
    onu_type: Optional[str] = None,
    olt_host: Optional[str] = None,
    pon_port: Optional[str] = None,
    confidence: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Admin override: update a customer's binding manually."""
    binding = db.query(models.ONUBinding).filter_by(customer_id=customer_id).first()
    customer = db.query(models.Customer).filter_by(username=customer_id).first()
    if not customer:
        return {"status": "error", "message": "Customer not found"}

    before: Dict[str, Any] = {}
    if binding:
        before = {
            "onu_identifier": binding.onu_identifier,
            "onu_type": binding.onu_type,
            "primary_identifier_type": binding.primary_identifier_type,
            "serial_number": binding.serial_number,
            "mac_address": binding.mac_address,
            "olt_host": binding.olt_host,
            "pon_port": binding.pon_port,
            "onu_index": binding.onu_index,
            "confidence": binding.confidence,
        }

    identity = build_binding_identity(onu_identifier=onu_identifier)
    if onu_identifier is not None:
        onu_identifier = identity["onu_identifier"]
        onu_type = onu_type or identity["onu_type"]
    if onu_type is not None:
        onu_type = onu_type.strip().lower()
        if onu_type not in ("epon", "gpon"):
            return {"status": "error", "message": "onu_type must be epon|gpon"}
    if confidence is not None and confidence not in ("verified", "probable", "guess"):
        return {"status": "error", "message": "confidence must be verified|probable|guess"}

    if binding is None:
        if not onu_identifier or not onu_type:
            return {
                "status": "error",
                "message": "No existing binding — must provide onu_identifier and onu_type",
            }
        binding = models.ONUBinding(
            customer_id=customer_id,
            onu_identifier=onu_identifier,
            onu_type=onu_type,
            primary_identifier_type=identity["primary_identifier_type"],
            serial_number=identity["serial_number"],
            mac_address=identity["mac_address"],
            olt_host=olt_host,
            pon_port=pon_port,
            binding_source="manual",
            confidence=confidence or "verified",
            verified_at=datetime.now(timezone.utc),
            verified_by_user_id=admin_id,
            is_active=True,
            sticker_photo_url=customer.sticker_photo_url,
            notes=notes,
        )
        db.add(binding)
    else:
        if onu_identifier is not None:
            binding.onu_identifier = onu_identifier
            binding.primary_identifier_type = identity["primary_identifier_type"]
            binding.serial_number = identity["serial_number"]
            binding.mac_address = identity["mac_address"]
        if onu_type is not None:
            binding.onu_type = onu_type
        if olt_host is not None:
            binding.olt_host = olt_host
        if pon_port is not None:
            binding.pon_port = pon_port
        if confidence is not None:
            binding.confidence = confidence
        binding.binding_source = "manual"
        binding.verified_by_user_id = admin_id
        binding.last_seen = datetime.now(timezone.utc)
        binding.verified_at = datetime.now(timezone.utc)
        binding.is_active = True
        binding.deactivated_at = None
        binding.deactivated_reason = None
        binding.sticker_photo_url = customer.sticker_photo_url
        if notes:
            binding.notes = notes

    # Keep physical serial on Customer, but do not mirror MAC/OLT placement
    # into legacy customer columns. ONUBinding is authoritative.
    if binding.primary_identifier_type == "serial" and binding.serial_number:
        customer.ont_serial_number = binding.serial_number

    # Clear any needs_review assignment for this customer (admin has reviewed)
    pending_reviews = db.query(models.CollectionAssignment).filter(
        models.CollectionAssignment.customer_id == customer_id,
        models.CollectionAssignment.status == "needs_review",
    ).all()
    for a in pending_reviews:
        a.status = "done"

    after = {
        "onu_identifier": binding.onu_identifier,
        "onu_type": binding.onu_type,
        "primary_identifier_type": binding.primary_identifier_type,
        "serial_number": binding.serial_number,
        "mac_address": binding.mac_address,
        "olt_host": binding.olt_host,
        "pon_port": binding.pon_port,
        "onu_index": binding.onu_index,
        "confidence": binding.confidence,
    }
    audit_changes = []
    for field, new_value in after.items():
        old_value = before.get(field)
        if old_value != new_value:
            audit_changes.append({
                "field_name": f"onu_binding.{field}",
                "old_value": old_value,
                "new_value": new_value,
            })
    if audit_changes:
        from services import customer_service as _cs
        admin = db.query(models.Technician).filter_by(id=admin_id).first()
        _cs.write_customer_audit(
            db,
            customer_id=customer_id,
            changes=audit_changes,
            changed_by=admin.username if admin else f"admin#{admin_id}",
            action="ADMIN_BINDING_CORRECTION",
        )

    _log(
        db,
        action="admin_correction",
        customer_id=customer_id,
        collector_id=admin_id,
        message=f"Admin corrected binding for {customer_id}",
        payload={"before": before, "after": after},
    )
    db.commit()
    db.refresh(binding)
    return {
        "status": "ok",
        "message": "Binding updated",
        "binding_id": binding.id,
    }


def list_activity_log(
    db: Session,
    *,
    campaign_id: Optional[int] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    q = db.query(
        models.CollectionLog, models.Technician.full_name,
    ).outerjoin(
        models.Technician, models.Technician.id == models.CollectionLog.collector_id,
    )
    if campaign_id:
        q = q.filter(models.CollectionLog.campaign_id == campaign_id)
    rows = q.order_by(models.CollectionLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": entry.id,
            "campaign_id": entry.campaign_id,
            "assignment_id": entry.assignment_id,
            "customer_id": entry.customer_id,
            "collector_id": entry.collector_id,
            "collector_name": name,
            "action": entry.action,
            "message": entry.message,
            "payload": entry.payload,
            "created_at": entry.created_at,
        }
        for entry, name in rows
    ]


# ---------------------------------------------------------------------------
# Street-walking survey flow (search-first, any-tech)
# ---------------------------------------------------------------------------

SKIP_REASONS = {"not_home", "refused", "locked", "wrong_address", "other"}


def _get_or_create_active_campaign(db: Session, collector_id: int) -> models.CollectionCampaign:
    """
    Return the most recent active campaign. If none exists, create one implicitly.
    This removes the admin distribution step — any tech can survey any customer.
    """
    campaign = (
        db.query(models.CollectionCampaign)
        .filter(models.CollectionCampaign.status.in_(["active", "running"]))
        .order_by(models.CollectionCampaign.created_at.desc())
        .first()
    )
    if campaign:
        return campaign
    campaign = db.query(models.CollectionCampaign).order_by(
        models.CollectionCampaign.created_at.desc()
    ).first()
    if campaign:
        return campaign
    campaign = models.CollectionCampaign(
        name="Walk-In Survey",
        description="Auto-created — tech self-serve survey flow",
        status="active",
        created_by=collector_id,
    )
    db.add(campaign)
    db.flush()
    return campaign


def _ensure_assignment(
    db: Session, *, customer_username: str, collector_id: int,
) -> models.CollectionAssignment:
    """
    Find or create an assignment row for this customer, claim it for the
    given collector. Always reassigns collector_id on touch (no locking).
    """
    customer = db.query(models.Customer).filter_by(username=customer_username).first()
    if not customer:
        raise ValueError(f"Customer {customer_username} not found")

    assignment = (
        db.query(models.CollectionAssignment)
        .filter(models.CollectionAssignment.customer_id == customer_username)
        .order_by(models.CollectionAssignment.assigned_at.desc())
        .first()
    )
    if assignment:
        if assignment.collector_id != collector_id:
            assignment.collector_id = collector_id
        return assignment

    campaign = _get_or_create_active_campaign(db, collector_id)
    assignment = models.CollectionAssignment(
        campaign_id=campaign.id,
        collector_id=collector_id,
        customer_id=customer_username,
        status="pending",
    )
    db.add(assignment)
    db.flush()
    return assignment


def submit_by_customer(
    db: Session,
    *,
    customer_username: str,
    collector_id: int,
    gps_lat: Optional[float],
    gps_lng: Optional[float],
    gps_accuracy_m: Optional[float] = None,
    onu_identifier: Optional[str] = None,
    ont_serial_number: Optional[str] = None,
    ont_mac_address: Optional[str] = None,
    ont_model: Optional[str] = None,
    device_setup: Optional[str] = None,
    sticker_photo_url: Optional[str] = None,
    ont_sticker_data: Optional[Dict[str, Any]] = None,
    router_sticker_photo_url: Optional[str] = None,
    router_mac_address: Optional[str] = None,
    router_model: Optional[str] = None,
    router_serial: Optional[str] = None,
    router_sticker_data: Optional[Dict[str, Any]] = None,
    wifi_ssid: Optional[str] = None,
    wifi_password: Optional[str] = None,
    alt_phones: Optional[List[str]] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Customer-keyed wrapper around submit_collection. Auto-claims assignment."""
    try:
        assignment = _ensure_assignment(
            db, customer_username=customer_username, collector_id=collector_id,
        )
        db.commit()
    except ValueError as e:
        return {"status": "error", "message": str(e), "warnings": []}
    return submit_collection(
        db,
        assignment_id=assignment.id,
        collector_id=collector_id,
        gps_lat=gps_lat,
        gps_lng=gps_lng,
        gps_accuracy_m=gps_accuracy_m,
        onu_identifier=onu_identifier,
        ont_serial_number=ont_serial_number,
        ont_mac_address=ont_mac_address,
        ont_model=ont_model,
        device_setup=device_setup,
        sticker_photo_url=sticker_photo_url,
        ont_sticker_data=ont_sticker_data,
        router_sticker_photo_url=router_sticker_photo_url,
        router_mac_address=router_mac_address,
        router_model=router_model,
        router_serial=router_serial,
        router_sticker_data=router_sticker_data,
        wifi_ssid=wifi_ssid,
        wifi_password=wifi_password,
        alt_phones=alt_phones,
        notes=notes,
    )


def skip_by_customer(
    db: Session,
    *,
    customer_username: str,
    collector_id: int,
    reason: str,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Customer-keyed wrapper around skip_assignment. Validates reason."""
    if reason not in SKIP_REASONS:
        return {
            "status": "error",
            "message": f"Invalid reason. Must be one of: {sorted(SKIP_REASONS)}",
        }
    try:
        assignment = _ensure_assignment(
            db, customer_username=customer_username, collector_id=collector_id,
        )
        db.commit()
    except ValueError as e:
        return {"status": "error", "message": str(e)}
    return skip_assignment(
        db,
        assignment_id=assignment.id,
        collector_id=collector_id,
        reason=reason,
        notes=notes,
    )


def _assignment_status_for_customer(db: Session) -> Dict[str, Dict[str, Any]]:
    """
    Return a map customer_username -> {status, collector_id, collector_name, completed_at}
    using each customer's most recent assignment.
    """
    rows = db.execute(text("""
        SELECT DISTINCT ON (a.customer_id)
            a.customer_id, a.status, a.skip_reason, a.collector_id,
            a.completed_at, t.full_name
        FROM collection_assignments a
        LEFT JOIN technicians t ON t.id = a.collector_id
        ORDER BY a.customer_id, a.assigned_at DESC
    """)).fetchall()
    return {
        r[0]: {
            "status": r[1],
            "skip_reason": r[2],
            "collector_id": r[3],
            "completed_at": r[4],
            "collector_name": r[5],
        }
        for r in rows
    }


def search_for_survey(
    db: Session,
    *,
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    collector_id: Optional[int] = None,
    not_bound: bool = False,
    only_with_gps: bool = False,
    near_lat: Optional[float] = None,
    near_lng: Optional[float] = None,
    radius_m: Optional[float] = None,
    sort: str = "auto",
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Realtime survey search.

    Matches username, first_name, last_name, phone, railwire_address, rico_address.
    Joins latest assignment to surface status.

    GPS-aware sorting:
      - If `near_lat`/`near_lng` provided: computes distance to each candidate and
        sorts ascending. Optional `radius_m` filters out anything beyond.
      - Sort modes:
            "auto"     — distance-asc when GPS provided, else recent-touch then name
            "distance" — same as auto but errors if GPS missing
            "recent"   — most recently surveyed first
            "name"     — alphabetical by username
            "pending"  — pending bucket first, then nearest

    Pagination: offset + limit. Returns {"items", "total"} so the UI can paginate.
    """
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    query = db.query(models.Customer).outerjoin(
        models.PoleGroup, models.Customer.pg_id == models.PoleGroup.id
    )

    # Text search across all identifying fields + full-name concat + PG name
    if q:
        term = f"%{q.strip()}%"
        digits = _PHONE_CLEAN_RE.sub("", q or "")
        phone_term = f"%{digits}%" if digits else term
        query = query.filter(
            or_(
                models.Customer.username.ilike(term),
                models.Customer.first_name.ilike(term),
                models.Customer.last_name.ilike(term),
                models.Customer.phone.ilike(phone_term),
                models.Customer.railwire_address.ilike(term),
                models.Customer.rico_address.ilike(term),
                func.concat(
                    func.coalesce(models.Customer.first_name, ''),
                    ' ',
                    func.coalesce(models.Customer.last_name, ''),
                ).ilike(term),
                models.PoleGroup.name.ilike(term),
            )
        )

    if only_with_gps:
        query = query.filter(
            models.Customer.gps_lat.isnot(None),
            models.Customer.gps_lng.isnot(None),
        )

    # Pull candidate set (no SQL ORDER yet — final sort is in Python so we can
    # rank by distance + status without PostGIS).
    candidates = query.all()

    status_map = _assignment_status_for_customer(db)
    active_bindings = {
        b.customer_id: b
        for b in db.query(models.ONUBinding).filter(
            models.ONUBinding.is_active.is_(True)
        ).all()
    }

    latest_logs: Dict[str, Dict[str, Any]] = {}
    log_rows = db.execute(text("""
        SELECT DISTINCT ON (customer_id) customer_id, payload, message
        FROM collection_log
        WHERE customer_id IS NOT NULL
          AND action IN ('submitted', 'submitted_partial')
        ORDER BY customer_id, created_at DESC, id DESC
    """)).fetchall()
    for r in log_rows:
        latest_logs[r[0]] = {
            "payload": r[1] or {},
            "message": r[2],
        }

    have_gps_origin = near_lat is not None and near_lng is not None

    rows: List[Dict[str, Any]] = []
    for c in candidates:
        info = status_map.get(c.username, {})
        survey_status = info.get("status") or ("surveyed" if c.last_surveyed_at else "pending")

        if status_filter and status_filter != "all":
            if status_filter == "pending" and survey_status not in ("pending", None):
                continue
            if status_filter == "done" and survey_status not in ("done", "surveyed"):
                continue
            if status_filter == "skipped" and survey_status != "skipped":
                continue
            if status_filter == "partial" and survey_status != "partial":
                continue
            if status_filter == "needs_review" and survey_status != "needs_review":
                continue
            if status_filter == "surveyed" and survey_status != "surveyed":
                continue

        if collector_id is not None and info.get("collector_id") != collector_id:
            continue

        lat = c.gps_lat or c.geo_lat
        lng = c.gps_lng or c.geo_long

        distance_m: Optional[float] = None
        if have_gps_origin and lat is not None and lng is not None:
            distance_m = _haversine_m(near_lat, near_lng, lat, lng)
            if radius_m is not None and distance_m > radius_m:
                continue

        binding = active_bindings.get(c.username)
        latest_log = latest_logs.get(c.username, {})
        latest_payload = latest_log.get("payload") or {}
        review_warnings = latest_payload.get("review_warnings") or latest_payload.get("warnings") or []
        if not isinstance(review_warnings, list):
            review_warnings = [str(review_warnings)]

        rows.append({
            "username": c.username,
            "item_type": "customer",
            "first_name": c.first_name,
            "last_name": c.last_name,
            "phone": c.phone,
            "railwire_address": c.railwire_address,
            "rico_address": c.rico_address,
            "survey_status": survey_status,
            "skip_reason": info.get("skip_reason"),
            "collector_id": info.get("collector_id"),
            "collector_name": info.get("collector_name"),
            "completed_at": info.get("completed_at"),
            "gps_lat": lat,
            "gps_lng": lng,
            "gps_confirmed": bool(c.gps_lat and c.gps_lng),
            "has_binding": c.username in active_bindings,
            "last_surveyed_at": c.last_surveyed_at,
            "mac_address": binding.mac_address if binding and binding.mac_address else c.mac_address,
            "customer_mac_address": c.mac_address,
            "onu_identifier": binding.onu_identifier if binding else None,
            "onu_type": binding.onu_type if binding else None,
            "binding_confidence": binding.confidence if binding else None,
            "binding_source": binding.binding_source if binding else None,
            "review_warnings": review_warnings,
            "review_detail": latest_log.get("message"),
            "ont_serial_number": (
                binding.serial_number
                if binding and binding.primary_identifier_type == "serial" and binding.serial_number
                else c.ont_serial_number
            ),
            "ont_model": c.ont_model,
            "device_setup": c.device_setup,
            "sticker_photo_url": c.sticker_photo_url,
            "router_sticker_photo_url": c.router_sticker_photo_url,
            "router_mac_address": c.router_mac_address,
            "router_model": c.router_model,
            "router_serial": c.router_serial,
            "wifi_ssid": c.wifi_ssid,
            "wifi_ssid_5g": c.wifi_ssid_5g,
            "wifi_password": c.wifi_password,
            "distance_m": round(distance_m, 1) if distance_m is not None else None,
            "pg_id": c.pg_id,
            "pg_name": c.pole_group.name if c.pg_id and c.pole_group else None,
        })

    if not_bound:
        rows = [r for r in rows if not r["has_binding"]]

    # Sort
    effective_sort = sort
    if effective_sort == "auto":
        effective_sort = "distance" if have_gps_origin else "pending"
    if effective_sort == "distance" and not have_gps_origin:
        # fall back gracefully
        effective_sort = "pending"

    if effective_sort == "distance":
        rows.sort(key=lambda r: (
            r["distance_m"] if r["distance_m"] is not None else float("inf"),
            r["username"],
        ))
    elif effective_sort == "recent":
        rows.sort(
            key=lambda r: (r["completed_at"] or r["last_surveyed_at"] or datetime.min.replace(tzinfo=timezone.utc)),
            reverse=True,
        )
    elif effective_sort == "name":
        rows.sort(key=lambda r: (r["username"] or ""))
    elif effective_sort == "pending":
        # Pending first, then by distance (if any), then by name
        bucket = {"pending": 0, "needs_review": 1, "partial": 2, "skipped": 3, "done": 4}
        rows.sort(key=lambda r: (
            bucket.get(r["survey_status"], 9),
            r["distance_m"] if r["distance_m"] is not None else float("inf"),
            r["username"],
        ))

    summary = {
        "done": sum(1 for r in rows if r["survey_status"] in ("done", "surveyed")),
        "partial": sum(1 for r in rows if r["survey_status"] == "partial"),
        "skipped": sum(1 for r in rows if r["survey_status"] == "skipped"),
        "needs_review": sum(1 for r in rows if r["survey_status"] == "needs_review"),
        "pending": sum(1 for r in rows if r["survey_status"] == "pending"),
        "bound": sum(1 for r in rows if r["has_binding"]),
        "unlinked": sum(1 for r in rows if not r["has_binding"]),
    }

    total = len(rows)
    page = rows[offset:offset + limit]
    return {"items": page, "total": total, "summary": summary}


def get_map_customers(
    db: Session,
    *,
    status_filter: Optional[str] = None,
    limit: int = 5000,
) -> Dict[str, Any]:
    """
    Return map points for the mobile survey map.

    Normal customers are plotted from customer-level GPS. PG customers are not
    duplicated as room/customer pins; each PG building is plotted once from the
    building GPS, then the user drills into floors/rooms from that building.
    """
    result = search_for_survey(
        db,
        q=None,
        status_filter=status_filter,
        only_with_gps=True,
        sort="name",
        limit=limit,
    )
    pg_customer_ids = {
        row[0]
        for row in db.query(models.PGRoom.username)
        .filter(models.PGRoom.username.isnot(None))
        .all()
        if row[0]
    }
    customer_rows = [
        row for row in result["items"]
        if not row.get("pg_id") and row.get("username") not in pg_customer_ids
    ]

    buildings = db.query(models.PGBuilding).filter(
        models.PGBuilding.gps_lat.isnot(None),
        models.PGBuilding.gps_lng.isnot(None),
    ).order_by(models.PGBuilding.name.asc()).all()

    pg_rows: List[Dict[str, Any]] = []
    for building in buildings:
        floor_count = len(building.floors or [])
        room_count = len(building.rooms or [])
        customer_count = sum(1 for room in (building.rooms or []) if room.username)
        done_count = sum(1 for room in (building.rooms or []) if room.status == "done")
        pending_count = max(0, room_count - done_count)
        pg_rows.append({
            "username": f"pg:{building.id}",
            "item_type": "pg_building",
            "first_name": building.name,
            "last_name": None,
            "phone": building.owner_mobile,
            "railwire_address": building.address,
            "rico_address": building.address,
            "survey_status": "done" if room_count and pending_count == 0 else "pending",
            "skip_reason": None,
            "collector_id": None,
            "collector_name": building.created_by,
            "completed_at": None,
            "gps_lat": building.gps_lat,
            "gps_lng": building.gps_lng,
            "gps_confirmed": True,
            "has_binding": customer_count > 0,
            "last_surveyed_at": building.updated_at or building.created_at,
            "distance_m": None,
            "pg_id": None,
            "pg_name": building.name,
            "building_id": building.id,
            "building_name": building.name,
            "building_type": building.pg_type,
            "floor_count": floor_count,
            "room_count": room_count,
            "customer_count": customer_count,
        })

    rows = (customer_rows + pg_rows)[:limit]
    summary = result.get("summary") or {}
    summary = {
        **summary,
        "pg_buildings": len(pg_rows),
        "normal_customer_points": len(customer_rows),
    }
    return {"items": rows, "total": len(rows), "summary": summary}


def get_live_progress(db: Session) -> Dict[str, Any]:
    """System-wide live progress — counts + per-tech breakdown."""
    total_customers = db.query(func.count(models.Customer.username)).scalar() or 0
    surveyed_customers = db.query(func.count(models.Customer.username)).filter(
        models.Customer.last_surveyed_at.isnot(None),
    ).scalar() or 0
    with_gps = db.query(func.count(models.Customer.username)).filter(
        models.Customer.gps_lat.isnot(None),
        models.Customer.gps_lng.isnot(None),
    ).scalar() or 0

    status_counts_rows = db.execute(text("""
        SELECT status, COUNT(*) FROM (
            SELECT DISTINCT ON (customer_id) customer_id, status
            FROM collection_assignments
            ORDER BY customer_id, assigned_at DESC
        ) latest
        GROUP BY status
    """)).fetchall()
    status_counts = {r[0]: int(r[1]) for r in status_counts_rows}

    per_tech_rows = db.execute(text("""
        SELECT
            t.id, t.full_name,
            SUM(CASE WHEN latest.status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN latest.status = 'partial' THEN 1 ELSE 0 END) AS partial,
            SUM(CASE WHEN latest.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN latest.status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
            MAX(latest.completed_at) AS last_activity
        FROM technicians t
        LEFT JOIN (
            SELECT DISTINCT ON (customer_id)
                customer_id, collector_id, status, completed_at, assigned_at
            FROM collection_assignments
            ORDER BY customer_id, assigned_at DESC
        ) latest ON latest.collector_id = t.id
        GROUP BY t.id, t.full_name
        HAVING SUM(
            CASE WHEN latest.status IN ('done','partial','skipped','needs_review') THEN 1 ELSE 0 END
        ) > 0
        ORDER BY done DESC NULLS LAST
    """)).fetchall()

    techs = [
        {
            "tech_id": r[0],
            "name": r[1],
            "done": int(r[2] or 0),
            "partial": int(r[3] or 0),
            "skipped": int(r[4] or 0),
            "needs_review": int(r[5] or 0),
            "last_activity": r[6],
        }
        for r in per_tech_rows
    ]

    return {
        "total_customers": int(total_customers),
        "surveyed_customers": int(surveyed_customers),
        "with_gps": int(with_gps),
        "pending": int(total_customers - surveyed_customers),
        "by_status": status_counts,
        "techs": techs,
    }
