"""
Ticket business logic — extracted from routers/tickets.py.
All functions receive db: Session + plain data. No Request/Response objects.
"""
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from config.constants import ALLOWED_MIME_TYPES, FILENAME_SAFE_RE, VALID_TRANSITIONS
from config.settings import settings
from services.customer_provenance_service import record_field_writes

logger = logging.getLogger("rico_net.tickets")

UPLOAD_DIR = os.environ.get(
    "UPLOAD_DIR",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads"
    ),
)

MAX_UPLOAD_SIZE_MB = settings.MAX_UPLOAD_SIZE_MB
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def validate_transition(current: str, target: str):
    """Raise 400 if the status transition is invalid."""
    allowed = VALID_TRANSITIONS.get(current, [])
    if target not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition: {current} -> {target}. "
            f"Allowed: {', '.join(allowed) if allowed else 'None'}",
        )


def log_audit(
    db: Session,
    ticket_id: int,
    user_id: int,
    action: str,
    field_name: str = None,
    old_value: str = None,
    new_value: str = None,
    metadata: dict = None,
):
    """Create an audit log entry for a ticket change."""
    entry = models.TicketAuditLog(
        ticket_id=ticket_id,
        changed_by=user_id,
        action=action,
        field_name=field_name,
        old_value=old_value,
        new_value=new_value,
        metadata_=metadata,
    )
    db.add(entry)


def apply_ticket_visibility(query, user: models.Technician):
    """Apply role-based ticket visibility constraints."""
    if user.role == "Admin":
        return query
    return query.filter(
        or_(
            models.Ticket.assigned_tech == user.username,
            and_(
                or_(
                    models.Ticket.assigned_tech.is_(None),
                    models.Ticket.assigned_tech == "",
                ),
                models.Ticket.status == "Open",
            ),
        )
    )


def ensure_ticket_access(
    ticket: models.Ticket,
    user: models.Technician,
    *,
    allow_unassigned_open: bool = True,
):
    """Raise 403 if user is not allowed to access this ticket."""
    if user.role == "Admin":
        return
    owns_ticket = ticket.assigned_tech == user.username
    can_claim = (
        allow_unassigned_open
        and (ticket.assigned_tech is None or ticket.assigned_tech == "")
        and ticket.status == "Open"
    )
    if not (owns_ticket or can_claim):
        raise HTTPException(
            status_code=403,
            detail="Ticket is assigned to another technician.",
        )


def sanitize_filename(filename: Optional[str]) -> str:
    """Normalize filenames to prevent path traversal and unsafe characters."""
    base = os.path.basename(filename or "upload.bin")
    cleaned = FILENAME_SAFE_RE.sub("_", base).strip("._")
    return cleaned or "upload.bin"


# ------------------------------------------------------------------
# Service functions
# ------------------------------------------------------------------

def get_stats(db: Session, user: models.Technician) -> dict:
    """Dashboard statistics for the ticket system."""
    try:
        visible_tickets = apply_ticket_visibility(db.query(models.Ticket), user)
        open_count = visible_tickets.filter(models.Ticket.status == "Open").count()
        assigned_count = visible_tickets.filter(models.Ticket.status == "Assigned").count()
        ongoing_count = visible_tickets.filter(models.Ticket.status == "Ongoing").count()
        resolved_count = visible_tickets.filter(models.Ticket.status == "Resolved").count()
        closed_count = visible_tickets.filter(models.Ticket.status == "Closed").count()

        today = date.today()
        created_today = visible_tickets.filter(
            func.date(models.Ticket.created_at) == today
        ).count()
        resolved_today = visible_tickets.filter(
            func.date(models.Ticket.resolved_at) == today
        ).count()

        now = datetime.now(timezone.utc)
        overdue_open = visible_tickets.filter(
            models.Ticket.status.in_(["Open", "Assigned"]),
            models.Ticket.created_at < (now - timedelta(hours=24)),
        ).count()
        overdue_ongoing = visible_tickets.filter(
            models.Ticket.status == "Ongoing",
            models.Ticket.started_at.isnot(None),
            models.Ticket.started_at < (now - timedelta(hours=48)),
        ).count()

        return {
            "open_count": open_count,
            "assigned_count": assigned_count,
            "ongoing_count": ongoing_count,
            "resolved_count": resolved_count,
            "closed_count": closed_count,
            "created_today": created_today,
            "resolved_today": resolved_today,
            "overdue_count": overdue_open + overdue_ongoing,
            "total_active": open_count + assigned_count + ongoing_count,
        }
    except SQLAlchemyError as e:
        logger.error("Database error in ticket stats: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def create_ticket(
    db: Session,
    user: models.Technician,
    ticket: schemas.TicketCreate,
    force: bool = False,
) -> models.Ticket:
    customer = (
        db.query(models.Customer)
        .filter(models.Customer.username == ticket.customer_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer ID (username) not found!")

    if not force:
        existing = (
            db.query(models.Ticket)
            .filter(
                models.Ticket.customer_id == ticket.customer_id,
                models.Ticket.issue_type == ticket.issue_type,
                models.Ticket.status.in_(["Open", "Assigned", "Ongoing"]),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate: Ticket #{existing.id} ({existing.status}) already exists for "
                f"this customer with issue type '{existing.issue_type}'. "
                f"Add ?force=true to create anyway.",
            )

    new_ticket = models.Ticket(
        customer_id=ticket.customer_id,
        issue_type=ticket.issue_type,
        description=ticket.description,
        priority=ticket.priority,
        status="Open",
        sub_issue=ticket.sub_issue,
        tags=ticket.tags,
        internal_notes=ticket.internal_notes,
    )

    db.add(new_ticket)
    try:
        db.commit()
        db.refresh(new_ticket)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error creating ticket: %s", str(e))
        raise HTTPException(status_code=500, detail="Failed to create ticket")

    log_audit(db, new_ticket.id, user.id, "creation", "status", None, "Open")
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.warning("Failed to write audit log for ticket #%d creation", new_ticket.id)

    logger.info(
        "Ticket #%d created for customer %s by %s",
        new_ticket.id,
        ticket.customer_id,
        user.username,
    )
    return new_ticket


def list_tickets(
    db: Session,
    user: models.Technician,
    *,
    status: str = "Open",
    assigned_tech: Optional[str] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
    priority: Optional[str] = None,
    created_after: Optional[date] = None,
    created_before: Optional[date] = None,
    skip: int = 0,
    limit: int = 50,
) -> dict:
    skip = max(skip, 0)
    limit = min(max(limit, 1), 200)

    try:
        query = db.query(models.Ticket).options(joinedload(models.Ticket.customer))

        if status != "All":
            query = query.filter(models.Ticket.status == status)

        query = apply_ticket_visibility(query, user)

        if customer_id:
            query = query.filter(models.Ticket.customer_id == customer_id)
        if assigned_tech:
            query = query.filter(models.Ticket.assigned_tech == assigned_tech)
        if priority:
            query = query.filter(models.Ticket.priority == priority)

        if q:
            search_term = f"%{q}%"
            try:
                ticket_id = int(q)
                query = query.filter(
                    (models.Ticket.id == ticket_id)
                    | (models.Ticket.customer_id.ilike(search_term))
                    | (models.Ticket.issue_type.ilike(search_term))
                    | (models.Ticket.description.ilike(search_term))
                )
            except ValueError:
                query = query.filter(
                    (models.Ticket.customer_id.ilike(search_term))
                    | (models.Ticket.issue_type.ilike(search_term))
                    | (models.Ticket.description.ilike(search_term))
                )

        if created_after:
            query = query.filter(func.date(models.Ticket.created_at) >= created_after)
        if created_before:
            query = query.filter(func.date(models.Ticket.created_at) <= created_before)

        query = query.order_by(models.Ticket.created_at.desc())
        total = query.count()
        tickets = query.offset(skip).limit(limit).all()
        return {"items": tickets, "total": total}
    except SQLAlchemyError as e:
        logger.error("Database error listing tickets: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def get_ticket(db: Session, user: models.Technician, ticket_id: int) -> models.Ticket:
    try:
        db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    except SQLAlchemyError as e:
        logger.error("Database error fetching ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ensure_ticket_access(db_ticket, user, allow_unassigned_open=True)
    return db_ticket


def update_ticket(
    db: Session,
    user: models.Technician,
    ticket_id: int,
    ticket_update: schemas.TicketUpdate,
) -> models.Ticket:
    db_ticket = (
        db.query(models.Ticket)
        .filter(models.Ticket.id == ticket_id)
        .with_for_update()
        .first()
    )
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ensure_ticket_access(db_ticket, user, allow_unassigned_open=True)

    if getattr(ticket_update, "assigned_tech", None) == "":
        ticket_update.assigned_tech = None

    # STATE MACHINE: Validate status transition
    if ticket_update.status and ticket_update.status != db_ticket.status:
        validate_transition(db_ticket.status, ticket_update.status)
        old_status = db_ticket.status

        log_audit(
            db, ticket_id, user.id, "status_change", "status", old_status, ticket_update.status,
        )

        if ticket_update.status == "Ongoing":
            now_utc = datetime.now(timezone.utc)

            if user.role == "Admin":
                tech_val = (
                    ticket_update.assigned_tech
                    if ticket_update.assigned_tech is not None
                    else db_ticket.assigned_tech
                )
                if not tech_val:
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot set status to Ongoing without an assigned technician.",
                    )
            else:
                if (
                    db_ticket.assigned_tech
                    and db_ticket.assigned_tech != user.username
                ):
                    raise HTTPException(
                        status_code=409,
                        detail=f"Ticket already assigned to {db_ticket.assigned_tech}.",
                    )

                if not db_ticket.assigned_tech:
                    claimed = (
                        db.query(models.Ticket)
                        .filter(
                            models.Ticket.id == ticket_id,
                            or_(
                                models.Ticket.assigned_tech.is_(None),
                                models.Ticket.assigned_tech == "",
                            ),
                        )
                        .update(
                            {
                                models.Ticket.assigned_tech: user.username,
                                models.Ticket.assigned_at: now_utc,
                            },
                            synchronize_session=False,
                        )
                    )
                    if claimed == 0:
                        raise HTTPException(
                            status_code=409,
                            detail="Ticket was just claimed by another technician. Refresh and try another ticket.",
                        )
                    db.refresh(db_ticket)

            db_ticket.started_at = now_utc
        elif ticket_update.status == "Resolved":
            db_ticket.resolved_at = datetime.now(timezone.utc)
        elif ticket_update.status == "Closed":
            db_ticket.closed_at = datetime.now(timezone.utc)
        db_ticket.status = ticket_update.status

        logger.info(
            "Ticket #%d status changed: %s -> %s by %s",
            ticket_id, old_status, ticket_update.status, user.username,
        )

    # Assignment handling
    if "assigned_tech" in ticket_update.model_dump(exclude_unset=True):
        if (
            user.role != "Admin"
            and ticket_update.assigned_tech != user.username
            and ticket_update.assigned_tech is not None
        ):
            raise HTTPException(
                status_code=403,
                detail="Field technicians can only assign tickets to themselves.",
            )
        old_assignee = db_ticket.assigned_tech
        db_ticket.assigned_tech = ticket_update.assigned_tech
        db_ticket.assigned_at = (
            datetime.now(timezone.utc) if ticket_update.assigned_tech else None
        )
        if db_ticket.status == "Open" and ticket_update.assigned_tech:
            old_status = db_ticket.status
            db_ticket.status = "Assigned"
            log_audit(
                db, ticket_id, user.id, "status_change", "status", old_status, "Assigned",
            )

        if old_assignee != db_ticket.assigned_tech:
            log_audit(
                db, ticket_id, user.id, "assignment", "assigned_tech",
                old_assignee, db_ticket.assigned_tech,
            )

    # Update text fields
    if ticket_update.description is not None:
        db_ticket.description = ticket_update.description
    if ticket_update.priority is not None:
        db_ticket.priority = ticket_update.priority
    if ticket_update.sub_issue is not None:
        db_ticket.sub_issue = ticket_update.sub_issue
    if ticket_update.tags is not None:
        db_ticket.tags = ticket_update.tags
    if ticket_update.internal_notes is not None:
        old_notes = db_ticket.internal_notes
        if old_notes != ticket_update.internal_notes:
            db_ticket.internal_notes = ticket_update.internal_notes
            log_audit(
                db, ticket_id, user.id, "notes_update", "internal_notes", None, "Note updated",
            )
    if ticket_update.materials_used is not None:
        db_ticket.materials_used = ticket_update.materials_used
    if ticket_update.issue_type is not None:
        db_ticket.issue_type = ticket_update.issue_type

    # Update customer geolocation
    if ticket_update.geo_lat is not None and ticket_update.geo_long is not None:
        if db_ticket.customer:
            db_ticket.customer.geo_lat = ticket_update.geo_lat
            db_ticket.customer.geo_long = ticket_update.geo_long
            if not db_ticket.internal_notes:
                db_ticket.internal_notes = ""
            db_ticket.internal_notes += (
                f"\n[SYSTEM]: Location updated to "
                f"{ticket_update.geo_lat}, {ticket_update.geo_long}"
            )

    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error updating ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(status_code=500, detail="Database error while updating ticket.")
    db.refresh(db_ticket)
    return db_ticket


def delete_ticket(db: Session, user: models.Technician, ticket_id: int) -> dict:
    if user.role != "Admin":
        raise HTTPException(
            status_code=403, detail="Only Admin users can delete tickets.",
        )

    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if db_ticket.status == "Closed":
        raise HTTPException(
            status_code=400, detail="Cannot delete closed tickets. They are kept for records.",
        )

    try:
        db.delete(db_ticket)
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error deleting ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to delete ticket")

    logger.info("Ticket #%d deleted by %s", ticket_id, user.username)
    return {"detail": "Ticket deleted successfully"}


def get_comments(
    db: Session, user: models.Technician, ticket_id: int,
) -> List[models.TicketComment]:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ensure_ticket_access(ticket, user, allow_unassigned_open=True)

    try:
        return (
            db.query(models.TicketComment)
            .filter(models.TicketComment.ticket_id == ticket_id)
            .order_by(models.TicketComment.created_at.asc())
            .all()
        )
    except SQLAlchemyError as e:
        logger.error("Database error listing comments for ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def add_comment(
    db: Session,
    user: models.Technician,
    ticket_id: int,
    comment: schemas.TicketCommentCreate,
) -> models.TicketComment:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ensure_ticket_access(ticket, user, allow_unassigned_open=True)

    new_comment = models.TicketComment(
        ticket_id=ticket_id,
        author=user.username,
        content=comment.content,
        is_internal=comment.is_internal,
    )
    db.add(new_comment)
    try:
        db.commit()
        db.refresh(new_comment)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error adding comment to ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to add comment")

    return new_comment


async def upload_media(
    db: Session,
    user: models.Technician,
    ticket_id: int,
    file: UploadFile,
) -> models.TicketMedia:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ensure_ticket_access(ticket, user, allow_unassigned_open=True)

    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{content_type}'. Allowed: images, PDF, MP4.",
        )

    ticket_dir = os.path.join(UPLOAD_DIR, str(ticket_id))
    try:
        os.makedirs(ticket_dir, exist_ok=True)
    except OSError as e:
        logger.error("Failed to create upload directory %s: %s", ticket_dir, str(e))
        raise HTTPException(
            status_code=500,
            detail="File system error: could not create upload directory.",
        )

    safe_name = sanitize_filename(file.filename)
    stored_filename = f"{uuid.uuid4().hex}_{safe_name}"
    file_path = os.path.join(ticket_dir, stored_filename)
    total_bytes = 0

    try:
        with open(file_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Max allowed size is {MAX_UPLOAD_SIZE_MB} MB.",
                    )
                buffer.write(chunk)
    except HTTPException:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise
    except OSError as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        logger.error("File system error during upload for ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(
            status_code=500,
            detail="File system error: could not save uploaded file.",
        )
    except Exception:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail="Could not save file")
    finally:
        await file.close()

    relative_url = f"/uploads/{ticket_id}/{stored_filename}"
    db_media = models.TicketMedia(
        ticket_id=ticket_id,
        file_path=relative_url,
        filename=safe_name,
        file_type=file.content_type or "application/octet-stream",
    )
    db.add(db_media)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail="Database error while saving media.")
    db.refresh(db_media)

    logger.info(
        "Media uploaded for ticket #%d: %s (%d bytes) by %s",
        ticket_id, safe_name, total_bytes, user.username,
    )
    return db_media


def delete_media(db: Session, user: models.Technician, media_id: int) -> dict:
    media = (
        db.query(models.TicketMedia)
        .options(joinedload(models.TicketMedia.ticket))
        .filter(models.TicketMedia.id == media_id)
        .first()
    )
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    if not media.ticket:
        raise HTTPException(status_code=404, detail="Associated ticket not found")
    ensure_ticket_access(media.ticket, user, allow_unassigned_open=False)

    stored_path = media.file_path
    if stored_path.startswith("/uploads/"):
        disk_path = os.path.join(UPLOAD_DIR, stored_path[len("/uploads/"):])
    else:
        disk_path = stored_path

    db.delete(media)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error while deleting media.")

    if os.path.exists(disk_path):
        try:
            os.remove(disk_path)
        except OSError as e:
            logger.warning("Failed to delete file %s: %s", disk_path, str(e))

    logger.info("Media #%d deleted by %s", media_id, user.username)
    return {"ok": True}


def complete_ticket(
    db: Session,
    user: models.Technician,
    ticket_id: int,
    payload: schemas.TicketCompleteRequest,
) -> dict:
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ensure_ticket_access(db_ticket, user, allow_unassigned_open=False)

    if db_ticket.status != "Ongoing":
        raise HTTPException(
            status_code=400,
            detail=f"Ticket must be in 'Ongoing' status to complete. Current: {db_ticket.status}",
        )

    old_status = db_ticket.status
    db_ticket.status = "Resolved"
    db_ticket.resolved_at = datetime.now(timezone.utc)
    db_ticket.resolution_remarks = payload.resolution_remarks

    if payload.materials_used:
        db_ticket.materials_used = payload.materials_used

    log_audit(db, ticket_id, user.id, "status_change", "status", old_status, "Resolved")
    log_audit(
        db, ticket_id, user.id, "resolution",
        metadata={"remarks": payload.resolution_remarks},
    )

    # Enrich Customer Profile
    customer = db_ticket.customer
    enriched_fields = []

    if not customer:
        raise HTTPException(status_code=404, detail="Associated customer not found")

    enrichment = payload.enrichment

    if enrichment.geo_lat is not None:
        old_val = str(customer.geo_lat) if customer.geo_lat else "null"
        customer.geo_lat = enrichment.geo_lat
        enriched_fields.append("geo_lat")
        log_audit(db, ticket_id, user.id, "enrichment", "geo_lat", old_val, str(enrichment.geo_lat))

    if enrichment.geo_long is not None:
        old_val = str(customer.geo_long) if customer.geo_long else "null"
        customer.geo_long = enrichment.geo_long
        enriched_fields.append("geo_long")
        log_audit(db, ticket_id, user.id, "enrichment", "geo_long", old_val, str(enrichment.geo_long))

    if enrichment.corrected_address:
        old_val = customer.rico_address or "null"
        customer.rico_address = enrichment.corrected_address
        enriched_fields.append("rico_address")
        log_audit(db, ticket_id, user.id, "enrichment", "rico_address", old_val, enrichment.corrected_address)

    if enrichment.wifi_ssid:
        old_val = customer.wifi_ssid or "null"
        customer.wifi_ssid = enrichment.wifi_ssid
        enriched_fields.append("wifi_ssid")
        log_audit(db, ticket_id, user.id, "enrichment", "wifi_ssid", old_val, enrichment.wifi_ssid)

    if enrichment.wifi_password:
        customer.wifi_password = enrichment.wifi_password
        enriched_fields.append("wifi_password")
        log_audit(db, ticket_id, user.id, "enrichment", "wifi_password", "***", "***")

    customer.last_enriched_at = datetime.now(timezone.utc)
    customer.last_enriched_by = user.id
    if enriched_fields:
        record_field_writes(
            db,
            customer_id=customer.username,
            field_names=enriched_fields,
            source="admin_enrichment",
            writer=user.username,
            evidence_ref=f"ticket:{ticket_id}",
            verified_at=customer.last_enriched_at,
            notes="Ticket completion enrichment",
            updated_at=customer.last_enriched_at,
        )

    try:
        db.commit()
        db.refresh(db_ticket)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error completing ticket #%d: %s", ticket_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to complete ticket")

    logger.info(
        "Ticket #%d completed by %s, enriched fields: %s",
        ticket_id, user.username, enriched_fields or "none",
    )

    return {
        "ticket": db_ticket,
        "enrichment_applied": len(enriched_fields) > 0,
        "enriched_fields": enriched_fields,
    }


def get_audit_log(
    db: Session, user: models.Technician, ticket_id: int,
) -> List[models.TicketAuditLog]:
    ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ensure_ticket_access(ticket, user, allow_unassigned_open=True)

    return (
        db.query(models.TicketAuditLog)
        .filter(models.TicketAuditLog.ticket_id == ticket_id)
        .order_by(models.TicketAuditLog.changed_at.desc())
        .all()
    )
