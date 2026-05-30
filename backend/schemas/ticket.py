"""Ticket-related Pydantic schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from schemas.customer import CustomerSummary, TicketSummary


class TicketBase(BaseModel):
    issue_type: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=5000)
    priority: str = Field(default="Normal", max_length=30)
    sub_issue: Optional[str] = Field(default=None, max_length=200)
    tags: Optional[str] = Field(default=None, max_length=500)
    internal_notes: Optional[str] = Field(default=None, max_length=5000)
    materials_used: Optional[str] = Field(default=None, max_length=2000)


class TicketCreate(TicketBase):
    customer_id: str = Field(min_length=1, max_length=50)


class TicketUpdate(BaseModel):
    status: Optional[str] = Field(default=None, max_length=30)
    assigned_tech: Optional[str] = Field(default=None, max_length=50)
    description: Optional[str] = Field(default=None, max_length=5000)
    priority: Optional[str] = Field(default=None, max_length=30)
    sub_issue: Optional[str] = Field(default=None, max_length=200)
    tags: Optional[str] = Field(default=None, max_length=500)
    internal_notes: Optional[str] = Field(default=None, max_length=5000)
    materials_used: Optional[str] = Field(default=None, max_length=2000)
    issue_type: Optional[str] = Field(default=None, max_length=100)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None


class TicketCommentCreate(BaseModel):
    author: str = Field(default="", max_length=50)
    content: str = Field(min_length=1, max_length=5000)
    is_internal: int = 0


class TicketCommentResponse(BaseModel):
    id: int
    author: str = Field(max_length=50)
    content: str = Field(max_length=5000)
    is_internal: int
    created_at: datetime

    class Config:
        from_attributes = True


class TicketMediaResponse(BaseModel):
    id: int
    file_type: str = Field(max_length=100)
    file_path: str = Field(max_length=500)
    filename: str = Field(max_length=255)
    uploaded_at: datetime

    class Config:
        from_attributes = True


class TicketAuditLogResponse(BaseModel):
    id: int
    action: str = Field(max_length=50)
    field_name: Optional[str] = Field(default=None, max_length=50)
    old_value: Optional[str] = Field(default=None, max_length=5000)
    new_value: Optional[str] = Field(default=None, max_length=5000)
    changed_by: Optional[int] = None
    changed_at: datetime

    class Config:
        from_attributes = True


class TicketResponse(TicketBase):
    id: int
    status: str = Field(max_length=30)
    created_at: datetime
    customer_id: str = Field(max_length=50)
    assigned_tech: Optional[str] = Field(default=None, max_length=50)
    comments: List[TicketCommentResponse] = []
    media: List[TicketMediaResponse] = []
    audit_log: List[TicketAuditLogResponse] = []
    assigned_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    resolution_remarks: Optional[str] = Field(default=None, max_length=5000)
    customer: Optional[CustomerSummary] = None

    class Config:
        from_attributes = True


class TicketListResponse(BaseModel):
    items: List[TicketResponse]
    total: int


class EnrichmentData(BaseModel):
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    corrected_address: Optional[str] = Field(default=None, max_length=500)
    wifi_ssid: Optional[str] = Field(default=None, max_length=100)
    wifi_password: Optional[str] = Field(default=None, max_length=100)


class TicketCompleteRequest(BaseModel):
    resolution_remarks: str = Field(min_length=1, max_length=5000)
    materials_used: Optional[str] = Field(default=None, max_length=2000)
    enrichment: EnrichmentData


class TicketCompleteResponse(BaseModel):
    ticket: TicketResponse
    enrichment_applied: bool
    enriched_fields: List[str] = []

    class Config:
        from_attributes = True
