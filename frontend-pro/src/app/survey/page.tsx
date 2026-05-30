"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API_URL } from "@/config";
import { authFetch, getAuthHeaders } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    CheckCircle2,
    Clock,
    Edit2,
    ExternalLink,
    Loader2,
    Map as MapIcon,
    MapPin,
    PhoneCall,
    RefreshCw,
    Search,
    UserCheck,
    Users,
    Wifi,
    XCircle,
    AlertCircle,
    Camera,
    Eye,
    X,
    ChevronRight,
    Award,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SurveyRow {
    username: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    railwire_address?: string | null;
    rico_address?: string | null;
    survey_status: string;
    skip_reason?: string | null;
    collector_id?: number | null;
    collector_name?: string | null;
    completed_at?: string | null;
    gps_lat?: number | null;
    gps_lng?: number | null;
    gps_confirmed: boolean;
    has_binding: boolean;
    last_surveyed_at?: string | null;
    mac_address?: string | null;
    customer_mac_address?: string | null;
    onu_identifier?: string | null;
    onu_type?: string | null;
    binding_confidence?: string | null;
    binding_source?: string | null;
    review_warnings?: string[];
    review_detail?: string | null;
    ont_serial_number?: string | null;
    ont_model?: string | null;
    device_setup?: string | null;
    router_model?: string | null;
    router_mac_address?: string | null;
    router_serial?: string | null;
    wifi_ssid?: string | null;
    wifi_ssid_5g?: string | null;
    wifi_password?: string | null;
    sticker_photo_url?: string | null;
    router_sticker_photo_url?: string | null;
}

interface TechStat {
    tech_id: number;
    name?: string | null;
    done: number;
    partial: number;
    skipped: number;
    needs_review: number;
    last_activity?: string | null;
}

interface LiveProgress {
    total_customers: number;
    surveyed_customers: number;
    with_gps: number;
    pending: number;
    by_status: Record<string, number>;
    techs: TechStat[];
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
    pending:      { label: "Pending",      cls: "bg-slate-100 text-slate-600 border-slate-200" },
    done:         { label: "Done",         cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    partial:      { label: "Partial",      cls: "bg-amber-100 text-amber-700 border-amber-200" },
    skipped:      { label: "Skipped",      cls: "bg-red-100 text-red-600 border-red-200" },
    needs_review: { label: "Needs Review", cls: "bg-orange-100 text-orange-700 border-orange-200" },
    surveyed:     { label: "Surveyed",     cls: "bg-blue-100 text-blue-700 border-blue-200" },
};

function mediaUrl(url?: string | null): string {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SurveyDashboardPage() {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [activeTab, setActiveTab] = useState("all");
    const [rows, setRows] = useState<SurveyRow[]>([]);
    const [rowsTotal, setRowsTotal] = useState(0); // real total from API
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<LiveProgress | null>(null);

    // Edit dialog
    const [editTarget, setEditTarget] = useState<SurveyRow | null>(null);
    const [editForm, setEditForm] = useState({
        mac_address: "",
        ont_serial_number: "",
        ont_model: "",
        router_mac_address: "",
        router_model: "",
        router_serial: "",
        wifi_ssid: "",
        wifi_ssid_5g: "",
        wifi_password: "",
        survey_status: "",
    });
    const [saving, setSaving] = useState(false);
    const [approving, setApproving] = useState(false);

    // Lightbox
    const [lightbox, setLightbox] = useState<string | null>(null);

    // Technician sheet
    const [selectedTech, setSelectedTech] = useState<TechStat | null>(null);
    const [techRows, setTechRows] = useState<SurveyRow[]>([]);
    const [techRowsLoading, setTechRowsLoading] = useState(false);

    // ----------------------------------------------------------------
    // Data fetching
    // ----------------------------------------------------------------

    const fetchProgress = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/collection/survey/progress`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setProgress(await res.json());
        } catch (e: any) {
            console.warn("Survey progress load failed", e?.message || e);
        }
    }, []);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search.trim()) params.set("q", search.trim());
            if (statusFilter !== "all") params.set("status", statusFilter);
            params.set("limit", "500");
            const res = await authFetch(`${API_URL}/collection/survey/search?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRows(data.items || []);
            setRowsTotal(data.total ?? data.items?.length ?? 0);
        } catch (e: any) {
            toast.error(`Load failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter]);

    useEffect(() => {
        const t = setTimeout(fetchRows, 250);
        return () => clearTimeout(t);
    }, [fetchRows]);

    useEffect(() => {
        fetchProgress();
        const id = setInterval(fetchProgress, 15000);
        return () => clearInterval(id);
    }, [fetchProgress]);

    // Fetch a specific tech's submissions
    const openTechSheet = useCallback(async (tech: TechStat) => {
        setSelectedTech(tech);
        setTechRowsLoading(true);
        setTechRows([]);
        try {
            const params = new URLSearchParams({ limit: "500", sort: "recent", collector_id: String(tech.tech_id) });
            const res = await authFetch(`${API_URL}/collection/survey/search?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setTechRows(data.items || []);
        } catch (e: any) {
            toast.error(`Failed to load submissions: ${e.message}`);
        } finally {
            setTechRowsLoading(false);
        }
    }, []);

    // ----------------------------------------------------------------
    // Edit submit
    // ----------------------------------------------------------------

    const openEdit = (row: SurveyRow) => {
        setEditTarget(row);
        setEditForm({
            mac_address: row.mac_address || "",
            ont_serial_number: row.ont_serial_number || "",
            ont_model: row.ont_model || "",
            router_mac_address: row.router_mac_address || "",
            router_model: row.router_model || "",
            router_serial: row.router_serial || "",
            wifi_ssid: row.wifi_ssid || "",
            wifi_ssid_5g: row.wifi_ssid_5g || "",
            wifi_password: row.wifi_password || "",
            survey_status: row.survey_status || "pending",
        });
    };

    const handleSave = async () => {
        if (!editTarget) return;
        setSaving(true);
        try {
            const patch: Record<string, any> = { change_reason: "Admin survey correction" };
            if (editForm.ont_serial_number !== (editTarget.ont_serial_number || ""))
                patch.ont_serial_number = editForm.ont_serial_number.trim().toUpperCase() || null;
            if (editForm.ont_model !== (editTarget.ont_model || ""))
                patch.ont_model = editForm.ont_model.trim() || null;
            if (editForm.router_mac_address !== (editTarget.router_mac_address || ""))
                patch.router_mac_address = editForm.router_mac_address.trim().toUpperCase() || null;
            if (editForm.router_model !== (editTarget.router_model || ""))
                patch.router_model = editForm.router_model.trim() || null;
            if (editForm.router_serial !== (editTarget.router_serial || ""))
                patch.router_serial = editForm.router_serial.trim() || null;
            if (editForm.wifi_ssid !== (editTarget.wifi_ssid || ""))
                patch.wifi_ssid = editForm.wifi_ssid.trim() || null;
            if (editForm.wifi_ssid_5g !== (editTarget.wifi_ssid_5g || ""))
                patch.wifi_ssid_5g = editForm.wifi_ssid_5g.trim() || null;
            if (editForm.wifi_password !== (editTarget.wifi_password || ""))
                patch.wifi_password = editForm.wifi_password.trim() || null;

            if (Object.keys(patch).length > 1) {
                const res = await fetch(`${API_URL}/customers/${encodeURIComponent(editTarget.username)}`, {
                    method: "PUT",
                    headers: getAuthHeaders(),
                    body: JSON.stringify(patch),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || "Customer update failed");
                }
            }

            if (
                editForm.mac_address !== (editTarget.mac_address || "") ||
                editForm.ont_serial_number !== (editTarget.ont_serial_number || "")
            ) {
                const identifier =
                    editForm.ont_serial_number.trim().toUpperCase() ||
                    editForm.mac_address.trim().toUpperCase();
                if (identifier) {
                    const res = await authFetch(`${API_URL}/collection/customers/${encodeURIComponent(editTarget.username)}/correct`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            onu_identifier: identifier,
                            confidence: "verified",
                            notes: "Admin survey correction",
                        }),
                    });
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.detail || "Binding correction failed");
                    }
                }
            }

            // If status changed, update via survey correction endpoint
            if (editForm.survey_status && editForm.survey_status !== editTarget.survey_status) {
                const res = await authFetch(`${API_URL}/collection/survey/customers/${encodeURIComponent(editTarget.username)}/status`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: editForm.survey_status, notes: "Admin manual status change" }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.detail || "Status update failed");
                }
            }

            toast.success("Saved");
            setEditTarget(null);
            await fetchRows();
            await fetchProgress();
            if (selectedTech) await openTechSheet(selectedTech);
        } catch (e: any) {
            toast.error(e.message || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleApprove = async () => {
        if (!editTarget) return;
        setApproving(true);
        try {
            const res = await authFetch(`${API_URL}/collection/survey/customers/${encodeURIComponent(editTarget.username)}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "done", notes: "Admin approved after review" }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Approval failed");
            }
            toast.success(`✅ ${editTarget.username} approved as Done`);
            setEditTarget(null);
            await fetchRows();
            await fetchProgress();
            if (selectedTech) await openTechSheet(selectedTech);
        } catch (e: any) {
            toast.error(e.message || "Approval failed");
        } finally {
            setApproving(false);
        }
    };

    // ----------------------------------------------------------------
    // Clickable stat card helpers — sets status filter + switches tab
    // ----------------------------------------------------------------

    const filterByStatus = (status: string, tab: string) => {
        setStatusFilter(status);
        setActiveTab(tab);
        setSearch("");
    };

    // ----------------------------------------------------------------
    // Derived counts
    // ----------------------------------------------------------------

    const progressView = useMemo<LiveProgress>(() => {
        if (progress) return progress;
        const byStatus: Record<string, number> = {
            done: rows.filter(r => r.survey_status === "done" || r.survey_status === "surveyed").length,
            partial: rows.filter(r => r.survey_status === "partial").length,
            pending: rows.filter(r => r.survey_status === "pending").length,
            skipped: rows.filter(r => r.survey_status === "skipped").length,
            needs_review: rows.filter(r => r.survey_status === "needs_review").length,
        };
        return {
            total_customers: rowsTotal || rows.length,
            surveyed_customers: byStatus.done,
            with_gps: rows.filter(r => r.gps_confirmed).length,
            pending: byStatus.pending,
            by_status: byStatus,
            techs: [],
        };
    }, [progress, rows, rowsTotal]);

    const surveyedPct = useMemo(() => {
        if (!progressView.total_customers) return 0;
        return Math.round((progressView.surveyed_customers / progressView.total_customers) * 100);
    }, [progressView]);

    // Use real totals from progress when no search is active, otherwise use fetched rows
    const isFiltered = search.trim().length > 0;

    const tabAll     = isFiltered ? rows.length : (rowsTotal || progressView.total_customers || 0);
    const tabDone    = isFiltered ? rows.filter(r => r.survey_status === "done" || r.survey_status === "surveyed").length : ((progressView.by_status?.done || 0) + (progressView.by_status?.surveyed || 0));
    const tabPartial = isFiltered ? rows.filter(r => r.survey_status === "partial").length : (progressView.by_status?.partial || 0);
    const tabPending = isFiltered ? rows.filter(r => r.survey_status === "pending").length : (progressView.by_status?.pending || 0);
    const tabSkipped = isFiltered ? rows.filter(r => r.survey_status === "skipped").length : (progressView.by_status?.skipped || 0);
    const tabReview  = isFiltered ? rows.filter(r => r.survey_status === "needs_review").length : (progressView.by_status?.needs_review || 0);

    const doneRows    = useMemo(() => rows.filter(r => r.survey_status === "done" || r.survey_status === "surveyed"), [rows]);
    const partialRows = useMemo(() => rows.filter(r => r.survey_status === "partial"), [rows]);
    const pendingRows = useMemo(() => rows.filter(r => r.survey_status === "pending"), [rows]);
    const skippedRows = useMemo(() => rows.filter(r => r.survey_status === "skipped"), [rows]);
    const reviewRows  = useMemo(() => rows.filter(r => r.survey_status === "needs_review"), [rows]);

    // ----------------------------------------------------------------
    // Render
    // ----------------------------------------------------------------

    return (
        <div className="flex min-h-screen bg-slate-50">
            <MainSidebar />
            <main className="flex-1 p-6 space-y-6 overflow-x-hidden max-w-full">

                {/* Header */}
                <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Field Survey</h1>
                        <p className="text-sm text-slate-500">
                            Operation Bridge the Gap — customer data collection dashboard
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Link href="/survey/map">
                            <Button variant="outline" size="sm">
                                <MapIcon className="h-4 w-4 mr-1" /> Map View
                            </Button>
                        </Link>
                        <Button variant="outline" size="sm" onClick={() => { fetchRows(); fetchProgress(); }} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
                        </Button>
                    </div>
                </div>

                {/* Stat cards — clickable to filter */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard
                        icon={<Users className="h-5 w-5" />}
                        label="Total Customers"
                        value={progressView.total_customers}
                        accent="slate"
                        onClick={() => { setStatusFilter("all"); setActiveTab("all"); setSearch(""); }}
                    />
                    <StatCard
                        icon={<CheckCircle2 className="h-5 w-5" />}
                        label="Surveyed"
                        value={progressView.surveyed_customers}
                        hint={`${surveyedPct}% of total`}
                        accent="emerald"
                        clickable
                        onClick={() => filterByStatus("done", "done")}
                    />
                    <StatCard
                        icon={<MapPin className="h-5 w-5" />}
                        label="GPS Captured"
                        value={progressView.with_gps}
                        accent="blue"
                        onClick={() => { window.location.href = "/survey/map"; }}
                    />
                    <StatCard
                        icon={<Clock className="h-5 w-5" />}
                        label="Pending"
                        value={progressView.pending}
                        accent="amber"
                        clickable
                        onClick={() => filterByStatus("pending", "pending")}
                    />
                </div>

                {/* Overall progress bar */}
                {progressView.total_customers > 0 && (
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-slate-700">Overall completion</span>
                                <span className="text-sm font-bold text-emerald-700">{surveyedPct}%</span>
                            </div>
                            <Progress value={surveyedPct} className="h-2" />
                            <div className="flex gap-4 mt-3 flex-wrap">
                                {Object.entries(STATUS_CFG).map(([key, cfg]) => {
                                    const count = progressView.by_status?.[key] ?? 0;
                                    if (!count) return null;
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => filterByStatus(key, key === "surveyed" ? "done" : key)}
                                            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                                        >
                                            <span className={`inline-block w-2 h-2 rounded-full ${cfg.cls.split(" ")[0]}`} />
                                            {cfg.label}: <strong>{count}</strong>
                                        </button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Technician performance — clickable rows open submission sheet */}
                {progressView.techs.length > 0 && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Award className="h-4 w-4 text-violet-600" />
                                Collector Performance
                            </CardTitle>
                            <CardDescription>Click a collector to view their submissions</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Collector</TableHead>
                                        <TableHead className="text-center">Done</TableHead>
                                        <TableHead className="text-center">Partial</TableHead>
                                        <TableHead className="text-center">Skipped</TableHead>
                                        <TableHead className="text-center">Needs Review</TableHead>
                                        <TableHead>Last Activity</TableHead>
                                        <TableHead></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {progressView.techs.map((t) => {
                                        const total = t.done + t.partial + t.skipped + t.needs_review;
                                        return (
                                            <TableRow
                                                key={t.tech_id}
                                                className="cursor-pointer hover:bg-violet-50/60 transition-colors"
                                                onClick={() => openTechSheet(t)}
                                            >
                                                <TableCell>
                                                    <div className="font-medium text-slate-800">{t.name || `Tech #${t.tech_id}`}</div>
                                                    <div className="text-xs text-slate-400">{total} submissions</div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-mono text-emerald-700 font-semibold">{t.done}</span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-mono text-amber-700">{t.partial}</span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-mono text-red-600">{t.skipped}</span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className="font-mono text-orange-700">{t.needs_review}</span>
                                                </TableCell>
                                                <TableCell className="text-sm text-slate-500">
                                                    {t.last_activity ? new Date(t.last_activity).toLocaleString() : "—"}
                                                </TableCell>
                                                <TableCell>
                                                    <ChevronRight className="h-4 w-4 text-slate-300" />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}

                {/* Customer table with tabs */}
                <Card>
                    <CardHeader className="pb-2">
                        <div className="flex items-center gap-3 flex-wrap">
                            <CardTitle className="flex-1 text-base">Customer Records</CardTitle>
                            <div className="relative w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    placeholder="Search name, phone, address…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9 h-9"
                                />
                                {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />}
                            </div>
                            <Select
                                value={statusFilter}
                                onValueChange={(v) => {
                                    setStatusFilter(v);
                                    if (v === "all") setActiveTab("all");
                                    else if (v === "needs_review") setActiveTab("review");
                                    else setActiveTab(v === "done" || v === "surveyed" ? "done" : v);
                                }}
                            >
                                <SelectTrigger className="w-40 h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All statuses</SelectItem>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="done">Done</SelectItem>
                                    <SelectItem value="partial">Partial</SelectItem>
                                    <SelectItem value="skipped">Skipped</SelectItem>
                                    <SelectItem value="needs_review">Needs Review</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <Tabs
                            value={activeTab}
                            onValueChange={(v) => {
                                setActiveTab(v);
                                setStatusFilter(v === "review" ? "needs_review" : v);
                            }}
                        >
                            <div className="px-6 border-b border-slate-100">
                                <TabsList className="h-9 bg-transparent p-0 gap-0">
                                    <TabBtn value="all" label="All" count={tabAll} />
                                    <TabBtn value="done" label="Done" count={tabDone} color="text-emerald-700" />
                                    <TabBtn value="partial" label="Partial" count={tabPartial} color="text-amber-700" />
                                    <TabBtn value="pending" label="Pending" count={tabPending} color="text-slate-600" />
                                    <TabBtn value="skipped" label="Skipped" count={tabSkipped} color="text-red-600" />
                                    <TabBtn value="review" label="Needs Review" count={tabReview} color="text-orange-700" />
                                </TabsList>
                            </div>

                            <TabsContent value="all" className="mt-0">
                                <CustomerTable rows={rows} onEdit={openEdit} onPhotoClick={setLightbox} />
                            </TabsContent>
                            <TabsContent value="done" className="mt-0">
                                <CustomerTable rows={doneRows} onEdit={openEdit} onPhotoClick={setLightbox} />
                            </TabsContent>
                            <TabsContent value="partial" className="mt-0">
                                <CustomerTable rows={partialRows} onEdit={openEdit} onPhotoClick={setLightbox} />
                            </TabsContent>
                            <TabsContent value="pending" className="mt-0">
                                <CustomerTable rows={pendingRows} onEdit={openEdit} onPhotoClick={setLightbox} />
                            </TabsContent>
                            <TabsContent value="skipped" className="mt-0">
                                <CustomerTable rows={skippedRows} onEdit={openEdit} onPhotoClick={setLightbox} />
                            </TabsContent>
                            <TabsContent value="review" className="mt-0">
                                <CustomerTable rows={reviewRows} onEdit={openEdit} onPhotoClick={setLightbox} />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
            </main>

            {/* Edit Dialog */}
            <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            Edit Survey Data —{" "}
                            {editTarget ? [editTarget.first_name, editTarget.last_name].filter(Boolean).join(" ") || editTarget.username : ""}
                        </DialogTitle>
                    </DialogHeader>

                    {editTarget && (
                        <div className="space-y-4 py-2">
                            {/* Approve banner for review/partial cases */}
                            {(editTarget.survey_status === "needs_review" || editTarget.survey_status === "partial") && (
                                <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                                    <div>
                                        <p className="text-sm font-semibold text-orange-800">
                                            {editTarget.survey_status === "needs_review" ? "⚠️ Needs Review" : "⏳ Partial Submission"}
                                        </p>
                                        <p className="text-xs text-orange-600 mt-0.5">
                                            {editTarget.survey_status === "needs_review"
                                                ? "Tech flagged this for admin review. Fix fields below then approve."
                                                : "Only partial data was captured. Review and approve when complete."}
                                        </p>
                                        {editTarget.review_warnings && editTarget.review_warnings.length > 0 && (
                                            <p className="text-xs text-orange-700 mt-1 font-mono">
                                                {editTarget.review_warnings.join(", ")}
                                            </p>
                                        )}
                                    </div>
                                    <Button
                                        onClick={handleApprove}
                                        disabled={approving || saving}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white ml-3 flex-shrink-0"
                                        size="sm"
                                    >
                                        {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                                        Approve as Done
                                    </Button>
                                </div>
                            )}

                            {(editTarget.mac_address || editTarget.customer_mac_address || editTarget.onu_identifier) && (
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                                        <div className="text-slate-500">Active binding used by system</div>
                                        <div className="font-mono text-slate-900 mt-1">{editTarget.mac_address || editTarget.onu_identifier || "none"}</div>
                                        <div className="text-slate-500 mt-1">
                                            {editTarget.binding_source || "unknown"} / {editTarget.binding_confidence || "unknown"}
                                        </div>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 p-2">
                                        <div className="text-slate-500">Legacy customer MAC</div>
                                        <div className="font-mono text-slate-900 mt-1">{editTarget.customer_mac_address || "none"}</div>
                                        <div className="text-slate-500 mt-1">kept only as fallback</div>
                                    </div>
                                </div>
                            )}

                            {/* Sticker photos */}
                            {(editTarget.sticker_photo_url || editTarget.router_sticker_photo_url) && (
                                <div>
                                    <Label className="text-xs text-slate-500 uppercase tracking-wide">Sticker Photos</Label>
                                    <div className="flex gap-2 mt-1">
                                        {editTarget.sticker_photo_url && (
                                            <button
                                                type="button"
                                                onClick={() => setLightbox(mediaUrl(editTarget.sticker_photo_url))}
                                                className="relative h-24 w-32 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 hover:border-emerald-400 transition-colors group flex-shrink-0"
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={mediaUrl(editTarget.sticker_photo_url)} alt="ONT sticker" className="w-full h-full object-contain" />
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                                                    <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                                                </div>
                                                <span className="absolute bottom-1 left-1 text-[9px] bg-black/50 text-white rounded px-1">ONT</span>
                                            </button>
                                        )}
                                        {editTarget.router_sticker_photo_url && (
                                            <button
                                                type="button"
                                                onClick={() => setLightbox(mediaUrl(editTarget.router_sticker_photo_url))}
                                                className="relative h-24 w-32 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 hover:border-blue-400 transition-colors group flex-shrink-0"
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={mediaUrl(editTarget.router_sticker_photo_url)} alt="Router sticker" className="w-full h-full object-contain" />
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                                                    <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                                                </div>
                                                <span className="absolute bottom-1 left-1 text-[9px] bg-black/50 text-white rounded px-1">Router</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div>
                                <Label>EPON MAC Address</Label>
                                <Input
                                    value={editForm.mac_address}
                                    onChange={(e) => setEditForm(f => ({ ...f, mac_address: e.target.value.toUpperCase() }))}
                                    placeholder="e.g. 8CC7C330AC57"
                                    className="font-mono mt-1"
                                />
                            </div>
                            <div>
                                <Label>ONT / GPON Serial</Label>
                                <Input
                                    value={editForm.ont_serial_number}
                                    onChange={(e) => setEditForm(f => ({ ...f, ont_serial_number: e.target.value.toUpperCase() }))}
                                    placeholder="e.g. GPOND02A2C65"
                                    className="font-mono mt-1"
                                />
                            </div>
                            <div>
                                <Label>ONT Model</Label>
                                <Input
                                    value={editForm.ont_model}
                                    onChange={(e) => setEditForm(f => ({ ...f, ont_model: e.target.value }))}
                                    placeholder="e.g. V2802 DAC"
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label>Router MAC</Label>
                                <Input
                                    value={editForm.router_mac_address}
                                    onChange={(e) => setEditForm(f => ({ ...f, router_mac_address: e.target.value.toUpperCase() }))}
                                    placeholder="Router MAC if separate router exists"
                                    className="font-mono mt-1"
                                />
                            </div>
                            <div>
                                <Label>Router Model</Label>
                                <Input
                                    value={editForm.router_model}
                                    onChange={(e) => setEditForm(f => ({ ...f, router_model: e.target.value }))}
                                    placeholder="e.g. Archer C24"
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <Label>Router Serial</Label>
                                <Input
                                    value={editForm.router_serial}
                                    onChange={(e) => setEditForm(f => ({ ...f, router_serial: e.target.value }))}
                                    placeholder="Router serial"
                                    className="mt-1"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <Label>WiFi SSID</Label>
                                    <Input
                                        value={editForm.wifi_ssid}
                                        onChange={(e) => setEditForm(f => ({ ...f, wifi_ssid: e.target.value }))}
                                        placeholder="2.4G SSID"
                                        className="mt-1"
                                    />
                                </div>
                                <div>
                                    <Label>WiFi 5G SSID</Label>
                                    <Input
                                        value={editForm.wifi_ssid_5g}
                                        onChange={(e) => setEditForm(f => ({ ...f, wifi_ssid_5g: e.target.value }))}
                                        placeholder="5G SSID"
                                        className="mt-1"
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>WiFi Password</Label>
                                <Input
                                    value={editForm.wifi_password}
                                    onChange={(e) => setEditForm(f => ({ ...f, wifi_password: e.target.value }))}
                                    placeholder="WiFi password"
                                    className="mt-1"
                                />
                            </div>

                            <div className="pt-1">
                                <Link
                                    href={`/customers/show/${encodeURIComponent(editTarget.username)}`}
                                    className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                                    target="_blank"
                                >
                                    <ExternalLink className="h-3 w-3" /> Open full customer profile (with audit log)
                                </Link>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving} className="bg-emerald-700 hover:bg-emerald-800">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Technician Submissions Sheet */}
            <Sheet open={!!selectedTech} onOpenChange={(o) => !o && setSelectedTech(null)}>
                <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
                    {selectedTech && (
                        <>
                            <SheetHeader className="pb-4">
                                <SheetTitle className="flex items-center gap-2">
                                    <UserCheck className="h-5 w-5 text-violet-600" />
                                    {selectedTech.name || `Tech #${selectedTech.tech_id}`}
                                </SheetTitle>
                                <SheetDescription>
                                    All survey submissions by this collector
                                </SheetDescription>
                                {/* Stats summary */}
                                <div className="flex gap-3 flex-wrap pt-2">
                                    <span className="text-sm bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">{selectedTech.done} Done</span>
                                    <span className="text-sm bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">{selectedTech.partial} Partial</span>
                                    <span className="text-sm bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">{selectedTech.skipped} Skipped</span>
                                    <span className="text-sm bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full font-medium">{selectedTech.needs_review} Needs Review</span>
                                </div>
                                {selectedTech.last_activity && (
                                    <p className="text-xs text-slate-400">
                                        Last active: {new Date(selectedTech.last_activity).toLocaleString()}
                                    </p>
                                )}
                            </SheetHeader>

                            {techRowsLoading ? (
                                <div className="flex items-center justify-center py-16 text-slate-400">
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading submissions…
                                </div>
                            ) : techRows.length === 0 ? (
                                <div className="py-12 text-center text-slate-400">
                                    <UserCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
                                    <p className="text-sm">No submissions found for this collector.</p>
                                </div>
                            ) : (
                                <div className="space-y-2 mt-2">
                                    {techRows.map((r) => {
                                        const s = STATUS_CFG[r.survey_status] || { label: r.survey_status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
                                        return (
                                            <div key={r.username} className="border border-slate-100 rounded-lg p-3 bg-white hover:bg-slate-50 transition-colors">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <Link
                                                                href={`/customers/show/${encodeURIComponent(r.username)}`}
                                                                target="_blank"
                                                                className="font-medium text-slate-800 hover:text-blue-600 hover:underline truncate"
                                                            >
                                                                {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.username}
                                                            </Link>
                                                            <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${s.cls}`}>{s.label}</Badge>
                                                        </div>
                                                        <div className="text-xs font-mono text-slate-400">{r.username}</div>
                                                        {r.phone && (
                                                            <a href={`tel:${r.phone}`} className="text-xs text-blue-600 flex items-center gap-1 mt-0.5">
                                                                <PhoneCall className="h-3 w-3" /> {r.phone}
                                                            </a>
                                                        )}
                                                        {(r.rico_address || r.railwire_address) && (
                                                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                                                                {r.rico_address || r.railwire_address}
                                                            </p>
                                                        )}
                                                        {r.mac_address && (
                                                            <span className="inline-block font-mono text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded mt-1">
                                                                {r.mac_address}
                                                            </span>
                                                        )}
                                                        {r.ont_serial_number && (
                                                            <span className="inline-block font-mono text-xs text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded mt-1 ml-1">
                                                                {r.ont_serial_number}
                                                            </span>
                                                        )}
                                                        {r.ont_model && (
                                                            <span className="text-xs text-slate-500 ml-2">{r.ont_model}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        {/* Sticker photos */}
                                                        {r.sticker_photo_url && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setLightbox(mediaUrl(r.sticker_photo_url))}
                                                                className="h-10 w-14 rounded border border-slate-200 overflow-hidden bg-slate-100 hover:border-emerald-400 transition-colors"
                                                                title="ONT sticker"
                                                            >
                                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                <img src={mediaUrl(r.sticker_photo_url)} alt="" className="w-full h-full object-contain" />
                                                            </button>
                                                        )}
                                                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => openEdit(r)}>
                                                            <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                                                        </Button>
                                                    </div>
                                                </div>
                                                {r.completed_at && (
                                                    <p className="text-[11px] text-slate-400 mt-1.5">
                                                        Submitted: {new Date(r.completed_at).toLocaleString()}
                                                        {r.gps_confirmed && (
                                                            <span className="ml-2 text-emerald-600">• GPS confirmed</span>
                                                        )}
                                                    </p>
                                                )}
                                                {r.skip_reason && (
                                                    <p className="text-xs text-red-500 mt-0.5">Skip reason: {r.skip_reason}</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </SheetContent>
            </Sheet>

            {/* Lightbox */}
            {lightbox && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85" onClick={() => setLightbox(null)}>
                    <button className="absolute top-4 right-4 text-white hover:text-slate-300" onClick={() => setLightbox(null)}>
                        <X className="h-8 w-8" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox} alt="Sticker" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// CustomerTable
// ---------------------------------------------------------------------------

function CustomerTable({
    rows,
    onEdit,
    onPhotoClick,
}: {
    rows: SurveyRow[];
    onEdit: (r: SurveyRow) => void;
    onPhotoClick: (url: string) => void;
}) {
    if (rows.length === 0) {
        return (
            <div className="py-16 text-center text-slate-400">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No customers in this category.</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow className="bg-slate-50">
                        <TableHead className="w-52">Customer</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead className="w-48">Address</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>ONT Identity</TableHead>
                        <TableHead>Device Details</TableHead>
                        <TableHead>Photos</TableHead>
                        <TableHead>Collector</TableHead>
                        <TableHead className="text-center">GPS</TableHead>
                        <TableHead></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((r) => {
                        const s = STATUS_CFG[r.survey_status] || { label: r.survey_status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
                        return (
                            <TableRow key={r.username} className="hover:bg-slate-50/70 transition-colors">
                                <TableCell>
                                    <Link href={`/customers/show/${encodeURIComponent(r.username)}`} className="hover:text-blue-600 group">
                                        <div className="font-medium group-hover:underline">
                                            {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                                        </div>
                                        <div className="font-mono text-xs text-slate-400">{r.username}</div>
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    {r.phone ? (
                                        <a href={`tel:${r.phone}`} className="text-blue-600 hover:underline flex items-center gap-1 text-sm">
                                            <PhoneCall className="h-3 w-3" /> {r.phone}
                                        </a>
                                    ) : <span className="text-slate-300">—</span>}
                                </TableCell>
                                <TableCell className="text-xs text-slate-500 max-w-[180px] truncate">
                                    {r.rico_address || r.railwire_address || "—"}
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={`text-xs ${s.cls}`}>{s.label}</Badge>
                                    {r.skip_reason && <div className="text-xs text-slate-400 mt-0.5">{r.skip_reason}</div>}
                                    {r.completed_at && (
                                        <div className="text-xs text-slate-400 mt-0.5">
                                            {new Date(r.completed_at).toLocaleDateString()}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {r.mac_address || r.ont_serial_number ? (
                                        <div className="space-y-1">
                                            {r.mac_address && <span className="font-mono text-xs text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {r.mac_address}
                                            </span>}
                                            {r.ont_serial_number && <div className="font-mono text-xs text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">{r.ont_serial_number}</div>}
                                        </div>
                                    ) : <span className="text-slate-300 text-xs">—</span>}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600">
                                    <div className="space-y-1">
                                        <div>{r.ont_model || "—"}</div>
                                        {r.binding_confidence && (
                                            <Badge variant="outline" className="text-[10px]">
                                                {r.binding_source || "binding"} / {r.binding_confidence}
                                            </Badge>
                                        )}
                                        {r.review_warnings && r.review_warnings.length > 0 && (
                                            <div className="font-mono text-[10px] text-orange-700">
                                                {r.review_warnings.join(", ")}
                                            </div>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-1">
                                        {r.sticker_photo_url && (
                                            <button
                                                type="button"
                                                title="ONT sticker"
                                                onClick={() => onPhotoClick(mediaUrl(r.sticker_photo_url))}
                                                className="h-8 w-8 rounded border border-slate-200 overflow-hidden bg-slate-100 hover:border-emerald-400 transition-colors flex-shrink-0"
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={mediaUrl(r.sticker_photo_url)} alt="" className="w-full h-full object-cover" />
                                            </button>
                                        )}
                                        {r.router_sticker_photo_url && (
                                            <button
                                                type="button"
                                                title="Router sticker"
                                                onClick={() => onPhotoClick(mediaUrl(r.router_sticker_photo_url))}
                                                className="h-8 w-8 rounded border border-slate-200 overflow-hidden bg-slate-100 hover:border-blue-400 transition-colors flex-shrink-0"
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={mediaUrl(r.router_sticker_photo_url)} alt="" className="w-full h-full object-cover" />
                                            </button>
                                        )}
                                        {!r.sticker_photo_url && !r.router_sticker_photo_url && (
                                            <span className="text-slate-300 text-xs">—</span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {r.collector_name ? (
                                        <span className="flex items-center gap-1 text-xs text-slate-700">
                                            <UserCheck className="h-3 w-3 text-slate-400" /> {r.collector_name}
                                        </span>
                                    ) : <span className="text-slate-300 text-xs">—</span>}
                                </TableCell>
                                <TableCell className="text-center">
                                    {r.gps_confirmed
                                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 inline" />
                                        : <XCircle className="h-4 w-4 text-slate-200 inline" />}
                                </TableCell>
                                <TableCell>
                                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onEdit(r)}>
                                        <Edit2 className="h-3.5 w-3.5" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabBtn({ value, label, count, color = "text-slate-700" }: { value: string; label: string; count: number; color?: string }) {
    return (
        <TabsTrigger
            value={value}
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-600 data-[state=active]:text-emerald-700 data-[state=active]:bg-transparent px-4 h-9 text-sm"
        >
            {label}
            {count > 0 && (
                <span className={`ml-1.5 text-xs font-semibold ${color}`}>{count.toLocaleString()}</span>
            )}
        </TabsTrigger>
    );
}

function StatCard({ icon, label, value, hint, accent, onClick, clickable }: {
    icon: React.ReactNode;
    label: string;
    value: number;
    hint?: string;
    accent: "slate" | "emerald" | "blue" | "amber";
    onClick?: () => void;
    clickable?: boolean;
}) {
    const iconCls = { slate: "bg-slate-100 text-slate-600", emerald: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700" }[accent];
    const valCls  = { slate: "text-slate-900", emerald: "text-emerald-700", blue: "text-blue-700", amber: "text-amber-700" }[accent];
    return (
        <Card
            className={onClick ? "cursor-pointer hover:shadow-md transition-shadow" : ""}
            onClick={onClick}
        >
            <CardContent className="py-5">
                <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{label}</div>
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconCls}`}>{icon}</div>
                </div>
                <div className={`text-3xl font-bold mt-3 ${valCls}`}>{value.toLocaleString()}</div>
                {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
                {clickable && <div className="text-xs text-slate-400 mt-1">Click to filter →</div>}
            </CardContent>
        </Card>
    );
}
