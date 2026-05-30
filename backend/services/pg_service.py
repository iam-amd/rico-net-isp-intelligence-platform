"""
PG (Paying Guest) building management service.
All DB interaction goes here — routers only call these functions.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

import models
from schemas.pg import (
    BuildingCreate, BuildingUpdate,
    FloorCreate,
    RoomCreate, RoomUpdate,
    RouterGroupCreate, RouterGroupUpdate,
    SyncPayload, SyncResponse,
)

logger = logging.getLogger("rico_net.pg_service")

UNKNOWN_OWNER_NAME = "Unknown"
ROOM_STRING_FIELDS = {
    "device_setup",
    "username",
    "ont_serial",
    "mac_address",
    "ont_model",
    "ont_sticker_photo_url",
    "router_sticker_photo_url",
    "router_mac_address",
    "router_serial",
    "router_model",
    "wifi_ssid",
    "wifi_ssid_5g",
    "wifi_password",
    "tech_note",
    "router_group_id",
}
ROOM_IDENTITY_FIELDS = {"username", "ont_serial", "mac_address", "ont_sticker_photo_url"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _photo_urls_to_json(urls: Optional[List[str]]) -> Optional[str]:
    return json.dumps(urls) if urls else None


def _photo_urls_from_json(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []


def _as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _json_list(raw: Optional[str]) -> List[dict]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _json_list_to_str(items: Optional[List[dict]]) -> Optional[str]:
    return json.dumps(items) if items else None


def _clean_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _clean_owner_name(value: Optional[str]) -> str:
    return _clean_str(value) or UNKNOWN_OWNER_NAME


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _room_snapshot(room: models.PGRoom) -> Dict[str, Any]:
    return {
        "id": room.id,
        "building_id": room.building_id,
        "floor_id": room.floor_id,
        "router_group_id": room.router_group_id,
        "room_number": room.room_number,
        "status": room.status,
        "connection_type": room.connection_type,
        "device_setup": room.device_setup,
        "username": room.username,
        "ont_serial": room.ont_serial,
        "mac_address": room.mac_address,
        "ont_model": room.ont_model,
        "ont_sticker_photo_url": room.ont_sticker_photo_url,
        "ont_sticker_data": room.ont_sticker_data,
        "router_sticker_photo_url": room.router_sticker_photo_url,
        "router_mac_address": room.router_mac_address,
        "router_serial": room.router_serial,
        "router_model": room.router_model,
        "router_sticker_data": room.router_sticker_data,
        "wifi_ssid": room.wifi_ssid,
        "wifi_ssid_5g": room.wifi_ssid_5g,
        "wifi_password": room.wifi_password,
        "scan_history": _json_list(room.scan_history),
        "tech_note": room.tech_note,
        "photo_urls": _photo_urls_from_json(room.photo_urls),
        "collected_at": _iso(room.collected_at),
    }


def _incoming_room_snapshot(data: RoomCreate) -> Dict[str, Any]:
    return {
        "id": data.id,
        "building_id": data.building_id,
        "floor_id": data.floor_id,
        "router_group_id": _clean_str(data.router_group_id),
        "room_number": _clean_str(data.room_number) or data.room_number,
        "status": data.status,
        "connection_type": data.connection_type,
        "device_setup": _clean_str(data.device_setup),
        "username": _clean_str(data.username),
        "ont_serial": _clean_str(data.ont_serial),
        "mac_address": _clean_str(data.mac_address),
        "ont_model": _clean_str(data.ont_model),
        "ont_sticker_photo_url": _clean_str(data.ont_sticker_photo_url),
        "ont_sticker_data": data.ont_sticker_data,
        "router_sticker_photo_url": _clean_str(data.router_sticker_photo_url),
        "router_mac_address": _clean_str(data.router_mac_address),
        "router_serial": _clean_str(data.router_serial),
        "router_model": _clean_str(data.router_model),
        "router_sticker_data": data.router_sticker_data,
        "wifi_ssid": _clean_str(data.wifi_ssid),
        "wifi_ssid_5g": _clean_str(data.wifi_ssid_5g),
        "wifi_password": _clean_str(data.wifi_password),
        "scan_history": data.scan_history or [],
        "tech_note": _clean_str(data.tech_note),
        "photo_urls": data.photo_urls or [],
        "collected_at": _iso(data.collected_at),
    }


def _identity_changed(current: Dict[str, Any], proposed: Dict[str, Any]) -> bool:
    from services.onu_binding_service import normalize_mac, normalize_serial

    for field in ROOM_IDENTITY_FIELDS:
        current_value = current.get(field)
        proposed_value = proposed.get(field)
        if field == "mac_address":
            current_value = normalize_mac(current_value) or _clean_str(current_value)
            proposed_value = normalize_mac(proposed_value) or _clean_str(proposed_value)
        elif field == "ont_serial":
            current_value = normalize_serial(current_value) or _clean_str(current_value)
            proposed_value = normalize_serial(proposed_value) or _clean_str(proposed_value)
        else:
            current_value = _clean_str(current_value)
            proposed_value = _clean_str(proposed_value)
        if current_value != proposed_value:
            return True
    return False


def _should_queue_room_review(existing: models.PGRoom, proposed: Dict[str, Any]) -> bool:
    collected_at = _as_utc(proposed.get("collected_at"))
    updated_at = _as_utc(existing.updated_at)
    if not collected_at or not updated_at or collected_at >= updated_at:
        return False
    return _identity_changed(_room_snapshot(existing), proposed)


def _queue_room_review(
    db: Session,
    room: models.PGRoom,
    proposed: Dict[str, Any],
    *,
    reason: str,
    changed_by: Optional[str],
) -> None:
    before = _room_snapshot(room)
    room.status = "flagged"
    if room.tech_note:
        room.tech_note = f"{room.tech_note}\nReview required: {reason}"
    else:
        room.tech_note = f"Review required: {reason}"
    room.updated_at = datetime.utcnow()
    after = _room_snapshot(room)
    _record_change(
        db,
        entity_type="room",
        entity_id=room.id,
        building_id=room.building_id,
        room_id=room.id,
        action="review_required",
        reason=reason,
        changed_by=changed_by,
        before_data=before,
        after_data={"current": after, "proposed": proposed},
    )


def _building_snapshot(building: models.PGBuilding) -> Dict[str, Any]:
    return {
        "id": building.id,
        "name": building.name,
        "pg_type": building.pg_type,
        "address": building.address,
        "owner_name": building.owner_name,
        "owner_mobile": building.owner_mobile,
        "owner_alt_mobile": building.owner_alt_mobile,
        "gps_lat": building.gps_lat,
        "gps_lng": building.gps_lng,
        "photo_url": building.photo_url,
    }


def _record_change(
    db: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    reason: Optional[str],
    changed_by: Optional[str],
    before_data: Optional[Dict[str, Any]],
    after_data: Optional[Dict[str, Any]],
    building_id: Optional[str] = None,
    room_id: Optional[str] = None,
) -> None:
    db.add(models.PGChangeEvent(
        entity_type=entity_type,
        entity_id=entity_id,
        building_id=building_id,
        room_id=room_id,
        action=action,
        reason=_clean_str(reason),
        changed_by=changed_by,
        before_data=before_data,
        after_data=after_data,
    ))


def _build_stats(building: models.PGBuilding) -> dict:
    total = len(building.rooms)
    done = sum(1 for r in building.rooms if r.status in ('done', 'shared'))
    pending = sum(1 for r in building.rooms if r.status == 'pending')
    return {
        "total_floors": len(building.floors),
        "total_rooms": total,
        "done_rooms": done,
        "pending_rooms": pending,
    }


def _room_to_dict(room: models.PGRoom) -> dict:
    d = {c.name: getattr(room, c.name) for c in room.__table__.columns}
    d["photo_urls"] = _photo_urls_from_json(room.photo_urls)
    d["scan_history"] = _json_list(getattr(room, "scan_history", None))
    return d


def _group_to_dict(g: models.PGRouterGroup) -> dict:
    return {c.name: getattr(g, c.name) for c in g.__table__.columns}


def _sticker_data_snapshot(data: Optional[dict], *, photo_url: Optional[str], sticker_type: str) -> Optional[dict]:
    if not data:
        return None
    payload = dict(data)
    payload["photo_url"] = photo_url or payload.get("photo_url")
    payload["sticker_type"] = sticker_type
    payload["captured_at"] = datetime.now(timezone.utc).isoformat()
    return payload


def add_room_photo(
    db: Session,
    room_id: str,
    url: str,
    *,
    changed_by: Optional[str] = None,
    reason: Optional[str] = "room photo uploaded",
) -> dict:
    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")
    before = _room_snapshot(room)
    existing = _photo_urls_from_json(room.photo_urls)
    if url not in existing:
        existing.append(url)
        room.photo_urls = _photo_urls_to_json(existing)
        _record_change(
            db,
            entity_type="room",
            entity_id=room.id,
            building_id=room.building_id,
            room_id=room.id,
            action="photo_upload",
            reason=reason,
            changed_by=changed_by,
            before_data=before,
            after_data=_room_snapshot(room),
        )
        db.commit()
    return {"url": url, "room_id": room_id}


def set_room_sticker_photo(
    db: Session,
    room_id: str,
    url: str,
    *,
    sticker_type: str,
    changed_by: Optional[str] = None,
) -> dict:
    """Persist a typed sticker photo and keep it in the room evidence gallery."""
    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")

    normalized_type = sticker_type if sticker_type in {"ont", "router"} else "ont"
    field = "router_sticker_photo_url" if normalized_type == "router" else "ont_sticker_photo_url"
    before = _room_snapshot(room)

    existing = _photo_urls_from_json(room.photo_urls)
    if url not in existing:
        existing.append(url)
    room.photo_urls = _photo_urls_to_json(existing)
    setattr(room, field, _clean_str(url))

    _record_change(
        db,
        entity_type="room",
        entity_id=room.id,
        building_id=room.building_id,
        room_id=room.id,
        action=f"{normalized_type}_sticker_photo",
        reason=f"{normalized_type.upper()} sticker photo captured for OCR",
        changed_by=changed_by,
        before_data=before,
        after_data=_room_snapshot(room),
    )
    db.commit()
    return {"url": url, "room_id": room_id, "sticker_type": normalized_type, "field": field}


def set_room_sticker_data(
    db: Session,
    room_id: str,
    *,
    sticker_type: str,
    data: dict,
    photo_url: Optional[str] = None,
    changed_by: Optional[str] = None,
) -> dict:
    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")

    normalized_type = sticker_type if sticker_type in {"ont", "router"} else "ont"
    field = "router_sticker_data" if normalized_type == "router" else "ont_sticker_data"
    before = _room_snapshot(room)
    setattr(room, field, _sticker_data_snapshot(data, photo_url=photo_url, sticker_type=normalized_type))
    if normalized_type == "router":
        room.device_setup = room.device_setup or "onu_router"
    else:
        room.device_setup = room.device_setup or "single_ont"
    _record_change(
        db,
        entity_type="room",
        entity_id=room.id,
        building_id=room.building_id,
        room_id=room.id,
        action=f"{normalized_type}_sticker_ocr",
        reason=f"{normalized_type.upper()} sticker OCR data captured",
        changed_by=changed_by,
        before_data=before,
        after_data=_room_snapshot(room),
    )
    if room.username:
        _sync_room_to_customer(db, room)
    db.commit()
    return {"room_id": room_id, "sticker_type": normalized_type, "field": field}


def _floor_to_dict(floor: models.PGFloor) -> dict:
    return {
        "id": floor.id,
        "building_id": floor.building_id,
        "floor_number": floor.floor_number,
        "created_at": floor.created_at,
        "rooms": [_room_to_dict(r) for r in floor.rooms],
        "router_groups": [_group_to_dict(g) for g in floor.router_groups],
    }


def _building_to_dict(building: models.PGBuilding, include_floors: bool = False) -> dict:
    stats = _build_stats(building)
    d = {c.name: getattr(building, c.name) for c in building.__table__.columns}
    d.update(stats)
    if include_floors:
        d["floors"] = [_floor_to_dict(f) for f in building.floors]
    return d


# ── Building CRUD ─────────────────────────────────────────────────────────────

def list_buildings(db: Session, search: Optional[str] = None) -> List[dict]:
    q = db.query(models.PGBuilding).options(
        joinedload(models.PGBuilding.floors),
        joinedload(models.PGBuilding.rooms),
    )
    if search:
        term = f"%{search.lower()}%"
        q = q.filter(
            models.PGBuilding.name.ilike(term) |
            models.PGBuilding.owner_name.ilike(term) |
            models.PGBuilding.address.ilike(term)
        )
    buildings = q.order_by(models.PGBuilding.created_at.desc()).all()
    return [_building_to_dict(b) for b in buildings]


def get_building(db: Session, building_id: str) -> dict:
    building = db.query(models.PGBuilding).options(
        joinedload(models.PGBuilding.floors).joinedload(models.PGFloor.rooms),
        joinedload(models.PGBuilding.floors).joinedload(models.PGFloor.router_groups),
        joinedload(models.PGBuilding.rooms),
    ).filter(models.PGBuilding.id == building_id).first()
    if not building:
        raise ValueError(f"Building {building_id} not found")
    return _building_to_dict(building, include_floors=True)


def create_building(db: Session, data: BuildingCreate, created_by: Optional[str] = None) -> dict:
    existing = db.query(models.PGBuilding).filter(models.PGBuilding.id == data.id).first()
    if existing:
        raise ValueError(f"Building with id {data.id} already exists")
    name = _clean_str(data.name)
    if not name:
        raise ValueError("Building name is required")
    building = models.PGBuilding(
        id=data.id,
        name=name,
        pg_type=data.pg_type,
        address=_clean_str(data.address),
        owner_name=_clean_owner_name(data.owner_name),
        owner_mobile=_clean_str(data.owner_mobile),
        owner_alt_mobile=_clean_str(data.owner_alt_mobile),
        gps_lat=data.gps_lat,
        gps_lng=data.gps_lng,
        photo_url=_clean_str(data.photo_url),
        created_by=created_by,
    )
    db.add(building)
    db.flush()
    _record_change(
        db,
        entity_type="building",
        entity_id=building.id,
        building_id=building.id,
        action="create",
        reason=data.change_reason or "field property created",
        changed_by=created_by,
        before_data=None,
        after_data=_building_snapshot(building),
    )
    db.commit()
    db.refresh(building)
    return _building_to_dict(building)


def update_building(
    db: Session,
    building_id: str,
    data: BuildingUpdate,
    *,
    changed_by: Optional[str] = None,
) -> dict:
    building = db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).first()
    if not building:
        raise ValueError(f"Building {building_id} not found")
    before = _building_snapshot(building)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "change_reason":
            continue
        col = field  # schema fields match column names
        if hasattr(building, col):
            if col == "name":
                cleaned = _clean_str(value)
                if not cleaned:
                    raise ValueError("Building name is required")
                setattr(building, col, cleaned)
            elif col == "owner_name":
                setattr(building, col, _clean_owner_name(value))
            elif col in {"address", "owner_mobile", "owner_alt_mobile", "photo_url"}:
                setattr(building, col, _clean_str(value))
            else:
                setattr(building, col, value)
    building.updated_at = datetime.utcnow()
    after = _building_snapshot(building)
    if before != after:
        _record_change(
            db,
            entity_type="building",
            entity_id=building.id,
            building_id=building.id,
            action="update",
            reason=data.change_reason,
            changed_by=changed_by,
            before_data=before,
            after_data=after,
        )
    db.commit()
    db.refresh(building)
    # Reload with rooms for stats
    return get_building(db, building_id)


def delete_building(db: Session, building_id: str) -> None:
    building = db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).first()
    if not building:
        raise ValueError(f"Building {building_id} not found")
    # Explicit cascade to avoid FK constraint issues
    db.query(models.PGRoom).filter(models.PGRoom.building_id == building_id).delete()
    db.query(models.PGRouterGroup).filter(models.PGRouterGroup.building_id == building_id).delete()
    db.query(models.PGFloor).filter(models.PGFloor.building_id == building_id).delete()
    db.delete(building)
    db.commit()


# ── Floor CRUD ────────────────────────────────────────────────────────────────

def set_building_photo(
    db: Session,
    building_id: str,
    photo_url: str,
    *,
    changed_by: Optional[str] = None,
) -> dict:
    building = db.query(models.PGBuilding).filter(models.PGBuilding.id == building_id).first()
    if not building:
        raise ValueError(f"Building {building_id} not found")
    before = _building_snapshot(building)
    building.photo_url = _clean_str(photo_url)
    building.updated_at = datetime.utcnow()
    after = _building_snapshot(building)
    if before != after:
        _record_change(
            db,
            entity_type="building",
            entity_id=building.id,
            building_id=building.id,
            action="photo_upload",
            reason="PG building photo uploaded",
            changed_by=changed_by,
            before_data=before,
            after_data=after,
        )
    db.commit()
    db.refresh(building)
    return _building_to_dict(building)


def add_floor(db: Session, data: FloorCreate) -> dict:
    building = db.query(models.PGBuilding).filter(models.PGBuilding.id == data.building_id).first()
    if not building:
        raise ValueError(f"Building {data.building_id} not found")
    existing = db.query(models.PGFloor).filter(models.PGFloor.id == data.id).first()
    if existing:
        raise ValueError(f"Floor {data.id} already exists")
    floor = models.PGFloor(id=data.id, building_id=data.building_id, floor_number=data.floor_number)
    db.add(floor)
    db.commit()
    db.refresh(floor)
    return _floor_to_dict(floor)


def delete_floor(db: Session, floor_id: str) -> None:
    floor = db.query(models.PGFloor).filter(models.PGFloor.id == floor_id).first()
    if not floor:
        raise ValueError(f"Floor {floor_id} not found")
    db.delete(floor)
    db.commit()


# ── Room CRUD ─────────────────────────────────────────────────────────────────

def upsert_room(db: Session, data: RoomCreate, *, changed_by: Optional[str] = None) -> dict:
    room = db.query(models.PGRoom).filter(models.PGRoom.id == data.id).first()
    if room:
        before = _room_snapshot(room)
        # Update
        for f, v in data.model_dump(exclude={'id', 'floor_id', 'building_id', 'change_reason'}).items():
            if f == 'photo_urls':
                room.photo_urls = _photo_urls_to_json(v)
            elif f == 'scan_history':
                room.scan_history = _json_list_to_str(v)
            elif f in {'ont_sticker_data', 'router_sticker_data'}:
                setattr(room, f, v)
            elif f in ROOM_STRING_FIELDS:
                setattr(room, f, _clean_str(v))
            elif hasattr(room, f):
                setattr(room, f, v)
        room.updated_at = datetime.utcnow()
        after = _room_snapshot(room)
        if before != after:
            _record_change(
                db,
                entity_type="room",
                entity_id=room.id,
                building_id=room.building_id,
                room_id=room.id,
                action="update",
                reason=data.change_reason,
                changed_by=changed_by,
                before_data=before,
                after_data=after,
            )
    else:
        room = models.PGRoom(
            id=data.id,
            building_id=data.building_id,
            floor_id=data.floor_id,
            router_group_id=_clean_str(data.router_group_id),
            room_number=_clean_str(data.room_number) or data.room_number,
            status=data.status,
            connection_type=data.connection_type,
            device_setup=_clean_str(data.device_setup) or "single_ont",
            username=_clean_str(data.username),
            ont_serial=_clean_str(data.ont_serial),
            mac_address=_clean_str(data.mac_address),
            ont_model=_clean_str(data.ont_model),
            ont_sticker_photo_url=_clean_str(data.ont_sticker_photo_url),
            ont_sticker_data=data.ont_sticker_data,
            router_sticker_photo_url=_clean_str(data.router_sticker_photo_url),
            router_mac_address=_clean_str(data.router_mac_address),
            router_serial=_clean_str(data.router_serial),
            router_model=_clean_str(data.router_model),
            router_sticker_data=data.router_sticker_data,
            wifi_ssid=_clean_str(data.wifi_ssid),
            wifi_ssid_5g=_clean_str(data.wifi_ssid_5g),
            wifi_password=_clean_str(data.wifi_password),
            scan_history=_json_list_to_str(data.scan_history),
            tech_note=_clean_str(data.tech_note),
            photo_urls=_photo_urls_to_json(data.photo_urls),
            collected_at=data.collected_at,
        )
        db.add(room)
        db.flush()
        _record_change(
            db,
            entity_type="room",
            entity_id=room.id,
            building_id=room.building_id,
            room_id=room.id,
            action="create",
            reason=data.change_reason or "field room created",
            changed_by=changed_by,
            before_data=None,
            after_data=_room_snapshot(room),
        )
    db.commit()
    db.refresh(room)
    # Push collected sticker/WiFi data to the linked customer profile (non-destructive)
    _sync_room_to_customer(db, room)
    db.commit()
    return _room_to_dict(room)


def update_room(
    db: Session,
    room_id: str,
    data: RoomUpdate,
    *,
    changed_by: Optional[str] = None,
) -> dict:
    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")
    before = _room_snapshot(room)
    for f, v in data.model_dump(exclude_unset=True).items():
        if f == 'change_reason':
            continue
        if f == 'photo_urls':
            room.photo_urls = _photo_urls_to_json(v)
        elif f == 'scan_history':
            room.scan_history = _json_list_to_str(v)
        elif f in {'ont_sticker_data', 'router_sticker_data'}:
            setattr(room, f, v)
        elif f in ROOM_STRING_FIELDS:
            setattr(room, f, _clean_str(v))
        elif hasattr(room, f):
            setattr(room, f, v)
    room.updated_at = datetime.utcnow()
    after = _room_snapshot(room)
    if before != after:
        _record_change(
            db,
            entity_type="room",
            entity_id=room.id,
            building_id=room.building_id,
            room_id=room.id,
            action="update",
            reason=data.change_reason,
            changed_by=changed_by,
            before_data=before,
            after_data=after,
        )
    if room.username:
        _sync_room_to_customer(db, room)
    db.commit()
    db.refresh(room)
    return _room_to_dict(room)


def delete_room(db: Session, room_id: str) -> None:
    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")
    db.delete(room)
    db.commit()


# ── Router Group CRUD ─────────────────────────────────────────────────────────

def _room_location_dict(room: models.PGRoom) -> Dict[str, Any]:
    building = room.building
    floor = room.floor
    return {
        "room_id": room.id,
        "building_id": room.building_id,
        "building_name": building.name if building else None,
        "floor_number": floor.floor_number if floor else None,
        "room_number": room.room_number,
        "username": room.username,
        "mac_address": room.mac_address,
        "ont_serial": room.ont_serial,
    }


def _compact_mac_expr(column):
    return func.replace(func.replace(func.upper(column), ":", ""), "-", "")


def _matching_room_query(
    db: Session,
    *,
    current_room_id: str,
    username: Optional[str],
    mac_address: Optional[str],
    ont_serial: Optional[str],
) -> List[models.PGRoom]:
    from services.onu_binding_service import normalize_mac, normalize_serial

    conditions = []
    username_clean = _clean_str(username)
    if username_clean:
        conditions.append(func.lower(models.PGRoom.username) == username_clean.lower())

    mac = normalize_mac(mac_address)
    if mac:
        conditions.append(_compact_mac_expr(models.PGRoom.mac_address) == mac.replace(":", ""))

    serial = normalize_serial(ont_serial)
    if serial:
        conditions.append(func.upper(models.PGRoom.ont_serial).in_([serial.upper(), f"SN:{serial.upper()}"]))

    if not conditions:
        return []

    return db.query(models.PGRoom).options(
        joinedload(models.PGRoom.building),
        joinedload(models.PGRoom.floor),
    ).filter(
        models.PGRoom.id != current_room_id,
        or_(*conditions),
    ).all()


def _match_live_onu(
    db: Session,
    *,
    mac_address: Optional[str],
    ont_serial: Optional[str],
) -> Optional[Dict[str, Any]]:
    from services.onu_binding_service import normalize_mac, normalize_serial

    serial = normalize_serial(ont_serial)
    if serial:
        onu = db.query(models.ONULatest).filter(
            func.upper(models.ONULatest.mac_address).in_([serial.upper(), f"SN:{serial.upper()}"])
        ).first()
        if onu:
            return {
                "match_type": "serial",
                "matched_value": serial.upper(),
                "status": onu.status,
                "olt_host": onu.olt_host,
                "pon_port": onu.pon_port,
                "onu_index": onu.onu_index,
            }

    mac = normalize_mac(mac_address)
    if mac:
        onu = db.query(models.ONULatest).filter(
            _compact_mac_expr(models.ONULatest.mac_address) == mac.replace(":", "")
        ).first()
        if onu:
            return {
                "match_type": "mac",
                "matched_value": mac,
                "status": onu.status,
                "olt_host": onu.olt_host,
                "pon_port": onu.pon_port,
                "onu_index": onu.onu_index,
            }
    return None


def get_room_link_conflicts(
    db: Session,
    *,
    room_id: str,
    username: Optional[str] = None,
    mac_address: Optional[str] = None,
    ont_serial: Optional[str] = None,
) -> Dict[str, Any]:
    from services.onu_binding_service import build_binding_identity, normalize_mac, normalize_serial

    conflicts: List[Dict[str, Any]] = []
    username_clean = _clean_str(username)
    mac = normalize_mac(mac_address)
    serial = normalize_serial(ont_serial)

    other_rooms = _matching_room_query(
        db,
        current_room_id=room_id,
        username=username_clean,
        mac_address=mac,
        ont_serial=serial,
    )
    for other in other_rooms:
        loc = _room_location_dict(other)
        matched = []
        if username_clean and other.username and other.username.lower() == username_clean.lower():
            matched.append("username")
        if mac and other.mac_address and normalize_mac(other.mac_address) == mac:
            matched.append("mac")
        if serial and other.ont_serial and normalize_serial(other.ont_serial) == serial:
            matched.append("serial")
        conflicts.append({
            **loc,
            "conflict_type": "room_" + "_".join(matched or ["link"]),
            "message": (
                f"{', '.join(matched).upper() or 'LINK'} already exists in "
                f"{loc.get('building_name') or 'another PG'} room {loc.get('room_number') or '-'}."
            ),
        })

    if username_clean:
        customer = db.query(models.Customer).filter(
            func.lower(models.Customer.username) == username_clean.lower()
        ).first()
        if not customer:
            conflicts.append({
                "conflict_type": "customer_not_found",
                "message": f"Username {username_clean} was not found in customers.",
                "username": username_clean,
            })
        else:
            if mac and customer.mac_address and normalize_mac(customer.mac_address) != mac:
                conflicts.append({
                    "conflict_type": "customer_mac_mismatch",
                    "message": f"Customer {username_clean} already has a different MAC on profile.",
                    "username": username_clean,
                    "mac_address": customer.mac_address,
                })
            if serial and customer.ont_serial_number and normalize_serial(customer.ont_serial_number) != serial:
                conflicts.append({
                    "conflict_type": "customer_serial_mismatch",
                    "message": f"Customer {username_clean} already has a different serial on profile.",
                    "username": username_clean,
                    "ont_serial": customer.ont_serial_number,
                })
            binding = db.query(models.ONUBinding).filter(
                models.ONUBinding.customer_id == customer.username,
                models.ONUBinding.is_active.is_(True),
            ).order_by(models.ONUBinding.verified_at.desc().nullslast()).first()
            if binding:
                binding_mac = normalize_mac(binding.mac_address)
                binding_serial = normalize_serial(binding.serial_number)
                if mac and binding_mac and binding_mac != mac:
                    conflicts.append({
                        "conflict_type": "binding_mac_mismatch",
                        "message": f"Customer {username_clean} has an active binding to another MAC.",
                        "username": username_clean,
                        "mac_address": binding.mac_address,
                    })
                if serial and binding_serial and binding_serial != serial:
                    conflicts.append({
                        "conflict_type": "binding_serial_mismatch",
                        "message": f"Customer {username_clean} has an active binding to another serial.",
                        "username": username_clean,
                        "ont_serial": binding.serial_number,
                    })

    identity = build_binding_identity(
        onu_identifier=serial or mac,
        ont_serial_number=serial,
        ont_mac_address=mac,
    )
    identifier = identity["onu_identifier"]
    if identifier:
        duplicate_binding = db.query(models.ONUBinding).filter(
            models.ONUBinding.is_active.is_(True),
            models.ONUBinding.onu_identifier == identifier,
            models.ONUBinding.customer_id != (username_clean or ""),
        ).first()
        if duplicate_binding:
            conflicts.append({
                "conflict_type": "binding_identifier_duplicate",
                "message": f"This ONT identity is already bound to customer {duplicate_binding.customer_id}.",
                "username": duplicate_binding.customer_id,
                "onu_identifier": duplicate_binding.onu_identifier,
            })

    return {
        "conflicts": conflicts,
        "can_override": True,
        "live_onu": _match_live_onu(db, mac_address=mac, ont_serial=serial),
    }


def resolve_room_link_conflicts(
    db: Session,
    *,
    room_id: str,
    username: Optional[str],
    mac_address: Optional[str],
    ont_serial: Optional[str],
    reason: str,
    changed_by: Optional[str] = None,
) -> Dict[str, Any]:
    from services.onu_binding_service import normalize_mac, normalize_serial

    current = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not current:
        raise ValueError(f"Room {room_id} not found")

    username_clean = _clean_str(username)
    mac = normalize_mac(mac_address)
    serial = normalize_serial(ont_serial)
    rooms = _matching_room_query(
        db,
        current_room_id=room_id,
        username=username_clean,
        mac_address=mac,
        ont_serial=serial,
    )
    changed = 0
    for other in rooms:
        before = _room_snapshot(other)
        if username_clean and other.username and other.username.lower() == username_clean.lower():
            other.username = None
            if other.connection_type == "individual":
                other.connection_type = "none"
        if mac and other.mac_address and normalize_mac(other.mac_address) == mac:
            other.mac_address = None
        if serial and other.ont_serial and normalize_serial(other.ont_serial) == serial:
            other.ont_serial = None
        other.updated_at = datetime.utcnow()
        after = _room_snapshot(other)
        if before != after:
            changed += 1
            _record_change(
                db,
                entity_type="room",
                entity_id=other.id,
                building_id=other.building_id,
                room_id=other.id,
                action="conflict_unlink",
                reason=reason,
                changed_by=changed_by,
                before_data=before,
                after_data=after,
            )
    db.commit()
    return {"status": "ok", "updated_rooms": changed}


def list_room_history(db: Session, room_id: str) -> List[dict]:
    events = db.query(models.PGChangeEvent).filter(
        models.PGChangeEvent.entity_type == "room",
        models.PGChangeEvent.entity_id == room_id,
    ).order_by(models.PGChangeEvent.created_at.desc()).all()
    return [
        {c.name: getattr(event, c.name) for c in event.__table__.columns}
        for event in events
    ]


def list_pending_room_reviews(db: Session, limit: int = 100) -> List[dict]:
    events = db.query(models.PGChangeEvent).filter(
        models.PGChangeEvent.entity_type == "room",
        models.PGChangeEvent.action.in_(["review_required", "review_applied", "review_dismissed"]),
    ).order_by(models.PGChangeEvent.created_at.desc()).limit(max(limit * 3, 100)).all()

    closed_ids = set()
    pending = []
    for event in events:
        if event.action in {"review_applied", "review_dismissed"}:
            ref = (event.after_data or {}).get("review_event_id")
            if ref is not None:
                closed_ids.add(ref)
            continue
        if event.id in closed_ids:
            continue
        pending.append({c.name: getattr(event, c.name) for c in event.__table__.columns})
        if len(pending) >= limit:
            break
    return pending


def apply_room_review(
    db: Session,
    *,
    room_id: str,
    event_id: int,
    reason: str,
    changed_by: Optional[str] = None,
) -> dict:
    event = db.query(models.PGChangeEvent).filter(
        models.PGChangeEvent.id == event_id,
        models.PGChangeEvent.entity_type == "room",
        models.PGChangeEvent.entity_id == room_id,
        models.PGChangeEvent.action == "review_required",
    ).first()
    proposed = (event.after_data or {}).get("proposed") if event else None
    if not event or not proposed:
        raise ValueError("Pending review not found")

    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")

    before = _room_snapshot(room)
    fields = [
        "router_group_id", "room_number", "status", "connection_type", "username",
        "device_setup", "ont_serial", "mac_address", "ont_model", "ont_sticker_photo_url",
        "ont_sticker_data", "router_sticker_photo_url", "router_mac_address", "router_serial",
        "router_model", "router_sticker_data", "wifi_ssid", "wifi_ssid_5g",
        "wifi_password", "tech_note", "collected_at",
    ]
    for field in fields:
        if field in proposed:
            value = _as_utc(proposed[field]) if field == "collected_at" else proposed[field]
            setattr(room, field, value)
    if "scan_history" in proposed:
        room.scan_history = _json_list_to_str(proposed["scan_history"])
    if "photo_urls" in proposed:
        room.photo_urls = _photo_urls_to_json(proposed["photo_urls"])
    room.updated_at = datetime.utcnow()
    after = _room_snapshot(room)
    _record_change(
        db,
        entity_type="room",
        entity_id=room.id,
        building_id=room.building_id,
        room_id=room.id,
        action="review_applied",
        reason=reason,
        changed_by=changed_by,
        before_data=before,
        after_data={"current": after, "review_event_id": event_id},
    )
    if room.username:
        _sync_room_to_customer(db, room)
    db.commit()
    db.refresh(room)
    return _room_to_dict(room)


def dismiss_room_review(
    db: Session,
    *,
    room_id: str,
    event_id: int,
    reason: str,
    changed_by: Optional[str] = None,
) -> dict:
    event = db.query(models.PGChangeEvent).filter(
        models.PGChangeEvent.id == event_id,
        models.PGChangeEvent.entity_type == "room",
        models.PGChangeEvent.entity_id == room_id,
        models.PGChangeEvent.action == "review_required",
    ).first()
    if not event:
        raise ValueError("Pending review not found")
    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")
    before = _room_snapshot(room)
    if room.status == "flagged":
        room.status = "pending"
    room.updated_at = datetime.utcnow()
    after = _room_snapshot(room)
    _record_change(
        db,
        entity_type="room",
        entity_id=room.id,
        building_id=room.building_id,
        room_id=room.id,
        action="review_dismissed",
        reason=reason,
        changed_by=changed_by,
        before_data=before,
        after_data={"current": after, "review_event_id": event_id},
    )
    db.commit()
    db.refresh(room)
    return _room_to_dict(room)


def revert_room_to_event(
    db: Session,
    *,
    room_id: str,
    event_id: int,
    reason: str,
    changed_by: Optional[str] = None,
) -> dict:
    event = db.query(models.PGChangeEvent).filter(
        models.PGChangeEvent.id == event_id,
        models.PGChangeEvent.entity_type == "room",
        models.PGChangeEvent.entity_id == room_id,
    ).first()
    if not event or not event.before_data:
        raise ValueError("Revert point not found")

    room = db.query(models.PGRoom).filter(models.PGRoom.id == room_id).first()
    if not room:
        raise ValueError(f"Room {room_id} not found")

    before = _room_snapshot(room)
    snap = event.before_data
    fields = [
        "router_group_id", "room_number", "status", "connection_type", "username",
        "device_setup", "ont_serial", "mac_address", "ont_model", "ont_sticker_photo_url",
        "ont_sticker_data", "router_sticker_photo_url", "router_mac_address", "router_serial",
        "router_model", "router_sticker_data", "wifi_ssid", "wifi_ssid_5g",
        "wifi_password", "tech_note", "collected_at",
    ]
    for field in fields:
        if field in snap:
            setattr(room, field, snap[field])
    if "scan_history" in snap:
        room.scan_history = _json_list_to_str(snap["scan_history"])
    if "photo_urls" in snap:
        room.photo_urls = _photo_urls_to_json(snap["photo_urls"])
    room.updated_at = datetime.utcnow()
    after = _room_snapshot(room)
    _record_change(
        db,
        entity_type="room",
        entity_id=room.id,
        building_id=room.building_id,
        room_id=room.id,
        action="revert",
        reason=reason,
        changed_by=changed_by,
        before_data=before,
        after_data=after,
    )
    db.commit()
    db.refresh(room)
    return _room_to_dict(room)


def upsert_router_group(db: Session, data: RouterGroupCreate) -> dict:
    grp = db.query(models.PGRouterGroup).filter(models.PGRouterGroup.id == data.id).first()
    if grp:
        for f, v in data.model_dump(exclude={'id', 'floor_id', 'building_id'}).items():
            if hasattr(grp, f):
                setattr(grp, f, v)
        grp.updated_at = datetime.utcnow()
    else:
        grp = models.PGRouterGroup(
            id=data.id,
            building_id=data.building_id,
            floor_id=data.floor_id,
            group_name=data.group_name,
            ont_serial=data.ont_serial,
            mac_address=data.mac_address,
            username=data.username,
            photo_url=data.photo_url,
        )
        db.add(grp)
    db.commit()
    db.refresh(grp)
    return _group_to_dict(grp)


def delete_router_group(db: Session, group_id: str) -> None:
    grp = db.query(models.PGRouterGroup).filter(models.PGRouterGroup.id == group_id).first()
    if not grp:
        raise ValueError(f"Router group {group_id} not found")
    # Unlink rooms before delete
    db.query(models.PGRoom).filter(
        models.PGRoom.router_group_id == group_id
    ).update({"router_group_id": None, "connection_type": "individual"})
    db.delete(grp)
    db.commit()


# ── PG → Customer Profile Sync ────────────────────────────────────────────────

def _lookup_live_onu_for_room(
    db: Session,
    *,
    serial_number: Optional[str],
    mac_address: Optional[str],
) -> Optional[models.ONULatest]:
    """Find live OLT data for a room identity. GPON uses SN:<serial>, EPON uses MAC."""
    from services.onu_binding_service import normalize_mac, normalize_serial

    serial = normalize_serial(serial_number)
    if serial:
        onu = db.query(models.ONULatest).filter(
            func.upper(models.ONULatest.mac_address).in_([serial.upper(), f"SN:{serial.upper()}"])
        ).first()
        if onu:
            return onu

    mac = normalize_mac(mac_address)
    if mac:
        return db.query(models.ONULatest).filter(
            _compact_mac_expr(models.ONULatest.mac_address) == mac.replace(":", "")
        ).first()
    return None


def _sync_room_to_customer(db: Session, room: models.PGRoom) -> None:
    """
    Push PG survey data to the linked customer and create/update the trusted ONU binding.
    ONT identity drives OLT mapping; separate router sticker data is stored only as
    customer/room evidence.
    """
    if not room.username:
        return
    customer = db.query(models.Customer).filter(
        models.Customer.username == room.username
    ).first()
    if not customer:
        return

    from services.customer_provenance_service import record_field_writes
    from services.onu_binding_service import build_binding_identity, normalize_mac, normalize_serial

    changed = False
    now = datetime.now(timezone.utc)
    ont_photo = _clean_str(room.ont_sticker_photo_url) or (room.photo_urls and (_photo_urls_from_json(room.photo_urls) or [None])[0])
    tracked_fields = [
        "device_setup", "ont_sticker_data", "router_sticker_data",
        "ont_serial_number", "ont_model", "sticker_photo_url", "router_sticker_photo_url",
        "router_mac_address", "router_serial", "router_model", "wifi_ssid",
        "wifi_ssid_5g", "wifi_password",
    ]
    before_values = {field: getattr(customer, field, None) for field in tracked_fields}

    serial_clean = normalize_serial(room.ont_serial)
    mac_clean = normalize_mac(room.mac_address)

    if room.device_setup and getattr(customer, "device_setup", None) != room.device_setup:
        customer.device_setup = room.device_setup
        changed = True
    if room.ont_sticker_data and getattr(customer, "ont_sticker_data", None) != room.ont_sticker_data:
        customer.ont_sticker_data = room.ont_sticker_data
        changed = True
    if room.router_sticker_data and getattr(customer, "router_sticker_data", None) != room.router_sticker_data:
        customer.router_sticker_data = room.router_sticker_data
        changed = True
    if serial_clean and customer.ont_serial_number != serial_clean:
        customer.ont_serial_number = serial_clean
        changed = True
    if room.ont_model and customer.ont_model != room.ont_model:
        customer.ont_model = room.ont_model
        changed = True
    if ont_photo and customer.sticker_photo_url != ont_photo:
        customer.sticker_photo_url = ont_photo
        changed = True
    if room.router_sticker_photo_url and customer.router_sticker_photo_url != room.router_sticker_photo_url:
        customer.router_sticker_photo_url = room.router_sticker_photo_url
        changed = True
    if room.router_mac_address and hasattr(customer, "router_mac_address"):
        router_mac = normalize_mac(room.router_mac_address) or _clean_str(room.router_mac_address)
        if router_mac and getattr(customer, "router_mac_address", None) != router_mac:
            customer.router_mac_address = router_mac
            changed = True
    if room.router_serial:
        router_serial = normalize_serial(room.router_serial)
        if router_serial and customer.router_serial != router_serial:
            customer.router_serial = router_serial
            changed = True
    if room.router_model and customer.router_model != room.router_model:
        customer.router_model = room.router_model
        changed = True
    if room.wifi_ssid and not customer.wifi_ssid:
        customer.wifi_ssid = room.wifi_ssid
        changed = True
    if room.wifi_ssid_5g and not getattr(customer, "wifi_ssid_5g", None):
        customer.wifi_ssid_5g = room.wifi_ssid_5g
        changed = True
    if room.wifi_password and not customer.wifi_password:
        customer.wifi_password = room.wifi_password
        changed = True

    identity = build_binding_identity(
        onu_identifier=serial_clean or mac_clean,
        ont_serial_number=serial_clean,
        ont_mac_address=mac_clean,
    )
    identifier_clean = identity["onu_identifier"]
    if identifier_clean:
        live_onu = _lookup_live_onu_for_room(
            db,
            serial_number=identity["serial_number"],
            mac_address=identity["mac_address"],
        )
        binding = db.query(models.ONUBinding).filter(
            models.ONUBinding.customer_id == customer.username,
            models.ONUBinding.is_active.is_(True),
        ).first()
        binding_notes = f"PG survey room {room.room_number}"
        if room.building and room.building.name:
            binding_notes += f" in {room.building.name}"

        if binding:
            binding.onu_identifier = identifier_clean
            binding.onu_type = identity["onu_type"]
            binding.primary_identifier_type = identity["primary_identifier_type"]
            binding.serial_number = identity["serial_number"]
            binding.mac_address = identity["mac_address"]
            binding.binding_source = "pg_survey"
            binding.confidence = "verified" if live_onu else "probable"
            binding.last_seen = now
            binding.verified_at = now
            binding.is_active = True
            binding.deactivated_at = None
            binding.deactivated_reason = None
            binding.sticker_photo_url = ont_photo
            binding.notes = binding_notes
        else:
            binding = models.ONUBinding(
                customer_id=customer.username,
                onu_identifier=identifier_clean,
                onu_type=identity["onu_type"],
                primary_identifier_type=identity["primary_identifier_type"],
                serial_number=identity["serial_number"],
                mac_address=identity["mac_address"],
                binding_source="pg_survey",
                confidence="verified" if live_onu else "probable",
                verified_at=now,
                sticker_photo_url=ont_photo,
                notes=binding_notes,
            )
            db.add(binding)

        if live_onu:
            binding.olt_host = live_onu.olt_host
            binding.pon_port = live_onu.pon_port
            binding.onu_index = live_onu.onu_index

        if identity["primary_identifier_type"] == "serial" and identity["serial_number"]:
            customer.ont_serial_number = identity["serial_number"]
            changed = True

    if changed:
        customer.last_surveyed_at = now
        changed_fields = [
            field for field in tracked_fields
            if before_values.get(field) != getattr(customer, field, None)
        ]
        if changed_fields:
            evidence_ref = ont_photo
            if not evidence_ref and room.building_id and room.room_number:
                evidence_ref = f"pg:{room.building_id}:{room.room_number}"
            record_field_writes(
                db,
                customer_id=customer.username,
                field_names=changed_fields,
                source="pg_survey",
                writer=getattr(room, "updated_by", None) or getattr(room, "created_by", None),
                evidence_ref=evidence_ref,
                verified_at=now,
                notes=f"PG room survey {room.room_number}",
                updated_at=now,
            )


# ── Bulk Sync ─────────────────────────────────────────────────────────────────

def bulk_sync(db: Session, payload: SyncPayload, synced_by: Optional[str] = None) -> SyncResponse:
    """
    Idempotent upsert of everything from the mobile app.
    Buildings and floors: insert-or-ignore (mobile owns creation).
    Rooms and groups: upsert (mobile owns last write).
    """
    resp = SyncResponse()

    # Buildings
    for b in payload.buildings:
        try:
            existing = db.query(models.PGBuilding).filter(models.PGBuilding.id == b.id).first()
            if not existing:
                building = models.PGBuilding(
                    id=b.id, name=(_clean_str(b.name) or b.name), pg_type=b.pg_type,
                    address=_clean_str(b.address), owner_name=_clean_owner_name(b.owner_name),
                    owner_mobile=_clean_str(b.owner_mobile), owner_alt_mobile=_clean_str(b.owner_alt_mobile),
                    gps_lat=b.gps_lat, gps_lng=b.gps_lng, photo_url=_clean_str(b.photo_url),
                    created_by=synced_by,
                )
                db.add(building)
                db.flush()
                _record_change(
                    db,
                    entity_type="building",
                    entity_id=building.id,
                    building_id=building.id,
                    action="create",
                    reason=b.change_reason or "mobile sync created building",
                    changed_by=synced_by,
                    before_data=None,
                    after_data=_building_snapshot(building),
                )
                resp.upserted_buildings += 1
            else:
                before = _building_snapshot(existing)
                # Update mutable fields
                existing.name = _clean_str(b.name) or existing.name
                existing.pg_type = b.pg_type
                existing.address = _clean_str(b.address)
                existing.owner_name = _clean_owner_name(b.owner_name)
                existing.owner_mobile = _clean_str(b.owner_mobile)
                existing.owner_alt_mobile = _clean_str(b.owner_alt_mobile)
                existing.gps_lat = b.gps_lat
                existing.gps_lng = b.gps_lng
                if b.photo_url:
                    existing.photo_url = _clean_str(b.photo_url)
                after = _building_snapshot(existing)
                if before != after:
                    _record_change(
                        db,
                        entity_type="building",
                        entity_id=existing.id,
                        building_id=existing.id,
                        action="update",
                        reason=b.change_reason or "mobile sync updated building",
                        changed_by=synced_by,
                        before_data=before,
                        after_data=after,
                    )
                resp.upserted_buildings += 1
        except Exception as e:
            logger.error("sync building %s: %s", b.id, e)
            resp.errors.append(f"building {b.id}: {e}")

    # Floors
    for f in payload.floors:
        try:
            existing = db.query(models.PGFloor).filter(models.PGFloor.id == f.id).first()
            if not existing:
                db.add(models.PGFloor(id=f.id, building_id=f.building_id, floor_number=f.floor_number))
                resp.upserted_floors += 1
        except Exception as e:
            logger.error("sync floor %s: %s", f.id, e)
            resp.errors.append(f"floor {f.id}: {e}")

    db.flush()

    # Router groups
    for g in payload.router_groups:
        try:
            existing = db.query(models.PGRouterGroup).filter(models.PGRouterGroup.id == g.id).first()
            if existing:
                existing.group_name = g.group_name
                existing.ont_serial = g.ont_serial
                existing.mac_address = g.mac_address
                existing.username = g.username
                if g.photo_url:
                    existing.photo_url = g.photo_url
            else:
                db.add(models.PGRouterGroup(
                    id=g.id, building_id=g.building_id, floor_id=g.floor_id,
                    group_name=g.group_name, ont_serial=g.ont_serial,
                    mac_address=g.mac_address, username=g.username, photo_url=g.photo_url,
                ))
            resp.upserted_groups += 1
        except Exception as e:
            logger.error("sync group %s: %s", g.id, e)
            resp.errors.append(f"group {g.id}: {e}")

    # Rooms
    for r in payload.rooms:
        try:
            existing = db.query(models.PGRoom).filter(models.PGRoom.id == r.id).first()
            if existing:
                proposed = _incoming_room_snapshot(r)
                if _should_queue_room_review(existing, proposed):
                    _queue_room_review(
                        db,
                        existing,
                        proposed,
                        reason=r.change_reason or "stale mobile room identity change needs review",
                        changed_by=synced_by,
                    )
                    resp.review_required += 1
                    resp.upserted_rooms += 1
                    continue
                before = _room_snapshot(existing)
                existing.status = r.status
                existing.connection_type = r.connection_type
                existing.device_setup = _clean_str(r.device_setup) or existing.device_setup or "single_ont"
                existing.username = _clean_str(r.username)
                existing.ont_serial = _clean_str(r.ont_serial)
                existing.mac_address = _clean_str(r.mac_address)
                existing.ont_model = _clean_str(r.ont_model)
                existing.ont_sticker_photo_url = _clean_str(r.ont_sticker_photo_url)
                existing.ont_sticker_data = r.ont_sticker_data
                existing.router_sticker_photo_url = _clean_str(r.router_sticker_photo_url)
                existing.router_mac_address = _clean_str(r.router_mac_address)
                existing.router_serial = _clean_str(r.router_serial)
                existing.router_model = _clean_str(r.router_model)
                existing.router_sticker_data = r.router_sticker_data
                existing.wifi_ssid = _clean_str(r.wifi_ssid)
                existing.wifi_ssid_5g = _clean_str(r.wifi_ssid_5g)
                existing.wifi_password = _clean_str(r.wifi_password)
                existing.scan_history = _json_list_to_str(r.scan_history)
                existing.tech_note = _clean_str(r.tech_note)
                existing.photo_urls = _photo_urls_to_json(r.photo_urls)
                existing.collected_at = r.collected_at
                existing.router_group_id = _clean_str(r.router_group_id)
                after = _room_snapshot(existing)
                if before != after:
                    _record_change(
                        db,
                        entity_type="room",
                        entity_id=existing.id,
                        building_id=existing.building_id,
                        room_id=existing.id,
                        action="update",
                        reason=r.change_reason or "mobile sync updated room",
                        changed_by=synced_by,
                        before_data=before,
                        after_data=after,
                    )
            else:
                room = models.PGRoom(
                    id=r.id, building_id=r.building_id, floor_id=r.floor_id,
                    router_group_id=_clean_str(r.router_group_id), room_number=_clean_str(r.room_number) or r.room_number,
                    status=r.status, connection_type=r.connection_type,
                    device_setup=_clean_str(r.device_setup) or "single_ont",
                    username=_clean_str(r.username), ont_serial=_clean_str(r.ont_serial),
                    mac_address=_clean_str(r.mac_address), ont_model=_clean_str(r.ont_model),
                    ont_sticker_photo_url=_clean_str(r.ont_sticker_photo_url),
                    ont_sticker_data=r.ont_sticker_data,
                    router_sticker_photo_url=_clean_str(r.router_sticker_photo_url),
                    router_mac_address=_clean_str(r.router_mac_address),
                    router_serial=_clean_str(r.router_serial),
                    router_model=_clean_str(r.router_model),
                    router_sticker_data=r.router_sticker_data,
                    wifi_ssid=_clean_str(r.wifi_ssid), wifi_ssid_5g=_clean_str(r.wifi_ssid_5g),
                    wifi_password=_clean_str(r.wifi_password),
                    scan_history=_json_list_to_str(r.scan_history),
                    tech_note=_clean_str(r.tech_note), photo_urls=_photo_urls_to_json(r.photo_urls),
                    collected_at=r.collected_at,
                )
                db.add(room)
                db.flush()
                _record_change(
                    db,
                    entity_type="room",
                    entity_id=room.id,
                    building_id=room.building_id,
                    room_id=room.id,
                    action="create",
                    reason=r.change_reason or "mobile sync created room",
                    changed_by=synced_by,
                    before_data=None,
                    after_data=_room_snapshot(room),
                )
            resp.upserted_rooms += 1
        except Exception as e:
            logger.error("sync room %s: %s", r.id, e)
            resp.errors.append(f"room {r.id}: {e}")

    # Push collected sticker/WiFi data to linked customer profiles (non-destructive)
    for r in payload.rooms:
        try:
            room_obj = db.query(models.PGRoom).filter(models.PGRoom.id == r.id).first()
            if room_obj and room_obj.username:
                _sync_room_to_customer(db, room_obj)
        except Exception as e:
            logger.warning("customer sync for room %s: %s", r.id, e)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("bulk_sync commit failed: %s", e)
        raise

    return resp


# ── Enriched Admin Dashboard ──────────────────────────────────────────────────

def _signal_label(rx: Optional[float]) -> str:
    if rx is None:
        return "unknown"
    if rx >= -20:
        return "excellent"
    if rx >= -24:
        return "good"
    if rx >= -27:
        return "weak"
    return "critical"


def get_building_dashboard(db: Session, building_id: str) -> Dict[str, Any]:
    """
    Returns the full building detail enriched with per-room customer and ONU data.
    Used by the admin dashboard for a single-request page load.
    """
    building = db.query(models.PGBuilding).options(
        joinedload(models.PGBuilding.floors).joinedload(models.PGFloor.rooms),
        joinedload(models.PGBuilding.floors).joinedload(models.PGFloor.router_groups),
        joinedload(models.PGBuilding.rooms),
    ).filter(models.PGBuilding.id == building_id).first()

    if not building:
        raise ValueError(f"Building {building_id} not found")

    # Collect all unique usernames linked to rooms
    usernames = list({r.username for r in building.rooms if r.username})

    # Fetch all matching customers in one query
    customers: Dict[str, models.Customer] = {}
    if usernames:
        rows = db.query(models.Customer).filter(
            models.Customer.username.in_(usernames)
        ).all()
        customers = {c.username: c for c in rows}

    # Fetch ONU statuses for all identifiers:
    # - customer MACs (for customer link section)
    # - room mac_address + room ont_serial (for sticker match section)
    # NOTE: GPON serials are stored in onu_latest.mac_address with "SN:" prefix
    #       by the OLT poller (e.g. "GPON00508E6A" → "SN:GPON00508E6A").
    #       We query both the raw serial and the SN: form so the lookup works.
    all_identifiers: set = set()
    for c in customers.values():
        if c.mac_address:
            all_identifiers.add(c.mac_address)
    for r in building.rooms:
        if r.mac_address:
            all_identifiers.add(r.mac_address)
        if r.ont_serial:
            all_identifiers.add(r.ont_serial)
            all_identifiers.add(f"SN:{r.ont_serial}")

    mac_to_onu: Dict[str, models.ONULatest] = {}
    if all_identifiers:
        onu_rows = db.query(models.ONULatest).filter(
            models.ONULatest.mac_address.in_(all_identifiers)
        ).all()
        mac_to_onu = {o.mac_address: o for o in onu_rows}

    # Check for PG conflicts: usernames linked in any OTHER room.
    if usernames:
        other_links = db.query(
            models.PGRoom.username,
            models.PGRoom.id,
            models.PGRoom.room_number,
            models.PGBuilding.name,
        ).join(
            models.PGBuilding, models.PGRoom.building_id == models.PGBuilding.id
        ).filter(
            models.PGRoom.username.in_(usernames),
        ).all()
        username_conflicts: Dict[str, List[dict]] = {}
        for row in other_links:
            username_conflicts.setdefault(row.username, []).append({
                "room_id": row.id,
                "building_name": row.name,
                "room_number": row.room_number,
            })
    else:
        username_conflicts = {}

    def enrich_room(room: models.PGRoom) -> Dict[str, Any]:
        d = _room_to_dict(room)
        customer = customers.get(room.username) if room.username else None
        onu = _lookup_live_onu_for_room(
            db,
            serial_number=customer.ont_serial_number if customer else None,
            mac_address=customer.mac_address if customer else None,
        ) if customer else None

        # Age of ONU reading
        onu_stale = False
        if onu:
            age_s = (datetime.now(timezone.utc) - onu.polled_at.replace(tzinfo=timezone.utc)
                     if onu.polled_at.tzinfo is None
                     else (datetime.now(timezone.utc) - onu.polled_at)).total_seconds()
            onu_stale = age_s > 300  # > 5 min = stale

        d["customer"] = {
            "username": customer.username,
            "first_name": customer.first_name,
            "last_name": customer.last_name,
            "phone": customer.phone,
            "plan_name": customer.plan_name,
            "expiry_date": customer.expiry_date.isoformat() if customer.expiry_date else None,
            "status": customer.status,
            "balance": customer.balance,
            "mac_address": customer.mac_address,
            "olt_host": customer.olt_host,
            "pon_port": customer.pon_port,
            "geo_lat": customer.gps_lat,
            "geo_lng": customer.gps_lng,
            "rico_address": customer.rico_address,
            "railwire_address": customer.railwire_address,
            "has_survey": customer.gps_lat is not None,
        } if customer else None

        d["onu"] = {
            "status": onu.status,
            "rx_power_dbm": onu.rx_power_dbm,
            "tx_power_dbm": onu.tx_power_dbm,
            "temperature_c": onu.temperature_c,
            "dying_gasp": onu.dying_gasp,
            "signal_label": _signal_label(onu.rx_power_dbm),
            "polled_at": onu.polled_at.isoformat(),
            "stale": onu_stale,
        } if onu else None

        # Sticker OLT match — try room's own collected MAC first, then ont_serial (GPON)
        # GPON serials are stored with "SN:" prefix in onu_latest, so we try both forms.
        room_onu_match = _match_live_onu(db, mac_address=room.mac_address, ont_serial=room.ont_serial)
        room_onu = _lookup_live_onu_for_room(
            db,
            serial_number=room.ont_serial,
            mac_address=room.mac_address,
        ) if room_onu_match else None
        room_onu_match_type = room_onu_match.get("match_type") if room_onu_match else None

        d["room_onu"] = {
            "status": room_onu.status,
            "rx_power_dbm": room_onu.rx_power_dbm,
            "signal_label": _signal_label(room_onu.rx_power_dbm),
            "polled_at": room_onu.polled_at.isoformat(),
            "match_type": room_onu_match_type,          # 'mac' | 'serial'
            "matched_value": room_onu_match.get("matched_value") if room_onu_match else None,
        } if room_onu else None

        if room.username:
            d["conflict"] = next(
                (
                    f"{link['building_name']} room {link['room_number']}"
                    for link in username_conflicts.get(room.username, [])
                    if link["room_id"] != room.id
                ),
                None,
            )
        else:
            d["conflict"] = None
        return d

    floors_out = []
    for floor in building.floors:
        groups_out = [_group_to_dict(g) for g in floor.router_groups]
        rooms_out = [enrich_room(r) for r in floor.rooms]
        floors_out.append({
            "id": floor.id,
            "building_id": floor.building_id,
            "floor_number": floor.floor_number,
            "created_at": floor.created_at,
            "rooms": rooms_out,
            "router_groups": groups_out,
        })

    stats = _build_stats(building)
    result = {c.name: getattr(building, c.name) for c in building.__table__.columns}
    result.update(stats)
    result["floors"] = floors_out

    # Building-level summary
    result["online_count"]  = sum(
        1 for r in building.rooms
        if r.username and customers.get(r.username)
        and customers[r.username].mac_address
        and mac_to_onu.get(customers[r.username].mac_address, None) is not None
        and mac_to_onu[customers[r.username].mac_address].status.lower() == "online"
    )
    result["offline_count"] = sum(
        1 for r in building.rooms
        if r.username and customers.get(r.username)
        and customers[r.username].mac_address
        and mac_to_onu.get(customers[r.username].mac_address, None) is not None
        and mac_to_onu[customers[r.username].mac_address].status.lower() != "online"
    )
    result["unlinked_count"] = sum(1 for r in building.rooms if not r.username)

    return result
