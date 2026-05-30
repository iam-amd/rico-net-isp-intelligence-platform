"""
Rico Net — NOC Dashboard Router
================================
REST endpoints for the NOC Dashboard. All require admin JWT auth.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import database
from middleware.auth import require_admin
from schemas.noc import (
    AlarmActionRequest,
    AlarmActionResponse,
    AlarmListResponse,
    AnalyticsResponse,
    TriageResponse,
    BandwidthSummary,
    CapacityPlanningResponse,
    CustomerDNAResponse,
    CustomerIntelResponse,
    CustomerSearchResponse,
    EnhancedSummary,
    GlobalSearchResponse,
    HealthReportResponse,
    HeatmapPoint,
    LinkONURequest,
    MaintenanceWindowCreate,
    MaintenanceWindowItem,
    MaintenanceWindowListResponse,
    MaintenanceScheduleResponse,
    NetworkSummary,
    NOCTicketsResponse,
    ONUDetail,
    ONUListResponse,
    ONURefreshResponse,
    OrphanONUResponse,
    OutageEvent,
    PortGridResponse,
    PortStatus,
    PredictionsResponse,
    RebootRequest,
    SignalPoint,
    SystemHealthResponse,
    UnlinkONURequest,
)
from services import alarm_service
from services import media_audit_service
from services import noc_service
from services import prediction_service

router = APIRouter(prefix="/noc", tags=["NOC Dashboard"])


# =============================================================================
# KPI SUMMARY
# =============================================================================

@router.get("/summary", response_model=EnhancedSummary)
def get_summary(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Network-wide KPI strip: total ONUs, online/offline, avg Rx, alarm count, critical signal, flapping, bandwidth."""
    return noc_service.get_network_summary(db)


# =============================================================================
# PORT GRID
# =============================================================================

@router.get("/ports", response_model=PortGridResponse)
def get_ports(
    olt_host: Optional[str] = Query(None),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Per-PON-port breakdown: counts, signal stats."""
    ports = noc_service.get_port_grid(db, olt_host=olt_host)
    return {"ports": ports}


# =============================================================================
# ONU LIST (paginated, filterable)
# =============================================================================

@router.get("/onus", response_model=ONUListResponse)
def get_onus(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None),
    pon_port: Optional[str] = Query(None),
    olt_host: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    signal_max: Optional[float] = Query(None, description="Filter ONUs with Rx <= this dBm"),
    linked: Optional[str] = Query(None, description="Filter by link status: 'linked' or 'unlinked'"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Paginated ONU list with filters."""
    items, total = noc_service.get_onu_list(
        db, page=page, page_size=page_size,
        status=status, pon_port=pon_port, olt_host=olt_host,
        search=search, signal_max=signal_max, linked=linked,
    )
    return {"onus": items, "total": total, "page": page, "page_size": page_size}


# =============================================================================
# ONU DETAIL
# =============================================================================

@router.get("/onus/{mac}", response_model=ONUDetail)
def get_onu_detail(
    mac: str,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Single ONU detail with 24h signal history."""
    detail = noc_service.get_onu_detail(db, mac)
    if not detail:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="ONU not found")
    return detail


@router.post("/onus/{mac}/refresh", response_model=ONURefreshResponse)
async def refresh_onu_signal(
    mac: str,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """
    On-demand single-ONU refresh for NOC real-time use.
    Calls the Pi proxy with targeted per-port commands (<15s).
    Updates onu_latest and returns fresh signal data.
    Use when a customer is on the phone and you need current Rx/Tx now.
    """
    from fastapi import HTTPException
    result = await noc_service.refresh_onu_signal(db, mac)
    if result is None:
        raise HTTPException(
            status_code=503,
            detail="ONU refresh failed — proxy unavailable or ONU not in database"
        )
    return result


# =============================================================================
# SIGNAL HISTORY
# =============================================================================

@router.get("/onus/{mac}/history")
def get_signal_history(
    mac: str,
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Signal trend: Rx/Tx power over time."""
    return noc_service.get_signal_history(db, mac, hours=hours)


# =============================================================================
# ALARM FEED
# =============================================================================

@router.get("/alarms", response_model=AlarmListResponse)
def get_alarms(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: Optional[str] = Query(None),
    pon_port: Optional[str] = Query(None),
    mac: Optional[str] = Query(None, description="Filter by specific MAC/SN address"),
    hours: Optional[int] = Query(None, ge=1, description="Filter alarms within last N hours"),
    status: Optional[str] = Query("open", description="open | resolved | all"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Alarm feed: paginated, filterable. Defaults to open alarms only."""
    items, total = noc_service.get_alarm_feed(
        db, page=page, page_size=page_size,
        event_type=event_type, pon_port=pon_port, hours=hours,
        status=None if status == "all" else status,
        mac_address=mac,
    )
    return {"alarms": items, "total": total, "page": page, "page_size": page_size}


def _alarm_action_response(alarm, message: str) -> AlarmActionResponse:
    return {
        "id": alarm.id,
        "status": alarm.status,
        "message": message,
        "acknowledged_at": alarm.acknowledged_at,
        "suppressed_until": alarm.suppressed_until,
        "resolved_at": alarm.resolved_at,
        "pon_port_outage_id": alarm.pon_port_outage_id,
        "area_outage_id": alarm.area_outage_id,
    }


@router.post("/alarms/{alarm_id}/ack", response_model=AlarmActionResponse)
def acknowledge_alarm(
    alarm_id: int,
    body: AlarmActionRequest = AlarmActionRequest(),
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    alarm = alarm_service.acknowledge_alarm(db, alarm_id, admin.id, note=body.note)
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    return _alarm_action_response(alarm, "Alarm acknowledged")


@router.post("/alarms/{alarm_id}/suppress", response_model=AlarmActionResponse)
def suppress_alarm(
    alarm_id: int,
    body: AlarmActionRequest,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    if not body.suppressed_until:
        raise HTTPException(status_code=400, detail="suppressed_until is required")
    alarm = alarm_service.suppress_alarm(
        db,
        alarm_id,
        admin.id,
        body.suppressed_until,
        reason=body.reason,
        note=body.note,
    )
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    return _alarm_action_response(alarm, "Alarm suppressed")


@router.post("/alarms/{alarm_id}/resolve", response_model=AlarmActionResponse)
def resolve_alarm(
    alarm_id: int,
    body: AlarmActionRequest = AlarmActionRequest(),
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    alarm = alarm_service.resolve_alarm(
        db,
        alarm_id,
        admin.id,
        reason=body.reason,
        note=body.note,
    )
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    return _alarm_action_response(alarm, "Alarm resolved")


@router.post("/alarms/{alarm_id}/link-outage", response_model=AlarmActionResponse)
def link_alarm_to_outage(
    alarm_id: int,
    body: AlarmActionRequest,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    if not body.outage_type or body.outage_id is None:
        raise HTTPException(status_code=400, detail="outage_type and outage_id are required")
    try:
        alarm = alarm_service.link_alarm_to_outage(
            db,
            alarm_id,
            body.outage_type,
            body.outage_id,
            admin.id,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    return _alarm_action_response(alarm, "Alarm linked to outage")


# =============================================================================
# MAINTENANCE WINDOWS
# =============================================================================

@router.get("/maintenance-windows", response_model=MaintenanceWindowListResponse)
def list_maintenance_windows(
    active_only: bool = Query(True),
    include_expired: bool = Query(False),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    windows = alarm_service.list_maintenance_windows(
        db,
        active_only=active_only,
        include_expired=include_expired,
    )
    return {"windows": windows}


@router.post("/maintenance-windows", response_model=MaintenanceWindowItem)
def create_maintenance_window(
    body: MaintenanceWindowCreate,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    try:
        return alarm_service.create_maintenance_window(
            db,
            olt_host=body.olt_host,
            pon_port=body.pon_port,
            starts_at=body.starts_at,
            ends_at=body.ends_at,
            reason=body.reason,
            created_by=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/maintenance-windows/{window_id}/cancel", response_model=MaintenanceWindowItem)
def cancel_maintenance_window(
    window_id: int,
    db: Session = Depends(database.get_db),
    admin=Depends(require_admin),
):
    window = alarm_service.cancel_maintenance_window(db, window_id, admin.id)
    if not window:
        raise HTTPException(status_code=404, detail="Maintenance window not found")
    return window


# =============================================================================
# SIGNAL TREND HISTORY (for chart)
# =============================================================================

@router.get("/history")
def get_network_history(
    hours: int = Query(6, ge=1, le=168),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Network-wide avg Rx power in 5-minute buckets for signal trend chart."""
    return noc_service.get_network_history(db, hours)


# =============================================================================
# OUTAGE DETECTION
# =============================================================================

@router.get("/outages")
def get_outages(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Active area outages: grouped offline ONUs by PON port."""
    return noc_service.detect_outages(db)


# =============================================================================
# HEATMAP
# =============================================================================

@router.get("/heatmap", response_model=List[HeatmapPoint])
def get_heatmap(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """All ONUs with coordinates for signal heatmap. Includes customer data where linked."""
    return noc_service.get_heatmap_data(db)


# =============================================================================
# BANDWIDTH
# =============================================================================

@router.get("/bandwidth", response_model=BandwidthSummary)
def get_bandwidth(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Network-wide bandwidth: downstream/upstream Mbps from latest snapshot batch."""
    return noc_service.get_bandwidth_summary(db)


# =============================================================================
# OPEN TICKETS (for NOC right panel)
# =============================================================================

@router.get("/tickets-summary", response_model=NOCTicketsResponse)
def get_tickets_summary(
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Open tickets for NOC dashboard side panel."""
    items, total = noc_service.get_open_tickets_for_noc(db, limit=limit)
    return {"tickets": items, "total": total}


# =============================================================================
# QUICK ACTIONS
# =============================================================================

@router.post("/force-poll")
async def force_poll(
    _admin=Depends(require_admin),
):
    """Trigger an immediate full OLT scan via the OLT proxy."""
    from services.olt_service import health_check
    health = await health_check()
    if health is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="OLT proxy is not reachable or disabled")
    return {"status": "ok", "message": "OLT proxy is online. Next poll cycle will fetch fresh data.", "proxy_health": health}


# =============================================================================
# DIAGNOSTICS / TRIAGE
# =============================================================================

@router.get("/triage", response_model=TriageResponse)
def get_triage(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Active faults with auto-diagnosis, sorted by priority."""
    return noc_service.get_active_faults(db)


# =============================================================================
# NETWORK ANALYTICS
# =============================================================================

@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(
    days: int = Query(7, ge=1, le=30),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Network analytics: alarm trends, problem ONUs, uptime SLA, signal degradation."""
    return noc_service.get_network_analytics(db, days=days)


# =============================================================================
# CAPACITY PLANNING
# =============================================================================

@router.get("/capacity", response_model=CapacityPlanningResponse)
def get_capacity(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Capacity planning: port utilization, signal distribution, growth, alerts."""
    return noc_service.get_capacity_planning(db)


# =============================================================================
# CUSTOMER INTELLIGENCE
# =============================================================================

@router.get("/customers", response_model=CustomerIntelResponse)
def get_customer_intelligence(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    filter_type: Optional[str] = Query(None, description="offline|critical|weak|expiring|expired|no_onu"),
    sort_by: str = Query("health_score", description="health_score|rx_power|name|expiry"),
    sort_dir: str = Query("asc", description="asc|desc"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Customer Intelligence: unified customer + ONU + billing view with health scores."""
    items, total = noc_service.get_customer_intelligence(
        db, page=page, page_size=page_size,
        search=search, filter_type=filter_type,
        sort_by=sort_by, sort_dir=sort_dir,
    )
    return {"customers": items, "total": total, "page": page, "page_size": page_size}


@router.get("/customers/{username}/dna", response_model=CustomerDNAResponse)
def get_customer_dna(
    username: str,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Single customer command-center profile: billing, OLT, alarms, tickets, survey, and PG context."""
    profile = noc_service.get_customer_dna(db, username)
    if not profile:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Customer not found")
    return profile


# =============================================================================
# ONU REBOOT
# =============================================================================

@router.post("/reboot-onu")
async def reboot_onu(
    body: RebootRequest,
    _admin=Depends(require_admin),
):
    """
    NOC-dashboard reboot — Admin only.

    Sister endpoints with the same OLT effect: /diagnostics/olt/reboot
    (admin diagnostics flow) and /field-team/reboot/{username} (mobile).
    Each is scoped to a different UX entry; all converge on
    `olt_service.reboot_onu(mac)`.
    """
    from services.olt_service import reboot_onu as do_reboot
    success = await do_reboot(body.mac_address)
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Reboot failed — OLT proxy unreachable or ONU not found")
    return {"status": "ok", "message": f"Reboot command sent to {body.mac_address}"}


# =============================================================================
# MANUAL ONU ↔ CUSTOMER LINKING
# =============================================================================

@router.post("/link-onu")
def link_onu(
    body: LinkONURequest,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """
    NOC-dashboard manual link — Admin only.

    Sister endpoint /field-team/link-onu serves the mobile scan flow and is
    open to any authenticated tech. Both delegate to
    `noc_service.link_onu_to_customer(...)`.
    """
    result = noc_service.link_onu_to_customer(
        db,
        body.onu_mac,
        body.customer_username,
        binding_source="admin_verified",
        changed_by="NOC Identity Review",
        reason=body.reason,
    )
    if result["status"] == "error":
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/unlink-onu")
def unlink_onu(
    body: UnlinkONURequest,
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Remove ONU↔customer link."""
    result = noc_service.unlink_onu(db, body.onu_mac)
    if result["status"] == "error":
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.get("/customer-search", response_model=CustomerSearchResponse)
def customer_search(
    q: str = Query(..., min_length=2),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Search customers by name/phone/address for manual ONU linking."""
    results, total = noc_service.search_customers_for_linking(db, q)
    return {"results": results, "total": total}


@router.get("/global-search", response_model=GlobalSearchResponse)
def global_search(
    q: str = Query(..., min_length=2),
    limit: int = Query(8, ge=1, le=20),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Unified NOC search across customers and ONUs."""
    return noc_service.global_search(db, q, limit=limit)


@router.get("/unlinked-onus")
def get_unlinked_onus(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """ONUs with no customer match — for manual linking UI."""
    onus = noc_service.get_unlinked_onus(db)
    return {"onus": onus, "total": len(onus)}


@router.get("/orphan-onus", response_model=OrphanONUResponse)
def get_orphan_onus(
    include_offline: bool = Query(False, description="Include offline or stale ONUs, not only online devices"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """ONUs that need billing/customer audit before they keep consuming capacity."""
    return noc_service.get_orphan_onus(db, include_offline=include_offline)


# =============================================================================
# PREDICTIONS
# =============================================================================

@router.get("/predictions", response_model=PredictionsResponse)
def get_predictions(
    limit: int = Query(100, ge=1, le=500),
    min_risk: Optional[str] = Query(None, description="Filter: MEDIUM or HIGH fiber_risk"),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Return ONU predictions sorted by health_score ascending (worst first)."""
    from sqlalchemy import text as _text
    preds = prediction_service.get_predictions(db, limit=limit, min_risk=min_risk)
    last_run = db.execute(_text("SELECT MAX(last_computed) FROM predictions")).scalar()
    return {"predictions": preds, "total": len(preds), "last_run": last_run}


@router.post("/run-predictions")
def run_predictions_now(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Trigger an immediate prediction run (normally runs nightly at 2AM)."""
    result = prediction_service.run_predictions(db)
    return {"status": "ok", **result}


# =============================================================================
# MAINTENANCE SCHEDULE
# =============================================================================

@router.get("/maintenance-schedule", response_model=MaintenanceScheduleResponse)
def get_maintenance_schedule(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """ONUs with weak/critical signal sorted by priority for field dispatch."""
    return noc_service.get_maintenance_schedule(db)


# =============================================================================
# HEALTH REPORT
# =============================================================================

@router.get("/health-report", response_model=HealthReportResponse)
def get_health_report(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Full network health snapshot — for management reports."""
    return noc_service.get_health_report(db)


@router.get("/system-health", response_model=SystemHealthResponse)
def get_system_health(
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Production dependency health for NOC operators."""
    return noc_service.get_system_health(db)


@router.get("/shift-brief")
def get_shift_brief(
    hours: int = Query(12, ge=1, le=24),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Shift-change handoff brief for NOC operators."""
    return noc_service.get_shift_brief(db, hours=hours)


@router.get("/media-audit")
def get_media_audit(
    include_orphans: bool = Query(True),
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(database.get_db),
    _admin=Depends(require_admin),
):
    """Audit uploads/ ownership, missing referenced files, and orphan files."""
    return media_audit_service.get_media_audit(db, include_orphans=include_orphans, limit=limit)
