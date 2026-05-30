// ─── Shared TypeScript types for the technicians module ───────────

export interface TechnicianItem {
    id: number;
    username: string;
    full_name: string;
    role: string;
    is_active: number;
    phone: string | null;
    email: string | null;
    specialization: string | null;
    area_assigned: string | null;
    employment_type: string | null;
    join_date: string | null;
    active_tickets: number;
    resolved_tickets: number;
    created_at: string | null;
}

export interface TechStats {
    total: number;
    active: number;
    inactive: number;
    on_duty: number;
    by_specialization: Record<string, number>;
    by_area: Record<string, number>;
}

export interface TechProfile {
    id: number;
    username: string;
    full_name: string;
    role: string;
    is_active: number | boolean;
    phone: string | null;
    email: string | null;
    specialization: string | null;
    area_assigned: string | null;
    employment_type: string | null;
    join_date: string | null;
    address: string | null;
    emergency_contact: string | null;
    notes: string | null;
    profile_photo: string | null;
    last_login: string | null;
    created_at: string | null;
    updated_at: string | null;
    active_tickets: number;
    resolved_tickets: number;
}

export interface TicketItem {
    id: number;
    customer_username: string;
    customer_name: string | null;
    issue_type: string;
    status: string;
    priority: string;
    created_at: string;
    resolved_at: string | null;
}

export interface PerfData {
    total_assigned: number;
    total_resolved: number;
    active_count: number;
    resolution_rate: number;
    avg_resolution_hours: number;
    monthly_data: { month: string; resolved: number; assigned: number }[];
    priority_breakdown: Record<string, number>;
}
