"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "@/config";
import { authFetch } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBanner } from "@/components/error-banner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    AlertCircle,
    CheckCircle2,
    Copy,
    Eye,
    Loader2,
    MapPin,
    Play,
    PlusCircle,
    RefreshCw,
    ShieldCheck,
    Users,
    X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (match backend schemas/collection.py)
// ---------------------------------------------------------------------------

interface Campaign {
    id: number;
    name: string;
    description?: string | null;
    status: string;
    target_count: number;
    completed_count: number;
    skipped_count: number;
    pending_count: number;
    progress_pct: number;
    created_at: string;
    started_at?: string | null;
    ended_at?: string | null;
}

interface CollectorStat {
    collector_id: number;
    collector_name?: string | null;
    assigned: number;
    done: number;
    skipped: number;
    pending: number;
    avg_minutes_per_record?: number | null;
    last_activity_at?: string | null;
}

interface LogEntry {
    id: number;
    campaign_id?: number | null;
    assignment_id?: number | null;
    customer_id?: string | null;
    collector_id?: number | null;
    collector_name?: string | null;
    action: string;
    message?: string | null;
    payload?: any;
    created_at: string;
}

interface CampaignProgress {
    campaign: Campaign;
    collectors: CollectorStat[];
    recent_activity: LogEntry[];
    issue_count: number;
    duplicate_count: number;
}

interface IssueItem {
    assignment_id: number;
    customer_id: string;
    customer_name?: string | null;
    collector_id?: number | null;
    collector_name?: string | null;
    issue_type: string;
    detail: string;
    onu_identifier?: string | null;
    gps_accuracy_m?: number | null;
    created_at: string;
    // Sticker photos + extracted fields (from backend list_issues)
    sticker_photo_url?: string | null;
    router_sticker_photo_url?: string | null;
    ont_model?: string | null;
    router_model?: string | null;
}

interface DuplicateItem {
    onu_identifier: string;
    onu_type: string;
    customer_ids: string[];
    count: number;
}

interface BindingItem {
    id: number;
    customer_id: string;
    onu_identifier: string;
    onu_type: string;
    primary_identifier_type?: string | null;
    serial_number?: string | null;
    mac_address?: string | null;
    olt_host?: string | null;
    pon_port?: string | null;
    onu_index?: number | null;
    binding_source: string;
    confidence: string;
    is_active?: boolean;
    verified_at?: string | null;
    deactivated_at?: string | null;
    deactivated_reason?: string | null;
    sticker_photo_url?: string | null;
    first_seen: string;
    last_seen: string;
    notes?: string | null;
}

interface CollectionStats {
    total_customers: number;
    bound_customers: number;
    surveyed_customers: number;
    bind_percentage: number;
    epon_bound: number;
    gpon_bound: number;
    duplicate_count: number;
    issue_count: number;
}

interface Technician {
    id: number;
    full_name: string;
    username: string;
    role: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CollectionPage() {
    const [stats, setStats] = useState<CollectionStats | null>(null);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
    const [progress, setProgress] = useState<CampaignProgress | null>(null);
    const [issues, setIssues] = useState<IssueItem[]>([]);
    const [duplicates, setDuplicates] = useState<DuplicateItem[]>([]);
    const [bindings, setBindings] = useState<BindingItem[]>([]);
    const [bindingSearch, setBindingSearch] = useState("");
    const [bindingState, setBindingState] = useState<"all" | "active" | "inactive">("active");
    const [technicians, setTechnicians] = useState<Technician[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Create campaign form
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDesc, setNewDesc] = useState("");
    const [creating, setCreating] = useState(false);

    // Distribute form
    const [distributeOpen, setDistributeOpen] = useState(false);
    const [selectedCollectorIds, setSelectedCollectorIds] = useState<number[]>([]);
    const [distributing, setDistributing] = useState(false);

    // Correction dialog
    const [correctionTarget, setCorrectionTarget] = useState<IssueItem | null>(null);
    const [corrIdent, setCorrIdent] = useState("");
    const [corrType, setCorrType] = useState<"epon" | "gpon">("epon");
    const [corrConfidence, setCorrConfidence] = useState<"verified" | "probable">("verified");
    const [corrNotes, setCorrNotes] = useState("");
    const [correcting, setCorrecting] = useState(false);

    // Lightbox for sticker photos
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    // -------------------- Data loading --------------------

    const loadCampaigns = useCallback(async () => {
        const res = await authFetch(`${API_URL}/collection/campaigns`);
        if (!res.ok) throw new Error("Failed to load campaigns");
        const json = await res.json();
        const items: Campaign[] = json.items || [];
        setCampaigns(items);
        return items;
    }, []);

    const loadStats = useCallback(async () => {
        const res = await authFetch(`${API_URL}/collection/stats`);
        if (res.ok) setStats(await res.json());
    }, []);

    const loadIssuesAndDuplicates = useCallback(async () => {
        const [iRes, dRes] = await Promise.all([
            authFetch(`${API_URL}/collection/issues`),
            authFetch(`${API_URL}/collection/duplicates`),
        ]);
        if (iRes.ok) setIssues((await iRes.json()).items || []);
        if (dRes.ok) setDuplicates((await dRes.json()).items || []);
    }, []);

    const loadBindings = useCallback(async () => {
        const res = await authFetch(`${API_URL}/collection/bindings?limit=500`);
        if (res.ok) setBindings((await res.json()).items || []);
    }, []);

    const loadProgress = useCallback(async (campaignId: number) => {
        const res = await authFetch(`${API_URL}/collection/campaigns/${campaignId}/progress`);
        if (!res.ok) {
            setProgress(null);
            return;
        }
        setProgress(await res.json());
    }, []);

    const loadTechnicians = useCallback(async () => {
        const res = await authFetch(`${API_URL}/technicians/?skip=0&limit=100`);
        if (!res.ok) return;
        const json = await res.json();
        setTechnicians(json.items || []);
    }, []);

    const refreshAll = useCallback(async () => {
        setRefreshing(true);
        setError(null);
        try {
            const items = await loadCampaigns();
            await loadStats();
            await loadIssuesAndDuplicates();
            await loadBindings();
            const currentId =
                selectedCampaignId ?? (items.length > 0 ? items[0].id : null);
            if (currentId) {
                setSelectedCampaignId(currentId);
                await loadProgress(currentId);
            }
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : "Network error contacting backend";
            console.error("[Collection]", e);
            setError(msg);
            toast.error(e?.message || "Failed to refresh");
        } finally {
            setRefreshing(false);
        }
    }, [loadCampaigns, loadStats, loadIssuesAndDuplicates, loadBindings, loadProgress, selectedCampaignId]);

    useEffect(() => {
        (async () => {
            setError(null);
            try {
                const items = await loadCampaigns();
                await Promise.all([loadStats(), loadIssuesAndDuplicates(), loadBindings(), loadTechnicians()]);
                if (items.length > 0) {
                    setSelectedCampaignId(items[0].id);
                    await loadProgress(items[0].id);
                }
            } catch (e: any) {
                const msg = e instanceof Error ? e.message : "Network error contacting backend";
                console.error("[Collection]", e);
                setError(msg);
                toast.error(e?.message || "Failed to load collection data");
            } finally {
                setLoading(false);
            }
        })();
    }, [loadCampaigns, loadStats, loadIssuesAndDuplicates, loadBindings, loadTechnicians, loadProgress]);

    // Reload progress when campaign selection changes
    useEffect(() => {
        if (selectedCampaignId != null) {
            loadProgress(selectedCampaignId);
        }
    }, [selectedCampaignId, loadProgress]);

    // -------------------- Actions --------------------

    const handleCreateCampaign = async () => {
        if (!newName.trim()) {
            toast.error("Campaign name is required");
            return;
        }
        setCreating(true);
        try {
            const res = await authFetch(`${API_URL}/collection/campaigns`, {
                method: "POST",
                body: JSON.stringify({
                    name: newName.trim(),
                    description: newDesc.trim() || null,
                    include_all_customers: true,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Failed to create campaign");
            }
            const created: Campaign = await res.json();
            toast.success(`Created campaign "${created.name}" with ${created.target_count} customers`);
            setCreateOpen(false);
            setNewName("");
            setNewDesc("");
            const items = await loadCampaigns();
            setSelectedCampaignId(created.id);
            if (items.length) await loadProgress(created.id);
        } catch (e: any) {
            toast.error(e?.message || "Create failed");
        } finally {
            setCreating(false);
        }
    };

    const toggleCollector = (id: number) => {
        setSelectedCollectorIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    };

    const handleDistribute = async () => {
        if (selectedCampaignId == null) {
            toast.error("Select a campaign first");
            return;
        }
        if (selectedCollectorIds.length === 0) {
            toast.error("Pick at least one collector");
            return;
        }
        setDistributing(true);
        try {
            const res = await authFetch(
                `${API_URL}/collection/campaigns/${selectedCampaignId}/distribute`,
                {
                    method: "POST",
                    body: JSON.stringify({ collector_ids: selectedCollectorIds }),
                },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Distribute failed");
            }
            const result = await res.json();
            toast.success(
                `Distributed ${result.total_assigned ?? "?"} assignments across ${selectedCollectorIds.length} collectors`,
            );
            setDistributeOpen(false);
            setSelectedCollectorIds([]);
            await loadProgress(selectedCampaignId);
            await loadStats();
        } catch (e: any) {
            toast.error(e?.message || "Distribute failed");
        } finally {
            setDistributing(false);
        }
    };

    const openCorrection = (issue: IssueItem) => {
        setCorrectionTarget(issue);
        setCorrIdent(issue.onu_identifier || "");
        setCorrType("epon");
        setCorrConfidence("verified");
        setCorrNotes("");
    };

    const handleCorrect = async () => {
        if (!correctionTarget) return;
        if (!corrIdent.trim()) {
            toast.error("ONU identifier is required");
            return;
        }
        setCorrecting(true);
        try {
            const res = await authFetch(
                `${API_URL}/collection/customers/${correctionTarget.customer_id}/correct`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        onu_identifier: corrIdent.trim().toUpperCase(),
                        onu_type: corrType,
                        confidence: corrConfidence,
                        notes: corrNotes.trim() || null,
                    }),
                },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Correction failed");
            }
            toast.success("Binding corrected");
            setCorrectionTarget(null);
            await loadIssuesAndDuplicates();
            await loadBindings();
            await loadStats();
            if (selectedCampaignId) await loadProgress(selectedCampaignId);
        } catch (e: any) {
            toast.error(e?.message || "Correction failed");
        } finally {
            setCorrecting(false);
        }
    };

    const filteredBindings = useMemo(() => {
        const q = bindingSearch.trim().toLowerCase();
        return bindings.filter((b) => {
            if (bindingState === "active" && b.is_active === false) return false;
            if (bindingState === "inactive" && b.is_active !== false) return false;
            if (!q) return true;
            return [
                b.customer_id,
                b.onu_identifier,
                b.serial_number,
                b.mac_address,
                b.olt_host,
                b.pon_port,
                b.binding_source,
                b.confidence,
            ].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
        });
    }, [bindings, bindingSearch, bindingState]);

    const bindingCounts = useMemo(() => {
        const active = bindings.filter((b) => b.is_active !== false).length;
        const inactive = bindings.length - active;
        const verified = bindings.filter((b) => b.confidence === "verified" && b.is_active !== false).length;
        return { active, inactive, verified };
    }, [bindings]);

    // -------------------- Derived --------------------

    const selectedCampaign = useMemo(
        () => campaigns.find((c) => c.id === selectedCampaignId) || null,
        [campaigns, selectedCampaignId],
    );

    // -------------------- Render --------------------

    if (loading) {
        return (
            <div className="flex min-h-screen bg-slate-50">
                <MainSidebar />
                <main className="flex-1 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
                </main>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-slate-50">
            <MainSidebar />
            <main className="flex-1 p-6 space-y-6 overflow-x-hidden">
                {error && <ErrorBanner title="Could not load collection data" message={error} onRetry={refreshAll} />}
                {/* Header */}
                <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Field Data Collection</h1>
                        <p className="text-sm text-slate-500">
                            Operation Bridge the Gap — customer ↔ ONU binding campaigns
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={refreshAll} disabled={refreshing}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                            <DialogTrigger asChild>
                                <Button className="bg-emerald-700 hover:bg-emerald-800">
                                    <PlusCircle className="h-4 w-4 mr-2" />
                                    New Campaign
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create Collection Campaign</DialogTitle>
                                    <DialogDescription>
                                        Includes every customer without a binding. Next step: distribute to collectors.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-2">
                                    <div>
                                        <Label htmlFor="name">Name</Label>
                                        <Input
                                            id="name"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder="Operation Bridge the Gap — Batch 1"
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="desc">Description (optional)</Label>
                                        <Textarea
                                            id="desc"
                                            value={newDesc}
                                            onChange={(e) => setNewDesc(e.target.value)}
                                            rows={3}
                                            placeholder="2-day door-to-door survey covering unlinked customers"
                                        />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleCreateCampaign}
                                        disabled={creating}
                                        className="bg-emerald-700 hover:bg-emerald-800"
                                    >
                                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                {/* Top stats */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard
                            icon={<Users className="h-5 w-5" />}
                            label="Bind Coverage"
                            value={`${stats.bind_percentage}%`}
                            hint={`${stats.bound_customers} / ${stats.total_customers} customers`}
                            accent="emerald"
                        />
                        <StatCard
                            icon={<MapPin className="h-5 w-5" />}
                            label="Surveyed"
                            value={stats.surveyed_customers.toString()}
                            hint="customers with GPS captured"
                            accent="blue"
                        />
                        <StatCard
                            icon={<Copy className="h-5 w-5" />}
                            label="Duplicates"
                            value={stats.duplicate_count.toString()}
                            hint="same ONU linked to 2+ customers"
                            accent={stats.duplicate_count ? "red" : "slate"}
                        />
                        <StatCard
                            icon={<AlertCircle className="h-5 w-5" />}
                            label="Needs Review"
                            value={stats.issue_count.toString()}
                            hint="low confidence submissions"
                            accent={stats.issue_count ? "amber" : "slate"}
                        />
                    </div>
                )}

                {/* Secondary: EPON / GPON split */}
                {stats && (
                    <div className="grid grid-cols-2 gap-4 max-w-md">
                        <Card>
                            <CardContent className="py-4">
                                <div className="text-xs text-slate-500 uppercase tracking-wide">EPON bound</div>
                                <div className="text-2xl font-bold text-slate-900 mt-1">{stats.epon_bound}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="py-4">
                                <div className="text-xs text-slate-500 uppercase tracking-wide">GPON bound</div>
                                <div className="text-2xl font-bold text-slate-900 mt-1">{stats.gpon_bound}</div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* Campaign selector + progress */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
                        <div>
                            <CardTitle>Active Campaign</CardTitle>
                            <CardDescription>Live progress and collector performance</CardDescription>
                        </div>
                        <div className="flex gap-2 items-center">
                            {campaigns.length > 0 && (
                                <Select
                                    value={selectedCampaignId?.toString() || ""}
                                    onValueChange={(v) => setSelectedCampaignId(parseInt(v, 10))}
                                >
                                    <SelectTrigger className="w-64">
                                        <SelectValue placeholder="Select campaign" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {campaigns.map((c) => (
                                            <SelectItem key={c.id} value={c.id.toString()}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            <Dialog open={distributeOpen} onOpenChange={setDistributeOpen}>
                                <DialogTrigger asChild>
                                    <Button
                                        variant="outline"
                                        disabled={!selectedCampaignId}
                                    >
                                        <Play className="h-4 w-4 mr-2" />
                                        Distribute
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Distribute Assignments</DialogTitle>
                                        <DialogDescription>
                                            Pick the field collectors — customers get split round-robin. Existing assignments are preserved.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-2 py-2 max-h-80 overflow-y-auto">
                                        {technicians.length === 0 && (
                                            <p className="text-sm text-slate-500">No technicians found.</p>
                                        )}
                                        {technicians.map((t) => {
                                            const checked = selectedCollectorIds.includes(t.id);
                                            return (
                                                <label
                                                    key={t.id}
                                                    className={`flex items-center gap-3 p-2 rounded border cursor-pointer ${
                                                        checked ? "bg-emerald-50 border-emerald-300" : "border-slate-200"
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleCollector(t.id)}
                                                        className="h-4 w-4"
                                                    />
                                                    <div className="flex-1">
                                                        <div className="font-medium text-sm">{t.full_name}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {t.username} · {t.role}
                                                        </div>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setDistributeOpen(false)} disabled={distributing}>
                                            Cancel
                                        </Button>
                                        <Button
                                            onClick={handleDistribute}
                                            disabled={distributing}
                                            className="bg-emerald-700 hover:bg-emerald-800"
                                        >
                                            {distributing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Distribute"}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        {!selectedCampaign && (
                            <p className="text-sm text-slate-500 italic">
                                No campaigns yet. Click &quot;New Campaign&quot; to create one.
                            </p>
                        )}
                        {selectedCampaign && (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                                    <MiniStat label="Target" value={selectedCampaign.target_count} />
                                    <MiniStat label="Done" value={selectedCampaign.completed_count} color="emerald" />
                                    <MiniStat label="Skipped" value={selectedCampaign.skipped_count} color="slate" />
                                    <MiniStat label="Pending" value={selectedCampaign.pending_count} color="amber" />
                                    <MiniStat label="Status" valueText={selectedCampaign.status} />
                                </div>
                                <div>
                                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                                        <span>{selectedCampaign.progress_pct.toFixed(1)}% complete</span>
                                        <span>
                                            {selectedCampaign.completed_count}/{selectedCampaign.target_count}
                                        </span>
                                    </div>
                                    <Progress value={selectedCampaign.progress_pct} />
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Collector table */}
                {progress && progress.collectors.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Collector Performance</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Collector</TableHead>
                                        <TableHead className="text-right">Assigned</TableHead>
                                        <TableHead className="text-right">Done</TableHead>
                                        <TableHead className="text-right">Skipped</TableHead>
                                        <TableHead className="text-right">Pending</TableHead>
                                        <TableHead className="text-right">Avg (min)</TableHead>
                                        <TableHead>Last activity</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {progress.collectors.map((c) => (
                                        <TableRow key={c.collector_id}>
                                            <TableCell className="font-medium">
                                                {c.collector_name || `#${c.collector_id}`}
                                            </TableCell>
                                            <TableCell className="text-right">{c.assigned}</TableCell>
                                            <TableCell className="text-right text-emerald-700 font-semibold">
                                                {c.done}
                                            </TableCell>
                                            <TableCell className="text-right">{c.skipped}</TableCell>
                                            <TableCell className="text-right">{c.pending}</TableCell>
                                            <TableCell className="text-right">
                                                {c.avg_minutes_per_record != null
                                                    ? c.avg_minutes_per_record.toFixed(1)
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-500">
                                                {c.last_activity_at
                                                    ? new Date(c.last_activity_at).toLocaleString()
                                                    : "—"}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}

                {/* Tabs for issues / duplicates / activity */}
                <Tabs defaultValue="issues" className="w-full">
                    <TabsList>
                        <TabsTrigger value="issues">
                            Issues
                            {issues.length > 0 && (
                                <Badge className="ml-2 bg-amber-500">{issues.length}</Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="duplicates">
                            Duplicates
                            {duplicates.length > 0 && (
                                <Badge className="ml-2 bg-red-500">{duplicates.length}</Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="bindings">
                            Bindings
                            <Badge className="ml-2 bg-emerald-600">{bindingCounts.active}</Badge>
                        </TabsTrigger>
                        <TabsTrigger value="activity">Recent Activity</TabsTrigger>
                    </TabsList>

                    {/* Issues tab */}
                    <TabsContent value="issues">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Needs Review Queue</CardTitle>
                                <CardDescription>
                                    Low GPS accuracy, duplicate ONU identifiers, or missing data. Correct in-place to resolve.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {issues.length === 0 ? (
                                    <EmptyState
                                        icon={<CheckCircle2 className="h-10 w-10 text-emerald-600" />}
                                        title="Clean queue"
                                        subtitle="No submissions need admin review right now."
                                    />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Customer</TableHead>
                                                <TableHead>Collector</TableHead>
                                                <TableHead>Issue</TableHead>
                                                <TableHead>ONU ID</TableHead>
                                                <TableHead>Photos</TableHead>
                                                <TableHead>GPS (m)</TableHead>
                                                <TableHead>When</TableHead>
                                                <TableHead></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {issues.map((i) => (
                                                <TableRow key={i.assignment_id}>
                                                    <TableCell>
                                                        <div className="font-medium">{i.customer_name || i.customer_id}</div>
                                                        <div className="text-xs text-slate-500">{i.customer_id}</div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {i.collector_name || (i.collector_id ? `#${i.collector_id}` : "—")}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                                                            {i.issue_type}
                                                        </Badge>
                                                        <div className="text-xs text-slate-500 mt-1 max-w-[240px] truncate">
                                                            {i.detail}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        {i.onu_identifier || "—"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex gap-1">
                                                            {i.sticker_photo_url && (
                                                                <button
                                                                    type="button"
                                                                    title="View ONT sticker"
                                                                    onClick={() => setLightboxUrl(`${API_URL}${i.sticker_photo_url}`)}
                                                                    className="h-10 w-10 rounded border border-slate-200 overflow-hidden bg-slate-100 hover:border-emerald-400 transition-colors flex-shrink-0"
                                                                >
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img src={`${API_URL}${i.sticker_photo_url}`} alt="ONT" className="w-full h-full object-cover" />
                                                                </button>
                                                            )}
                                                            {i.router_sticker_photo_url && (
                                                                <button
                                                                    type="button"
                                                                    title="View router sticker"
                                                                    onClick={() => setLightboxUrl(`${API_URL}${i.router_sticker_photo_url}`)}
                                                                    className="h-10 w-10 rounded border border-slate-200 overflow-hidden bg-slate-100 hover:border-blue-400 transition-colors flex-shrink-0"
                                                                >
                                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                    <img src={`${API_URL}${i.router_sticker_photo_url}`} alt="Router" className="w-full h-full object-cover" />
                                                                </button>
                                                            )}
                                                            {!i.sticker_photo_url && !i.router_sticker_photo_url && (
                                                                <span className="text-xs text-slate-400">—</span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-sm">
                                                        {i.gps_accuracy_m != null ? i.gps_accuracy_m.toFixed(0) : "—"}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-slate-500">
                                                        {new Date(i.created_at).toLocaleString()}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => openCorrection(i)}
                                                        >
                                                            <ShieldCheck className="h-3 w-3 mr-1" />
                                                            Correct
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Duplicates tab */}
                    <TabsContent value="duplicates">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Duplicate ONU Identifiers</CardTitle>
                                <CardDescription>
                                    Same MAC/SN bound to multiple customers — physically impossible, must be resolved.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {duplicates.length === 0 ? (
                                    <EmptyState
                                        icon={<CheckCircle2 className="h-10 w-10 text-emerald-600" />}
                                        title="No duplicates"
                                        subtitle="Every ONU identifier is unique."
                                    />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>ONU Identifier</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Count</TableHead>
                                                <TableHead>Customers</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {duplicates.map((d, idx) => (
                                                <TableRow key={`${d.onu_identifier}-${idx}`}>
                                                    <TableCell className="font-mono text-xs">{d.onu_identifier}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">{d.onu_type.toUpperCase()}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-red-600">
                                                        {d.count}
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        {d.customer_ids.join(", ")}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Bindings tab */}
                    <TabsContent value="bindings">
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <CardTitle className="text-base">Trusted ONU Bindings</CardTitle>
                                        <CardDescription>
                                            Field/admin verified customer-to-ONU identity. GPON uses serial, EPON uses MAC.
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <Badge className="bg-emerald-600">Active {bindingCounts.active}</Badge>
                                        <Badge variant="outline">Verified {bindingCounts.verified}</Badge>
                                        <Badge variant="secondary">Inactive {bindingCounts.inactive}</Badge>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                    <Input
                                        value={bindingSearch}
                                        onChange={(e) => setBindingSearch(e.target.value)}
                                        placeholder="Search customer, serial, MAC, OLT, PON..."
                                        className="md:max-w-sm"
                                    />
                                    <Select value={bindingState} onValueChange={(v: any) => setBindingState(v)}>
                                        <SelectTrigger className="w-full md:w-40">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active only</SelectItem>
                                            <SelectItem value="inactive">Inactive only</SelectItem>
                                            <SelectItem value="all">All bindings</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {filteredBindings.length === 0 ? (
                                    <EmptyState
                                        icon={<ShieldCheck className="h-10 w-10 text-slate-400" />}
                                        title="No bindings found"
                                        subtitle="Survey/manual links will appear here after technicians verify ONT stickers."
                                    />
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Customer</TableHead>
                                                    <TableHead>Primary</TableHead>
                                                    <TableHead>Serial / MAC</TableHead>
                                                    <TableHead>OLT Placement</TableHead>
                                                    <TableHead>Trust</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead>Sticker</TableHead>
                                                    <TableHead>Seen</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {filteredBindings.map((b) => {
                                                    const active = b.is_active !== false;
                                                    return (
                                                        <TableRow key={b.id} className={!active ? "opacity-60" : ""}>
                                                            <TableCell>
                                                                <div className="font-mono text-xs font-semibold">{b.customer_id}</div>
                                                                {b.notes && <div className="text-xs text-slate-500 truncate max-w-[180px]">{b.notes}</div>}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Badge variant="outline" className="font-mono">
                                                                    {(b.primary_identifier_type || b.onu_type).toUpperCase()}
                                                                </Badge>
                                                                <div className="font-mono text-xs mt-1 max-w-[170px] truncate">{b.onu_identifier}</div>
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                <div><span className="text-slate-400">SN:</span> <span className="font-mono">{b.serial_number || "-"}</span></div>
                                                                <div><span className="text-slate-400">MAC:</span> <span className="font-mono">{b.mac_address || "-"}</span></div>
                                                            </TableCell>
                                                            <TableCell className="text-xs">
                                                                <div className="font-mono">{b.olt_host || "-"}</div>
                                                                <div className="text-slate-500">{b.pon_port || "-"} {b.onu_index != null ? `#${b.onu_index}` : ""}</div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col gap-1">
                                                                    <Badge className={b.confidence === "verified" ? "bg-emerald-600" : "bg-amber-500"}>
                                                                        {b.confidence}
                                                                    </Badge>
                                                                    <span className="text-xs text-slate-500">{b.binding_source}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                {active ? (
                                                                    <Badge className="bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>
                                                                ) : (
                                                                    <div className="space-y-1">
                                                                        <Badge variant="secondary"><X className="h-3 w-3 mr-1" />Inactive</Badge>
                                                                        {b.deactivated_reason && <div className="text-xs text-slate-500">{b.deactivated_reason}</div>}
                                                                    </div>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {b.sticker_photo_url ? (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => setLightboxUrl(`${API_URL}${b.sticker_photo_url}`)}
                                                                    >
                                                                        <Eye className="h-3 w-3 mr-1" />
                                                                        View
                                                                    </Button>
                                                                ) : (
                                                                    <span className="text-xs text-slate-400">No photo</span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="text-xs text-slate-500">
                                                                <div>{new Date(b.verified_at || b.last_seen || b.first_seen).toLocaleString()}</div>
                                                                {b.deactivated_at && <div>Off: {new Date(b.deactivated_at).toLocaleString()}</div>}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Activity tab */}
                    <TabsContent value="activity">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Recent Activity</CardTitle>
                                <CardDescription>
                                    Full audit trail — every submission, skip, photo upload, and admin correction.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {progress && progress.recent_activity.length > 0 ? (
                                    <div className="space-y-2">
                                        {progress.recent_activity.map((log) => (
                                            <div
                                                key={log.id}
                                                className="flex items-start gap-3 p-3 rounded border border-slate-200 bg-white"
                                            >
                                                <div className="mt-0.5">
                                                    <ActionIcon action={log.action} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {log.action}
                                                        </Badge>
                                                        {log.customer_id && (
                                                            <span className="text-xs font-mono text-slate-600">
                                                                {log.customer_id}
                                                            </span>
                                                        )}
                                                        {log.collector_name && (
                                                            <span className="text-xs text-slate-500">
                                                                by {log.collector_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {log.message && (
                                                        <div className="text-sm text-slate-700 mt-1">{log.message}</div>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-400 whitespace-nowrap">
                                                    {new Date(log.created_at).toLocaleString()}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyState
                                        icon={<RefreshCw className="h-10 w-10 text-slate-400" />}
                                        title="No activity yet"
                                        subtitle="Activity appears as collectors submit data."
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                {/* Correction dialog */}
                <Dialog open={!!correctionTarget} onOpenChange={(open) => !open && setCorrectionTarget(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Correct Binding</DialogTitle>
                            <DialogDescription>
                                Manual override for {correctionTarget?.customer_name || correctionTarget?.customer_id}.
                                This marks the assignment as resolved and overwrites the existing binding.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            {/* Sticker photo comparison */}
                            {(correctionTarget?.sticker_photo_url || correctionTarget?.router_sticker_photo_url) && (
                                <div>
                                    <Label className="text-xs text-slate-500 uppercase tracking-wide">Sticker Photos — compare MAC in image with field below</Label>
                                    <div className="flex gap-3 mt-2">
                                        {correctionTarget.sticker_photo_url && (
                                            <div className="flex-1">
                                                <div className="text-xs text-slate-500 mb-1 font-medium">ONT Sticker</div>
                                                <button
                                                    type="button"
                                                    onClick={() => setLightboxUrl(`${API_URL}${correctionTarget.sticker_photo_url}`)}
                                                    className="relative w-full h-40 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 hover:border-emerald-400 transition-colors group"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={`${API_URL}${correctionTarget.sticker_photo_url}`}
                                                        alt="ONT sticker"
                                                        className="w-full h-full object-contain"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                                                        <Eye className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                </button>
                                                {correctionTarget.ont_model && (
                                                    <div className="text-xs text-slate-600 mt-1">Model: <span className="font-mono font-semibold">{correctionTarget.ont_model}</span></div>
                                                )}
                                            </div>
                                        )}
                                        {correctionTarget.router_sticker_photo_url && (
                                            <div className="flex-1">
                                                <div className="text-xs text-slate-500 mb-1 font-medium">Router Sticker</div>
                                                <button
                                                    type="button"
                                                    onClick={() => setLightboxUrl(`${API_URL}${correctionTarget.router_sticker_photo_url}`)}
                                                    className="relative w-full h-40 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 hover:border-emerald-400 transition-colors group"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={`${API_URL}${correctionTarget.router_sticker_photo_url}`}
                                                        alt="Router sticker"
                                                        className="w-full h-full object-contain"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                                                        <Eye className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                </button>
                                                {correctionTarget.router_model && (
                                                    <div className="text-xs text-slate-600 mt-1">Model: <span className="font-mono font-semibold">{correctionTarget.router_model}</span></div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div>
                                <Label>ONU Identifier (MAC or Serial)</Label>
                                <Input
                                    value={corrIdent}
                                    onChange={(e) => setCorrIdent(e.target.value.toUpperCase())}
                                    placeholder="e.g. AABBCCDDEEFF or NLNK12345678"
                                    className="font-mono"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>Type</Label>
                                    <Select value={corrType} onValueChange={(v: any) => setCorrType(v)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="epon">EPON (MAC)</SelectItem>
                                            <SelectItem value="gpon">GPON (Serial)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>Confidence</Label>
                                    <Select value={corrConfidence} onValueChange={(v: any) => setCorrConfidence(v)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="verified">Verified</SelectItem>
                                            <SelectItem value="probable">Probable</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div>
                                <Label>Notes (optional)</Label>
                                <Textarea
                                    value={corrNotes}
                                    onChange={(e) => setCorrNotes(e.target.value)}
                                    rows={2}
                                    placeholder="Why this correction"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setCorrectionTarget(null)} disabled={correcting}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCorrect}
                                disabled={correcting}
                                className="bg-emerald-700 hover:bg-emerald-800"
                            >
                                {correcting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply Correction"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Lightbox */}
                {lightboxUrl && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
                        onClick={() => setLightboxUrl(null)}
                    >
                        <button
                            type="button"
                            className="absolute top-4 right-4 text-white hover:text-slate-300"
                            onClick={() => setLightboxUrl(null)}
                        >
                            <X className="h-8 w-8" />
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={lightboxUrl}
                            alt="Sticker"
                            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                )}
            </main>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
    icon,
    label,
    value,
    hint,
    accent,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint: string;
    accent: "emerald" | "blue" | "red" | "amber" | "slate";
}) {
    const accentClasses: Record<string, string> = {
        emerald: "bg-emerald-50 text-emerald-700",
        blue: "bg-blue-50 text-blue-700",
        red: "bg-red-50 text-red-700",
        amber: "bg-amber-50 text-amber-700",
        slate: "bg-slate-100 text-slate-600",
    };
    return (
        <Card>
            <CardContent className="py-5">
                <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold">
                        {label}
                    </div>
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${accentClasses[accent]}`}>
                        {icon}
                    </div>
                </div>
                <div className="text-3xl font-bold text-slate-900 mt-3">{value}</div>
                <div className="text-xs text-slate-500 mt-1">{hint}</div>
            </CardContent>
        </Card>
    );
}

function MiniStat({
    label,
    value,
    valueText,
    color,
}: {
    label: string;
    value?: number;
    valueText?: string;
    color?: "emerald" | "amber" | "slate";
}) {
    const colorClass =
        color === "emerald"
            ? "text-emerald-700"
            : color === "amber"
              ? "text-amber-600"
              : color === "slate"
                ? "text-slate-500"
                : "text-slate-900";
    return (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
            <div className={`text-xl font-bold mt-1 ${colorClass}`}>
                {valueText ?? value ?? 0}
            </div>
        </div>
    );
}

function EmptyState({
    icon,
    title,
    subtitle,
}: {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-10 text-center">
            {icon}
            <div className="mt-3 font-semibold text-slate-700">{title}</div>
            <div className="text-sm text-slate-500">{subtitle}</div>
        </div>
    );
}

function ActionIcon({ action }: { action: string }) {
    if (action.includes("submit") || action.includes("done")) {
        return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    }
    if (action.includes("skip")) {
        return <AlertCircle className="h-4 w-4 text-slate-500" />;
    }
    if (action.includes("correct")) {
        return <ShieldCheck className="h-4 w-4 text-blue-600" />;
    }
    if (action.includes("photo")) {
        return <MapPin className="h-4 w-4 text-purple-600" />;
    }
    return <RefreshCw className="h-4 w-4 text-slate-400" />;
}
