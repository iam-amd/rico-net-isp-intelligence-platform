"""
Rico Net — Field Team Service
==============================
GPS location tracking for field technicians.
Mobile app posts location every 60s; NOC dashboard shows live tech positions.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from sqlalchemy import text
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("rico_net.field_team_service")


def save_tech_location(
    db: Session,
    technician_id: int,
    lat: float,
    lng: float,
    accuracy_m: float | None = None,
    battery_pct: int | None = None,
) -> Dict[str, Any]:
    """
    Insert a tech_locations row.
    Returns the saved record as a dict.
    """
    # Verify technician exists
    tech = db.query(models.Technician).filter(models.Technician.id == technician_id).first()
    if tech is None:
        return {"status": "error", "message": f"Technician {technician_id} not found"}

    row = models.TechLocation(
        technician_id=technician_id,
        lat=lat,
        lng=lng,
        accuracy_m=accuracy_m,
        battery_pct=battery_pct,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    logger.debug("field_team: tech %d location saved (%.4f, %.4f)", technician_id, lat, lng)
    return {
        "status": "ok",
        "id": row.id,
        "technician_id": technician_id,
        "lat": lat,
        "lng": lng,
        "timestamp": row.timestamp.isoformat(),
    }


def get_active_tech_locations(db: Session, hours: int = 4) -> List[Dict[str, Any]]:
    """
    Return the most recent location per technician within the last `hours` hours.
    Joins technicians table for name.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    now = datetime.now(timezone.utc)

    rows = db.execute(text("""
        SELECT DISTINCT ON (tl.technician_id)
            tl.technician_id,
            t.full_name,
            tl.lat,
            tl.lng,
            tl.accuracy_m,
            tl.battery_pct,
            tl.timestamp
        FROM tech_locations tl
        JOIN technicians t ON t.id = tl.technician_id
        WHERE tl.timestamp >= :cutoff
        ORDER BY tl.technician_id, tl.timestamp DESC
    """), {"cutoff": cutoff}).fetchall()

    result = []
    for row in rows:
        ts = row[6]
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        minutes_ago = (now - ts).total_seconds() / 60 if ts else 0.0
        result.append({
            "technician_id": row[0],
            "technician_name": row[1],
            "lat": float(row[2]),
            "lng": float(row[3]),
            "accuracy_m": float(row[4]) if row[4] else None,
            "battery_pct": row[5],
            "timestamp": ts,
            "minutes_ago": round(minutes_ago, 1),
        })

    return result


def _tech_location_status(minutes_ago: float | None) -> str:
    if minutes_ago is None:
        return "missing"
    if minutes_ago <= 5:
        return "live"
    if minutes_ago <= 30:
        return "recent"
    return "stale"


def get_technician_monitor(db: Session, hours: int = 24) -> Dict[str, Any]:
    """
    Return every active technician with their latest GPS state.
    Unlike /locations, this includes technicians with stale or missing GPS.
    """
    now = datetime.now(timezone.utc)
    techs = db.query(models.Technician).filter(models.Technician.is_active == 1).order_by(models.Technician.full_name.asc()).all()
    technicians: List[Dict[str, Any]] = []

    for tech in techs:
        latest = db.query(models.TechLocation).filter(
            models.TechLocation.technician_id == tech.id,
        ).order_by(models.TechLocation.timestamp.desc()).first()

        timestamp = latest.timestamp if latest else None
        if timestamp and timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        minutes_ago = round((now - timestamp).total_seconds() / 60, 1) if timestamp else None
        status = _tech_location_status(minutes_ago)
        if minutes_ago is not None and minutes_ago > hours * 60:
            status = "missing"

        assigned_values = [value for value in [tech.username, tech.full_name] if value]
        active_ticket_count = 0
        if assigned_values:
            active_ticket_count = db.query(models.Ticket).filter(
                models.Ticket.assigned_tech.in_(assigned_values),
                models.Ticket.status.notin_(["Closed", "Resolved", "Done", "Cancelled", "closed", "resolved", "done", "cancelled"]),
            ).count()

        technicians.append({
            "technician_id": tech.id,
            "technician_username": tech.username,
            "technician_name": tech.full_name,
            "phone": tech.phone,
            "role": tech.role,
            "area_assigned": tech.area_assigned,
            "status": status,
            "lat": float(latest.lat) if latest and status != "missing" else None,
            "lng": float(latest.lng) if latest and status != "missing" else None,
            "accuracy_m": float(latest.accuracy_m) if latest and latest.accuracy_m is not None and status != "missing" else None,
            "battery_pct": latest.battery_pct if latest and status != "missing" else None,
            "timestamp": timestamp if status != "missing" else None,
            "minutes_ago": minutes_ago if status != "missing" else None,
            "active_ticket_count": active_ticket_count,
        })

    live_count = sum(1 for tech in technicians if tech["status"] == "live")
    missing_count = sum(1 for tech in technicians if tech["status"] == "missing")
    stale_count = sum(1 for tech in technicians if tech["status"] in {"recent", "stale"})

    return {
        "technicians": technicians,
        "total": len(technicians),
        "live": live_count,
        "stale": stale_count,
        "missing": missing_count,
    }
