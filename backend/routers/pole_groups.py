"""
Pole Group router — admin-only endpoints.

Pole groups are physical fiber split groups. Admin manages them explicitly
(there are ~500 in the field, each with 20-40 customers).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import database
import models
from middleware.auth import require_admin
from schemas.pole_group import (
    BulkActionResponse,
    BulkUsernameRequest,
    PoleGroupCreate,
    PoleGroupDetail,
    PoleGroupListResponse,
    PoleGroupResponse,
    PoleGroupUpdate,
)
from services import pole_group_service

logger = logging.getLogger("rico_net.pole_group_router")

router = APIRouter(prefix="/pole-groups", tags=["Pole Groups"])


@router.get("", response_model=PoleGroupListResponse)
def list_groups(
    search: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    items = pole_group_service.list_pole_groups(db, search=search)
    return {"items": items, "total": len(items)}


@router.post("", response_model=PoleGroupResponse)
def create_group(
    body: PoleGroupCreate,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    try:
        pg = pole_group_service.create_pole_group(
            db,
            name=body.name,
            description=body.description,
            area=body.area,
            created_by=admin.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "id": pg.id,
        "name": pg.name,
        "description": pg.description,
        "area": pg.area,
        "customer_count": 0,
        "surveyed_count": 0,
        "bound_count": 0,
        "created_at": pg.created_at,
        "updated_at": pg.updated_at,
    }


@router.get("/{pg_id}", response_model=PoleGroupDetail)
def get_group(
    pg_id: int,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    try:
        return pole_group_service.get_pole_group_detail(db, pg_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/{pg_id}", response_model=PoleGroupResponse)
def update_group(
    pg_id: int,
    body: PoleGroupUpdate,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    try:
        pg = pole_group_service.update_pole_group(
            db,
            pg_id,
            name=body.name,
            description=body.description,
            area=body.area,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Re-fetch detail for counts
    return pole_group_service.list_pole_groups(db, search=pg.name)[0]


@router.delete("/{pg_id}")
def delete_group(
    pg_id: int,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    try:
        pole_group_service.delete_pole_group(db, pg_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"status": "ok", "message": "Pole group deleted"}


@router.post("/{pg_id}/add-customers", response_model=BulkActionResponse)
def add_customers(
    pg_id: int,
    body: BulkUsernameRequest,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    try:
        result = pole_group_service.add_customers_to_group(db, pg_id, body.usernames)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return result


@router.post("/{pg_id}/remove-customers", response_model=BulkActionResponse)
def remove_customers(
    pg_id: int,
    body: BulkUsernameRequest,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    try:
        result = pole_group_service.remove_customers_from_group(db, pg_id, body.usernames)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return result
