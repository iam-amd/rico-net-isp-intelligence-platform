"""
Rico Net â€” Field Team Router
==============================
GPS location + field tech intelligence endpoints for the mobile app.
"""
import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import database
import models
from middleware.auth import require_admin, get_current_user
from schemas.noc import TechLocationCreate, TechLocationsResponse, TechMonitorResponse
from schemas.field_tech import (
    TicketBriefing,
    ONULiveStatus,
    SignalPoint,
    TroubleshootingGuide,
    SmartDispatchItem,
    RebootResponse,
    AreaOutageInfo,
)
from services import field_team_service
from services import field_tech_intel_service as intel

router = APIRouter(prefix="/field-team", tags=["Field Team"])

VISIT_PROOF_MAX_DISTANCE_M = 150


def _distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    )
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _require_visit_proof_for_link(db: Session, body: dict) -> None:
    customer_username = (body.get("customer_username") or "").strip()
    has_photo = bool((body.get("sticker_photo_url") or body.get("photo_url") or "").strip())
    has_ocr = bool((body.get("ocr_response_id") or body.get("ocr_result_id") or "").strip())
    if not has_photo and not has_ocr:
        raise HTTPException(
            status_code=422,
            detail="link-onu requires sticker_photo_url or ocr_response_id proof",
        )

    customer = db.query(models.Customer).filter(
        models.Customer.username == customer_username
    ).first()
    if not customer or customer.gps_lat is None or customer.gps_lng is None:
        return

    raw_lat = body.get("gps_lat", body.get("lat"))
    raw_lng = body.get("gps_lng", body.get("lng"))
    if raw_lat is None or raw_lng is None:
        raise HTTPException(
            status_code=422,
            detail="link-onu requires GPS when customer GPS is known",
        )
    try:
        tech_lat = float(raw_lat)
        tech_lng = float(raw_lng)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid GPS coordinates")

    distance = _distance_m(tech_lat, tech_lng, customer.gps_lat, customer.gps_lng)
    if distance > VISIT_PROOF_MAX_DISTANCE_M:
        raise HTTPException(
            status_code=403,
            detail=f"Technician is too far from customer location ({distance:.0f}m)",
        )


def _has_open_assigned_ticket(db: Session, customer_username: str, username: str) -> bool:
    ticket = db.query(models.Ticket).filter(
        models.Ticket.customer_id == customer_username,
        models.Ticket.assigned_tech == username,
        models.Ticket.status.in_(["Open", "Assigned", "Ongoing"]),
    ).first()
    return ticket is not None


@router.post("/location")
def post_location(
    body: TechLocationCreate,
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """
    Mobile app posts technician GPS location.
    The JWT identifies the technician directly (auth returns Technician model).
    """
    result = field_team_service.save_tech_location(
        db,
        technician_id=current_user.id,
        lat=body.lat,
        lng=body.lng,
        accuracy_m=body.accuracy_m,
        battery_pct=body.battery_pct,
    )
    if result.get("status") == "error":
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.get("/locations", response_model=TechLocationsResponse)
def get_locations(
    hours: int = Query(4, ge=1, le=24, description="Look back this many hours for last known location"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """NOC Dashboard: get latest location of each active technician."""
    locs = field_team_service.get_active_tech_locations(db, hours=hours)
    return {"locations": locs, "total": len(locs)}


@router.get("/monitor", response_model=TechMonitorResponse)
def get_technician_monitor(
    hours: int = Query(24, ge=1, le=168, description="Treat latest GPS older than this as missing"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """NOC Dashboard: every active technician with live, stale, or missing GPS status."""
    return field_team_service.get_technician_monitor(db, hours=hours)


# ---------------------------------------------------------------------------
# Field Tech Intelligence Endpoints
# ---------------------------------------------------------------------------

@router.get("/briefing/{customer_username}", response_model=TicketBriefing)
def get_briefing(
    customer_username: str,
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """Pre-visit intelligence card â€” single call returns everything a tech needs."""
    data = intel.get_ticket_briefing(db, customer_username)
    return data


@router.get("/onu/{mac}/live", response_model=ONULiveStatus)
def get_onu_live(
    mac: str,
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """Live ONU metrics for 30s auto-refresh polling."""
    result = intel.get_onu_live_status(db, mac)
    if not result:
        raise HTTPException(status_code=404, detail=f"ONU {mac} not found")
    return result


@router.get("/onu/{mac}/sparkline")
def get_sparkline(
    mac: str,
    hours: int = Query(24, ge=1, le=168, description="Hours of signal history"),
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """Signal history data points for sparkline/chart."""
    return intel.get_signal_sparkline(db, mac, hours=hours)


@router.get("/outage-check")
def outage_check(
    pon_port: str = Query(..., description="PON port e.g. 0/3"),
    olt_host: str = Query(..., description="OLT host e.g. 10.10.10.100"),
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """Check if a specific port has an active area outage."""
    result = intel.check_area_outage(db, pon_port, olt_host)
    if not result:
        return {"outage": False}
    return {**result, "outage": True}


@router.get("/smart-queue")
def get_smart_queue(
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """Enriched dispatch queue sorted by fault severity + health score."""
    items = intel.get_smart_dispatch_queue(db, current_user.id)
    return {"items": items, "total": len(items)}


@router.get("/troubleshooting/{fault_type}", response_model=TroubleshootingGuide)
def get_troubleshooting(
    fault_type: str,
    current_user=Depends(get_current_user),
):
    """Step-by-step troubleshooting guide per fault type."""
    guide = intel.get_troubleshooting_steps(fault_type)
    if not guide:
        raise HTTPException(
            status_code=404,
            detail=f"No troubleshooting guide for fault type: {fault_type}",
        )
    return guide


@router.post("/link-onu")
def link_onu_field(
    body: dict,
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """
    Field-tech link â€” any authenticated tech.

    Sister endpoint /noc/link-onu serves the NOC dashboard and is admin-only;
    both delegate to `noc_service.link_onu_to_customer(...)` so the binding
    behaviour is identical. Different role gates only.

    Body: { "onu_mac": "xx:xx:xx:xx:xx:xx", "customer_username": "tn.name.xx" }
    """
    from services import noc_service
    onu_mac = body.get("onu_mac", "").strip()
    customer_username = body.get("customer_username", "").strip()
    if not onu_mac or not customer_username:
        raise HTTPException(status_code=422, detail="onu_mac and customer_username are required")
    _require_visit_proof_for_link(db, body)
    result = noc_service.link_onu_to_customer(db, onu_mac, customer_username)
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/reboot/{customer_username}", response_model=RebootResponse)
async def reboot_onu(
    customer_username: str,
    db: Session = Depends(database.get_db),
    current_user=Depends(get_current_user),
):
    """
    Mobile-app reboot â€” Senior Tech + Admin only.

    Sister endpoints with the same OLT effect: /diagnostics/olt/reboot (admin
    diagnostics flow) and /noc/reboot-onu (NOC dashboard). Each is scoped to
    a different UX entry; all converge on `olt_service.reboot_onu(mac)`.
    """
    if current_user.role not in ("Admin", "Senior Tech"):
        raise HTTPException(
            status_code=403,
            detail="Only Senior Techs and Admins can reboot ONUs",
        )
    if current_user.role != "Admin" and not _has_open_assigned_ticket(
        db,
        customer_username,
        current_user.username,
    ):
        raise HTTPException(
            status_code=403,
            detail="Reboot requires an open ticket assigned to you",
        )
    result = await intel.reboot_onu(db, customer_username)
    return result
