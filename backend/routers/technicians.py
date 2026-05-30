"""
Technician Management Router (thin wrapper)
=============================================
All business logic lives in services/technician_service.py.
"""
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

import database
import models
import schemas
from middleware.auth import get_current_user
from services import technician_service

router = APIRouter(tags=["Technicians"])


@router.get("/technicians/stats", response_model=schemas.TechnicianStats)
def get_technician_stats(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.get_stats(db)


@router.get("/technicians/workload")
def get_workload_overview(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.get_workload(db)


@router.get("/technicians/", response_model=schemas.TechnicianListResponse)
def list_technicians(
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    specialization: Optional[str] = None,
    area: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.list_technicians(
        db, q=q, status_filter=status_filter, specialization=specialization,
        area=area, skip=skip, limit=limit,
    )


@router.get("/technicians/{tech_id}", response_model=schemas.TechnicianResponse)
def get_technician(
    tech_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.get_technician(db, tech_id)


@router.post("/technicians/", status_code=status.HTTP_201_CREATED)
def create_technician(
    tech: schemas.TechnicianCreate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.create_technician(db, current_user, tech)


@router.put("/technicians/{tech_id}", response_model=schemas.TechnicianResponse)
def update_technician(
    tech_id: int,
    data: schemas.TechnicianUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.update_technician(db, current_user, tech_id, data)


@router.put("/technicians/{tech_id}/toggle-status")
def toggle_technician_status(
    tech_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.toggle_status(db, current_user, tech_id)


@router.delete("/technicians/{tech_id}")
def delete_technician(
    tech_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.delete_technician(db, current_user, tech_id)


@router.post("/technicians/{tech_id}/photo")
async def upload_profile_photo(
    tech_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return await technician_service.upload_photo(db, current_user, tech_id, file)


@router.get("/technicians/{tech_id}/performance")
def get_technician_performance(
    tech_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.get_performance(db, tech_id)


@router.post("/technicians/{technician_id}/push-token", status_code=200)
def register_push_token(
    technician_id: int,
    payload: schemas.PushTokenRequest,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.register_push_token(db, technician_id, payload)


@router.delete("/technicians/{technician_id}/push-token", status_code=200)
def unregister_push_token(
    technician_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return technician_service.unregister_push_token(db, technician_id)
