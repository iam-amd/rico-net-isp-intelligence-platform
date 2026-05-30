"""
Inventory business logic — extracted from routers/inventory.py.
"""
import logging

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models, schemas

logger = logging.getLogger("rico_net.inventory")


# ------------------------------------------------------------------
# List
# ------------------------------------------------------------------

def list_inventory(db: Session, skip: int = 0, limit: int = 100):
    """List all inventory items with pagination."""
    skip = max(skip, 0)
    limit = min(max(limit, 1), 500)
    try:
        base = db.query(models.InventoryItem)
        count = base.count()
        items = base.offset(skip).limit(limit).all()
        return {"items": items, "total": count}
    except SQLAlchemyError as e:
        logger.error("Database error listing inventory: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


# ------------------------------------------------------------------
# Create
# ------------------------------------------------------------------

def create_item(db: Session, item: schemas.InventoryItemCreate, current_user: models.Technician):
    """Create a new inventory item. Admin only."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin users can create inventory items")

    db_item = db.query(models.InventoryItem).filter(
        models.InventoryItem.name == item.name
    ).first()
    if db_item:
        raise HTTPException(status_code=409, detail="Item already exists")

    new_item = models.InventoryItem(**item.model_dump())
    db.add(new_item)
    try:
        db.commit()
        db.refresh(new_item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Item already exists")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error creating inventory item %s: %s", item.name, str(e))
        raise HTTPException(status_code=500, detail="Failed to create inventory item")

    logger.info("Inventory item created: %s by %s", item.name, current_user.username)
    return new_item


# ------------------------------------------------------------------
# Get one
# ------------------------------------------------------------------

def get_item(db: Session, item_id: int):
    """Fetch a single inventory item by ID."""
    try:
        item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    except SQLAlchemyError as e:
        logger.error("Database error fetching inventory item %d: %s", item_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


# ------------------------------------------------------------------
# Update
# ------------------------------------------------------------------

def update_item(db: Session, item_id: int, item_update: schemas.InventoryItemUpdate, current_user: models.Technician):
    """Update an inventory item. Admin only."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin users can update inventory items")

    db_item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    for var, value in item_update.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(db_item, var, value)

    try:
        db.commit()
        db.refresh(db_item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An item with that name already exists")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error updating inventory item %d: %s", item_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to update inventory item")

    logger.info("Inventory item #%d updated by %s", item_id, current_user.username)
    return db_item


# ------------------------------------------------------------------
# Delete
# ------------------------------------------------------------------

def delete_item(db: Session, item_id: int, current_user: models.Technician):
    """Delete an inventory item. Admin only."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin users can delete inventory items")

    db_item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if db_item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    try:
        db.delete(db_item)
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error deleting inventory item %d: %s", item_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to delete inventory item")

    logger.info("Inventory item #%d deleted by %s", item_id, current_user.username)
    return {"ok": True}
