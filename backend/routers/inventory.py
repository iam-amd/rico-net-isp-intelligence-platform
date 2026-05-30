"""
Rico Net CMS -- Inventory Router
==================================
Thin HTTP wrapper — all business logic lives in services/inventory_service.py.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models, schemas
from database import get_db
from middleware.auth import get_current_user
from services import inventory_service

router = APIRouter(
    prefix="/inventory",
    tags=["inventory"],
)


# 1. LIST ALL ITEMS
@router.get("/", response_model=schemas.InventoryListResponse)
def read_inventory(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return inventory_service.list_inventory(db, skip=skip, limit=limit)


# 2. CREATE ITEM
@router.post("/", response_model=schemas.InventoryItemResponse)
def create_item(
    item: schemas.InventoryItemCreate,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return inventory_service.create_item(db, item, current_user)


# 3. GET ONE ITEM
@router.get("/{id}", response_model=schemas.InventoryItemResponse)
def read_item(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return inventory_service.get_item(db, id)


# 4. UPDATE ITEM
@router.put("/{id}", response_model=schemas.InventoryItemResponse)
def update_item(
    id: int,
    item_update: schemas.InventoryItemUpdate,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return inventory_service.update_item(db, id, item_update, current_user)


# 5. DELETE ITEM
@router.delete("/{id}")
def delete_item(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return inventory_service.delete_item(db, id, current_user)
