"""Inventory-related Pydantic schemas."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class InventoryItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = Field(default="General", max_length=50)
    quantity: int = Field(default=0, ge=0)
    unit: str = Field(default="units", max_length=30)


class InventoryItemCreate(InventoryItemBase):
    pass


class InventoryItemUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, ge=0)
    name: Optional[str] = Field(default=None, max_length=100)
    category: Optional[str] = Field(default=None, max_length=50)
    unit: Optional[str] = Field(default=None, max_length=30)


class InventoryItemResponse(InventoryItemBase):
    id: int
    last_updated: Optional[datetime] = None

    class Config:
        from_attributes = True


class InventoryListResponse(BaseModel):
    items: List[InventoryItemResponse]
    total: int
