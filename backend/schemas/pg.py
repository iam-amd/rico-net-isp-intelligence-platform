"""PG (Paying Guest) Pydantic schemas."""
from datetime import datetime
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, Field


PGType = Literal['Ladies', 'Gents', 'Mixed']
RoomStatus = Literal['pending', 'done', 'vacant', 'flagged', 'shared']
ConnectionType = Literal['individual', 'router_group', 'linked_room', 'none']
DeviceSetup = Literal['single_ont', 'onu_router']


# ── RouterGroup ───────────────────────────────────────────────────────────────

class RouterGroupBase(BaseModel):
    group_name: str = Field(max_length=100)
    ont_serial: Optional[str] = Field(default=None, max_length=64)
    mac_address: Optional[str] = Field(default=None, max_length=17)
    username: Optional[str] = Field(default=None, max_length=50)
    photo_url: Optional[str] = Field(default=None, max_length=500)


class RouterGroupCreate(RouterGroupBase):
    id: str = Field(max_length=36)
    floor_id: str = Field(max_length=36)
    building_id: str = Field(max_length=36)


class RouterGroupUpdate(RouterGroupBase):
    pass


class RouterGroupResponse(RouterGroupBase):
    id: str
    floor_id: str
    building_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Room ──────────────────────────────────────────────────────────────────────

class RoomBase(BaseModel):
    room_number: str = Field(max_length=20)
    status: RoomStatus = 'pending'
    connection_type: ConnectionType = 'none'
    device_setup: Optional[DeviceSetup] = None
    username: Optional[str] = Field(default=None, max_length=50)
    ont_serial: Optional[str] = Field(default=None, max_length=64)
    mac_address: Optional[str] = Field(default=None, max_length=32)
    ont_model: Optional[str] = Field(default=None, max_length=64)
    ont_sticker_photo_url: Optional[str] = Field(default=None, max_length=500)
    ont_sticker_data: Optional[dict[str, Any]] = None
    router_sticker_photo_url: Optional[str] = Field(default=None, max_length=500)
    router_mac_address: Optional[str] = Field(default=None, max_length=32)
    router_serial: Optional[str] = Field(default=None, max_length=64)
    router_model: Optional[str] = Field(default=None, max_length=64)
    router_sticker_data: Optional[dict[str, Any]] = None
    wifi_ssid: Optional[str] = Field(default=None, max_length=100)
    wifi_ssid_5g: Optional[str] = Field(default=None, max_length=100)
    wifi_password: Optional[str] = Field(default=None, max_length=100)
    scan_history: Optional[List[dict]] = None
    tech_note: Optional[str] = None
    photo_urls: Optional[List[str]] = None
    collected_at: Optional[datetime] = None
    router_group_id: Optional[str] = Field(default=None, max_length=36)


class RoomCreate(RoomBase):
    id: str = Field(max_length=36)
    floor_id: str = Field(max_length=36)
    building_id: str = Field(max_length=36)
    change_reason: Optional[str] = Field(default=None, max_length=500)


class RoomUpdate(RoomBase):
    change_reason: Optional[str] = Field(default=None, max_length=500)


class RoomResponse(RoomBase):
    id: str
    floor_id: str
    building_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Floor ─────────────────────────────────────────────────────────────────────

class FloorCreate(BaseModel):
    id: str = Field(max_length=36)
    building_id: str = Field(max_length=36)
    floor_number: int


class FloorResponse(BaseModel):
    id: str
    building_id: str
    floor_number: int
    rooms: List[RoomResponse] = []
    router_groups: List[RouterGroupResponse] = []
    created_at: datetime

    class Config:
        from_attributes = True


# ── Building ──────────────────────────────────────────────────────────────────

class BuildingBase(BaseModel):
    name: str = Field(max_length=200)
    pg_type: PGType = 'Mixed'
    address: Optional[str] = None
    owner_name: Optional[str] = Field(default=None, max_length=120)
    owner_mobile: Optional[str] = Field(default=None, max_length=20)
    owner_alt_mobile: Optional[str] = Field(default=None, max_length=20)
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    photo_url: Optional[str] = Field(default=None, max_length=500)


class BuildingCreate(BuildingBase):
    id: str = Field(max_length=36)
    change_reason: Optional[str] = Field(default=None, max_length=500)


class BuildingUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    pg_type: Optional[PGType] = None
    address: Optional[str] = None
    owner_name: Optional[str] = Field(default=None, max_length=120)
    owner_mobile: Optional[str] = Field(default=None, max_length=20)
    owner_alt_mobile: Optional[str] = Field(default=None, max_length=20)
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    photo_url: Optional[str] = Field(default=None, max_length=500)
    change_reason: Optional[str] = Field(default=None, max_length=500)


class BuildingResponse(BuildingBase):
    id: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    total_floors: int = 0
    total_rooms: int = 0
    done_rooms: int = 0
    pending_rooms: int = 0

    class Config:
        from_attributes = True


class BuildingDetail(BuildingResponse):
    floors: List[FloorResponse] = []


# ── Bulk Sync (mobile pushes full state on reconnect) ────────────────────────

class SyncPayload(BaseModel):
    buildings: List[BuildingCreate] = []
    floors: List[FloorCreate] = []
    rooms: List[RoomCreate] = []
    router_groups: List[RouterGroupCreate] = []


class SyncResponse(BaseModel):
    upserted_buildings: int = 0
    upserted_floors: int = 0
    upserted_rooms: int = 0
    upserted_groups: int = 0
    review_required: int = 0
    errors: List[str] = []


class RoomLinkConflict(BaseModel):
    conflict_type: str
    message: str
    room_id: Optional[str] = None
    building_id: Optional[str] = None
    building_name: Optional[str] = None
    floor_number: Optional[int] = None
    room_number: Optional[str] = None
    username: Optional[str] = None
    mac_address: Optional[str] = None
    ont_serial: Optional[str] = None


class RoomConflictResponse(BaseModel):
    conflicts: List[RoomLinkConflict] = []
    can_override: bool = True
    live_onu: Optional[dict] = None


class RoomConflictResolveRequest(BaseModel):
    username: Optional[str] = Field(default=None, max_length=50)
    mac_address: Optional[str] = Field(default=None, max_length=32)
    ont_serial: Optional[str] = Field(default=None, max_length=64)
    reason: str = Field(min_length=3, max_length=500)


class RoomExistingPhotoOCRRequest(BaseModel):
    photo_url: str = Field(min_length=1, max_length=500)
    sticker_type: Optional[Literal["ont", "router"]] = None


class PGChangeEventResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: str
    building_id: Optional[str] = None
    room_id: Optional[str] = None
    action: str
    reason: Optional[str] = None
    changed_by: Optional[str] = None
    before_data: Optional[dict[str, Any]] = None
    after_data: Optional[dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True
