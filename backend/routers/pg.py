"""
PG (Paying Guest) building management endpoints.

Admin: full CRUD on buildings/floors/rooms/groups.
Field Tech: read + upsert their own data, bulk sync.
"""
import logging
import os
from typing import Optional
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

import database
from config.settings import settings
from middleware.auth import get_current_user, require_admin
from utils.file_upload import save_uploaded_file
from schemas.pg import (
    BuildingCreate, BuildingDetail, BuildingResponse, BuildingUpdate,
    FloorCreate, FloorResponse,
    RouterGroupCreate, RouterGroupResponse, RouterGroupUpdate,
    RoomCreate, RoomResponse, RoomUpdate,
    RoomConflictResponse, RoomConflictResolveRequest, PGChangeEventResponse,
    RoomExistingPhotoOCRRequest,
    SyncPayload, SyncResponse,
)
from services import pg_service

logger = logging.getLogger("rico_net.pg_router")

router = APIRouter(prefix="/pg", tags=["PG Buildings"])


def _stored_room_photo_path(room_id: str, photo_url: str) -> str:
    """Resolve a stored /uploads/pg/{room_id}/... URL to a safe local file path."""
    parsed_path = unquote(urlparse(photo_url).path)
    expected_prefix = f"/uploads/pg/{room_id}/"
    if not parsed_path.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="photo_url must be a stored photo for this room")

    rel_path = parsed_path.removeprefix("/uploads/").lstrip("/\\")
    upload_root = os.path.abspath(settings.UPLOAD_DIR)
    disk_path = os.path.abspath(os.path.join(upload_root, rel_path))
    if not (disk_path == upload_root or disk_path.startswith(upload_root + os.sep)):
        raise HTTPException(status_code=400, detail="Invalid photo path")
    if not os.path.isfile(disk_path):
        raise HTTPException(status_code=404, detail="Stored photo not found")
    return disk_path


# ── Buildings ─────────────────────────────────────────────────────────────────

@router.get("/buildings", response_model=list[BuildingResponse])
def list_buildings(
    search: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    return pg_service.list_buildings(db, search=search)


@router.post("/buildings", response_model=BuildingResponse, status_code=201)
def create_building(
    body: BuildingCreate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.create_building(db, body, created_by=user.username)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/buildings/{building_id}", response_model=BuildingDetail)
def get_building(
    building_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    try:
        return pg_service.get_building(db, building_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/buildings/{building_id}/dashboard")
def get_building_dashboard(
    building_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    """Enriched admin view: building + customer profiles + ONU live status per room."""
    try:
        return pg_service.get_building_dashboard(db, building_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/buildings/{building_id}", response_model=BuildingDetail)
def update_building(
    building_id: str,
    body: BuildingUpdate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.update_building(db, building_id, body, changed_by=user.username)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/buildings/{building_id}")
def delete_building(
    building_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    try:
        pg_service.delete_building(db, building_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok", "message": "Building deleted"}


# ── Floors ────────────────────────────────────────────────────────────────────

@router.post("/buildings/{building_id}/photo", response_model=BuildingResponse)
async def upload_building_photo(
    building_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """Upload/replace the PG building identification photo."""
    dest_dir = os.path.join(settings.UPLOAD_DIR, "pg", building_id, "building")
    unique_name = await save_uploaded_file(
        file,
        dest_dir,
        allowed_mimes={"image/jpeg", "image/png", "image/webp", "image/gif"},
        prefix="building",
    )
    url = f"/uploads/pg/{building_id}/building/{unique_name}"
    try:
        return pg_service.set_building_photo(db, building_id, url, changed_by=user.username)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/buildings/{building_id}/floors", response_model=FloorResponse, status_code=201)
def add_floor(
    building_id: str,
    body: FloorCreate,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    if body.building_id != building_id:
        raise HTTPException(status_code=400, detail="building_id mismatch")
    try:
        return pg_service.add_floor(db, body)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/floors/{floor_id}")
def delete_floor(
    floor_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    try:
        pg_service.delete_floor(db, floor_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok"}


# ── Rooms ─────────────────────────────────────────────────────────────────────

@router.post("/rooms", response_model=RoomResponse, status_code=201)
def upsert_room(
    body: RoomCreate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.upsert_room(db, body, changed_by=user.username)
    except Exception as e:
        logger.error("upsert_room error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rooms/{room_id}/conflicts", response_model=RoomConflictResponse)
def get_room_conflicts(
    room_id: str,
    username: Optional[str] = Query(None, max_length=50),
    mac_address: Optional[str] = Query(None, max_length=32),
    ont_serial: Optional[str] = Query(None, max_length=64),
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    return pg_service.get_room_link_conflicts(
        db,
        room_id=room_id,
        username=username,
        mac_address=mac_address,
        ont_serial=ont_serial,
    )


@router.post("/rooms/{room_id}/resolve-conflicts")
def resolve_room_conflicts(
    room_id: str,
    body: RoomConflictResolveRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.resolve_room_link_conflicts(
            db,
            room_id=room_id,
            username=body.username,
            mac_address=body.mac_address,
            ont_serial=body.ont_serial,
            reason=body.reason,
            changed_by=user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/rooms/{room_id}", response_model=RoomResponse)
def update_room(
    room_id: str,
    body: RoomUpdate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.update_room(db, room_id, body, changed_by=user.username)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/rooms/{room_id}/history", response_model=list[PGChangeEventResponse])
def list_room_history(
    room_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    return pg_service.list_room_history(db, room_id)


@router.get("/room-reviews", response_model=list[PGChangeEventResponse])
def list_room_reviews(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    return pg_service.list_pending_room_reviews(db, limit=limit)


@router.post("/rooms/{room_id}/reviews/{event_id}/apply", response_model=RoomResponse)
def apply_room_review(
    room_id: str,
    event_id: int,
    reason: str = Query(..., min_length=3, max_length=500),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.apply_room_review(
            db,
            room_id=room_id,
            event_id=event_id,
            reason=reason,
            changed_by=user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/rooms/{room_id}/reviews/{event_id}/dismiss", response_model=RoomResponse)
def dismiss_room_review(
    room_id: str,
    event_id: int,
    reason: str = Query(..., min_length=3, max_length=500),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.dismiss_room_review(
            db,
            room_id=room_id,
            event_id=event_id,
            reason=reason,
            changed_by=user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/rooms/{room_id}/history/{event_id}/revert", response_model=RoomResponse)
def revert_room_history(
    room_id: str,
    event_id: int,
    reason: str = Query(..., min_length=3, max_length=500),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    try:
        return pg_service.revert_room_to_event(
            db,
            room_id=room_id,
            event_id=event_id,
            reason=reason,
            changed_by=user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/rooms/{room_id}")
def delete_room(
    room_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    try:
        pg_service.delete_room(db, room_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok"}


# ── Router Groups ─────────────────────────────────────────────────────────────

@router.post("/router-groups", response_model=RouterGroupResponse, status_code=201)
def upsert_router_group(
    body: RouterGroupCreate,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    try:
        return pg_service.upsert_router_group(db, body)
    except Exception as e:
        logger.error("upsert_router_group error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/router-groups/{group_id}", response_model=RouterGroupResponse)
def update_router_group(
    group_id: str,
    body: RouterGroupUpdate,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    from schemas.pg import RouterGroupCreate
    data = RouterGroupCreate(id=group_id, floor_id="", building_id="", **body.model_dump())
    try:
        return pg_service.upsert_router_group(db, data)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/router-groups/{group_id}")
def delete_router_group(
    group_id: str,
    db: Session = Depends(database.get_db),
    _user=Depends(get_current_user),
):
    try:
        pg_service.delete_router_group(db, group_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok"}


# ── Room Photos ───────────────────────────────────────────────────────────────

@router.post("/rooms/{room_id}/photos")
async def upload_room_photo(
    room_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """Upload a photo for a room and append its URL to the room's photo_urls list."""
    dest_dir = os.path.join(settings.UPLOAD_DIR, "pg", room_id)
    unique_name = await save_uploaded_file(
        file, dest_dir,
        allowed_mimes={"image/jpeg", "image/png", "image/webp", "image/gif"},
    )
    url = f"/uploads/pg/{room_id}/{unique_name}"
    try:
        return pg_service.add_room_photo(db, room_id, url, changed_by=user.username)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Bulk Sync ─────────────────────────────────────────────────────────────────

@router.post("/rooms/{room_id}/ocr-sticker-photo")
async def upload_and_ocr_room_sticker(
    room_id: str,
    sticker_type: str = Query("ont", max_length=20),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """
    Save the room sticker photo first, then OCR it. If OCR fails, the photo remains
    attached to the room so admin can manually enter MAC/serial/model later.
    """
    normalized_type = (sticker_type or "ont").strip().lower()
    if normalized_type not in {"ont", "router", "auto"}:
        raise HTTPException(status_code=400, detail="sticker_type must be ont, router, or auto")

    dest_dir = os.path.join(settings.UPLOAD_DIR, "pg", room_id)
    unique_name = await save_uploaded_file(
        file, dest_dir,
        allowed_mimes={"image/jpeg", "image/png", "image/webp", "image/gif"},
        prefix="router_sticker" if normalized_type == "router" else "ont_sticker",
    )
    url = f"/uploads/pg/{room_id}/{unique_name}"
    try:
        pg_service.set_room_sticker_photo(
            db,
            room_id,
            url,
            sticker_type="router" if normalized_type == "router" else "ont",
            changed_by=user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    file_path = os.path.join(dest_dir, unique_name)
    with open(file_path, "rb") as f:
        image_bytes = f.read()

    from routers.collection import _apply_ocr_live_identity
    from services.ocr_service import extract_sticker_data

    result = extract_sticker_data(image_bytes)
    result = _apply_ocr_live_identity(db, result)
    result["photo_url"] = url
    result["room_id"] = room_id
    result["requested_sticker_type"] = normalized_type
    try:
        pg_service.set_room_sticker_data(
            db,
            room_id,
            sticker_type="router" if normalized_type == "router" else "ont",
            data=result,
            photo_url=url,
            changed_by=user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return result


@router.post("/rooms/{room_id}/ocr-existing-photo")
def ocr_existing_room_photo(
    room_id: str,
    body: RoomExistingPhotoOCRRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """
    Re-run OCR on a room photo that is already stored on the server.
    Admin uses this for manual review when the field scan was unclear.
    """
    file_path = _stored_room_photo_path(room_id, body.photo_url)
    with open(file_path, "rb") as f:
        image_bytes = f.read()

    from routers.collection import _apply_ocr_live_identity
    from services.ocr_service import extract_sticker_data

    result = extract_sticker_data(image_bytes)
    result = _apply_ocr_live_identity(db, result)
    result["photo_url"] = urlparse(body.photo_url).path
    result["room_id"] = room_id
    if body.sticker_type:
        pg_service.set_room_sticker_photo(
            db,
            room_id,
            result["photo_url"],
            sticker_type=body.sticker_type,
            changed_by=user.username,
        )
        pg_service.set_room_sticker_data(
            db,
            room_id,
            sticker_type=body.sticker_type,
            data=result,
            photo_url=result["photo_url"],
            changed_by=user.username,
        )
        result["requested_sticker_type"] = body.sticker_type
    return result


@router.post("/sync", response_model=SyncResponse)
def bulk_sync(
    payload: SyncPayload,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """
    Mobile app calls this when it comes back online.
    Idempotent: safe to call multiple times with the same data.
    """
    try:
        return pg_service.bulk_sync(db, payload, synced_by=user.username)
    except Exception as e:
        logger.error("bulk_sync error: %s", e)
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")
