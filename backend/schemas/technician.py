"""Technician-related Pydantic schemas."""
import re
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field, field_validator

from schemas.common import ROLE_VALUES, _validate_email, _validate_phone_digits


class PushTokenRequest(BaseModel):
    push_token: str = Field(max_length=255)
    platform: str = Field(max_length=10)


class TechnicianCreate(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=100)
    role: ROLE_VALUES = "Field Tech"
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    specialization: str = Field(default="General", max_length=50)
    area_assigned: Optional[str] = Field(default=None, max_length=100)
    employment_type: str = Field(default="Full-Time", max_length=30)
    join_date: Optional[datetime] = None
    address: Optional[str] = Field(default=None, max_length=500)
    emergency_contact: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=5000)

    @field_validator("phone", "emergency_contact")
    def validate_phone(cls, v):
        if v is not None:
            return _validate_phone_digits(v)
        return v

    @field_validator("email")
    def validate_email(cls, v):
        if v is not None:
            return _validate_email(v)
        return v

    @field_validator("username")
    def validate_username(cls, v):
        if not re.match(r'^[a-zA-Z0-9_.-]+$', v):
            raise ValueError('Username must contain only letters, numbers, dots, hyphens, and underscores.')
        return v


class TechnicianUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=100)
    role: Optional[ROLE_VALUES] = None
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    specialization: Optional[str] = Field(default=None, max_length=50)
    area_assigned: Optional[str] = Field(default=None, max_length=100)
    employment_type: Optional[str] = Field(default=None, max_length=30)
    join_date: Optional[datetime] = None
    address: Optional[str] = Field(default=None, max_length=500)
    emergency_contact: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=5000)
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)

    @field_validator("phone", "emergency_contact")
    def validate_phone(cls, v):
        if v is not None:
            return _validate_phone_digits(v)
        return v

    @field_validator("email")
    def validate_email(cls, v):
        if v is not None:
            return _validate_email(v)
        return v


class TechnicianResponse(BaseModel):
    id: int
    username: str = Field(max_length=50)
    full_name: str = Field(max_length=100)
    role: str = Field(max_length=30)
    is_active: int
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    specialization: Optional[str] = Field(default=None, max_length=50)
    area_assigned: Optional[str] = Field(default=None, max_length=100)
    employment_type: Optional[str] = Field(default=None, max_length=30)
    join_date: Optional[datetime] = None
    address: Optional[str] = Field(default=None, max_length=500)
    emergency_contact: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=5000)
    profile_photo: Optional[str] = Field(default=None, max_length=500)
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    active_tickets: int = 0
    resolved_tickets: int = 0

    class Config:
        from_attributes = True


class TechnicianListResponse(BaseModel):
    items: List[TechnicianResponse]
    total: int


class TechnicianStats(BaseModel):
    total: int
    active: int
    inactive: int
    on_duty: int
    by_specialization: dict = {}
    by_area: dict = {}
