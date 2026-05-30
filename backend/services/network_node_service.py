"""
Network Node & Outage business logic — extracted from routers/network_nodes.py.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("rico_net.network_nodes")


# =============================================================================
# SCHEMAS (local — with input validation)
# =============================================================================

class NetworkNodeCreate(BaseModel):
    node_name: str = Field(min_length=1, max_length=50)
    area: Optional[str] = Field(default=None, max_length=100)
    node_type: str = Field(default="pole", max_length=30)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    is_operational: bool = True


class NetworkNodeUpdate(BaseModel):
    area: Optional[str] = Field(default=None, max_length=100)
    node_type: Optional[str] = Field(default=None, max_length=30)
    geo_lat: Optional[float] = None
    geo_long: Optional[float] = None
    is_operational: Optional[bool] = None


class NodeOutageCreate(BaseModel):
    outage_type: str = Field(default="unknown", max_length=50)
    description: Optional[str] = Field(default=None, max_length=2000)


# =============================================================================
# NETWORK NODES CRUD
# =============================================================================

def list_nodes(db: Session):
    """List all network nodes with their current outage count."""
    try:
        nodes = db.query(models.NetworkNode).order_by(models.NetworkNode.node_name).all()
        result = []
        for node in nodes:
            active_outages = sum(1 for o in node.outages if o.is_active)
            result.append(
                {
                    "id": node.id,
                    "node_name": node.node_name,
                    "area": node.area,
                    "node_type": node.node_type,
                    "geo_lat": node.geo_lat,
                    "geo_long": node.geo_long,
                    "is_operational": node.is_operational,
                    "active_outages": active_outages,
                    "created_at": node.created_at,
                }
            )
        return {"items": result, "total": len(result)}
    except SQLAlchemyError as e:
        logger.error("Database error listing network nodes: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def create_node(db: Session, data: NetworkNodeCreate, current_user: models.Technician):
    """Create a new network node. Admin only."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can create network nodes")

    existing = db.query(models.NetworkNode).filter(
        models.NetworkNode.node_name == data.node_name
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Node '{data.node_name}' already exists")

    node = models.NetworkNode(**data.model_dump())
    db.add(node)
    try:
        db.commit()
        db.refresh(node)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Node '{data.node_name}' already exists")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error creating node %s: %s", data.node_name, str(e))
        raise HTTPException(status_code=500, detail="Failed to create network node")

    logger.info("Network node created: %s by %s", data.node_name, current_user.username)
    return node


def update_node(db: Session, node_id: int, data: NetworkNodeUpdate, current_user: models.Technician):
    """Update node details or toggle operational status."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can update network nodes")

    node = db.query(models.NetworkNode).filter(models.NetworkNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(node, field, value)

    try:
        db.commit()
        db.refresh(node)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error updating node %d: %s", node_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to update network node")

    logger.info("Network node #%d updated by %s", node_id, current_user.username)
    return node


def delete_node(db: Session, node_id: int, current_user: models.Technician):
    """Delete a node and all its outage records."""
    if current_user.role != "Admin":
        raise HTTPException(status_code=403, detail="Only Admin can delete network nodes")

    node = db.query(models.NetworkNode).filter(models.NetworkNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        db.delete(node)
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error deleting node %d: %s", node_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to delete network node")

    logger.info("Network node #%d deleted by %s", node_id, current_user.username)
    return {"ok": True}


# =============================================================================
# OUTAGE MANAGEMENT
# =============================================================================

def list_outages(db: Session, node_id: int, active_only: bool = False):
    """List outages for a specific node."""
    node = db.query(models.NetworkNode).filter(models.NetworkNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        outages = node.outages
        if active_only:
            outages = [o for o in outages if o.is_active]
        return {"items": outages, "total": len(outages)}
    except SQLAlchemyError as e:
        logger.error("Database error listing outages for node %d: %s", node_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def report_outage(db: Session, node_id: int, data: NodeOutageCreate, current_user: models.Technician):
    """Report a new outage on a node. Also marks the node as non-operational."""
    node = db.query(models.NetworkNode).filter(models.NetworkNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    outage = models.NodeOutage(
        node_id=node_id,
        outage_type=data.outage_type,
        description=data.description,
        is_active=True,
        reported_by=current_user.id,
    )
    node.is_operational = False
    db.add(outage)
    try:
        db.commit()
        db.refresh(outage)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error reporting outage for node %d: %s", node_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to report outage")

    logger.info(
        "Outage reported on node #%d (%s) by %s: %s",
        node_id,
        node.node_name,
        current_user.username,
        data.outage_type,
    )
    return outage


def resolve_outage(db: Session, node_id: int, outage_id: int, current_user: models.Technician):
    """Resolve an active outage. If no active outages remain, node is marked operational again."""
    outage = db.query(models.NodeOutage).filter(
        models.NodeOutage.id == outage_id,
        models.NodeOutage.node_id == node_id,
    ).first()
    if not outage:
        raise HTTPException(status_code=404, detail="Outage not found")
    if not outage.is_active:
        raise HTTPException(status_code=400, detail="Outage is already resolved")

    outage.is_active = False
    outage.resolved_at = datetime.now(timezone.utc)

    # Auto-restore node operational status if no active outages remain
    remaining_active = db.query(models.NodeOutage).filter(
        models.NodeOutage.node_id == node_id,
        models.NodeOutage.is_active == True,
        models.NodeOutage.id != outage_id,
    ).count()

    if remaining_active == 0:
        node = db.query(models.NetworkNode).filter(models.NetworkNode.id == node_id).first()
        if node:
            node.is_operational = True

    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error resolving outage #%d: %s", outage_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to resolve outage")

    logger.info(
        "Outage #%d on node #%d resolved by %s",
        outage_id,
        node_id,
        current_user.username,
    )
    return {"ok": True, "message": "Outage resolved"}
