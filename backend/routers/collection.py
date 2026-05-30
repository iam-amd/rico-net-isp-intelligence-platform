"""
Rico Net — Collection Router (Operation Bridge the Gap)
=========================================================
Field data collection endpoints: campaigns, assignments, submission, monitoring.

Collector endpoints (any authenticated tech):
    GET  /collection/my-assignments          — my queue
    POST /collection/assignments/{id}/submit — submit field data
    POST /collection/assignments/{id}/skip   — mark skipped
    POST /collection/assignments/{id}/photo  — upload install photo

Admin endpoints:
    GET    /collection/campaigns                   — list all
    POST   /collection/campaigns                   — create
    POST   /collection/campaigns/{id}/distribute   — assign round-robin
    GET    /collection/campaigns/{id}/progress     — live dashboard data
    GET    /collection/campaigns/{id}/log          — full activity log
    GET    /collection/issues                      — needs_review queue
    GET    /collection/duplicates                  — identifier collisions
    POST   /collection/customers/{id}/correct      — admin manual override
"""
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

import database
import models
from config.settings import settings
from middleware.auth import get_current_user, require_admin
from schemas.collection import (
    AdminCorrectionRequest,
    AssignmentDistributionRequest,
    AssignmentListResponse,
    CampaignCreate,
    CampaignListResponse,
    CampaignProgress,
    CampaignResponse,
    CollectionSubmission,
    CustomerSkipBody,
    CustomerSubmitBody,
    DuplicateListResponse,
    IssueListResponse,
    SkipRequest,
    SubmissionResponse,
    SurveyLiveProgress,
    SurveyMapResponse,
    SurveySearchResponse,
)
from services import collection_service
from utils.file_upload import save_uploaded_file

logger = logging.getLogger("rico_net.collection_router")

router = APIRouter(prefix="/collection", tags=["Collection"])


def _reset_ocr_identity_fields(result: Dict[str, Any]) -> None:
    """Initialize live-OLT validation fields returned to the mobile survey app."""
    result["mac_in_database"] = False
    result["onu_status"] = None
    result["identity_in_database"] = False
    result["identity_status"] = None
    result["identity_olt_host"] = None
    result["identity_pon_port"] = None
    result["identity_onu_index"] = None
    result["identity_match_type"] = None
    result["identity_match_value"] = None


def _set_ocr_identity_match(
    result: Dict[str, Any],
    onu: models.ONULatest,
    *,
    match_type: str,
    match_value: str,
) -> None:
    result["identity_in_database"] = True
    result["identity_status"] = onu.status
    result["identity_olt_host"] = onu.olt_host
    result["identity_pon_port"] = onu.pon_port
    result["identity_onu_index"] = onu.onu_index
    result["identity_match_type"] = match_type
    result["identity_match_value"] = match_value
    if not result.get("onu_status"):
        result["onu_status"] = onu.status


def _lookup_onu_latest_by_mac_compact(db: Session, mac_compact: str) -> Optional[models.ONULatest]:
    return db.query(models.ONULatest).filter(
        func.replace(
            func.replace(func.upper(models.ONULatest.mac_address), ":", ""),
            "-",
            "",
        ) == mac_compact.upper()
    ).first()


def _apply_ocr_live_identity(db: Session, result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Cross-check OCR output against live OLT data.

    GPON is serial-first because the OLT stores GPON ONUs as SN:<serial>.
    EPON remains MAC-first, including the existing OCR 4/A correction path.
    """
    from services.ocr_service import _mac_4a_candidates
    from services.onu_binding_service import normalize_mac, normalize_serial

    _reset_ocr_identity_fields(result)

    try:
        serial_candidates = [
            result.get("gpon_sn"),
            result.get("onu_identifier"),
            result.get("ont_serial_number"),
        ]
        serial_candidates.extend(result.get("serial_candidates") or [])
        seen_serials = set()
        for value in serial_candidates:
            serial = normalize_serial(value)
            if not serial or serial in seen_serials or normalize_mac(value):
                continue
            seen_serials.add(serial)
            identifiers = [serial.upper(), f"SN:{serial.upper()}"]
            onu = db.query(models.ONULatest).filter(
                func.upper(models.ONULatest.mac_address).in_(identifiers)
            ).first()
            if onu:
                _set_ocr_identity_match(
                    result,
                    onu,
                    match_type="serial",
                    match_value=serial.upper(),
                )
                result["onu_identifier"] = serial.upper()
                logger.info(
                    "[OCR] GPON serial %s confirmed in onu_latest (status=%s)",
                    serial,
                    onu.status,
                )
                return result

        mac_sources = [result.get("mac_address"), result.get("onu_identifier")]
        mac_sources.extend(result.get("mac_candidates") or [])
        mac = next((normalize_mac(value) for value in mac_sources if normalize_mac(value)), None)
        if not mac:
            return result

        mac_compact = mac.replace(":", "")
        onu = _lookup_onu_latest_by_mac_compact(db, mac_compact)
        if onu:
            result["mac_in_database"] = True
            result["onu_status"] = onu.status
            result["mac_confidence"] = "high"
            _set_ocr_identity_match(
                result,
                onu,
                match_type="mac",
                match_value=mac_compact,
            )
            logger.info("[OCR] MAC %s confirmed in onu_latest (status=%s)", mac_compact, onu.status)
            return result

        for alt_mac in _mac_4a_candidates(mac_compact):
            onu = _lookup_onu_latest_by_mac_compact(db, alt_mac)
            if onu:
                logger.info(
                    "[OCR] 4/A fix: %s -> %s confirmed in onu_latest (status=%s)",
                    mac_compact,
                    alt_mac,
                    onu.status,
                )
                result["mac_address"] = alt_mac
                if not result.get("gpon_sn"):
                    result["onu_identifier"] = alt_mac
                result["mac_in_database"] = True
                result["onu_status"] = onu.status
                result["mac_confidence"] = "high"
                result["mac_strategy"] = (result.get("mac_strategy") or "") + "+4a_fix"
                _set_ocr_identity_match(
                    result,
                    onu,
                    match_type="mac_4a_fix",
                    match_value=alt_mac,
                )
                return result

        logger.info("[OCR] Identifier not found in onu_latest (may be unlinked)")
    except Exception as e:
        logger.warning("[OCR] DB identity lookup failed: %s", e)

    return result


# ---------------------------------------------------------------------------
# Collector endpoints (field staff)
# ---------------------------------------------------------------------------

@router.get("/my-assignments", response_model=AssignmentListResponse)
def get_my_assignments(
    status: Optional[str] = Query(None, description="pending | done | skipped | needs_review"),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    items = collection_service.list_my_assignments(
        db, collector_id=current_user.id, status_filter=status,
    )
    pending = sum(1 for i in items if i["status"] == "pending")
    done = sum(1 for i in items if i["status"] == "done")
    skipped = sum(1 for i in items if i["status"] == "skipped")
    return {
        "items": items,
        "total": len(items),
        "pending": pending,
        "done": done,
        "skipped": skipped,
    }


@router.post("/assignments/{assignment_id}/submit", response_model=SubmissionResponse)
def submit_assignment(
    assignment_id: int,
    body: CollectionSubmission,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    result = collection_service.submit_collection(
        db,
        assignment_id=assignment_id,
        collector_id=current_user.id,
        gps_lat=body.gps_lat,
        gps_lng=body.gps_lng,
        gps_accuracy_m=body.gps_accuracy_m,
        onu_identifier=body.onu_identifier,
        ont_serial_number=body.ont_serial_number,
        ont_mac_address=body.ont_mac_address,
        ont_model=body.ont_model,
        device_setup=body.device_setup,
        sticker_photo_url=body.sticker_photo_url,
        ont_sticker_data=body.ont_sticker_data,
        router_sticker_photo_url=body.router_sticker_photo_url,
        router_mac_address=body.router_mac_address,
        router_model=body.router_model,
        router_serial=body.router_serial,
        router_sticker_data=body.router_sticker_data,
        alt_phones=body.alt_phones,
        notes=body.notes,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/assignments/{assignment_id}/skip")
def skip_assignment(
    assignment_id: int,
    body: SkipRequest,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    result = collection_service.skip_assignment(
        db,
        assignment_id=assignment_id,
        collector_id=current_user.id,
        reason=body.reason,
        notes=body.notes,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/assignments/{assignment_id}/photo")
async def upload_photo(
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """
    Upload install photo for an assignment.
    Updates customer.install_photo_url. Does NOT mark assignment done.
    """
    assignment = db.query(models.CollectionAssignment).filter_by(id=assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.collector_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your assignment")

    dest_dir = os.path.join(settings.UPLOAD_DIR, "collection", str(assignment_id))
    try:
        filename = await save_uploaded_file(
            file, dest_dir, prefix=f"a{assignment_id}",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("photo upload failed: %s", e)
        raise HTTPException(status_code=500, detail="Upload failed")

    rel_url = f"/uploads/collection/{assignment_id}/{filename}"
    customer = db.query(models.Customer).filter_by(username=assignment.customer_id).first()
    if customer:
        customer.install_photo_url = rel_url
        db.commit()

    collection_service._log(
        db,
        action="photo_uploaded",
        assignment_id=assignment_id,
        customer_id=assignment.customer_id,
        collector_id=current_user.id,
        message="Install photo uploaded",
        payload={"url": rel_url},
    )
    db.commit()
    return {"status": "ok", "url": rel_url}


@router.post("/survey/ocr-sticker")
async def ocr_sticker(
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """
    OCR a sticker photo and return extracted fields.
    Mobile sends photo → gets back pre-filled JSON → user corrects if needed.

    mac_confidence tells the app HOW the MAC was found:
      'high'   → explicit colon/dash format or after MAC: label → trust it
      'medium' → found on a MAC-labelled line → likely correct
      'low'    → fuzzy fallback (Strategy 4b/5) → high false positive risk
      null     → not found

    mac_in_database: legacy MAC-only flag.
    identity_in_database: live OLT match for either GPON serial or EPON MAC.
    """
    from services.ocr_service import extract_sticker_data
    image_bytes = await file.read()
    result = extract_sticker_data(image_bytes)
    return _apply_ocr_live_identity(db, result)


@router.post("/survey/customers/{customer_username}/sticker-photo")
async def upload_sticker_photo(
    customer_username: str,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Upload a photo of the ONT sticker for reference."""
    customer = db.query(models.Customer).filter_by(username=customer_username).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    dest_dir = os.path.join(settings.UPLOAD_DIR, "stickers", customer_username)
    try:
        filename = await save_uploaded_file(
            file, dest_dir, prefix="sticker",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("sticker photo upload failed: %s", e)
        raise HTTPException(status_code=500, detail="Upload failed")

    rel_url = f"/uploads/stickers/{customer_username}/{filename}"
    customer.sticker_photo_url = rel_url
    binding = db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id == customer_username,
        models.ONUBinding.is_active.is_(True),
    ).first()
    if binding:
        binding.sticker_photo_url = rel_url
    db.commit()
    return {"status": "ok", "url": rel_url}


@router.post("/survey/customers/{customer_username}/router-sticker-photo")
async def upload_router_sticker_photo(
    customer_username: str,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Upload a photo of the separate router sticker (when device setup is ONT + router)."""
    customer = db.query(models.Customer).filter_by(username=customer_username).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    dest_dir = os.path.join(settings.UPLOAD_DIR, "stickers", customer_username)
    try:
        filename = await save_uploaded_file(file, dest_dir, prefix="router_sticker")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("router sticker photo upload failed: %s", e)
        raise HTTPException(status_code=500, detail="Upload failed")

    rel_url = f"/uploads/stickers/{customer_username}/{filename}"
    customer.router_sticker_photo_url = rel_url
    db.commit()
    return {"status": "ok", "url": rel_url}


# ---------------------------------------------------------------------------
# Admin endpoints — campaign lifecycle
# ---------------------------------------------------------------------------

@router.get("/campaigns", response_model=CampaignListResponse)
def list_campaigns(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    items = collection_service.list_campaigns(db)
    return {"items": items, "total": len(items)}


@router.post("/campaigns", response_model=CampaignResponse)
def create_campaign(
    body: CampaignCreate,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    try:
        campaign = collection_service.create_campaign(
            db,
            name=body.name,
            description=body.description,
            include_all_customers=body.include_all_customers,
            customer_usernames=body.customer_usernames,
            created_by=admin.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return collection_service._campaign_to_dict(campaign, pending_count=0)


@router.post("/campaigns/{campaign_id}/distribute")
def distribute_campaign(
    campaign_id: int,
    body: AssignmentDistributionRequest,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    try:
        result = collection_service.distribute_assignments(
            db,
            campaign_id=campaign_id,
            collector_ids=body.collector_ids,
            created_by=admin.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.get("/campaigns/{campaign_id}/progress", response_model=CampaignProgress)
def campaign_progress(
    campaign_id: int,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    try:
        return collection_service.get_campaign_progress(db, campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/campaigns/{campaign_id}/log")
def campaign_log(
    campaign_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    entries = collection_service.list_activity_log(
        db, campaign_id=campaign_id, limit=limit,
    )
    return {"items": entries, "total": len(entries)}


# ---------------------------------------------------------------------------
# Admin endpoints — issues, duplicates, corrections
# ---------------------------------------------------------------------------

@router.get("/issues", response_model=IssueListResponse)
def list_issues(
    campaign_id: Optional[int] = Query(None),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    items = collection_service.list_issues(db, campaign_id=campaign_id)
    return {"items": items, "total": len(items)}


@router.get("/duplicates", response_model=DuplicateListResponse)
def list_duplicates(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    items = collection_service.list_duplicates(db)
    return {"items": items, "total": len(items)}


@router.post("/customers/{customer_id}/correct")
def correct_binding(
    customer_id: str,
    body: AdminCorrectionRequest,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    result = collection_service.admin_correct_binding(
        db,
        customer_id=customer_id,
        admin_id=admin.id,
        onu_identifier=body.onu_identifier,
        onu_type=body.onu_type,
        olt_host=body.olt_host,
        pon_port=body.pon_port,
        confidence=body.confidence,
        notes=body.notes,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.get("/bindings")
def list_bindings(
    customer_id: Optional[str] = Query(None),
    confidence: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Admin view of all ONU bindings — used by the corrections page."""
    q = db.query(models.ONUBinding)
    if customer_id:
        q = q.filter(models.ONUBinding.customer_id == customer_id)
    if confidence:
        q = q.filter(models.ONUBinding.confidence == confidence)
    rows = q.order_by(models.ONUBinding.last_seen.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": b.id,
                "customer_id": b.customer_id,
                "onu_identifier": b.onu_identifier,
                "onu_type": b.onu_type,
                "olt_host": b.olt_host,
                "pon_port": b.pon_port,
                "onu_index": b.onu_index,
                "binding_source": b.binding_source,
                "confidence": b.confidence,
                "primary_identifier_type": b.primary_identifier_type,
                "serial_number": b.serial_number,
                "mac_address": b.mac_address,
                "is_active": b.is_active,
                "verified_at": b.verified_at,
                "deactivated_at": b.deactivated_at,
                "deactivated_reason": b.deactivated_reason,
                "sticker_photo_url": b.sticker_photo_url,
                "first_seen": b.first_seen,
                "last_seen": b.last_seen,
                "notes": b.notes,
            }
            for b in rows
        ],
        "total": len(rows),
    }


# ---------------------------------------------------------------------------
# Street-walking survey flow — any authenticated tech
# ---------------------------------------------------------------------------

@router.get("/survey/search", response_model=SurveySearchResponse)
def survey_search(
    q: Optional[str] = Query(None, description="Search term: name, username, phone, street, address"),
    status: Optional[str] = Query(None, description="pending | done | partial | skipped | all"),
    collector_id: Optional[int] = Query(None, description="Only return customers submitted by this collector"),
    not_bound: bool = Query(False, description="Only return customers without a linked ONU"),
    only_with_gps: bool = Query(False),
    near_lat: Optional[float] = Query(None, ge=-90, le=90, description="Caller GPS latitude"),
    near_lng: Optional[float] = Query(None, ge=-180, le=180, description="Caller GPS longitude"),
    radius_m: Optional[float] = Query(None, ge=0, le=100000, description="Filter to within N metres of caller"),
    sort: str = Query("auto", description="auto | distance | recent | name | pending"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """
    Realtime customer search for the street-walking survey flow.
    Any authenticated tech can search — no campaign distribution needed.

    GPS-aware: pass `near_lat`/`near_lng` and the result will be sorted by
    distance ascending (default `sort=auto`). When no GPS is given, defaults
    to pending-first then name.
    """
    return collection_service.search_for_survey(
        db,
        q=q,
        status_filter=status,
        collector_id=collector_id,
        not_bound=not_bound,
        only_with_gps=only_with_gps,
        near_lat=near_lat,
        near_lng=near_lng,
        radius_m=radius_m,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/survey/map", response_model=SurveyMapResponse)
def survey_map(
    status: Optional[str] = Query(None),
    limit: int = Query(5000, ge=1, le=10000),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """All customers with confirmed GPS, for the admin map view."""
    return collection_service.get_map_customers(
        db, status_filter=status, limit=limit,
    )


@router.get("/survey/progress", response_model=SurveyLiveProgress)
def survey_progress(
    db: Session = Depends(database.get_db),
    _user: models.Technician = Depends(get_current_user),
):
    """System-wide live progress + per-tech breakdown."""
    return collection_service.get_live_progress(db)


@router.post("/survey/customers/{customer_username}/submit")
def survey_submit_customer(
    customer_username: str,
    body: CustomerSubmitBody,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """
    Submit survey for a customer. Auto-creates assignment and claims it
    for the current tech. No prior distribution required.
    """
    result = collection_service.submit_by_customer(
        db,
        customer_username=customer_username,
        collector_id=current_user.id,
        gps_lat=body.gps_lat,
        gps_lng=body.gps_lng,
        gps_accuracy_m=body.gps_accuracy_m,
        onu_identifier=body.onu_identifier,
        ont_serial_number=body.ont_serial_number,
        ont_mac_address=body.ont_mac_address,
        ont_model=body.ont_model,
        device_setup=body.device_setup,
        sticker_photo_url=body.sticker_photo_url,
        ont_sticker_data=body.ont_sticker_data,
        router_sticker_photo_url=body.router_sticker_photo_url,
        router_mac_address=body.router_mac_address,
        router_model=body.router_model,
        router_serial=body.router_serial,
        router_sticker_data=body.router_sticker_data,
        wifi_ssid=body.wifi_ssid,
        wifi_password=body.wifi_password,
        alt_phones=body.alt_phones,
        notes=body.notes,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/survey/customers/{customer_username}/status")
def survey_update_status(
    customer_username: str,
    body: dict,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    """
    Admin: manually set a customer's survey_status.
    Used to approve needs_review/partial submissions as done.
    Body: { status: 'done'|'partial'|'needs_review'|'pending', notes: str }
    """
    allowed = {"done", "partial", "needs_review", "pending", "skipped"}
    new_status = (body.get("status") or "").strip()
    if new_status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {allowed}")

    customer = db.query(models.Customer).filter_by(username=customer_username).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Find the most recent assignment for this customer
    assignment = (
        db.query(models.CollectionAssignment)
        .filter_by(customer_id=customer_username)
        .order_by(models.CollectionAssignment.id.desc())
        .first()
    )

    old_status = assignment.status if assignment else customer.survey_status
    notes = (body.get("notes") or "").strip() or "Admin status override"

    if assignment:
        assignment.status = new_status
        if new_status == "done":
            import datetime
            assignment.completed_at = assignment.completed_at or datetime.datetime.utcnow()

    # Always keep customer.survey_status in sync
    customer.survey_status = new_status
    if new_status == "done":
        import datetime
        customer.last_surveyed_at = customer.last_surveyed_at or datetime.datetime.utcnow()
        binding = (
            db.query(models.ONUBinding)
            .filter_by(customer_id=customer_username, is_active=True)
            .first()
        )
        if binding and binding.confidence != "verified":
            from services import customer_service
            old_confidence = binding.confidence
            binding.confidence = "verified"
            binding.binding_source = "field_scan"
            binding.verified_by_user_id = admin.id
            binding.verified_at = datetime.datetime.utcnow()
            customer_service.write_customer_audit(
                db,
                customer_id=customer_username,
                changes=[{
                    "field_name": "onu_binding.confidence",
                    "old_value": old_confidence,
                    "new_value": "verified",
                }],
                changed_by=admin.username,
                action="ADMIN_SURVEY_APPROVAL",
            )

    collection_service._log(
        db,
        action="admin_status_override",
        assignment_id=assignment.id if assignment else None,
        customer_id=customer_username,
        collector_id=admin.id,
        message=f"Admin changed status: {old_status} → {new_status}. {notes}",
        payload={"old_status": old_status, "new_status": new_status, "notes": notes},
    )
    db.commit()
    return {"status": "ok", "new_status": new_status, "customer": customer_username}


@router.post("/survey/customers/{customer_username}/skip")
def survey_skip_customer(
    customer_username: str,
    body: CustomerSkipBody,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Skip a customer with a typed reason. Auto-creates assignment."""
    result = collection_service.skip_by_customer(
        db,
        customer_username=customer_username,
        collector_id=current_user.id,
        reason=body.reason,
        notes=body.notes,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.get("/stats")
def collection_stats(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Top-line numbers for the admin dashboard landing card."""
    from sqlalchemy import func

    total_customers = db.query(func.count(models.Customer.username)).scalar() or 0
    active_binding_filter = models.ONUBinding.is_active.is_(True)
    bound_customers = db.query(func.count(func.distinct(models.ONUBinding.customer_id))).filter(
        active_binding_filter,
    ).scalar() or 0
    surveyed_customers = db.query(func.count(models.Customer.username)).filter(
        models.Customer.last_surveyed_at.isnot(None),
    ).scalar() or 0
    duplicate_count = collection_service._count_duplicate_identifiers(db)
    issue_count = db.query(func.count(models.CollectionAssignment.id)).filter(
        models.CollectionAssignment.status == "needs_review",
    ).scalar() or 0

    epon_bound = db.query(func.count(models.ONUBinding.id)).filter(
        models.ONUBinding.onu_type == "epon",
        active_binding_filter,
    ).scalar() or 0
    gpon_bound = db.query(func.count(models.ONUBinding.id)).filter(
        models.ONUBinding.onu_type == "gpon",
        active_binding_filter,
    ).scalar() or 0

    return {
        "total_customers": int(total_customers),
        "bound_customers": int(bound_customers),
        "surveyed_customers": int(surveyed_customers),
        "bind_percentage": round((bound_customers / total_customers) * 100, 1) if total_customers else 0,
        "epon_bound": int(epon_bound),
        "gpon_bound": int(gpon_bound),
        "duplicate_count": int(duplicate_count),
        "issue_count": int(issue_count),
    }
