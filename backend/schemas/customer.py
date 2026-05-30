"""Customer-related Pydantic schemas."""
import re
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from schemas.common import _validate_email, _validate_phone_digits


class CustomerPhoneResponse(BaseModel):
    id: int
    phone_number: str = Field(max_length=20)
    label: str = Field(max_length=50)
    is_primary: bool
    created_at: datetime

    class Config:
        from_attributes = True


class CustomerPhoneCreate(BaseModel):
    phone_number: str = Field(max_length=20)
    label: str = Field(default="Self", max_length=50)
    is_primary: bool = False

    @field_validator("phone_number")
    def validate_phone(cls, v):
        return _validate_phone_digits(v)


class TicketSummary(BaseModel):
    """Lightweight ticket info embedded in customer responses."""
    id: int
    issue_type: str = Field(max_length=100)
    status: str = Field(max_length=30)
    created_at: datetime
    description: Optional[str] = Field(default=None, max_length=5000)

    class Config:
        from_attributes = True


class CustomerSummary(BaseModel):
    username: str = Field(max_length=50)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=20)
    railwire_address: Optional[str] = Field(default=None, max_length=500)
    rico_address: Optional[str] = Field(default=None, max_length=500)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    mac_address: Optional[str] = Field(default=None, max_length=17)
    olt_host: Optional[str] = Field(default=None, max_length=45)
    pon_port: Optional[str] = Field(default=None, max_length=20)
    pg_id: Optional[int] = None
    pg_name: Optional[str] = None
    phones: List[CustomerPhoneResponse] = []

    class Config:
        from_attributes = True


class CustomerResponse(BaseModel):
    id: Optional[int] = None
    username: str = Field(max_length=50)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = Field(default=None, max_length=5000)
    railwire_address: Optional[str] = Field(default=None, max_length=500)
    plan_name: Optional[str] = Field(default=None, max_length=100)
    expiry_date: Optional[datetime] = None
    status: Optional[str] = Field(default=None, max_length=30)
    balance: float = 0.0
    rico_address: Optional[str] = Field(default=None, max_length=500)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    pole_id: Optional[str] = Field(default=None, max_length=50)
    splitter_id: Optional[str] = Field(default=None, max_length=50)
    wifi_ssid: Optional[str] = Field(default=None, max_length=100)
    wifi_ssid_5g: Optional[str] = Field(default=None, max_length=100)
    wifi_password: Optional[str] = Field(default=None, max_length=100)
    # ONU / Device fields (from survey collection)
    mac_address: Optional[str] = Field(default=None, max_length=50)
    olt_host: Optional[str] = Field(default=None, max_length=45)
    pon_port: Optional[str] = Field(default=None, max_length=20)
    onu_index: Optional[int] = None
    device_setup: Optional[str] = Field(default=None, max_length=20)
    ont_model: Optional[str] = Field(default=None, max_length=64)
    ont_serial_number: Optional[str] = Field(default=None, max_length=64)
    ont_sticker_data: Optional[dict] = None
    router_mac_address: Optional[str] = Field(default=None, max_length=64)
    router_model: Optional[str] = Field(default=None, max_length=64)
    router_serial: Optional[str] = Field(default=None, max_length=64)
    router_sticker_data: Optional[dict] = None
    install_photo_url: Optional[str] = None
    sticker_photo_url: Optional[str] = None
    router_sticker_photo_url: Optional[str] = None
    last_surveyed_at: Optional[datetime] = None
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None
    gps_accuracy_m: Optional[float] = None
    pg_id: Optional[int] = None
    pg_name: Optional[str] = None
    tickets: List[TicketSummary] = []
    phones: List[CustomerPhoneResponse] = []
    connection_status: Optional[str] = Field(default="unknown", max_length=20)
    last_seen_online: Optional[datetime] = None
    created_at: Optional[datetime] = None
    last_updated: Optional[datetime] = None
    last_enriched_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerListResponse(BaseModel):
    items: List[CustomerResponse]
    total: int


class CustomerStats(BaseModel):
    total_customers: int
    active_customers: int
    inactive_customers: int
    total_outstanding: float
    overdue_count: int = 0
    expiring_today_count: int = 0
    in_draft: int = 0
    projects: int = 0


class CustomerCreate(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    phone: str = Field(max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    railwire_address: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=5000)
    plan_name: str = Field(default="Basic", max_length=100)
    expiry_date: Optional[datetime] = None
    status: str = Field(default="Active", max_length=30)
    balance: float = 0.0
    rico_address: Optional[str] = Field(default=None, max_length=500)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    pole_id: Optional[str] = Field(default=None, max_length=50)
    wifi_ssid: Optional[str] = Field(default=None, max_length=100)
    wifi_password: Optional[str] = Field(default=None, max_length=100)

    @field_validator('phone')
    def validate_phone(cls, v):
        return _validate_phone_digits(v)

    @field_validator('email')
    def validate_email(cls, v):
        if v is not None:
            return _validate_email(v)
        return v

    @field_validator('username')
    def validate_username(cls, v):
        if not re.match(r'^[a-zA-Z0-9_.-]+$', v):
            raise ValueError('Username must contain only letters, numbers, dots, hyphens, and underscores.')
        return v


class ConnectionStatusUpdate(BaseModel):
    status: Literal["online", "offline", "intermittent"]
    last_seen: Optional[datetime] = None


class CustomerUpdate(BaseModel):
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = Field(default=None, max_length=5000)
    rico_address: Optional[str] = Field(default=None, max_length=500)
    pole_id: Optional[str] = Field(default=None, max_length=50)
    splitter_id: Optional[str] = Field(default=None, max_length=50)
    wifi_ssid: Optional[str] = Field(default=None, max_length=100)
    wifi_ssid_5g: Optional[str] = Field(default=None, max_length=100)
    wifi_password: Optional[str] = Field(default=None, max_length=100)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    # ONU / Device fields — admin can correct these
    mac_address: Optional[str] = Field(default=None, max_length=50)
    olt_host: Optional[str] = Field(default=None, max_length=45)
    pon_port: Optional[str] = Field(default=None, max_length=20)
    device_setup: Optional[str] = Field(default=None, max_length=20)
    ont_model: Optional[str] = Field(default=None, max_length=64)
    ont_serial_number: Optional[str] = Field(default=None, max_length=64)
    ont_sticker_data: Optional[dict] = None
    router_mac_address: Optional[str] = Field(default=None, max_length=64)
    router_model: Optional[str] = Field(default=None, max_length=64)
    router_serial: Optional[str] = Field(default=None, max_length=64)
    router_sticker_data: Optional[dict] = None
    last_surveyed_at: Optional[datetime] = None
    change_reason: str = Field(default="General Update", max_length=200)

    @field_validator('phone')
    def validate_phone(cls, v):
        if v is not None:
            return _validate_phone_digits(v)
        return v

    @field_validator('email')
    def validate_email(cls, v):
        if v is not None:
            return _validate_email(v)
        return v
