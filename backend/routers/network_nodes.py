"""
Rico Net CMS -- Network Node and Outage management router.
Thin HTTP wrapper — all business logic lives in services/network_node_service.py.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import database, models
from middleware.auth import get_current_user
from services import network_node_service
from services.network_node_service import NetworkNodeCreate, NetworkNodeUpdate, NodeOutageCreate

router = APIRouter(prefix="/network-nodes", tags=["Network Nodes"])


# =============================================================================
# NETWORK NODES CRUD
# =============================================================================

@router.get("/")
def list_nodes(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """List all network nodes with their current outage count."""
    return network_node_service.list_nodes(db)


@router.post("/", status_code=201)
def create_node(
    data: NetworkNodeCreate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Create a new network node. Admin only."""
    return network_node_service.create_node(db, data, current_user)


@router.put("/{node_id}")
def update_node(
    node_id: int,
    data: NetworkNodeUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Update node details or toggle operational status."""
    return network_node_service.update_node(db, node_id, data, current_user)


@router.delete("/{node_id}")
def delete_node(
    node_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Delete a node and all its outage records."""
    return network_node_service.delete_node(db, node_id, current_user)


# =============================================================================
# OUTAGE MANAGEMENT
# =============================================================================

@router.get("/{node_id}/outages")
def list_outages(
    node_id: int,
    active_only: bool = False,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """List outages for a specific node."""
    return network_node_service.list_outages(db, node_id, active_only=active_only)


@router.post("/{node_id}/outages", status_code=201)
def report_outage(
    node_id: int,
    data: NodeOutageCreate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Report a new outage on a node. Also marks the node as non-operational."""
    return network_node_service.report_outage(db, node_id, data, current_user)


@router.put("/{node_id}/outages/{outage_id}/resolve")
def resolve_outage(
    node_id: int,
    outage_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """Resolve an active outage. If no active outages remain, node is marked operational again."""
    return network_node_service.resolve_outage(db, node_id, outage_id, current_user)
