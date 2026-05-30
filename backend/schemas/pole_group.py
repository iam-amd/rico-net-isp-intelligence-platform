"""
Pole Group schemas — physical fiber split group management.
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class PoleGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: Optional[str] = None
    area: Optional[str] = Field(None, max_length=80)


class PoleGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = None
    area: Optional[str] = Field(None, max_length=80)


class PoleGroupResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    area: Optional[str] = None
    customer_count: int = 0
    surveyed_count: int = 0
    bound_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PoleGroupListResponse(BaseModel):
    items: List[PoleGroupResponse]
    total: int


class PoleGroupCustomer(BaseModel):
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    rico_address: Optional[str] = None
    has_binding: bool = False
    last_surveyed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PoleGroupDetail(PoleGroupResponse):
    customers: List[PoleGroupCustomer] = []


class BulkUsernameRequest(BaseModel):
    """Paste-based bulk add. Accepts newline, comma, or space separated."""
    usernames: List[str] = Field(..., min_length=1)


class BulkActionResponse(BaseModel):
    added: int = 0
    removed: int = 0
    not_found: List[str] = []
    already_in_group: List[str] = []
    moved_from_other_group: List[str] = []
