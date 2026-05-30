"""
Rico Net CMS -- Ticket Router (thin wrapper)
==============================================
All business logic lives in services/ticket_service.py.
"""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

import database
import models
import schemas
from middleware.auth import get_current_user
from services import ticket_service

router = APIRouter(
    prefix="/tickets",
    tags=["Tickets"],
)


@router.get("/stats")
def get_ticket_stats(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.get_stats(db, current_user)


@router.post("/", response_model=schemas.TicketResponse)
def create_ticket(
    ticket: schemas.TicketCreate,
    force: bool = False,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.create_ticket(db, current_user, ticket, force)


@router.get("/", response_model=schemas.TicketListResponse)
def list_tickets(
    status: str = "Open",
    assigned_tech: Optional[str] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
    priority: Optional[str] = None,
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.list_tickets(
        db, current_user,
        status=status, assigned_tech=assigned_tech, customer_id=customer_id,
        q=q, priority=priority, created_after=created_after,
        created_before=created_before, skip=skip, limit=limit,
    )


@router.get("/{ticket_id}", response_model=schemas.TicketResponse)
def get_ticket(
    ticket_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.get_ticket(db, current_user, ticket_id)


@router.put("/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(
    ticket_id: int,
    ticket_update: schemas.TicketUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.update_ticket(db, current_user, ticket_id, ticket_update)


@router.delete("/{ticket_id}")
def delete_ticket(
    ticket_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.delete_ticket(db, current_user, ticket_id)


@router.get("/{ticket_id}/comments", response_model=List[schemas.TicketCommentResponse])
def list_comments(
    ticket_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.get_comments(db, current_user, ticket_id)


@router.post("/{ticket_id}/comments", response_model=schemas.TicketCommentResponse)
def add_comment(
    ticket_id: int,
    comment: schemas.TicketCommentCreate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.add_comment(db, current_user, ticket_id, comment)


@router.post("/{ticket_id}/media", response_model=schemas.TicketMediaResponse)
async def upload_media(
    ticket_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return await ticket_service.upload_media(db, current_user, ticket_id, file)


@router.delete("/media/{media_id}")
def delete_media(
    media_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.delete_media(db, current_user, media_id)


@router.post("/{ticket_id}/complete", response_model=schemas.TicketCompleteResponse)
def complete_ticket(
    ticket_id: int,
    payload: schemas.TicketCompleteRequest,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.complete_ticket(db, current_user, ticket_id, payload)


@router.get("/{ticket_id}/audit", response_model=List[schemas.TicketAuditLogResponse])
def get_ticket_audit_log(
    ticket_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return ticket_service.get_audit_log(db, current_user, ticket_id)
