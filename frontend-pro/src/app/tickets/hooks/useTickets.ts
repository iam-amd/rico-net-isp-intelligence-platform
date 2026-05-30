import { useState, useEffect, useCallback } from "react";
import { API_URL } from "@/config";
import { toast } from "sonner";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";

// =============================================================================
// TYPES
// =============================================================================

export interface TicketMedia {
    id: number;
    file_path: string;
    file_type: string;
    filename: string;
    uploaded_at: string;
}

export interface TicketComment {
    id: number;
    author: string;
    content: string;
    is_internal: number;
    created_at: string;
}

export interface CustomerSummary {
    username: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    railwire_address?: string;
    rico_address?: string;
    geo_lat?: number;
    geo_long?: number;
}

export interface Ticket {
    id: number;
    customer_id: string;
    issue_type: string;
    sub_issue?: string;
    priority: "Critical" | "High" | "Normal" | "Low";
    status: "Open" | "Assigned" | "Ongoing" | "Resolved" | "Closed";
    description: string;
    tags?: string;
    internal_notes?: string;
    materials_used?: string;
    resolution_remarks?: string;

    // Timestamps
    created_at: string;
    assigned_at?: string;
    started_at?: string;
    resolved_at?: string;
    closed_at?: string;
    assigned_tech?: string;

    // Relations
    comments: TicketComment[];
    media: TicketMedia[];
    customer?: CustomerSummary;
}

export interface TechnicianInfo {
    id: number;
    username: string;
    full_name: string;
    role: string;
    active_tickets: number;
}

export interface TicketStats {
    open_count: number;
    assigned_count: number;
    ongoing_count: number;
    resolved_count: number;
    closed_count: number;
    created_today: number;
    resolved_today: number;
    overdue_count: number;
    total_active: number;
}

export interface CustomerLite {
    username: string;
    first_name: string;
    phone: string;
    plan_name: string;
    address?: string;
    status: "Active" | "Past Due" | "Inactive";
}

export interface AuditLogEntry {
    id: number;
    ticket_id: number;
    changed_by: number;
    action: string;
    field_name: string | null;
    old_value: string | null;
    new_value: string | null;
    metadata_: any;
    changed_at: string;
}

// Q-02 FIX: Removed redundant `const API_URL = API_URL` alias; using API_URL directly below.

// =============================================================================
// HOOK
// =============================================================================

export function useTickets() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [technicians, setTechnicians] = useState<TechnicianInfo[]>([]);
    const [stats, setStats] = useState<TicketStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchTickets = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${API_URL}/tickets/?status=All&limit=200`, {
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (!res.ok) throw new Error("Failed to fetch tickets");
            const data = await res.json();
            setTickets(data.items || []);
        } catch (error) {
            console.error(error);
            toast.error("Failed to load tickets");
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchTechnicians = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/technicians/`, {
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (res.ok) {
                const data = await res.json();
                setTechnicians(data.items || []);
            }
        } catch (error) {
            console.error("Failed to fetch technicians:", error);
            toast.error("Failed to load technicians list");
        }
    }, []);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/tickets/stats`, {
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (error) {
            console.error("Failed to fetch ticket stats:", error);
            toast.error("Failed to load ticket statistics");
        }
    }, []);

    const createTicket = async (data: any): Promise<boolean> => {
        try {
            const res = await fetch(`${API_URL}/tickets/`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(data),
            });
            if (handle401(res)) return false;
            if (res.status === 409) {
                // Duplicate ticket warning
                const err = await res.json();
                const forceCreate = window.confirm(
                    `${err.detail}\n\nDo you want to create it anyway?`
                );
                if (forceCreate) {
                    const retryRes = await fetch(`${API_URL}/tickets/?force=true`, {
                        method: "POST",
                        headers: getAuthHeaders(),
                        body: JSON.stringify(data),
                    });
                    if (handle401(retryRes)) return false;
                    if (!retryRes.ok) throw new Error("Failed to create ticket");
                    toast.success("Ticket Created (forced)");
                    fetchTickets();
                    fetchStats();
                    return true;
                } else {
                    toast.info("Ticket creation cancelled by user.");
                }
                return false;
            }
            if (!res.ok) throw new Error("Failed to create ticket");
            toast.success("Ticket Created");
            fetchTickets();
            fetchStats();
            return true;
        } catch (error) {
            toast.error("Failed to create ticket");
            return false;
        }
    };

    const updateTicket = async (id: number, data: any): Promise<boolean> => {
        try {
            const res = await fetch(`${API_URL}/tickets/${id}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify(data),
            });
            if (handle401(res)) return false;
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to update ticket");
            }

            // Refetch to get fresh data with computed fields
            fetchTickets();
            fetchStats();

            toast.success("Ticket Updated");
            return true;
        } catch (error: any) {
            toast.error(error.message || "Failed to update ticket");
            return false;
        }
    };

    const deleteTicket = async (id: number): Promise<boolean> => {
        try {
            const res = await fetch(`${API_URL}/tickets/${id}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return false;
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to delete ticket");
            }
            setTickets(prev => prev.filter(t => t.id !== id));
            fetchStats();
            toast.success("Ticket Deleted");
            return true;
        } catch (error: any) {
            toast.error(error.message || "Failed to delete ticket");
            return false;
        }
    };

    const addComment = useCallback(async (ticketId: number, content: string, isInternal: boolean = false): Promise<boolean> => {
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}/comments`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ content, is_internal: isInternal ? 1 : 0 }),
            });
            if (handle401(res)) return false;
            if (!res.ok) throw new Error("Failed to add comment");
            toast.success("Comment added");
            return true;
        } catch (error: any) {
            toast.error(error.message || "Failed to add comment");
            return false;
        }
    }, []);

    const fetchAuditLog = useCallback(async (ticketId: number): Promise<AuditLogEntry[]> => {
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}/audit`, {
                headers: getAuthHeaders(),
            });
            if (res.ok) return await res.json();
            return [];
        } catch {
            return [];
        }
    }, []);

    const fetchSingleTicket = useCallback(async (ticketId: number): Promise<Ticket | null> => {
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
                headers: getAuthHeaders(),
            });
            if (res.ok) return await res.json();
            return null;
        } catch {
            return null;
        }
    }, []);

    const searchCustomers = useCallback(async (query: string) => {
        if (query.length < 2) return [];
        try {
            const res = await fetch(`${API_URL}/customers/?q=${query}&limit=5`, {
                headers: getAuthHeaders(),
            });
            if (res.ok) {
                const data = await res.json();
                return data.items.map((c: any) => ({
                    ...c,
                }));
            }
            return [];
        } catch (e) {
            console.error(e);
            return [];
        }
    }, []);

    useEffect(() => {
        fetchTickets();
        fetchTechnicians();
        fetchStats();
    }, [fetchTickets, fetchTechnicians, fetchStats]);

    return {
        tickets,
        technicians,
        stats,
        isLoading,
        fetchTickets,
        fetchTechnicians,
        fetchStats,
        createTicket,
        updateTicket,
        deleteTicket,
        addComment,
        fetchAuditLog,
        fetchSingleTicket,
        searchCustomers
    };
}
