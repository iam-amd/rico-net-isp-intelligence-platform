// ============================================================
// RICO NET — TECHNICIAN MOBILE APP — TYPE DEFINITIONS
// Production-grade type system for the entire mobile app
// ============================================================

// ------------------------------------------------------------------
// 1. ENUMS & CONSTANTS
// ------------------------------------------------------------------

export type TicketStatus = 'Open' | 'Assigned' | 'Ongoing' | 'Resolved' | 'Closed';

export type Priority = 'Low' | 'Normal' | 'High';

export type TechnicianRole = 'Field Tech' | 'Senior Tech' | 'Admin';

/**
 * Valid ticket status transitions.
 * Maps each status -> list of statuses it can transition to.
 * This is the mobile-side state machine. Backend has its own validation.
 */
export const VALID_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
    'Open': ['Assigned', 'Ongoing'],
    'Assigned': ['Ongoing', 'Open'],
    'Ongoing': ['Resolved', 'Assigned'],
    'Resolved': ['Closed', 'Ongoing'],
    'Closed': ['Open', 'Ongoing', 'Assigned'],
};

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(from: TicketStatus, to: TicketStatus): boolean {
    return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ------------------------------------------------------------------
// 2. USER / AUTH TYPES
// ------------------------------------------------------------------

export interface TechnicianUser {
    token: string;
    id: number;
    username: string;
    full_name: string;
    role: TechnicianRole;
}

// ------------------------------------------------------------------
// 3. CUSTOMER TYPES
// ------------------------------------------------------------------

/**
 * A linked phone number for a customer (multi-number support).
 * Matches backend schema: CustomerPhoneResponse.
 */
export interface CustomerPhone {
    id: number;
    phone_number: string;
    label: string;
    is_primary: boolean;
    created_at: string;
}

/**
 * Customer connection status — derived from diagnostics or manual check.
 */
export type CustomerConnectionStatus = 'online' | 'offline' | 'unknown';

export interface Customer {
    /** Primary key is `username` (string), not a numeric id. */
    username: string;
    first_name: string;
    last_name?: string;
    phone?: string;
    email?: string;
    notes?: string;
    railwire_address?: string;

    // Billing
    plan_name?: string;
    expiry_date?: string;
    status?: string;
    balance?: number;

    // Rico Net specifics
    rico_address?: string;
    geo_lat?: number;
    geo_long?: number;
    gps_lat?: number;
    gps_lng?: number;
    gps_accuracy_m?: number;
    pole_id?: string;
    splitter_id?: string;
    wifi_ssid?: string;
    wifi_ssid_5g?: string;
    wifi_password?: string;
    mac_address?: string;
    olt_host?: string;
    pon_port?: string;
    onu_index?: number;

    // Survey / ONT data (collected by field team)
    device_setup?: 'single_ont' | 'onu_router';
    ont_serial_number?: string;
    ont_model?: string;
    ont_sticker_data?: Record<string, any>;
    router_mac_address?: string;
    router_model?: string;
    router_serial?: string;
    router_sticker_data?: Record<string, any>;
    install_photo_url?: string;
    sticker_photo_url?: string;
    router_sticker_photo_url?: string;
    last_surveyed_at?: string;

    // PG / Pole Group
    pg_id?: number | null;
    pg_name?: string | null;

    // Relations
    tickets?: TicketSummary[];
    phones?: CustomerPhone[];

    // Timestamps
    created_at?: string;
    last_updated?: string;
    last_enriched_at?: string;
}

/**
 * Lightweight ticket summary embedded in Customer responses.
 * Matches backend schema: TicketSummary.
 */
export interface TicketSummary {
    id: number;
    issue_type: string;
    status: string;
    created_at: string;
    description?: string;
}

/**
 * Customer summary embedded in Ticket responses.
 * Matches backend schema: CustomerSummary.
 */
export interface CustomerSummary {
    username: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    railwire_address?: string;
    rico_address?: string;
    geo_lat?: number;
    geo_long?: number;
    mac_address?: string;
    olt_host?: string;
    pon_port?: string;
    phones?: CustomerPhone[];
}

/**
 * Paginated customer list response.
 * Matches backend schema: CustomerListResponse.
 */
export interface CustomerListResponse {
    items: Customer[];
    total: number;
}

// ------------------------------------------------------------------
// 4. TICKET TYPES
// ------------------------------------------------------------------

export interface TicketMedia {
    id: number;
    ticket_id?: number;
    file_type: string;
    file_path: string;
    filename: string;
    uploaded_at: string;
}

export interface TicketComment {
    id: number;
    ticket_id?: number;
    author: string;
    content: string;
    is_internal: number;
    created_at: string;
}

/**
 * Audit log entry for a ticket.
 * Matches backend schema: TicketAuditLogResponse.
 */
export interface TicketAuditLog {
    id: number;
    ticket_id?: number;
    action: string;
    field_name?: string;
    old_value?: string;
    new_value?: string;
    changed_by?: number;
    changed_at: string;
}

export interface Ticket {
    id: number;
    customer_id: string;
    customer?: CustomerSummary;
    issue_type: string;
    priority: Priority;
    status: TicketStatus;
    assigned_tech?: string;
    description?: string;
    internal_notes?: string;
    materials_used?: string;
    sub_issue?: string;
    tags?: string;
    resolution_remarks?: string;
    created_at?: string;
    updated_at?: string;
    assigned_at?: string;
    started_at?: string;
    resolved_at?: string;
    closed_at?: string;
    media?: TicketMedia[];
    comments?: TicketComment[];
    audit_log?: TicketAuditLog[];
}

export interface UpdateTicketPayload {
    status?: TicketStatus;
    internal_notes?: string;
    materials_used?: string;
    assigned_tech?: string;
    geo_lat?: number;
    geo_long?: number;
    resolution_details?: string;
    signal_strength?: string;
    description?: string;
    priority?: string;
    issue_type?: string;
    sub_issue?: string;
    tags?: string;
}

/**
 * Paginated ticket list response.
 * Matches backend schema: TicketListResponse.
 */
export interface TicketListResponse {
    items: Ticket[];
    total: number;
}

// ------------------------------------------------------------------
// 5. INVENTORY TYPES
// ------------------------------------------------------------------

export interface InventoryItem {
    id: number;
    name: string;
    category: string;
    quantity: number;
    unit: string;
    last_updated?: string;
}

/**
 * Paginated inventory list response.
 * Matches backend schema: InventoryListResponse.
 */
export interface InventoryListResponse {
    items: InventoryItem[];
    total: number;
}

// ------------------------------------------------------------------
// 6. API ERROR TYPES
// ------------------------------------------------------------------

export class ApiError extends Error {
    statusCode: number;
    field?: string;
    isNetworkError: boolean;

    constructor(message: string, statusCode: number = 0, field?: string, isNetworkError: boolean = false) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.field = field;
        this.isNetworkError = isNetworkError;
    }
}

// ------------------------------------------------------------------
// 7. TECHNICIAN STATS (for profile screen)
// ------------------------------------------------------------------

export interface TechnicianStats {
    assigned_count: number;
    ongoing_count: number;
    resolved_count: number;
    total_count: number;
}

// ------------------------------------------------------------------
// 8. OFFLINE QUEUE TYPES
// ------------------------------------------------------------------

export interface QueuedMediaUpload {
    /** Local file URI (file://...) or web blob URL. The file must still exist
     *  on disk at replay time; if not, the queued item is dropped. */
    uri: string;
    fileType: string;
    fileName: string;
}

export interface QueuedOperation {
    id: string;
    type: 'updateTicket' | 'uploadMedia' | 'deleteMedia' | 'completeTicket' | 'addComment';
    endpoint: string;
    method: 'PUT' | 'POST' | 'DELETE';
    payload?: any;
    /** Set only for type === 'uploadMedia'. Holds the source file URI so the
     *  queue can rebuild a FormData on replay (FormData itself can't be
     *  JSON-serialised into AsyncStorage). */
    mediaUpload?: QueuedMediaUpload;
    ticketId: string | number;
    retryCount: number;
    createdAt: string;
    lastAttempt?: string;
    error?: string;
}

export interface QueueStatus {
    pending: number;
    failed: number;
    isProcessing: boolean;
}

// ------------------------------------------------------------------
// 9. TICKET COMPLETE TYPES
// ------------------------------------------------------------------

export interface EnrichmentData {
    geo_lat?: number;
    geo_long?: number;
    corrected_address?: string;
    wifi_ssid?: string;
    wifi_password?: string;
}

export interface TicketCompletePayload {
    resolution_remarks: string;
    materials_used?: string;
    enrichment: EnrichmentData;
}

export interface TicketCompleteResponse {
    ticket: Ticket;
    enrichment_applied: boolean;
    enriched_fields: string[];
}

// ------------------------------------------------------------------
// 10. DIAGNOSTICS TYPES
// ------------------------------------------------------------------

export interface DiagnosticAlert {
    alert_type: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    details?: Record<string, any>;
}

export interface DiagnosticsResponse {
    customer_username: string;
    customer_name: string;
    alerts: DiagnosticAlert[];
    can_create_ticket: boolean;
    summary: string;
}

// ------------------------------------------------------------------
// 11. FIELD TECH INTELLIGENCE TYPES
// ------------------------------------------------------------------

export type SignalLevel = 'excellent' | 'good' | 'weak' | 'critical';
export type FaultType = 'POWER_CUT' | 'FIBER_CRITICAL' | 'FIBER_WEAK' | 'FIBER_FLAP' | 'ONU_OFFLINE';
export type BillingStatus = 'active' | 'expiring' | 'expired' | 'unknown';

export interface SignalPoint {
    timestamp: string;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    status: string | null;
}

export interface AreaOutageInfo {
    pon_port: string;
    olt_host: string;
    affected_count: number;
    total_count: number;
    severity: string;
    detection: string;
    outage: boolean;
}

export interface TicketBriefing {
    onu_status: string | null;
    rx_power: number | null;
    tx_power: number | null;
    temperature: number | null;
    voltage: number | null;
    dying_gasp: boolean;
    signal_level: SignalLevel | null;
    polled_at: string | null;
    mac_address: string | null;
    olt_host: string | null;
    pon_port: string | null;

    fault_type: FaultType | null;
    recommended_action: string | null;
    recommended_tools: string[];

    health_score: number | null;
    fiber_risk: string | null;
    churn_risk: string | null;

    billing_status: BillingStatus | null;
    days_until_expiry: number | null;

    alarm_count_24h: number;
    area_outage: AreaOutageInfo | null;
    signal_history: SignalPoint[];
    no_onu_linked: boolean;
}

export interface ONULiveStatus {
    mac_address: string;
    status: string | null;
    rx_power: number | null;
    tx_power: number | null;
    temperature: number | null;
    voltage: number | null;
    dying_gasp: boolean;
    signal_level: SignalLevel | null;
    polled_at: string | null;
}

export interface TroubleshootingStep {
    step_number: number;
    instruction: string;
    tool: string | null;
    expected_outcome: string | null;
}

export interface TroubleshootingGuide {
    fault_type: string;
    title: string;
    steps: TroubleshootingStep[];
    safety_notes: string[];
}

export interface SmartDispatchItem {
    ticket_id: number;
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    customer_username: string | null;
    issue_type: string | null;
    priority: string | null;
    status: string;
    created_at: string;
    description: string | null;

    fault_type: FaultType | null;
    fault_severity: number | null;
    health_score: number | null;
    recommended_action: string | null;
    recommended_tools: string[];
    onu_status: string | null;
    rx_power: number | null;
    signal_level: SignalLevel | null;
    has_area_outage: boolean;
}

export interface RebootResponse {
    status: 'success' | 'error';
    message: string;
}

// ------------------------------------------------------------------
// 12. COLLECTION (Operation Bridge the Gap)
// ------------------------------------------------------------------

export type OnuType = 'epon' | 'gpon';

export type CollectionStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'no_access' | 'needs_review';

export interface CollectionAssignment {
    id: number;
    campaign_id: number;
    collector_id: number;
    collector_name?: string | null;
    customer_id: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_address?: string | null;
    status: CollectionStatus;
    skip_reason?: string | null;
    attempts: number;
    assigned_at: string;
    completed_at?: string | null;
    already_has_binding: boolean;
    current_mac_address?: string | null;
    customer_lat?: number | null;
    customer_lng?: number | null;
}

export interface CollectionAssignmentListResponse {
    items: CollectionAssignment[];
    total: number;
    pending: number;
    done: number;
    skipped: number;
}

export interface CollectionSubmission {
    gps_lat?: number;
    gps_lng?: number;
    gps_accuracy_m?: number | null;
    onu_identifier?: string;
    ont_serial_number?: string;
    ont_mac_address?: string;
    ont_model?: string;
    device_setup?: 'single_ont' | 'onu_router';
    sticker_photo_url?: string;
    ont_sticker_data?: Record<string, any>;
    router_sticker_photo_url?: string;
    router_mac_address?: string;
    router_model?: string;
    router_serial?: string;
    router_sticker_data?: Record<string, any>;
    wifi_ssid?: string;
    wifi_password?: string;
    alt_phones?: string[];
    notes?: string;
}

export interface CollectionSubmissionResponse {
    status: 'ok' | 'partial' | 'duplicate' | 'conflict' | 'error';
    assignment_id: number;
    binding_id?: number | null;
    message: string;
    duplicate_of?: string | null;
    warnings: string[];
}
