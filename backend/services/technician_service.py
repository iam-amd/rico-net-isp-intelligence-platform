"""
Technician business logic — extracted from routers/technicians.py.
"""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models
import schemas
from config.constants import ALLOWED_IMAGE_EXTENSIONS, MAX_PHOTO_UPLOAD_SIZE
from middleware.auth import get_password_hash

logger = logging.getLogger("rico_net.technicians")


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def batch_ticket_counts(
    db: Session, usernames: List[str],
) -> Dict[str, Dict[str, int]]:
    """Batch-compute active and resolved ticket counts in TWO queries."""
    if not usernames:
        return {}

    result = {u: {"active": 0, "resolved": 0} for u in usernames}

    active_rows = (
        db.query(models.Ticket.assigned_tech, func.count(models.Ticket.id))
        .filter(
            models.Ticket.assigned_tech.in_(usernames),
            models.Ticket.status.in_(["Assigned", "Ongoing"]),
        )
        .group_by(models.Ticket.assigned_tech)
        .all()
    )
    for username, count in active_rows:
        if username in result:
            result[username]["active"] = count

    resolved_rows = (
        db.query(models.Ticket.assigned_tech, func.count(models.Ticket.id))
        .filter(
            models.Ticket.assigned_tech.in_(usernames),
            models.Ticket.status.in_(["Resolved", "Closed"]),
        )
        .group_by(models.Ticket.assigned_tech)
        .all()
    )
    for username, count in resolved_rows:
        if username in result:
            result[username]["resolved"] = count

    return result


def tech_to_response(tech: models.Technician, counts: Dict[str, int]) -> dict:
    """Convert a Technician ORM object to a response dict with pre-computed counts."""
    return {
        "id": tech.id,
        "username": tech.username,
        "full_name": tech.full_name,
        "role": tech.role,
        "is_active": tech.is_active,
        "phone": tech.phone,
        "email": tech.email,
        "specialization": tech.specialization,
        "area_assigned": tech.area_assigned,
        "employment_type": tech.employment_type,
        "join_date": tech.join_date,
        "address": tech.address,
        "emergency_contact": tech.emergency_contact,
        "notes": tech.notes,
        "profile_photo": tech.profile_photo,
        "last_login": tech.last_login,
        "created_at": tech.created_at,
        "updated_at": tech.updated_at,
        "active_tickets": counts.get("active", 0),
        "resolved_tickets": counts.get("resolved", 0),
    }


# ------------------------------------------------------------------
# Service functions
# ------------------------------------------------------------------

def get_stats(db: Session) -> dict:
    try:
        total = db.query(func.count(models.Technician.id)).scalar() or 0
        active = (
            db.query(func.count(models.Technician.id))
            .filter(models.Technician.is_active == 1)
            .scalar()
            or 0
        )
        inactive = total - active

        on_duty_usernames = (
            db.query(models.Ticket.assigned_tech)
            .filter(
                models.Ticket.assigned_tech.isnot(None),
                models.Ticket.assigned_tech != "",
                models.Ticket.status.in_(["Assigned", "Ongoing"]),
            )
            .distinct()
            .all()
        )
        on_duty = len(on_duty_usernames)

        spec_rows = (
            db.query(models.Technician.specialization, func.count(models.Technician.id))
            .filter(models.Technician.is_active == 1)
            .group_by(models.Technician.specialization)
            .all()
        )
        by_specialization = {(s or "General"): c for s, c in spec_rows}

        area_rows = (
            db.query(models.Technician.area_assigned, func.count(models.Technician.id))
            .filter(
                models.Technician.is_active == 1,
                models.Technician.area_assigned.isnot(None),
            )
            .group_by(models.Technician.area_assigned)
            .all()
        )
        by_area = {(a or "Unassigned"): c for a, c in area_rows}

        return {
            "total": total,
            "active": active,
            "inactive": inactive,
            "on_duty": on_duty,
            "by_specialization": by_specialization,
            "by_area": by_area,
        }
    except SQLAlchemyError as e:
        logger.error("Database error in technician stats: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def get_workload(db: Session) -> dict:
    try:
        techs = db.query(models.Technician).filter(models.Technician.is_active == 1).all()
        usernames = [t.username for t in techs]
        if not usernames:
            return {"technicians": []}

        active_map: Dict[str, int] = {}
        active_rows = (
            db.query(models.Ticket.assigned_tech, func.count(models.Ticket.id))
            .filter(
                models.Ticket.assigned_tech.in_(usernames),
                models.Ticket.status.in_(["Assigned", "Ongoing"]),
            )
            .group_by(models.Ticket.assigned_tech)
            .all()
        )
        for username, count in active_rows:
            active_map[username] = count

        month_start = datetime.now(timezone.utc).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        monthly_map: Dict[str, int] = {}
        monthly_rows = (
            db.query(models.Ticket.assigned_tech, func.count(models.Ticket.id))
            .filter(
                models.Ticket.assigned_tech.in_(usernames),
                models.Ticket.status.in_(["Resolved", "Closed"]),
                models.Ticket.resolved_at >= month_start,
            )
            .group_by(models.Ticket.assigned_tech)
            .all()
        )
        for username, count in monthly_rows:
            monthly_map[username] = count

        total_map: Dict[str, int] = {}
        total_rows = (
            db.query(models.Ticket.assigned_tech, func.count(models.Ticket.id))
            .filter(
                models.Ticket.assigned_tech.in_(usernames),
                models.Ticket.status.in_(["Resolved", "Closed"]),
            )
            .group_by(models.Ticket.assigned_tech)
            .all()
        )
        for username, count in total_rows:
            total_map[username] = count

        result = []
        for tech in techs:
            result.append({
                "id": tech.id,
                "full_name": tech.full_name,
                "username": tech.username,
                "role": tech.role,
                "specialization": tech.specialization or "General",
                "area": tech.area_assigned,
                "active_tickets": active_map.get(tech.username, 0),
                "resolved_this_month": monthly_map.get(tech.username, 0),
                "total_resolved": total_map.get(tech.username, 0),
                "profile_photo": tech.profile_photo,
            })

        return {"technicians": result}
    except SQLAlchemyError as e:
        logger.error("Database error in workload overview: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def list_technicians(
    db: Session,
    *,
    q: Optional[str] = None,
    status_filter: Optional[str] = None,
    specialization: Optional[str] = None,
    area: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
) -> dict:
    try:
        query = db.query(models.Technician)

        if status_filter == "active":
            query = query.filter(models.Technician.is_active == 1)
        elif status_filter == "inactive":
            query = query.filter(models.Technician.is_active == 0)

        if specialization:
            query = query.filter(models.Technician.specialization == specialization)
        if area:
            query = query.filter(models.Technician.area_assigned == area)

        if q and q.strip():
            search = f"%{q.strip()}%"
            query = query.filter(
                or_(
                    models.Technician.full_name.ilike(search),
                    models.Technician.username.ilike(search),
                    models.Technician.phone.ilike(search),
                    models.Technician.email.ilike(search),
                    models.Technician.area_assigned.ilike(search),
                )
            )

        total = query.count()
        techs = query.order_by(models.Technician.id.desc()).offset(skip).limit(limit).all()

        usernames = [t.username for t in techs]
        counts = batch_ticket_counts(db, usernames)

        items = [
            tech_to_response(t, counts.get(t.username, {"active": 0, "resolved": 0}))
            for t in techs
        ]
        return {"items": items, "total": total}
    except SQLAlchemyError as e:
        logger.error("Database error listing technicians: %s", str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def get_technician(db: Session, tech_id: int) -> dict:
    try:
        tech = db.query(models.Technician).filter(models.Technician.id == tech_id).first()
    except SQLAlchemyError as e:
        logger.error("Database error fetching technician %d: %s", tech_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found.")
    counts = batch_ticket_counts(db, [tech.username])
    return tech_to_response(tech, counts.get(tech.username, {"active": 0, "resolved": 0}))


def create_technician(
    db: Session, user: models.Technician, tech: schemas.TechnicianCreate,
) -> dict:
    if user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can perform this action.",
        )

    existing = db.query(models.Technician).filter(
        models.Technician.username == tech.username
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken.")

    hashed_pw = get_password_hash(tech.password)

    new_tech = models.Technician(
        username=tech.username,
        hashed_password=hashed_pw,
        full_name=tech.full_name,
        role=tech.role,
        phone=tech.phone,
        email=tech.email,
        specialization=tech.specialization,
        area_assigned=tech.area_assigned,
        employment_type=tech.employment_type,
        join_date=tech.join_date,
        address=tech.address,
        emergency_contact=tech.emergency_contact,
        notes=tech.notes,
    )
    db.add(new_tech)
    try:
        db.commit()
        db.refresh(new_tech)
    except IntegrityError:
        db.rollback()
        logger.warning("Duplicate technician creation attempt: %s", tech.username)
        raise HTTPException(status_code=409, detail="Username already taken.")
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error creating technician %s: %s", tech.username, str(e))
        raise HTTPException(status_code=500, detail="Failed to create technician")

    logger.info(
        "Technician created: %s (role=%s) by %s", tech.username, tech.role, user.username,
    )
    return {
        "message": "Technician created successfully",
        "id": new_tech.id,
        "username": new_tech.username,
    }


def update_technician(
    db: Session, user: models.Technician, tech_id: int, data: schemas.TechnicianUpdate,
) -> dict:
    tech = db.query(models.Technician).filter(models.Technician.id == tech_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found.")

    if user.role != "Admin" and user.id != tech_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only update your own profile.",
        )

    update_data = data.model_dump(exclude_unset=True)

    if "password" in update_data and update_data["password"]:
        if user.id != tech_id and user.role != "Admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Admin users can perform this action.",
            )
        tech.hashed_password = get_password_hash(update_data.pop("password"))
    else:
        update_data.pop("password", None)

    if "role" in update_data and user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can change roles.",
        )

    for field, value in update_data.items():
        setattr(tech, field, value)

    try:
        db.commit()
        db.refresh(tech)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error updating technician %d: %s", tech_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to update technician")

    logger.info("Technician #%d updated by %s", tech_id, user.username)
    counts = batch_ticket_counts(db, [tech.username])
    return tech_to_response(tech, counts.get(tech.username, {"active": 0, "resolved": 0}))


def toggle_status(db: Session, user: models.Technician, tech_id: int) -> dict:
    if user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can perform this action.",
        )

    tech = db.query(models.Technician).filter(models.Technician.id == tech_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found.")

    if tech.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")

    tech.is_active = 0 if tech.is_active == 1 else 1
    try:
        db.commit()
        db.refresh(tech)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error toggling technician #%d status: %s", tech_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to toggle technician status")

    status_label = "activated" if tech.is_active == 1 else "deactivated"
    logger.info(
        "Technician %s (id=%d) %s by %s", tech.full_name, tech_id, status_label, user.username,
    )
    return {
        "message": f"Technician {tech.full_name} has been {status_label}.",
        "is_active": tech.is_active,
    }


def delete_technician(db: Session, user: models.Technician, tech_id: int) -> dict:
    if user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can perform this action.",
        )

    tech = db.query(models.Technician).filter(models.Technician.id == tech_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found.")

    if tech.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    ticket_count = (
        db.query(func.count(models.Ticket.id))
        .filter(models.Ticket.assigned_tech == tech.username)
        .scalar()
        or 0
    )

    try:
        if ticket_count > 0:
            tech.is_active = 0
            db.commit()
            logger.info(
                "Technician %s (id=%d) soft-deleted (has %d tickets) by %s",
                tech.username, tech_id, ticket_count, user.username,
            )
            return {
                "message": f"Technician has {ticket_count} linked tickets. Account deactivated instead of deleted.",
                "soft_deleted": True,
            }

        db.delete(tech)
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error deleting technician #%d: %s", tech_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to delete technician")

    logger.info(
        "Technician %s (id=%d) permanently deleted by %s",
        tech.username, tech_id, user.username,
    )
    return {"message": "Technician deleted permanently.", "soft_deleted": False}


async def upload_photo(
    db: Session, user: models.Technician, tech_id: int, file: UploadFile,
) -> dict:
    tech = db.query(models.Technician).filter(models.Technician.id == tech_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found.")

    if user.role != "Admin" and user.id != tech_id:
        raise HTTPException(status_code=403, detail="Not authorized.")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type. Allowed: {', '.join(ALLOWED_IMAGE_EXTENSIONS)}",
        )

    content = await file.read()
    if len(content) > MAX_PHOTO_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_PHOTO_UPLOAD_SIZE // (1024 * 1024)}MB.",
        )

    upload_dir = os.path.join("uploads", "technicians", str(tech_id))
    try:
        os.makedirs(upload_dir, exist_ok=True)
    except OSError as e:
        logger.error("Failed to create upload directory %s: %s", upload_dir, str(e))
        raise HTTPException(
            status_code=500,
            detail="File system error: could not create upload directory.",
        )

    safe_name = f"profile_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(upload_dir, safe_name)

    try:
        with open(file_path, "wb") as f:
            f.write(content)
    except OSError as e:
        logger.error("Failed to write profile photo to %s: %s", file_path, str(e))
        raise HTTPException(
            status_code=500,
            detail="File system error: could not save profile photo.",
        )

    tech.profile_photo = f"/uploads/technicians/{tech_id}/{safe_name}"
    try:
        db.commit()
        db.refresh(tech)
    except SQLAlchemyError as e:
        db.rollback()
        if os.path.exists(file_path):
            os.remove(file_path)
        logger.error("Database error saving profile photo for tech #%d: %s", tech_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to save profile photo")

    logger.info("Profile photo uploaded for technician #%d by %s", tech_id, user.username)
    return {
        "message": "Photo uploaded successfully",
        "profile_photo": tech.profile_photo,
    }


def get_performance(db: Session, tech_id: int) -> dict:
    tech = db.query(models.Technician).filter(models.Technician.id == tech_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found.")

    username = tech.username

    try:
        counts = (
            db.query(
                func.count(models.Ticket.id).label("total_assigned"),
                func.count(
                    case(
                        (models.Ticket.status.in_(["Resolved", "Closed"]), models.Ticket.id),
                        else_=None,
                    )
                ).label("total_resolved"),
                func.count(
                    case(
                        (models.Ticket.status.in_(["Assigned", "Ongoing"]), models.Ticket.id),
                        else_=None,
                    )
                ).label("active_count"),
            )
            .filter(models.Ticket.assigned_tech == username)
            .first()
        )

        total_assigned = counts.total_assigned or 0
        total_resolved = counts.total_resolved or 0
        active_count = counts.active_count or 0

        resolution_rate = (
            round((total_resolved / total_assigned * 100), 1) if total_assigned > 0 else 0
        )

        resolved_tickets = (
            db.query(models.Ticket)
            .filter(
                models.Ticket.assigned_tech == username,
                models.Ticket.status.in_(["Resolved", "Closed"]),
                models.Ticket.resolved_at.isnot(None),
            )
            .all()
        )

        avg_hours = 0
        if resolved_tickets:
            total_hours = 0
            count = 0
            for t in resolved_tickets:
                if t.resolved_at and t.created_at:
                    delta = t.resolved_at - t.created_at
                    total_hours += delta.total_seconds() / 3600
                    count += 1
            avg_hours = round(total_hours / count, 1) if count > 0 else 0

        now = datetime.now(timezone.utc)
        six_months_ago = (now.replace(day=1) - timedelta(days=150)).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )

        resolved_monthly = (
            db.query(
                func.to_char(models.Ticket.resolved_at, "YYYY-MM").label("month_key"),
                func.count(models.Ticket.id),
            )
            .filter(
                models.Ticket.assigned_tech == username,
                models.Ticket.status.in_(["Resolved", "Closed"]),
                models.Ticket.resolved_at >= six_months_ago,
            )
            .group_by("month_key")
            .all()
        )
        resolved_map = {row[0]: row[1] for row in resolved_monthly}

        assigned_monthly = (
            db.query(
                func.to_char(models.Ticket.created_at, "YYYY-MM").label("month_key"),
                func.count(models.Ticket.id),
            )
            .filter(
                models.Ticket.assigned_tech == username,
                models.Ticket.created_at >= six_months_ago,
            )
            .group_by("month_key")
            .all()
        )
        assigned_map = {row[0]: row[1] for row in assigned_monthly}

        monthly_data = []
        for i in range(5, -1, -1):
            month_start = (now.replace(day=1) - timedelta(days=i * 30)).replace(
                day=1, hour=0, minute=0, second=0
            )
            month_key = month_start.strftime("%Y-%m")
            monthly_data.append({
                "month": month_start.strftime("%b %Y"),
                "resolved": resolved_map.get(month_key, 0),
                "assigned": assigned_map.get(month_key, 0),
            })

        priority_rows = (
            db.query(models.Ticket.priority, func.count(models.Ticket.id))
            .filter(models.Ticket.assigned_tech == username)
            .group_by(models.Ticket.priority)
            .all()
        )
        priority_data = {p: c for p, c in priority_rows if c > 0}

        return {
            "total_assigned": total_assigned,
            "total_resolved": total_resolved,
            "active_count": active_count,
            "resolution_rate": resolution_rate,
            "avg_resolution_hours": avg_hours,
            "monthly_data": monthly_data,
            "priority_breakdown": priority_data,
        }
    except SQLAlchemyError as e:
        logger.error("Database error in technician #%d performance: %s", tech_id, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


def register_push_token(
    db: Session, technician_id: int, payload: schemas.PushTokenRequest,
) -> dict:
    tech = db.query(models.Technician).filter(models.Technician.id == technician_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found")
    tech.push_token = payload.push_token
    tech.push_platform = payload.platform
    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error registering push token for tech #%d: %s", technician_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to register push token")
    logger.info("Push token registered for technician #%d", technician_id)
    return {"status": "ok", "message": "Push token registered"}


def unregister_push_token(db: Session, technician_id: int) -> dict:
    tech = db.query(models.Technician).filter(models.Technician.id == technician_id).first()
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found")
    tech.push_token = None
    tech.push_platform = None
    try:
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error unregistering push token for tech #%d: %s", technician_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to unregister push token")
    logger.info("Push token cleared for technician #%d", technician_id)
    return {"status": "ok", "message": "Push token cleared"}
