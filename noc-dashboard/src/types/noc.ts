export interface NetworkSummary {
  total_onus: number;
  online: number;
  offline: number;
  avg_rx_power: number | null;
  worst_rx_power: number | null;
  alarm_count_24h: number;
  last_poll: string | null;
  olt_hosts: string[];
  data_is_stale: boolean;
  staleness_minutes: number;
  live_data_available: boolean;
  source_status: string;
  freshness_message: string | null;
  metrics_are_last_known: boolean;
  critical_signal: number;
  flapping: number;
  downstream_mbps: number | null;
  upstream_mbps: number | null;
}

export interface BandwidthSummary {
  downstream_mbps: number | null;
  upstream_mbps: number | null;
  per_port: { pon_port: string; downstream_mbps: number; upstream_mbps: number }[];
  sample_window_seconds: number;
  data_is_stale: boolean;
  sample_age_seconds: number | null;
  source_status: string;
  message: string | null;
}

export interface NOCTicketItem {
  id: number;
  customer_name: string | null;
  issue_type: string | null;
  priority: string | null;
  status: string | null;
  fault_type: string | null;
  created_at: string | null;
}

export interface PortStatus {
  pon_port: string;
  olt_host: string;
  total: number;
  online: number;
  offline: number;
  avg_rx: number | null;
  worst_rx: number | null;
  worst_mac: string | null;
  last_poll: string | null;
  data_is_stale: boolean;
}

export interface ONUListItem {
  mac_address: string;
  olt_host: string;
  pon_port: string | null;
  onu_index: number | null;
  status: string | null;
  rx_power_dbm: number | null;
  tx_power_dbm: number | null;
  temperature_c: number | null;
  voltage_mv: number | null;
  dying_gasp: boolean;
  polled_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_plan: string | null;
}

export interface SignalPoint {
  timestamp: string;
  rx_power_dbm: number | null;
  tx_power_dbm: number | null;
  status: string | null;
  rx_mbps?: number | null;
  tx_mbps?: number | null;
  distance_m?: number | null;
}

export interface ONUDetail extends ONUListItem {
  customer_expiry: string | null;
  customer_status: string | null;
  customer_balance: number | null;
  customer_address: string | null;
  customer_geo_lat: number | null;
  customer_geo_long: number | null;
  customer_id: number | null;
  customer_match_source: string | null;
  binding_id: number | null;
  binding_customer_id: string | null;
  binding_active: boolean;
  binding_source: string | null;
  binding_confidence: string | null;
  binding_primary_identifier_type: string | null;
  binding_serial_number: string | null;
  binding_mac_address: string | null;
  binding_verified_at: string | null;
  binding_sticker_photo_url: string | null;
  history_24h: SignalPoint[];
}

export interface HeatmapPoint {
  mac_address: string;
  pon_port: string | null;
  olt_host: string;
  status: string | null;
  rx_power_dbm: number | null;
  customer_username: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_plan: string | null;
  lat: number;
  lng: number;
  has_exact_location: boolean;
  location_tier: number; // 1=GPS exact, 2=area-level, 3=cluster jitter
  location_source: string | null;
  pg_building_id: string | null;
  pg_building_name: string | null;
  pg_room_number: string | null;
}

export interface AlarmItem {
  id: number;
  mac_address: string;
  event_type: string;
  olt_host: string | null;
  pon_port: string | null;
  onu_index: number | null;
  received_at: string;
  customer_name: string | null;
  status: string | null;           // open | resolved | suppressed
  occurrence_count: number | null; // how many times this alarm fired
  resolved_at: string | null;
  duration_seconds: number | null;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  suppressed_until: string | null;
  resolution_reason: string | null;
  operator_note: string | null;
}

export interface AlarmActionPayload {
  note?: string | null;
  reason?: string | null;
  suppressed_until?: string | null;
  outage_type?: 'pon_port' | 'area' | string | null;
  outage_id?: number | null;
}

export interface AlarmActionResult {
  id: number;
  status: string;
  message: string;
  acknowledged_at: string | null;
  suppressed_until: string | null;
  resolved_at: string | null;
  pon_port_outage_id: number | null;
  area_outage_id: number | null;
}

export interface OutageEvent {
  pon_port: string;
  olt_host: string;
  affected_count: number;
  total_count: number;
  severity: string;
  offline_macs: string[];
}

export type SignalLevel = 'excellent' | 'good' | 'weak' | 'critical' | 'offline';


// =============================================================================
// CAPACITY PLANNING
// =============================================================================

// =============================================================================
// DIAGNOSTICS / TRIAGE
// =============================================================================

export interface FaultItem {
  mac_address: string;
  olt_host: string | null;
  pon_port: string | null;
  onu_index: number | null;
  status: string | null;
  rx_power_dbm: number | null;
  tx_power_dbm: number | null;
  temperature_c: number | null;
  dying_gasp: boolean;
  fault_type: string;
  severity: string;
  action: string;
  priority: number;
  alarm_count_24h: number;
  customer_name: string | null;
  customer_phone: string | null;
  polled_at: string | null;
}

export interface TriageData {
  summary: {
    total_faults: number;
    total_healthy: number;
    critical: number;
    high: number;
    medium: number;
  };
  fault_breakdown: { fault_type: string; count: number }[];
  faults: FaultItem[];
}


// =============================================================================
// NETWORK ANALYTICS
// =============================================================================

export interface AnalyticsSummary {
  total_alarms: number;
  days_analyzed: number;
  avg_network_uptime: number | null;
  problem_onu_count: number;
  degrading_onu_count: number;
}

export interface ProblemONU {
  mac_address: string;
  alarm_count: number;
  pon_port: string | null;
  status: string | null;
  rx_power_dbm: number | null;
  customer_name: string | null;
  customer_phone: string | null;
}

export interface UptimeSLA {
  date: string;
  avg_uptime: number | null;
  worst_uptime: number | null;
  onu_count: number;
  sla_99_pct: number;
  sla_95_pct: number;
  avg_rx: number | null;
}

export interface SignalDegradation {
  mac_address: string;
  first_rx: number;
  last_rx: number;
  delta: number;
  customer_name: string | null;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  alarm_by_type: { event_type: string; count: number }[];
  alarm_trend: Record<string, any>[];
  alarm_by_port: { pon_port: string; count: number }[];
  top_problem_onus: ProblemONU[];
  uptime_sla: UptimeSLA[];
  worst_uptime_onus: { mac_address: string; avg_uptime: number; days_tracked: number; customer_name: string | null }[];
  signal_degradation: SignalDegradation[];
}

export interface PortCapacity {
  pon_port: string;
  olt_host: string;
  total_onus: number;
  max_capacity: number;
  utilization_pct: number;
  online: number;
  offline: number;
  avg_rx: number | null;
  worst_rx: number | null;
  signal_distribution: {
    excellent: number;
    good: number;
    weak: number;
    critical: number;
  };
}

export interface OLTCapacity {
  olt_host: string;
  total_onus: number;
  total_ports: number;
  max_capacity: number;
  utilization_pct: number;
}

export interface GrowthPoint {
  date: string;
  onu_count: number;
  avg_rx: number | null;
  avg_uptime: number | null;
}

export interface CapacityAlert {
  type: string;
  port: string;
  olt_host: string;
  message: string;
}

export interface CapacityPlanningData {
  summary: {
    total_onus: number;
    total_capacity: number;
    overall_utilization_pct: number;
    total_ports: number;
    total_olts: number;
  };
  ports: PortCapacity[];
  olts: OLTCapacity[];
  signal_distribution: {
    excellent: number;
    good: number;
    weak: number;
    critical: number;
    no_signal: number;
  };
  growth_trend: GrowthPoint[];
  alerts: CapacityAlert[];
}


// =============================================================================
// CUSTOMER INTELLIGENCE
// =============================================================================

// =============================================================================
// ONU LINKING
// =============================================================================

export interface CustomerSearchItem {
  username: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  plan_name: string | null;
  has_onu_link: boolean;
}

export interface GlobalSearchItem {
  type: string;
  label: string;
  subtitle: string | null;
  target_url: string;
  customer_username: string | null;
  mac_address: string | null;
  status: string | null;
  match_source: string | null;
}

export interface UnlinkedONU {
  mac_address: string;
  status: string | null;
  rx_power_dbm: number | null;
  pon_port: string | null;
  onu_index: number | null;
  olt_host: string;
}

export interface OrphanONU {
  mac_address: string;
  status: string | null;
  rx_power_dbm: number | null;
  pon_port: string | null;
  onu_index: number | null;
  olt_host: string;
  polled_at: string | null;
  reason: string;
  severity: string;
  recommended_action: string;
  match_source: string;
  customer_username: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_status: string | null;
  customer_expiry_date: string | null;
  binding_id: number | null;
  binding_confidence: string | null;
  binding_source: string | null;
}

export interface OrphanONUSummary {
  total: number;
  missing_customer: number;
  inactive_customer: number;
  expired_customer: number;
  online: number;
  offline: number;
}

export interface OrphanONUResponse {
  summary: OrphanONUSummary;
  onus: OrphanONU[];
}

export interface MediaOwnerRef {
  url: string;
  owner_type: string;
  owner_id: string;
  field: string;
}

export interface MissingMediaFile {
  url: string;
  expected_path: string;
  owners: MediaOwnerRef[];
}

export interface OrphanMediaFile {
  url: string;
  relative_path: string;
  size_bytes: number;
  modified_at: number;
}

export interface DuplicateMediaReference {
  url: string;
  owners: MediaOwnerRef[];
}

export interface MediaAuditData {
  upload_root: string;
  summary: {
    referenced_urls: number;
    disk_files: number;
    missing_files: number;
    orphan_files: number;
    duplicate_references: number;
    referenced_size_bytes: number;
    orphan_size_bytes: number;
  };
  missing_files: MissingMediaFile[];
  orphan_files: OrphanMediaFile[];
  duplicate_references: DuplicateMediaReference[];
}

// =============================================================================
// PREDICTIONS
// =============================================================================

export interface PredictionItem {
  mac_address: string;
  olt_host: string | null;
  pon_port: string | null;
  rx_slope_7d: number | null;
  rx_avg_7d: number | null;
  alarm_count_30d: number;
  offline_count_30d: number;
  fiber_risk: string | null;   // LOW/MEDIUM/HIGH/CRITICAL
  churn_risk: string | null;   // LOW/MEDIUM/HIGH
  health_score: number;
  recommended_action: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  last_computed: string | null;
}

export interface PredictionsResponse {
  predictions: PredictionItem[];
  total: number;
  last_run: string | null;
}

// =============================================================================
// MAINTENANCE SCHEDULE
// =============================================================================

export interface MaintenanceItem {
  mac_address: string;
  olt_host: string;
  pon_port: string | null;
  onu_index: number | null;
  rx_power_dbm: number | null;
  rx_slope_7d: number | null;
  signal_level: string;
  recommended_action: string;
  customer_name: string | null;
  customer_phone: string | null;
  priority: number;
}

export interface MaintenanceScheduleData {
  items: MaintenanceItem[];
  total: number;
  critical_count: number;
  high_count: number;
}

// =============================================================================
// HEALTH REPORT
// =============================================================================

export interface HealthReportData {
  generated_at: string;
  total_onus: number;
  online: number;
  offline: number;
  online_pct: number;
  critical_signal: number;
  weak_signal: number;
  avg_rx_power: number | null;
  avg_health_score: number | null;
  predictions_available: boolean;
  total_predictions: number;
  high_fiber_risk: number;
  high_churn_risk: number;
  open_tickets: number;
  alarm_count_24h: number;
  alarm_count_7d: number;
}

export interface SystemHealthComponent {
  name: string;
  category: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown' | string;
  message: string;
  operator_action: string | null;
  last_seen: string | null;
  age_seconds: number | null;
  details: Record<string, unknown>;
}

export interface SystemHealthData {
  generated_at: string;
  overall_status: 'ok' | 'warning' | 'critical' | 'unknown' | string;
  counts: Record<string, number>;
  components: SystemHealthComponent[];
}

export interface MaintenanceWindow {
  id: number;
  olt_host: string;
  pon_port: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_by: number | null;
  is_active: boolean;
  created_at: string | null;
  cancelled_at: string | null;
  cancelled_by: number | null;
}

export interface MaintenanceWindowCreate {
  olt_host: string;
  pon_port?: string | null;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
}

export interface ShiftBriefAlarm {
  id: number;
  event_type: string;
  mac_address: string;
  olt_host: string | null;
  pon_port: string | null;
  onu_index: number | null;
  received_at: string;
  occurrence_count: number;
}

export interface ShiftBriefData {
  generated_at: string;
  window_hours: number;
  alarms: {
    open_total: number;
    received_in_window: number;
    breakdown: { event_type: string; count: number }[];
    latest_open: ShiftBriefAlarm[];
  };
  tickets: {
    open: number;
    assigned: number;
    ongoing: number;
    overdue: number;
  };
  orphan_onus: OrphanONUSummary;
  maintenance: {
    id: number;
    olt_host: string;
    pon_port: string | null;
    starts_at: string;
    ends_at: string;
    reason: string | null;
    is_current: boolean;
  }[];
  system_health: {
    unhealthy_total: number;
    components: SystemHealthComponent[];
  };
  handoff_actions: string[];
}

// =============================================================================
// FIELD TEAM GPS
// =============================================================================

export interface TechLocationItem {
  technician_id: number;
  technician_name: string | null;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  battery_pct: number | null;
  timestamp: string;
  minutes_ago: number;
}

export interface TechMonitorItem {
  technician_id: number;
  technician_username: string | null;
  technician_name: string | null;
  phone: string | null;
  role: string | null;
  area_assigned: string | null;
  status: 'live' | 'recent' | 'stale' | 'missing' | string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  battery_pct: number | null;
  timestamp: string | null;
  minutes_ago: number | null;
  active_ticket_count: number;
}

export interface TechMonitorData {
  technicians: TechMonitorItem[];
  total: number;
  live: number;
  stale: number;
  missing: number;
}

// =============================================================================
// PG BUILDING NOC VIEW
// =============================================================================

export interface PGBuildingSummary {
  id: string;
  name: string;
  pg_type: string;
  address: string | null;
  owner_name: string | null;
  owner_mobile: string | null;
  total_floors: number;
  total_rooms: number;
  done_rooms: number;
  pending_rooms: number;
  online_count?: number;
  offline_count?: number;
  unlinked_count?: number;
}

export interface PGRoomCustomer {
  username: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  plan_name: string | null;
  status: string | null;
  mac_address: string | null;
}

export interface PGRoomONU {
  status: string | null;
  rx_power_dbm: number | null;
  signal_label: string | null;
  polled_at: string | null;
  match_type?: string | null;
  matched_value?: string | null;
  stale?: boolean;
}

export interface PGRoomDashboard {
  id: string;
  floor_id: string;
  building_id: string;
  room_number: string;
  status: string;
  connection_type: string;
  username: string | null;
  ont_serial: string | null;
  mac_address: string | null;
  ont_model: string | null;
  router_group_id: string | null;
  customer: PGRoomCustomer | null;
  onu: PGRoomONU | null;
  room_onu: PGRoomONU | null;
  conflict: string | null;
}

export interface PGFloorDashboard {
  id: string;
  building_id: string;
  floor_number: number;
  rooms: PGRoomDashboard[];
}

export interface PGBuildingDashboard extends PGBuildingSummary {
  floors: PGFloorDashboard[];
}

export interface PGReviewEvent {
  id: number;
  entity_type: string;
  entity_id: string;
  building_id: string | null;
  room_id: string | null;
  action: string;
  reason: string | null;
  changed_by: string | null;
  before_data: Record<string, any> | null;
  after_data: {
    current?: Record<string, any>;
    proposed?: Record<string, any>;
    review_event_id?: number;
  } | null;
  created_at: string;
}

export interface CustomerIntelItem {
  username: string;
  name: string | null;
  phone: string | null;
  address: string | null;

  plan_name: string | null;
  expiry_date: string | null;
  balance: number | null;
  status: string | null;
  monthly_data_used_mb: number | null;

  mac_address: string | null;
  onu_mac: string | null;
  onu_status: string | null;
  pon_port: string | null;
  olt_host: string | null;

  rx_power_dbm: number | null;
  tx_power_dbm: number | null;
  temperature_c: number | null;
  signal_level: string | null;

  health_score: number;
  health_factors: string[];

  last_seen_online: string | null;
  polled_at: string | null;
  alarm_count_24h: number;
}

export interface CustomerDNA {
  customer: {
    username: string;
    id: number | null;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    alt_phone: string | null;
    email: string | null;
    railwire_address: string | null;
    rico_address: string | null;
    notes: string | null;
    plan_name: string | null;
    expiry_date: string | null;
    status: string | null;
    balance: number | null;
    framed_ip: string | null;
    monthly_data_used_mb: number | null;
    connection_status: string | null;
    last_seen_online: string | null;
    mac_address: string | null;
    device_setup: string | null;
    ont_serial_number: string | null;
    ont_model: string | null;
    ont_sticker_data: Record<string, unknown> | null;
    router_mac_address: string | null;
    router_model: string | null;
    router_serial: string | null;
    router_sticker_data: Record<string, unknown> | null;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    gps_lat: number | null;
    gps_lng: number | null;
    gps_accuracy_m: number | null;
    geo_lat: number | null;
    geo_long: number | null;
    map_lat: number | null;
    map_lng: number | null;
    location_source: string | null;
    install_photo_url: string | null;
    sticker_photo_url: string | null;
    router_sticker_photo_url: string | null;
    last_surveyed_at: string | null;
    pole_group_id: number | null;
    pole_group_name: string | null;
    created_at: string | null;
    last_updated: string | null;
  };
  binding: {
    id: number;
    onu_identifier: string;
    onu_type: string;
    primary_identifier_type: string | null;
    serial_number: string | null;
    mac_address: string | null;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    binding_source: string | null;
    confidence: string | null;
    first_seen: string | null;
    last_seen: string | null;
    verified_at: string | null;
    sticker_photo_url: string | null;
    notes: string | null;
  } | null;
  onu: {
    mac_address: string;
    olt_host: string;
    pon_port: string | null;
    onu_index: number | null;
    status: string | null;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    temperature_c: number | null;
    voltage_mv: number | null;
    dying_gasp: boolean;
    polled_at: string | null;
    age_seconds: number | null;
    stale: boolean;
    vendor_id: string | null;
    model_id: string | null;
    hw_version: string | null;
    sw_version: string | null;
    signal_level: string | null;
  } | null;
  identity_conflicts?: {
    kind: string;
    severity: string;
    message: string;
    onu?: {
      mac_address: string;
      olt_host: string;
      pon_port: string | null;
      onu_index: number | null;
      status: string | null;
      rx_power_dbm: number | null;
      polled_at: string | null;
      age_seconds: number | null;
      stale: boolean;
    };
  }[];
  health: {
    score: number;
    factors: string[];
    flags: Record<string, boolean>;
    alarm_count_24h: number;
    open_ticket_count: number;
    identity_values: string[];
    decision: string;
  };
  alarms: {
    id: number;
    mac_address: string;
    event_type: string;
    status: string | null;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    received_at: string;
    resolved_at: string | null;
    occurrence_count: number | null;
  }[];
  tickets: {
    id: number;
    issue_type: string | null;
    priority: string | null;
    status: string | null;
    description: string | null;
    assigned_tech: string | null;
    created_at: string | null;
    assigned_at: string | null;
    started_at: string | null;
    resolved_at: string | null;
    closed_at: string | null;
  }[];
  survey: {
    assignment_id: number;
    campaign_id: number;
    collector_id: number;
    collector_name: string | null;
    status: string;
    skip_reason: string | null;
    attempts: number;
    assigned_at: string | null;
    completed_at: string | null;
    last_surveyed_at: string | null;
  } | null;
  pg: {
    building_id: string;
    building_name: string | null;
    building_type: string | null;
    building_address: string | null;
    building_gps_lat: number | null;
    building_gps_lng: number | null;
    floor_id: string;
    floor_number: number | null;
    room_id: string;
    room_number: string;
    room_status: string;
    connection_type: string;
    router_group_id: string | null;
    router_group_name: string | null;
    room_ont_serial: string | null;
    room_mac_address: string | null;
    room_ont_model: string | null;
    tech_note: string | null;
    collected_at: string | null;
  } | null;
  provenance: {
    field_name: string;
    source: string;
    source_rank: number;
    writer: string | null;
    evidence_ref: string | null;
    updated_at: string | null;
    verified_at: string | null;
    notes: string | null;
  }[];
  audit_log: {
    id: number;
    action: string;
    field_name: string | null;
    old_value: string | null;
    new_value: string | null;
    changed_by: string | null;
    changed_at: string | null;
  }[];
  bandwidth: {
    rx_mbps: number | null;
    tx_mbps: number | null;
    sampled_at: string | null;
    supported?: boolean;
    source_status?: string;
    reason?: string | null;
  } | null;
  olt_capability?: {
    host: string | null;
    name: string;
    olt_type: string;
    model: string;
    firmware: string;
    has_lan_mac_table: boolean;
    lan_mac_oid: string | null;
    requires_survey_for_binding: boolean;
    has_customer_bandwidth: boolean;
    has_pon_bandwidth: boolean;
    has_offline_reason: boolean;
    has_traps_verified: boolean;
    customer_bandwidth_reason: string;
    binding_match_note: string;
  } | null;
  prediction: {
    health_score: number;
    fiber_risk: string | null;
    churn_risk: string | null;
    recommended_action: string | null;
    rx_slope_7d: number | null;
    rx_avg_7d: number | null;
    last_computed: string | null;
  } | null;
  links: {
    customer: string | null;
    onu: string | null;
    map: string | null;
    pg: string | null;
  };
}
