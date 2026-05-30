"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApiUrl } from "@refinedev/core";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import {
    ArrowLeft, Phone, Mail, MapPin, Wrench, Briefcase, Shield, Calendar,
    Clock, Edit, Power, AlertTriangle, CheckCircle2, Ticket,
    ClipboardList, ExternalLink, Camera, TrendingUp, BarChart3, Target, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";

import type { TechProfile, TicketItem, PerfData } from "../../types";
import { RoleBadge } from "../../components/RoleBadge";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
    getInitials,
    formatDate,
    statusColors,
    priorityColors,
    priorityBarColors,
} from "../../utils";

// ─── Performance Dashboard ──────────────────────────────────────
function PerformanceDashboard({ techId, apiUrl }: { techId: number; apiUrl: string }) {
    const [perf, setPerf] = useState<PerfData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${apiUrl}/technicians/${techId}/performance`, { headers: getAuthHeaders() });
                if (handle401(res)) return;
                if (res.ok) setPerf(await res.json());
                else toast.error("Failed to load performance data");
            } catch {
                toast.error("Failed to load performance data");
            }
            setLoading(false);
        })();
    }, [apiUrl, techId]);

    if (loading) return <div className="h-40 bg-gray-50 rounded-lg animate-pulse" />;
    if (!perf) return null;

    const maxMonthly = Math.max(...perf.monthly_data.map((d) => Math.max(d.resolved, d.assigned)), 1);
    const totalPriority = Object.values(perf.priority_breakdown).reduce((a, b) => a + b, 0);

    return (
        <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Performance Analytics
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* KPI Row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 p-4 rounded-xl border border-emerald-100">
                        <div className="flex items-center gap-2 mb-1">
                            <Target className="h-4 w-4 text-emerald-500" />
                            <span className="text-xs text-emerald-600 font-medium">Resolution Rate</span>
                        </div>
                        <p className="text-2xl font-bold text-emerald-700">{perf.resolution_rate}%</p>
                    </div>
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="h-4 w-4 text-blue-500" />
                            <span className="text-xs text-blue-600 font-medium">Avg Resolution</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-700">{perf.avg_resolution_hours}h</p>
                    </div>
                    <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-xl border border-amber-100">
                        <div className="flex items-center gap-2 mb-1">
                            <TrendingUp className="h-4 w-4 text-amber-500" />
                            <span className="text-xs text-amber-600 font-medium">Total Assigned</span>
                        </div>
                        <p className="text-2xl font-bold text-amber-700">{perf.total_assigned}</p>
                    </div>
                    <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 p-4 rounded-xl border border-purple-100">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="h-4 w-4 text-purple-500" />
                            <span className="text-xs text-purple-600 font-medium">Active Now</span>
                        </div>
                        <p className="text-2xl font-bold text-purple-700">{perf.active_count}</p>
                    </div>
                </div>

                {/* Monthly Chart */}
                <div>
                    <h4 className="text-sm font-medium text-gray-600 mb-3">Monthly Trend (Last 6 Months)</h4>
                    <div className="flex items-end gap-2 h-32">
                        {perf.monthly_data.map((d, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '100px' }}>
                                    <div
                                        className="w-3 bg-blue-200 rounded-t transition-all"
                                        style={{ height: `${Math.max(4, (d.assigned / maxMonthly) * 100)}px` }}
                                        title={`Assigned: ${d.assigned}`}
                                    />
                                    <div
                                        className="w-3 bg-emerald-400 rounded-t transition-all"
                                        style={{ height: `${Math.max(4, (d.resolved / maxMonthly) * 100)}px` }}
                                        title={`Resolved: ${d.resolved}`}
                                    />
                                </div>
                                <span className="text-[10px] text-gray-400">{d.month.split(" ")[0]}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-4 justify-center mt-2 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-200 rounded" /> Assigned</span>
                        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-400 rounded" /> Resolved</span>
                    </div>
                </div>

                {/* Priority Breakdown */}
                {totalPriority > 0 && (
                    <div>
                        <h4 className="text-sm font-medium text-gray-600 mb-3">Priority Distribution</h4>
                        <div className="space-y-2">
                            {Object.entries(perf.priority_breakdown).map(([priority, count]) => (
                                <div key={priority} className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500 w-16">{priority}</span>
                                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${priorityBarColors[priority] || "bg-gray-400"}`}
                                            style={{ width: `${(count / totalPriority) * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-xs font-semibold text-gray-600 w-6 text-right">{count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Ticket History ─────────────────────────────────────────────
function TicketHistorySection({ username, apiUrl }: { username: string; apiUrl: string }) {
    const [tab, setTab] = useState<"active" | "resolved" | "all">("active");
    const [tickets, setTickets] = useState<TicketItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                if (tab === "resolved") {
                    const url = new URL(`${apiUrl}/tickets/`);
                    url.searchParams.set("assigned_tech", username);
                    url.searchParams.set("status", "Resolved");
                    url.searchParams.set("limit", "50");
                    const res = await fetch(url.toString(), { headers: getAuthHeaders() });
                    if (handle401(res)) return;
                    if (res.ok) { const data = await res.json(); setTickets(data.items || []); setTotal(data.total || 0); }
                } else {
                    const statuses = tab === "active" ? ["Open", "Assigned", "Ongoing"] : ["Open", "Assigned", "Ongoing", "Resolved", "Closed"];
                    let all: TicketItem[] = [], cnt = 0;
                    for (const s of statuses) {
                        const url = new URL(`${apiUrl}/tickets/`);
                        url.searchParams.set("assigned_tech", username);
                        url.searchParams.set("status", s);
                        url.searchParams.set("limit", "50");
                        const res = await fetch(url.toString(), { headers: getAuthHeaders() });
                        if (handle401(res)) return;
                        if (res.ok) { const d = await res.json(); all = [...all, ...(d.items || [])]; cnt += d.total || 0; }
                    }
                    setTickets(all); setTotal(cnt);
                }
            } catch {
                toast.error("Failed to load ticket history");
            }
            setLoading(false);
        })();
    }, [apiUrl, username, tab]);

    const tabs = [{ key: "active" as const, label: "Active Jobs" }, { key: "resolved" as const, label: "Resolved" }, { key: "all" as const, label: "All Tickets" }];

    return (
        <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                        <ClipboardList className="h-4 w-4" /> Assigned Tickets
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-normal">{total}</span>
                    </CardTitle>
                </div>
                <div className="flex gap-1 mt-3 bg-gray-100 p-1 rounded-lg w-fit">
                    {tabs.map((t) => (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                        >{t.label}</button>
                    ))}
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />)}</div>
                ) : tickets.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">No {tab === "all" ? "" : tab} tickets found.</div>
                ) : (
                    <div className="space-y-2">
                        {tickets.map((ticket) => (
                            <Link key={ticket.id} href={`/tickets/show/${ticket.id}`} className="block">
                                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50/50 hover:bg-emerald-50/40 transition-colors group cursor-pointer border border-transparent hover:border-emerald-100">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <span className="text-xs font-mono font-semibold text-gray-400 w-12 flex-shrink-0">#{ticket.id}</span>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-gray-800 truncate">{ticket.customer_name || ticket.customer_username}</p>
                                            <p className="text-xs text-gray-400 truncate">{ticket.issue_type}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 flex-shrink-0">
                                        <span className={`text-xs font-medium ${priorityColors[ticket.priority] || "text-gray-500"}`}>{ticket.priority}</span>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[ticket.status] || "bg-gray-100 text-gray-600"}`}>{ticket.status}</span>
                                        <span className="text-xs text-gray-400 hidden sm:block">{formatDate(ticket.created_at)}</span>
                                        <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Main Page ──────────────────────────────────────────────────
export default function TechnicianShowPage() {
    const params = useParams();
    const techId = params?.id;
    const apiUrl = useApiUrl();
    const [tech, setTech] = useState<TechProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);

    // Confirm dialog for toggle status
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);

    useEffect(() => {
        if (!techId) return;
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(`${apiUrl}/technicians/${techId}`, { headers: getAuthHeaders() });
                if (handle401(res)) return;
                if (res.ok) setTech(await res.json());
                else toast.error("Failed to load technician profile");
            } catch {
                toast.error("Failed to load technician profile");
            }
            setLoading(false);
        })();
    }, [apiUrl, techId]);

    const handleToggleStatus = async () => {
        if (!tech) return;
        setConfirmLoading(true);
        try {
            const res = await fetch(`${apiUrl}/technicians/${tech.id}/toggle-status`, { method: "PUT", headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (res.ok) {
                setTech((p) => p ? { ...p, is_active: p.is_active === 1 || p.is_active === true ? 0 : 1 } : p);
                toast.success(`Technician ${tech.is_active === 1 || tech.is_active === true ? "deactivated" : "activated"} successfully`);
            }
            else { const d = await res.json(); toast.error(d.detail || "Failed to toggle status"); }
        } catch { toast.error("Network error. Please try again."); }
        setConfirmLoading(false);
        setConfirmOpen(false);
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !tech) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch(`${apiUrl}/technicians/${tech.id}/photo`, {
                method: "POST",
                headers: { Authorization: getAuthHeaders().Authorization },
                body: formData,
            });
            if (handle401(res)) return;
            if (res.ok) {
                const data = await res.json();
                setTech((p) => p ? { ...p, profile_photo: data.profile_photo } : p);
                toast.success("Profile photo updated");
            } else {
                const d = await res.json();
                toast.error(d.detail || "Upload failed");
            }
        } catch { toast.error("Photo upload failed. Please try again."); }
        setUploading(false);
    };

    const isActive = tech ? (tech.is_active === 1 || tech.is_active === true) : false;
    const photoUrl = tech?.profile_photo ? `${apiUrl}${tech.profile_photo}` : null;

    if (loading) {
        return (
            <div className="flex h-screen bg-[#F4F5F7]">
                <MainSidebar />
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-pulse text-gray-400">Loading technician profile...</div>
                </div>
            </div>
        );
    }

    if (!tech) {
        return (
            <div className="flex h-screen bg-[#F4F5F7]">
                <MainSidebar />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-3" />
                        <h2 className="text-lg font-semibold text-gray-700">Technician Not Found</h2>
                        <Link href="/technicians"><Button variant="outline" className="mt-4">← Back to List</Button></Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <ErrorBoundary fallbackTitle="Technician profile failed to load">
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-8 min-h-screen">
                    <Link href="/technicians">
                        <Button variant="ghost" className="gap-2 text-gray-500 hover:text-gray-700 -ml-3">
                            <ArrowLeft className="h-4 w-4" /> Back to Technicians
                        </Button>
                    </Link>

                    {/* Profile Header */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
                        <div className="flex flex-col md:flex-row items-start gap-6">
                            {/* Avatar with photo upload */}
                            <div className="relative group">
                                <Avatar className="h-20 w-20 border-4 border-emerald-100">
                                    {photoUrl ? (
                                        <AvatarImage src={photoUrl} alt={tech.full_name} className="object-cover" />
                                    ) : null}
                                    <AvatarFallback className="bg-emerald-100 text-emerald-700 text-2xl font-bold">
                                        {getInitials(tech.full_name)}
                                    </AvatarFallback>
                                </Avatar>
                                <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                    <Camera className="h-5 w-5 text-white" />
                                    <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
                                </label>
                                {uploading && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-full">
                                        <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                )}
                            </div>

                            <div className="flex-1">
                                <div className="flex items-center gap-4 flex-wrap">
                                    <h1 className="text-2xl font-bold text-gray-900">{tech.full_name}</h1>
                                    <RoleBadge role={tech.role} size="md" />
                                    {isActive ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                                            <CheckCircle2 className="h-3 w-3" /> Active
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                                            <AlertTriangle className="h-3 w-3" /> Inactive
                                        </span>
                                    )}
                                </div>
                                <p className="text-gray-400 mt-1">@{tech.username}</p>
                                <div className="flex items-center gap-6 mt-4 flex-wrap text-sm text-gray-500">
                                    {tech.phone && <div className="flex items-center gap-1.5"><Phone className="h-4 w-4 text-gray-400" />{tech.phone}</div>}
                                    {tech.email && <div className="flex items-center gap-1.5"><Mail className="h-4 w-4 text-gray-400" />{tech.email}</div>}
                                    {tech.area_assigned && <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-gray-400" />{tech.area_assigned}</div>}
                                </div>
                            </div>

                            <div className="flex gap-2 flex-shrink-0">
                                <Link href={`/technicians/edit/${tech.id}`}><Button variant="outline" className="gap-2"><Edit className="h-4 w-4" /> Edit</Button></Link>
                                <Button
                                    variant="outline"
                                    className={`gap-2 ${isActive ? "text-red-600 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}
                                    onClick={() => setConfirmOpen(true)}
                                >
                                    <Power className="h-4 w-4" /> {isActive ? "Deactivate" : "Activate"}
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[
                            { icon: Ticket, label: "Active Jobs", value: tech.active_tickets, color: "amber" },
                            { icon: CheckCircle2, label: "Resolved", value: tech.resolved_tickets, color: "green" },
                            { icon: Calendar, label: "Joined", value: formatDate(tech.join_date || tech.created_at), color: "blue", small: true },
                            { icon: Clock, label: "Last Login", value: tech.last_login ? formatDate(tech.last_login) : "Never", color: "purple", small: true },
                        ].map((s, i) => (
                            <Card key={i} className="border-none shadow-sm bg-white">
                                <CardContent className="p-5 flex items-center gap-4">
                                    <div className={`p-3 rounded-full bg-${s.color}-50`}>
                                        <s.icon className={`h-5 w-5 text-${s.color}-500`} />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500">{s.label}</p>
                                        <p className={`${s.small ? "text-sm font-semibold" : "text-xl font-bold"} text-gray-900`}>{s.value}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card className="border-none shadow-sm bg-white">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                                    <Briefcase className="h-4 w-4" /> Professional Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-4">
                                    {[
                                        { label: "Specialization", value: <><Wrench className="h-3.5 w-3.5 text-gray-400 inline mr-1" />{tech.specialization || "General"}</> },
                                        { label: "Employment", value: tech.employment_type || "Full-Time" },
                                        { label: "Area / Zone", value: tech.area_assigned || "—" },
                                        { label: "Role", value: tech.role },
                                    ].map((d, i) => (
                                        <div key={i}>
                                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{d.label}</p>
                                            <p className="text-sm font-medium text-gray-700">{d.value}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-none shadow-sm bg-white">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
                                    <Phone className="h-4 w-4" /> Contact Information
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-4">
                                    {[
                                        { label: "Phone", value: tech.phone || "—", mono: true },
                                        { label: "Email", value: tech.email || "—", blue: true },
                                        { label: "Emergency Contact", value: tech.emergency_contact || "—", mono: true },
                                        { label: "Address", value: tech.address || "—" },
                                    ].map((d, i) => (
                                        <div key={i}>
                                            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{d.label}</p>
                                            <p className={`text-sm font-medium ${d.blue ? "text-blue-600" : "text-gray-700"} ${d.mono ? "font-mono" : ""}`}>{d.value}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Performance Dashboard */}
                    <PerformanceDashboard techId={tech.id} apiUrl={apiUrl} />

                    {/* Assigned Tickets */}
                    <TicketHistorySection username={tech.username} apiUrl={apiUrl} />

                    {/* Notes */}
                    {tech.notes && (
                        <Card className="border-none shadow-sm bg-white">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700">Internal Notes</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-gray-600 whitespace-pre-wrap">{tech.notes}</p>
                            </CardContent>
                        </Card>
                    )}

                    <div className="text-xs text-gray-400 flex gap-6 justify-end pb-8">
                        <span>Created: {formatDate(tech.created_at)}</span>
                        {tech.updated_at && <span>Updated: {formatDate(tech.updated_at)}</span>}
                    </div>
                </div>
            </div>

            {/* Confirm Dialog for Toggle */}
            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={isActive ? "Deactivate Technician" : "Activate Technician"}
                description={`Are you sure you want to ${isActive ? "deactivate" : "activate"} ${tech.full_name}? ${isActive ? "They will no longer be able to log in or receive tickets." : "They will regain access to the system."}`}
                confirmLabel={isActive ? "Deactivate" : "Activate"}
                variant={isActive ? "danger" : "default"}
                loading={confirmLoading}
                onConfirm={handleToggleStatus}
            />
        </div>
        </ErrorBoundary>
    );
}
