import client from './client';
import type { NetworkSummary, PortStatus, ONUListItem, ONUDetail, AlarmItem, AlarmActionPayload, AlarmActionResult, SignalPoint, HeatmapPoint, BandwidthSummary, NOCTicketItem, CustomerIntelItem, CustomerDNA, CapacityPlanningData, AnalyticsData, TriageData, CustomerSearchItem, GlobalSearchItem, UnlinkedONU, OrphanONUResponse, MediaAuditData, PredictionsResponse, MaintenanceScheduleData, MaintenanceWindow, MaintenanceWindowCreate, HealthReportData, SystemHealthData, ShiftBriefData, TechLocationItem, TechMonitorData, PGBuildingSummary, PGBuildingDashboard, PGReviewEvent } from '../types/noc';

export async function fetchSummary(): Promise<NetworkSummary> {
  const { data } = await client.get('/noc/summary');
  return data;
}

export async function fetchPorts(oltHost?: string): Promise<PortStatus[]> {
  const params = oltHost ? { olt_host: oltHost } : {};
  const { data } = await client.get('/noc/ports', { params });
  return data.ports;
}

export async function fetchONUs(params: {
  page?: number;
  page_size?: number;
  status?: string;
  pon_port?: string;
  olt_host?: string;
  search?: string;
  signal_max?: number;
  linked?: string;
}): Promise<{ onus: ONUListItem[]; total: number; page: number; page_size: number }> {
  const { data } = await client.get('/noc/onus', { params });
  return data;
}

export async function fetchONUDetail(mac: string): Promise<ONUDetail> {
  const { data } = await client.get(`/noc/onus/${encodeURIComponent(mac)}`);
  return data;
}

export async function fetchSignalHistory(mac: string, hours = 24): Promise<SignalPoint[]> {
  const { data } = await client.get(`/noc/onus/${encodeURIComponent(mac)}/history`, { params: { hours } });
  return data;
}

export async function fetchAlarms(params: {
  page?: number;
  page_size?: number;
  event_type?: string;
  pon_port?: string;
  hours?: number;
  status?: string;
}): Promise<{ alarms: AlarmItem[]; total: number; page: number; page_size: number }> {
  const { data } = await client.get('/noc/alarms', { params });
  return data;
}

export async function acknowledgeAlarm(id: number, payload: AlarmActionPayload = {}): Promise<AlarmActionResult> {
  const { data } = await client.post(`/noc/alarms/${id}/ack`, payload);
  return data;
}

export async function suppressAlarm(id: number, payload: AlarmActionPayload): Promise<AlarmActionResult> {
  const { data } = await client.post(`/noc/alarms/${id}/suppress`, payload);
  return data;
}

export async function resolveAlarm(id: number, payload: AlarmActionPayload = {}): Promise<AlarmActionResult> {
  const { data } = await client.post(`/noc/alarms/${id}/resolve`, payload);
  return data;
}

export async function linkAlarmToOutage(id: number, payload: AlarmActionPayload): Promise<AlarmActionResult> {
  const { data } = await client.post(`/noc/alarms/${id}/link-outage`, payload);
  return data;
}

export async function fetchOutages() {
  const { data } = await client.get('/noc/outages');
  return data;
}

export async function fetchHeatmap(): Promise<HeatmapPoint[]> {
  const { data } = await client.get('/noc/heatmap');
  return data;
}

export async function fetchBandwidth(): Promise<BandwidthSummary> {
  const { data } = await client.get('/noc/bandwidth');
  return data;
}

export async function fetchNOCTickets(limit = 20): Promise<{ tickets: NOCTicketItem[]; total: number }> {
  const { data } = await client.get('/noc/tickets-summary', { params: { limit } });
  return data;
}

export async function forcePoll(): Promise<{ status: string; message: string }> {
  const { data } = await client.post('/noc/force-poll');
  return data;
}

export async function rebootONU(mac: string): Promise<{ status: string; message: string }> {
  const { data } = await client.post('/noc/reboot-onu', { mac_address: mac });
  return data;
}

export async function fetchTriage(): Promise<TriageData> {
  const { data } = await client.get('/noc/triage');
  return data;
}

export async function fetchAnalytics(days = 7): Promise<AnalyticsData> {
  const { data } = await client.get('/noc/analytics', { params: { days } });
  return data;
}

export async function fetchCapacityPlanning(): Promise<CapacityPlanningData> {
  const { data } = await client.get('/noc/capacity');
  return data;
}

export async function fetchCustomerIntelligence(params: {
  page?: number;
  page_size?: number;
  search?: string;
  filter_type?: string;
  sort_by?: string;
  sort_dir?: string;
}): Promise<{ customers: CustomerIntelItem[]; total: number; page: number; page_size: number }> {
  const { data } = await client.get('/noc/customers', { params });
  return data;
}

export async function fetchCustomerDNA(username: string): Promise<CustomerDNA> {
  const { data } = await client.get(`/noc/customers/${encodeURIComponent(username)}/dna`);
  return data;
}

// =============================================================================
// ONU LINKING
// =============================================================================

export async function searchCustomersForLinking(q: string): Promise<{ results: CustomerSearchItem[]; total: number }> {
  const { data } = await client.get('/noc/customer-search', { params: { q } });
  return data;
}

export async function globalSearch(q: string, limit = 8): Promise<{ results: GlobalSearchItem[]; total: number }> {
  const { data } = await client.get('/noc/global-search', { params: { q, limit } });
  return data;
}

export async function linkONU(onu_mac: string, customer_username: string, reason?: string): Promise<{ status: string; message: string }> {
  const { data } = await client.post('/noc/link-onu', { onu_mac, customer_username, reason });
  return data;
}

export async function unlinkONU(onu_mac: string): Promise<{ status: string; message: string }> {
  const { data } = await client.post('/noc/unlink-onu', { onu_mac });
  return data;
}

export async function fetchUnlinkedONUs(): Promise<{ onus: UnlinkedONU[]; total: number }> {
  const { data } = await client.get('/noc/unlinked-onus');
  return data;
}

export async function fetchOrphanONUs(includeOffline = false): Promise<OrphanONUResponse> {
  const { data } = await client.get('/noc/orphan-onus', {
    params: { include_offline: includeOffline },
  });
  return data;
}

export async function fetchMediaAudit(includeOrphans = true, limit = 500): Promise<MediaAuditData> {
  const { data } = await client.get('/noc/media-audit', {
    params: { include_orphans: includeOrphans, limit },
  });
  return data;
}

// =============================================================================
// PREDICTIONS
// =============================================================================

export async function fetchPredictions(limit = 100): Promise<PredictionsResponse> {
  const { data } = await client.get('/noc/predictions', { params: { limit } });
  return data;
}

export async function runPredictionsNow(): Promise<{ status: string; computed: number }> {
  const { data } = await client.post('/noc/run-predictions');
  return data;
}

// =============================================================================
// MAINTENANCE SCHEDULE
// =============================================================================

export async function fetchMaintenanceSchedule(): Promise<MaintenanceScheduleData> {
  const { data } = await client.get('/noc/maintenance-schedule');
  return data;
}

export async function fetchMaintenanceWindows(params?: { active_only?: boolean; include_expired?: boolean }): Promise<MaintenanceWindow[]> {
  const { data } = await client.get('/noc/maintenance-windows', { params });
  return data.windows;
}

export async function createMaintenanceWindow(payload: MaintenanceWindowCreate): Promise<MaintenanceWindow> {
  const { data } = await client.post('/noc/maintenance-windows', payload);
  return data;
}

export async function cancelMaintenanceWindow(id: number): Promise<MaintenanceWindow> {
  const { data } = await client.post(`/noc/maintenance-windows/${id}/cancel`);
  return data;
}

// =============================================================================
// HEALTH REPORT
// =============================================================================

export async function fetchHealthReport(): Promise<HealthReportData> {
  const { data } = await client.get('/noc/health-report');
  return data;
}

export async function fetchSystemHealth(): Promise<SystemHealthData> {
  const { data } = await client.get('/noc/system-health');
  return data;
}

export async function fetchShiftBrief(hours = 12): Promise<ShiftBriefData> {
  const { data } = await client.get('/noc/shift-brief', { params: { hours } });
  return data;
}

// =============================================================================
// FIELD TEAM GPS
// =============================================================================

export async function fetchTechLocations(hours = 4): Promise<{ locations: TechLocationItem[]; total: number }> {
  const { data } = await client.get('/field-team/locations', { params: { hours } });
  return data;
}

export async function fetchTechMonitor(hours = 24): Promise<TechMonitorData> {
  const { data } = await client.get('/field-team/monitor', { params: { hours } });
  return data;
}

export async function fetchPGBuildings(search?: string): Promise<PGBuildingSummary[]> {
  const { data } = await client.get('/pg/buildings', { params: search ? { search } : {} });
  return data;
}

export async function fetchPGBuildingDashboard(buildingId: string): Promise<PGBuildingDashboard> {
  const { data } = await client.get(`/pg/buildings/${encodeURIComponent(buildingId)}/dashboard`);
  return data;
}

export async function fetchPGReviews(limit = 100): Promise<PGReviewEvent[]> {
  const { data } = await client.get('/pg/room-reviews', { params: { limit } });
  return data;
}

export async function applyPGReview(roomId: string, eventId: number, reason: string): Promise<unknown> {
  const { data } = await client.post(
    `/pg/rooms/${encodeURIComponent(roomId)}/reviews/${eventId}/apply`,
    null,
    { params: { reason } },
  );
  return data;
}

export async function dismissPGReview(roomId: string, eventId: number, reason: string): Promise<unknown> {
  const { data } = await client.post(
    `/pg/rooms/${encodeURIComponent(roomId)}/reviews/${eventId}/dismiss`,
    null,
    { params: { reason } },
  );
  return data;
}

export async function login(username: string, password: string): Promise<string> {
  const form = new URLSearchParams();
  form.append('username', username);
  form.append('password', password);
  const { data } = await client.post('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data.access_token;
}
