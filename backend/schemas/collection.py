"""
Collection schemas — Operation Bridge the Gap

Field survey data collection: customer ↔ ONU binding, GPS capture,
contact enrichment, full audit trail.
"""
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Campaigns
# ---------------------------------------------------------------------------

class CampaignCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    include_all_customers: bool = True
    customer_usernames: Optional[List[str]] = None  # used when include_all=False


class CampaignResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    status: str
    target_count: int
    completed_count: int
    skipped_count: int
    pending_count: int = 0
    progress_pct: float = 0.0
    created_at: datetime
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CampaignListResponse(BaseModel):
    items: List[CampaignResponse]
    total: int


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------

class AssignmentDistributionRequest(BaseModel):
    collector_ids: List[int] = Field(..., min_length=1)
    # Round-robin across these techs


class AssignmentResponse(BaseModel):
    id: int
    campaign_id: int
    collector_id: int
    collector_name: Optional[str] = None
    customer_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    status: str
    skip_reason: Optional[str] = None
    attempts: int
    assigned_at: datetime
    completed_at: Optional[datetime] = None
    # Hints so mobile knows if the customer already has a binding
    already_has_binding: bool = False
    current_mac_address: Optional[str] = None
    # Customer geo hints (for sort by distance)
    customer_lat: Optional[float] = None
    customer_lng: Optional[float] = None

    class Config:
        from_attributes = True


class AssignmentListResponse(BaseModel):
    items: List[AssignmentResponse]
    total: int
    pending: int
    done: int
    skipped: int


# ---------------------------------------------------------------------------
# Submission (the main write)
# ---------------------------------------------------------------------------

class CollectionSubmission(BaseModel):
    """
    Simplified collector submission.

    Primary capture:  GPS + ONT sticker scan.
    Optional:         alt phones (multi), notes, install photo.

    When the ONT sticker is damaged/unreadable, submit with no onu_identifier —
    the assignment is flagged `partial` and shown to admin for follow-up.

    Backend auto-detects onu_type from the identifier format and auto-maps
    olt_host / pon_port / onu_index from the `onu_latest` live poll table.
    """
    # Required — always captured
    gps_lat: Optional[float] = Field(None, ge=-90, le=90)
    gps_lng: Optional[float] = Field(None, ge=-180, le=180)
    gps_accuracy_m: Optional[float] = Field(None, ge=0, le=10000)

    # Optional — ONT sticker (missing = partial submission)
    onu_identifier: Optional[str] = Field(None, max_length=64)
    ont_serial_number: Optional[str] = Field(None, max_length=64)
    ont_mac_address: Optional[str] = Field(None, max_length=64)
    ont_model: Optional[str] = Field(None, max_length=64)
    device_setup: Optional[str] = Field(None, max_length=20)
    sticker_photo_url: Optional[str] = None
    ont_sticker_data: Optional[dict[str, Any]] = None
    router_sticker_photo_url: Optional[str] = None
    router_mac_address: Optional[str] = Field(None, max_length=64)
    router_model: Optional[str] = Field(None, max_length=64)
    router_serial: Optional[str] = Field(None, max_length=64)
    router_sticker_data: Optional[dict[str, Any]] = None

    # Optional contact enrichment
    alt_phones: Optional[List[str]] = None  # multiple alt phones (caller-ID hints)
    notes: Optional[str] = None

    @field_validator("onu_identifier")
    @classmethod
    def _onu_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().upper()
        return v or None


class SubmissionResponse(BaseModel):
    status: str  # ok | duplicate | conflict | error
    assignment_id: int
    binding_id: Optional[int] = None
    message: str
    duplicate_of: Optional[str] = None  # customer_id if this SN already bound elsewhere
    warnings: List[str] = []


class SkipRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=60)
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Admin monitoring — progress, issues, logs
# ---------------------------------------------------------------------------

class CollectorStats(BaseModel):
    collector_id: int
    collector_name: Optional[str] = None
    assigned: int
    done: int
    skipped: int
    pending: int
    avg_minutes_per_record: Optional[float] = None
    last_activity_at: Optional[datetime] = None


class CampaignProgress(BaseModel):
    campaign: CampaignResponse
    collectors: List[CollectorStats]
    recent_activity: List["LogEntry"]
    issue_count: int
    duplicate_count: int


class LogEntry(BaseModel):
    id: int
    campaign_id: Optional[int] = None
    assignment_id: Optional[int] = None
    customer_id: Optional[str] = None
    collector_id: Optional[int] = None
    collector_name: Optional[str] = None
    action: str
    message: Optional[str] = None
    payload: Optional[Any] = None
    created_at: datetime

    class Config:
        from_attributes = True


class IssueItem(BaseModel):
    """A submission that needs admin attention."""
    assignment_id: int
    customer_id: str
    customer_name: Optional[str] = None
    collector_id: Optional[int] = None
    collector_name: Optional[str] = None
    issue_type: str  # low_confidence | duplicate_identifier | low_gps_accuracy | olt_mismatch | missing_data
    detail: str
    onu_identifier: Optional[str] = None
    gps_accuracy_m: Optional[float] = None
    created_at: datetime


class IssueListResponse(BaseModel):
    items: List[IssueItem]
    total: int


class AdminCorrectionRequest(BaseModel):
    """Admin manually corrects/overrides a binding."""
    onu_identifier: Optional[str] = None
    onu_type: Optional[str] = None
    olt_host: Optional[str] = None
    pon_port: Optional[str] = None
    confidence: Optional[str] = None  # verified | probable | guess
    notes: Optional[str] = None


class DuplicateItem(BaseModel):
    onu_identifier: str
    onu_type: str
    customer_ids: List[str]
    count: int


class DuplicateListResponse(BaseModel):
    items: List[DuplicateItem]
    total: int


# ---------------------------------------------------------------------------
# Street-walking survey flow (search-first)
# ---------------------------------------------------------------------------

class SurveyCustomerRow(BaseModel):
    username: str
    item_type: str = "customer"  # customer | pg_building
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    railwire_address: Optional[str] = None
    rico_address: Optional[str] = None
    survey_status: str  # pending | done | partial | skipped | needs_review | surveyed
    skip_reason: Optional[str] = None
    collector_id: Optional[int] = None
    collector_name: Optional[str] = None
    completed_at: Optional[datetime] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    gps_confirmed: bool = False
    has_binding: bool = False
    last_surveyed_at: Optional[datetime] = None
    mac_address: Optional[str] = None
    customer_mac_address: Optional[str] = None
    onu_identifier: Optional[str] = None
    onu_type: Optional[str] = None
    binding_confidence: Optional[str] = None
    binding_source: Optional[str] = None
    review_warnings: List[str] = []
    review_detail: Optional[str] = None
    ont_serial_number: Optional[str] = None
    ont_model: Optional[str] = None
    device_setup: Optional[str] = None
    sticker_photo_url: Optional[str] = None
    router_sticker_photo_url: Optional[str] = None
    router_mac_address: Optional[str] = None
    router_model: Optional[str] = None
    router_serial: Optional[str] = None
    wifi_ssid: Optional[str] = None
    wifi_ssid_5g: Optional[str] = None
    wifi_password: Optional[str] = None
    distance_m: Optional[float] = None  # distance from caller's GPS, when provided
    pg_id: Optional[int] = None
    pg_name: Optional[str] = None
    building_id: Optional[str] = None
    building_name: Optional[str] = None
    building_type: Optional[str] = None
    floor_count: Optional[int] = None
    room_count: Optional[int] = None
    customer_count: Optional[int] = None


class SurveySummary(BaseModel):
    done: int = 0
    partial: int = 0
    skipped: int = 0
    needs_review: int = 0
    pending: int = 0
    bound: int = 0
    unlinked: int = 0


class SurveySearchResponse(BaseModel):
    items: List[SurveyCustomerRow]
    total: int
    summary: Optional[SurveySummary] = None


class SurveyMapResponse(BaseModel):
    items: List[SurveyCustomerRow]
    total: int


class SurveyTechStats(BaseModel):
    tech_id: int
    name: Optional[str] = None
    done: int = 0
    partial: int = 0
    skipped: int = 0
    needs_review: int = 0
    last_activity: Optional[datetime] = None


class SurveyLiveProgress(BaseModel):
    total_customers: int
    surveyed_customers: int
    with_gps: int
    pending: int
    by_status: dict[str, int]
    techs: List[SurveyTechStats]


class CustomerSubmitBody(BaseModel):
    gps_lat: Optional[float] = Field(None, ge=-90, le=90)
    gps_lng: Optional[float] = Field(None, ge=-180, le=180)
    gps_accuracy_m: Optional[float] = Field(None, ge=0, le=10000)
    onu_identifier: Optional[str] = Field(None, max_length=64)
    ont_serial_number: Optional[str] = Field(None, max_length=64)
    ont_mac_address: Optional[str] = Field(None, max_length=64)
    ont_model: Optional[str] = Field(None, max_length=64)
    device_setup: Optional[str] = Field(None, max_length=20)
    sticker_photo_url: Optional[str] = None
    ont_sticker_data: Optional[dict[str, Any]] = None
    router_sticker_photo_url: Optional[str] = None
    router_mac_address: Optional[str] = Field(None, max_length=64)
    router_model: Optional[str] = Field(None, max_length=64)
    router_serial: Optional[str] = Field(None, max_length=64)
    router_sticker_data: Optional[dict[str, Any]] = None
    wifi_ssid: Optional[str] = Field(None, max_length=64)
    wifi_password: Optional[str] = Field(None, max_length=64)
    alt_phones: Optional[List[str]] = None
    notes: Optional[str] = None


class CustomerSkipBody(BaseModel):
    reason: str = Field(..., description="not_home | refused | locked | wrong_address | other")
    notes: Optional[str] = None

    @field_validator("reason")
    @classmethod
    def _validate_reason(cls, v: str) -> str:
        allowed = {"not_home", "refused", "locked", "wrong_address", "other"}
        if v not in allowed:
            raise ValueError(f"reason must be one of: {sorted(allowed)}")
        return v


# Resolve forward references
CampaignProgress.model_rebuild()
