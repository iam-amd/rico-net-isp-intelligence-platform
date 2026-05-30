"""Pydantic schemas for NOC Dashboard endpoints."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


# =============================================================================
# NETWORK SUMMARY (KPI strip)
# =============================================================================

class NetworkSummary(BaseModel):
    total_onus: int
    online: int
    offline: int
    avg_rx_power: Optional[float] = None
    worst_rx_power: Optional[float] = None
    alarm_count_24h: int = 0
    last_poll: Optional[datetime] = None
    olt_hosts: List[str] = []
    data_is_stale: bool = False        # True when last_poll > 10 min ago
    staleness_minutes: float = 0.0     # minutes since last OLT push
    live_data_available: bool = True
    source_status: str = "live"        # live | stale | unavailable
    freshness_message: Optional[str] = None
    metrics_are_last_known: bool = False


# =============================================================================
# PORT STATUS (PON port grid)
# =============================================================================

class PortStatus(BaseModel):
    pon_port: str
    olt_host: str
    total: int
    online: int
    offline: int
    avg_rx: Optional[float] = None
    worst_rx: Optional[float] = None
    worst_mac: Optional[str] = None
    last_poll: Optional[datetime] = None
    data_is_stale: bool = False


class PortGridResponse(BaseModel):
    ports: List[PortStatus]


# =============================================================================
# ONU LIST (paginated table)
# =============================================================================

class ONUListItem(BaseModel):
    mac_address: str
    olt_host: str
    pon_port: Optional[str] = None
    onu_index: Optional[int] = None
    status: Optional[str] = None
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    voltage_mv: Optional[int] = None
    dying_gasp: bool = False
    polled_at: Optional[datetime] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_plan: Optional[str] = None


class ONUListResponse(BaseModel):
    onus: List[ONUListItem]
    total: int
    page: int
    page_size: int


# =============================================================================
# ONU DETAIL
# =============================================================================

class SignalPoint(BaseModel):
    timestamp: datetime
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    status: Optional[str] = None


class PredictionSnapshot(BaseModel):
    health_score: Optional[int] = None
    fiber_risk: Optional[str] = None
    churn_risk: Optional[str] = None
    recommended_action: Optional[str] = None
    rx_slope_7d: Optional[float] = None
    rx_avg_7d: Optional[float] = None
    last_computed: Optional[str] = None


class BandwidthSnapshot(BaseModel):
    rx_mbps: Optional[float] = None
    tx_mbps: Optional[float] = None
    sampled_at: Optional[str] = None
    supported: bool = True
    source_status: str = "live"
    reason: Optional[str] = None


class ONUDetail(ONUListItem):
    # Device hardware info
    vendor_id: Optional[str] = None
    model_id: Optional[str] = None
    hw_version: Optional[str] = None
    sw_version: Optional[str] = None
    is_gpon: bool = False
    signal_available: bool = True
    # Alarm / event health
    alarm_count_24h: int = 0
    alarm_count_30d: int = 0
    flap_count_30d: int = 0
    open_alarms: int = 0
    # Prediction intelligence
    prediction: Optional[PredictionSnapshot] = None
    # Bandwidth
    bandwidth: Optional[BandwidthSnapshot] = None
    # Customer
    customer_expiry: Optional[datetime] = None
    customer_status: Optional[str] = None
    customer_balance: Optional[float] = None
    customer_address: Optional[str] = None
    customer_geo_lat: Optional[float] = None
    customer_geo_long: Optional[float] = None
    customer_id: Optional[int] = None
    customer_match_source: Optional[str] = None
    # Trusted ONU binding metadata
    binding_id: Optional[int] = None
    binding_customer_id: Optional[str] = None
    binding_active: bool = False
    binding_source: Optional[str] = None
    binding_confidence: Optional[str] = None
    binding_primary_identifier_type: Optional[str] = None
    binding_serial_number: Optional[str] = None
    binding_mac_address: Optional[str] = None
    binding_verified_at: Optional[datetime] = None
    binding_sticker_photo_url: Optional[str] = None
    history_24h: List[SignalPoint] = []


# =============================================================================
# HEATMAP
# =============================================================================

class HeatmapPoint(BaseModel):
    mac_address: str
    pon_port: Optional[str] = None
    olt_host: str
    status: Optional[str] = None
    rx_power_dbm: Optional[float] = None
    customer_username: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_plan: Optional[str] = None
    lat: float
    lng: float
    has_exact_location: bool = False
    location_tier: int = 3  # 1=GPS exact, 2=area-level, 3=cluster jitter
    location_source: Optional[str] = None
    pg_building_id: Optional[str] = None
    pg_building_name: Optional[str] = None
    pg_room_number: Optional[str] = None


# =============================================================================
# ALARM FEED
# =============================================================================

class AlarmItem(BaseModel):
    id: int
    mac_address: str
    event_type: str
    olt_host: Optional[str] = None
    pon_port: Optional[str] = None
    onu_index: Optional[int] = None
    received_at: datetime
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    status: Optional[str] = "open"
    occurrence_count: Optional[int] = 1
    resolved_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    acknowledged_by: Optional[int] = None
    acknowledged_at: Optional[datetime] = None
    suppressed_until: Optional[datetime] = None
    resolution_reason: Optional[str] = None
    operator_note: Optional[str] = None

    class Config:
        from_attributes = True


class AlarmListResponse(BaseModel):
    alarms: List[AlarmItem]
    total: int
    page: int
    page_size: int


class AlarmActionRequest(BaseModel):
    note: Optional[str] = None
    reason: Optional[str] = None
    suppressed_until: Optional[datetime] = None
    outage_type: Optional[str] = None  # pon_port | area
    outage_id: Optional[int] = None


class AlarmActionResponse(BaseModel):
    id: int
    status: str
    message: str
    acknowledged_at: Optional[datetime] = None
    suppressed_until: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    pon_port_outage_id: Optional[int] = None
    area_outage_id: Optional[int] = None


class MaintenanceWindowCreate(BaseModel):
    olt_host: str
    pon_port: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    reason: Optional[str] = None


class MaintenanceWindowItem(BaseModel):
    id: int
    olt_host: str
    pon_port: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    reason: Optional[str] = None
    created_by: Optional[int] = None
    is_active: bool
    created_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancelled_by: Optional[int] = None

    class Config:
        from_attributes = True


class MaintenanceWindowListResponse(BaseModel):
    windows: List[MaintenanceWindowItem]


# =============================================================================
# OUTAGE
# =============================================================================

class OutageEvent(BaseModel):
    pon_port: str
    olt_host: str
    affected_count: int
    total_count: int
    severity: str  # MINOR, MAJOR, CRITICAL, TOTAL
    offline_macs: List[str] = []
    detection: str = "PORT"  # PORT = port-threshold, CONCURRENT = time-correlated


# =============================================================================
# BANDWIDTH
# =============================================================================

class BandwidthSummary(BaseModel):
    downstream_mbps: Optional[float] = None
    upstream_mbps: Optional[float] = None
    per_port: List[dict] = []      # [{pon_port, downstream_mbps, upstream_mbps}]
    sample_window_seconds: int = 0  # how old is this data
    data_is_stale: bool = False
    sample_age_seconds: Optional[float] = None
    source_status: str = "live"
    message: Optional[str] = None


# =============================================================================
# ENHANCED SUMMARY (adds critical, flapping to base summary)
# =============================================================================

class EnhancedSummary(NetworkSummary):
    critical_signal: int = 0       # ONUs with Rx < -27 dBm
    flapping: int = 0              # ONUs with 3+ state transitions in 24h
    downstream_mbps: Optional[float] = None
    upstream_mbps: Optional[float] = None


# =============================================================================
# NOC TICKETS (open tickets for right panel)
# =============================================================================

class NOCTicketItem(BaseModel):
    id: int
    customer_name: Optional[str] = None
    issue_type: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    fault_type: Optional[str] = None    # parsed from tags
    created_at: Optional[datetime] = None


class NOCTicketsResponse(BaseModel):
    tickets: List[NOCTicketItem]
    total: int


# =============================================================================
# ONU REBOOT REQUEST
# =============================================================================

class RebootRequest(BaseModel):
    mac_address: str


class LinkONURequest(BaseModel):
    onu_mac: str
    customer_username: str
    reason: Optional[str] = None


class UnlinkONURequest(BaseModel):
    onu_mac: str


class OrphanONUItem(BaseModel):
    mac_address: str
    status: Optional[str] = None
    rx_power_dbm: Optional[float] = None
    pon_port: Optional[str] = None
    onu_index: Optional[int] = None
    olt_host: str
    polled_at: Optional[datetime] = None
    reason: str
    severity: str
    recommended_action: str
    match_source: str
    customer_username: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_status: Optional[str] = None
    customer_expiry_date: Optional[datetime] = None
    binding_id: Optional[int] = None
    binding_confidence: Optional[str] = None
    binding_source: Optional[str] = None


class OrphanONUSummary(BaseModel):
    total: int
    missing_customer: int
    inactive_customer: int
    expired_customer: int
    online: int
    offline: int


class OrphanONUResponse(BaseModel):
    summary: OrphanONUSummary
    onus: List[OrphanONUItem]


class CustomerSearchItem(BaseModel):
    username: str
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    plan_name: Optional[str] = None
    has_onu_link: bool = False


class CustomerSearchResponse(BaseModel):
    results: List[CustomerSearchItem]
    total: int


class GlobalSearchItem(BaseModel):
    type: str
    label: str
    subtitle: Optional[str] = None
    target_url: str
    customer_username: Optional[str] = None
    mac_address: Optional[str] = None
    status: Optional[str] = None
    match_source: Optional[str] = None


class GlobalSearchResponse(BaseModel):
    results: List[GlobalSearchItem]
    total: int


# =============================================================================
# CUSTOMER INTELLIGENCE
# =============================================================================

# =============================================================================
# CAPACITY PLANNING
# =============================================================================

# =============================================================================
# NETWORK ANALYTICS
# =============================================================================

# =============================================================================
# DIAGNOSTICS / TRIAGE
# =============================================================================

class FaultItem(BaseModel):
    mac_address: str
    olt_host: Optional[str] = None
    pon_port: Optional[str] = None
    onu_index: Optional[int] = None
    status: Optional[str] = None
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    dying_gasp: bool = False
    fault_type: str
    severity: str
    action: str
    priority: int
    alarm_count_24h: int = 0
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    polled_at: Optional[str] = None


class TriageSummary(BaseModel):
    total_faults: int
    total_healthy: int
    critical: int
    high: int
    medium: int


class TriageResponse(BaseModel):
    summary: TriageSummary
    fault_breakdown: List[dict]
    faults: List[FaultItem]


class AnalyticsSummary(BaseModel):
    total_alarms: int
    days_analyzed: int
    avg_network_uptime: Optional[float] = None
    problem_onu_count: int
    degrading_onu_count: int


class AnalyticsResponse(BaseModel):
    summary: AnalyticsSummary
    alarm_by_type: List[dict]
    alarm_trend: List[dict]
    alarm_by_port: List[dict]
    top_problem_onus: List[dict]
    uptime_sla: List[dict]
    worst_uptime_onus: List[dict]
    signal_degradation: List[dict]


class PortCapacity(BaseModel):
    pon_port: str
    olt_host: str
    total_onus: int
    max_capacity: int
    utilization_pct: float
    online: int
    offline: int
    avg_rx: Optional[float] = None
    worst_rx: Optional[float] = None
    signal_distribution: dict = {}


class OLTCapacity(BaseModel):
    olt_host: str
    total_onus: int
    total_ports: int
    max_capacity: int
    utilization_pct: float


class CapacitySummary(BaseModel):
    total_onus: int
    total_capacity: int
    overall_utilization_pct: float
    total_ports: int
    total_olts: int


class GrowthPoint(BaseModel):
    date: str
    onu_count: int
    avg_rx: Optional[float] = None
    avg_uptime: Optional[float] = None


class CapacityAlert(BaseModel):
    type: str  # CRITICAL, WARNING, SIGNAL
    port: str
    olt_host: str
    message: str


class CapacityPlanningResponse(BaseModel):
    summary: CapacitySummary
    ports: List[PortCapacity]
    olts: List[OLTCapacity]
    signal_distribution: dict
    growth_trend: List[GrowthPoint]
    alerts: List[CapacityAlert]


class CustomerIntelItem(BaseModel):
    # Identity
    username: str
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

    # Billing
    plan_name: Optional[str] = None
    expiry_date: Optional[datetime] = None
    balance: Optional[float] = None
    status: Optional[str] = None                   # Railwire account status
    monthly_data_used_mb: Optional[float] = None

    # ONU link
    mac_address: Optional[str] = None
    onu_mac: Optional[str] = None                   # EPON MAC (may differ from customer MAC)
    onu_status: Optional[str] = None                # online / offline
    pon_port: Optional[str] = None
    olt_host: Optional[str] = None

    # Signal
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    signal_level: Optional[str] = None              # excellent / good / weak / critical

    # Health score (0-100)
    health_score: int = 0
    health_factors: List[str] = []                  # what's pulling the score down

    # Timestamps
    last_seen_online: Optional[datetime] = None
    polled_at: Optional[datetime] = None

    # Alarm count (24h)
    alarm_count_24h: int = 0


class CustomerIntelResponse(BaseModel):
    customers: List[CustomerIntelItem]
    total: int
    page: int
    page_size: int


class CustomerDNAResponse(BaseModel):
    customer: Dict[str, Any]
    binding: Optional[Dict[str, Any]] = None
    onu: Optional[Dict[str, Any]] = None
    identity_conflicts: List[Dict[str, Any]] = []
    health: Dict[str, Any]
    alarms: List[Dict[str, Any]] = []
    tickets: List[Dict[str, Any]] = []
    survey: Optional[Dict[str, Any]] = None
    pg: Optional[Dict[str, Any]] = None
    provenance: List[Dict[str, Any]] = []
    audit_log: List[Dict[str, Any]] = []
    olt_capability: Optional[Dict[str, Any]] = None
    bandwidth: Optional[BandwidthSnapshot] = None
    prediction: Optional[Dict[str, Any]] = None
    links: Dict[str, Optional[str]]


# =============================================================================
# PREDICTIONS
# =============================================================================

class PredictionItem(BaseModel):
    mac_address: str
    olt_host: Optional[str] = None
    pon_port: Optional[str] = None
    rx_slope_7d: Optional[float] = None
    rx_avg_7d: Optional[float] = None
    alarm_count_30d: int = 0
    offline_count_30d: int = 0
    fiber_risk: Optional[str] = None   # LOW/MEDIUM/HIGH/CRITICAL
    churn_risk: Optional[str] = None   # LOW/MEDIUM/HIGH
    health_score: int = 100            # 0-100 composite
    recommended_action: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    last_computed: Optional[datetime] = None


class PredictionsResponse(BaseModel):
    predictions: List[PredictionItem]
    total: int
    last_run: Optional[datetime] = None


# =============================================================================
# MAINTENANCE SCHEDULE
# =============================================================================

class MaintenanceItem(BaseModel):
    mac_address: str
    olt_host: str
    pon_port: Optional[str] = None
    onu_index: Optional[int] = None
    rx_power_dbm: Optional[float] = None
    rx_slope_7d: Optional[float] = None
    signal_level: str                  # weak / critical
    recommended_action: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    priority: int                      # 1=dispatch now, 2=48h, 3=monitor


class MaintenanceScheduleResponse(BaseModel):
    items: List[MaintenanceItem]
    total: int
    critical_count: int
    high_count: int


# =============================================================================
# HEALTH REPORT
# =============================================================================

class HealthReportResponse(BaseModel):
    generated_at: datetime
    total_onus: int
    online: int
    offline: int
    online_pct: float
    critical_signal: int
    weak_signal: int
    avg_rx_power: Optional[float] = None
    avg_health_score: Optional[float] = None
    predictions_available: bool = False
    total_predictions: int = 0
    high_fiber_risk: int = 0
    high_churn_risk: int = 0
    open_tickets: int = 0
    alarm_count_24h: int = 0
    alarm_count_7d: int = 0


class SystemHealthComponent(BaseModel):
    name: str
    category: str
    status: str
    message: str
    operator_action: Optional[str] = None
    last_seen: Optional[datetime] = None
    age_seconds: Optional[float] = None
    details: Dict[str, Any] = {}


class SystemHealthResponse(BaseModel):
    generated_at: datetime
    overall_status: str
    counts: Dict[str, int]
    components: List[SystemHealthComponent]


# =============================================================================
# FIELD TEAM GPS
# =============================================================================

class TechLocationCreate(BaseModel):
    lat: float
    lng: float
    accuracy_m: Optional[float] = None
    battery_pct: Optional[int] = None


class TechLocationItem(BaseModel):
    technician_id: int
    technician_name: Optional[str] = None
    lat: float
    lng: float
    accuracy_m: Optional[float] = None
    battery_pct: Optional[int] = None
    timestamp: datetime
    minutes_ago: float = 0.0


class TechLocationsResponse(BaseModel):
    locations: List[TechLocationItem]
    total: int


class TechMonitorItem(BaseModel):
    technician_id: int
    technician_username: Optional[str] = None
    technician_name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    area_assigned: Optional[str] = None
    status: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None
    battery_pct: Optional[int] = None
    timestamp: Optional[datetime] = None
    minutes_ago: Optional[float] = None
    active_ticket_count: int = 0


class TechMonitorResponse(BaseModel):
    technicians: List[TechMonitorItem]
    total: int
    live: int
    stale: int
    missing: int


class ONURefreshResponse(BaseModel):
    """Fresh signal data returned after an on-demand ONU refresh."""
    mac_address: str
    status: str
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    voltage_mv: Optional[int] = None
    dying_gasp: bool = False
    polled_at: Optional[str] = None
    source: str = "proxy_refresh"
