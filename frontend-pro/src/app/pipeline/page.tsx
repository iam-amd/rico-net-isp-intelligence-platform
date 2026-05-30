"use client";
/**
 * Pipeline Command Center — single-page real-time monitor of the full data flow.
 * Styled to match the scraper dashboard at :5005 — big metric cards, pulsing
 * status indicator, color-coded stages and workers, gap drill-downs.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "@/config";
import { authFetch, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { toast } from "sonner";
import {
    RefreshCw, Activity, Users, Wifi, Server, Database, GitBranch, Cpu,
    AlertTriangle, CheckCircle2, XCircle, HelpCircle, PlayCircle,
    AlertCircle, Search, Router, Zap, FileText, Terminal, History,
    ArrowDown, ShieldAlert, Bell, Check, X as XIcon,
} from "lucide-react";

// ── Drift Center types ─────────────────────────────────────────────────────

interface BindingAlert {
    id: number;
    category: string;
    severity: "info" | "warning" | "critical";
    summary: string;
    suggested_action: string | null;
    customer_username: string | null;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    current_state: Record<string, unknown> | null;
    dedup_key: string | null;
    status: "open" | "ack" | "resolved" | "auto_resolved";
    opened_at: string;
    updated_at: string;
    resolved_at: string | null;
    resolved_by: string | null;
    resolution_note: string | null;
}

interface BindingAlertsResponse { count: number; alerts: BindingAlert[]; }

interface ActivityEvent {
    id: number;
    ts: string;
    category: string;
    severity: "info" | "warning" | "critical";
    actor: string | null;
    customer_username: string | null;
    summary: string;
    payload: Record<string, unknown> | null;
}

interface ActivityEventsResponse { count: number; events: ActivityEvent[]; }

interface ActivityCategoriesResponse {
    categories: Array<{ category: string; cnt: number; cnt_24h: number; last_seen: string | null }>;
}

// ── Types ───────────────────────────────────────────────────────────────────

type StageStatus = "green" | "amber" | "red" | "unknown";

interface Stage {
    key: string; name: string; category: "ingest" | "sync" | "binding" | "snmp";
    status: StageStatus;
    last_success_at: string | null; age_seconds: number | null;
    slo: { warn_after_sec: number; critical_after_sec: number };
    details: Record<string, unknown>; operator_hint: string | null;
}
interface Worker {
    worker_name: string; expected_interval_sec: number | null;
    last_finished_at: string | null; last_started_at: string | null;
    last_status: string | null; duration_seconds: number | null;
    records_processed: number | null; notes: string | null;
    age_seconds: number | null; status: StageStatus;
    slo: { warn_after_sec: number; critical_after_sec: number } | null;
    operator_hint: string | null;
}
interface Coverage {
    total: number; with_mac: number; with_binding: number; draft: number;
}
interface TruthSummary {
    verdict: "usable" | "usable_with_missing_olts" | "needs_investigation" | "conflicted";
    next_action: string;
    connected_olts: number; expected_olts: number;
    active_customers: number; active_with_mac: number; linked_customers: number;
    match_rate_pct: number;
    live_pon_matches: number; held_from_history: number;
    verified_links: number; probable_links: number;
    missing_olt_likely: number; unknown_unbound: number; no_mac_in_portal: number;
    critical_alerts: number; duplicate_mac_alerts: number; profile_incomplete_alerts: number;
    orphan_onus_24h: number;
    orphan_mac_rows_24h?: number;
    olt_slots_seen_24h?: number;
    olt_online_slots?: number;
    orphan_onus_by_olt: Array<{ olt_host: string; cnt: number }>;
    total_customers: number;
}
interface PerAccount {
    account: string; total: number; with_mac: number; with_binding: number;
    draft: number; missing_mac: number; missing_binding: number;
}
interface Gaps {
    missing_mac: number; missing_binding: number; draft: number;
}
interface StateBreakdown {
    overall: Record<string, number>;
    per_account: Array<{ account: string; state: string; cnt: number }>;
    states_order: string[];
}
interface PipelineHealth {
    generated_at: string; overall_status: StageStatus;
    stages: Stage[]; workers: Worker[]; coverage: Coverage;
    truth_summary?: TruthSummary;
    per_account: PerAccount[]; gaps: Gaps;
    state_breakdown?: StateBreakdown;
}

// Per-state UI metadata for the breakdown chips.
const STATE_CFG: Record<string, { label: string; border: string; icon: React.ReactNode; tip: string }> = {
    complete:                { label: "text-emerald-300", border: "border-emerald-500/30", icon: <CheckCircle2 className="h-3 w-3" />, tip: "MAC scraped + bound to OLT" },
    mac_scrape_pending:      { label: "text-blue-300",    border: "border-blue-500/30",    icon: <Search className="h-3 w-3" />,       tip: "Never scraped yet — scheduler will pick up" },
    mac_scrape_failed:       { label: "text-amber-300",   border: "border-amber-500/30",   icon: <AlertTriangle className="h-3 w-3" />, tip: "Scraper failed < 3 times — auto-retry pending" },
    mac_persistent_failure:  { label: "text-red-300",     border: "border-red-500/30",     icon: <XCircle className="h-3 w-3" />,      tip: "≥ 3 failed attempts — manual review needed" },
    no_mac_in_portal:        { label: "text-purple-300",  border: "border-purple-500/30",  icon: <FileText className="h-3 w-3" />,     tip: "Page reached but Railwire has no MAC — survey needed" },
    subscriber_expired:      { label: "text-pink-300",    border: "border-pink-500/30",    icon: <AlertCircle className="h-3 w-3" />,  tip: "Railwire says subscriber expired — contact MSP to reactivate" },
    subscriber_inactive:     { label: "text-zinc-300",    border: "border-zinc-500/30",    icon: <FileText className="h-3 w-3" />,     tip: "Inactive in Railwire CSV — plan paused/expired, no current MAC" },
    unbound_offline:         { label: "text-zinc-300",    border: "border-zinc-500/30",    icon: <Wifi className="h-3 w-3" />,         tip: "Was bound, ONU now offline" },
    unbound_mac_drift:       { label: "text-cyan-300",    border: "border-cyan-500/30",    icon: <Router className="h-3 w-3" />,       tip: "MAC near-match on OLT — auto-bind expected next cycle" },
    olt4_likely:             { label: "text-orange-300",  border: "border-orange-500/30",  icon: <HelpCircle className="h-3 w-3" />,   tip: "MAC not on any registered OLT — probably on OLT #4" },
    unbound_unknown:         { label: "text-red-300",     border: "border-red-500/30",     icon: <AlertCircle className="h-3 w-3" />,  tip: "MAC scraped but invisible everywhere — needs investigation" },
    draft:                   { label: "text-zinc-400",    border: "border-zinc-500/30",    icon: <FileText className="h-3 w-3" />,     tip: "Removed from Railwire — preserved" },
    _fallback:               { label: "text-zinc-300",    border: "border-white/10",       icon: <HelpCircle className="h-3 w-3" />,   tip: "Unknown state" },
};
interface GapCustomer { username: string; first_name: string | null; last_name: string | null;
    phone: string | null; [k: string]: unknown; }
type GapKey = "missing_mac" | "missing_binding" | "draft";

interface PipelineCustomer {
    username: string;
    first_name: string | null; last_name: string | null;
    phone: string | null; email: string | null;
    plan_name: string | null; expiry_date: string | null; balance: number | null;
    status: string | null; connection_status: string | null; last_seen_online: string | null;
    mac_address: string | null; railwire_admin: string | null;
    mac_scrape_attempts?: number | null; mac_last_error?: string | null;
    link_status: string | null; olt_host: string | null; pon_port: string | null; onu_index: number | null;
    onu_status: string | null; polled_at: string | null; rx_power_dbm: number | null;
    binding_source: string | null; confidence: string | null;
    data_pipeline_status?: string | null; last_diagnosis?: string | null;
}
interface AccountChip { account: string; cnt: number }
interface CustomersResponse {
    total: number; limit: number; offset: number;
    filters: { account: string | null; q: string | null; has_mac: boolean | null; link_status: string | null };
    accounts: AccountChip[];
    customers: PipelineCustomer[];
}

interface LogTail {
    log_type: string; path: string; exists: boolean;
    total_lines?: number; matched_lines?: number; returned_lines?: number;
    lines: string[];
    error?: string;
}

interface ActivityItem {
    source: "user" | "scheduler" | "cli" | "worker";
    id: string;
    kind: string;             // bind | rescrape | scrape_account | scrape:csv | scrape:mac | ...
    step: string | null;
    account: string | null;
    customer: string | null;
    triggered_by: string | null;
    started_at: string | null;
    finished_at: string | null;
    duration_seconds: number | null;
    status: string;           // start | ok | error | miss | running | success | failed
    result_summary: string | null;
    error_message: string | null;
    pid: number | null;
    records_processed?: number | null;
}
interface ActivityResponse {
    limit: number;
    count: number;
    filters: { account: string | null };
    accounts: AccountChip[];
    items: ActivityItem[];
}

type LogType = "actions" | "scraper" | "single" | "csv" | "mac" | "details" | "scheduler" | "session" | "sync_daemon";

const LOG_PANES: { key: LogType; label: string; color: string; icon: React.ReactNode }[] = [
    { key: "actions",     label: "user actions (live)",  color: "text-cyan-300",   icon: <PlayCircle className="h-3.5 w-3.5" /> },
    { key: "single",      label: "single_scrape.log",    color: "text-blue-300",   icon: <Users className="h-3.5 w-3.5" /> },
    { key: "mac",         label: "mac_scrape.log",       color: "text-orange-400", icon: <Search className="h-3.5 w-3.5" /> },
    { key: "csv",         label: "csv_sync.log",         color: "text-emerald-400", icon: <Database className="h-3.5 w-3.5" /> },
    { key: "details",     label: "details_scrape.log",   color: "text-purple-400", icon: <FileText className="h-3.5 w-3.5" /> },
    { key: "scraper",     label: "scraper.log",          color: "text-blue-400",   icon: <Zap className="h-3.5 w-3.5" /> },
    { key: "scheduler",   label: "scheduler.log",        color: "text-zinc-400",   icon: <Activity className="h-3.5 w-3.5" /> },
    { key: "sync_daemon", label: "sync_daemon.log",      color: "text-cyan-400",   icon: <Server className="h-3.5 w-3.5" /> },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmtAge = (s: number | null): string => {
    if (s == null) return "never";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
};

/** Strict DD/MM/YYYY hh:MM:SS AM/PM — used everywhere on this page so the format is consistent. */
const fmtDate = (input: string | number | Date | null | undefined, withSeconds = true): string => {
    if (input == null || input === "") return "—";
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return String(input);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dd = pad(d.getDate());
    const mm = pad(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const h24 = d.getHours();
    const ampm = h24 >= 12 ? "PM" : "AM";
    const h12 = ((h24 + 11) % 12) + 1;        // 0→12, 13→1, etc.
    const hh = pad(h12);
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return withSeconds
        ? `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss} ${ampm}`
        : `${dd}/${mm}/${yyyy} ${hh}:${mi} ${ampm}`;
};
const fmtTime = (input: string | number | Date | null | undefined): string => {
    if (input == null || input === "") return "—";
    const d = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(d.getTime())) return String(input);
    const pad = (n: number) => String(n).padStart(2, "0");
    const h24 = d.getHours();
    const ampm = h24 >= 12 ? "PM" : "AM";
    const h12 = ((h24 + 11) % 12) + 1;
    return `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
};
const num = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString());
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

const STATUS_DOT: Record<StageStatus, string> = {
    green:   "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)]",
    amber:   "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]",
    red:     "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]",
    unknown: "bg-zinc-600",
};
const STATUS_BADGE: Record<StageStatus, string> = {
    green:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    amber:   "bg-amber-500/10 text-amber-400 border-amber-500/25",
    red:     "bg-red-500/10 text-red-400 border-red-500/25",
    unknown: "bg-white/5 text-zinc-400 border-white/10",
};
const STATUS_ICON: Record<StageStatus, React.ReactNode> = {
    green:   <CheckCircle2 className="h-3.5 w-3.5" />,
    amber:   <AlertTriangle className="h-3.5 w-3.5" />,
    red:     <XCircle className="h-3.5 w-3.5" />,
    unknown: <HelpCircle className="h-3.5 w-3.5" />,
};

const GAP_LABELS: Record<GapKey, { label: string; color: string; icon: React.ReactNode }> = {
    missing_mac:     { label: "Missing MAC",                       color: "orange", icon: <Search className="h-4 w-4" /> },
    missing_binding: { label: "Missing OLT Binding",               color: "red",    icon: <AlertCircle className="h-4 w-4" /> },
    draft:           { label: "Draft (not in Railwire anymore)",   color: "gray",   icon: <FileText className="h-4 w-4" /> },
};

// ── Page ────────────────────────────────────────────────────────────────────

function PipelineContent() {
    const [data, setData] = useState<PipelineHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [openGap, setOpenGap] = useState<GapKey | null>(null);
    const [gapRows, setGapRows] = useState<GapCustomer[] | null>(null);
    const [gapLoading, setGapLoading] = useState(false);
    const [triggering, setTriggering] = useState<string | null>(null);

    // Customer table state
    const [custs, setCusts] = useState<CustomersResponse | null>(null);
    const [custLoading, setCustLoading] = useState(false);
    const [custAccount, setCustAccount] = useState<string | null>(null);
    const [custQuery, setCustQuery] = useState("");
    const [custMacFilter, setCustMacFilter] = useState<"any" | "has" | "missing">("any");
    const [custLinkFilter, setCustLinkFilter] = useState<"any" | "linked" | "unlinked">("any");
    const [custPage, setCustPage] = useState(0);
    const [custPipelineState, setCustPipelineState] = useState<string | null>(null);
    const PAGE_SIZE = 25;

    // Live logs state
    const [logFilterAccount, setLogFilterAccount] = useState<string | null>(null);
    const [logs, setLogs] = useState<Record<LogType, LogTail | null>>(
        Object.fromEntries(LOG_PANES.map((p) => [p.key, null])) as Record<LogType, LogTail | null>
    );
    const [logAutoScroll, setLogAutoScroll] = useState(true);

    // Activity feed state (user actions + scheduler scraper runs, merged)
    const [activity, setActivity] = useState<ActivityResponse | null>(null);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityAccount, setActivityAccount] = useState<string | null>(null);
    const [activitySource, setActivitySource] = useState<"all" | "user" | "scheduler" | "worker">("all");

    const load = useCallback(async () => {
        setRefreshing(true);
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/pipeline/health`);
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = (await res.json()) as PipelineHealth;
            setData(j);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
            toast.error(`Failed to load pipeline health: ${msg}`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    const loadGap = useCallback(async (k: GapKey) => {
        setGapLoading(true);
        setOpenGap(k);
        try {
            const res = await authFetch(`${API_URL}/pipeline/gaps/${k}?limit=200`);
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json();
            setGapRows(j.customers || []);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Failed to load ${k}: ${msg}`);
        } finally {
            setGapLoading(false);
        }
    }, []);

    const triggerReconcile = useCallback(async () => {
        setTriggering("reconcile");
        try {
            const res = await authFetch(`${API_URL}/engine/reconcile`, { method: "POST" });
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success("Engine reconcile started in the background. Refreshing in a few seconds…");
            setTimeout(() => void load(), 5000);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Failed to start reconcile: ${msg}`);
        } finally {
            setTriggering(null);
        }
    }, [load]);

    const loadCustomers = useCallback(async () => {
        setCustLoading(true);
        try {
            const params = new URLSearchParams({
                limit: String(PAGE_SIZE),
                offset: String(custPage * PAGE_SIZE),
            });
            if (custAccount)              params.set("account", custAccount);
            if (custQuery.trim())         params.set("q", custQuery.trim());
            if (custMacFilter === "has")     params.set("has_mac", "true");
            if (custMacFilter === "missing") params.set("has_mac", "false");
            if (custLinkFilter !== "any")    params.set("link_status", custLinkFilter);
            if (custPipelineState)           params.set("pipeline_state", custPipelineState);
            const res = await authFetch(`${API_URL}/pipeline/customers?${params.toString()}`);
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = (await res.json()) as CustomersResponse;
            setCusts(j);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Failed to load customers: ${msg}`);
        } finally {
            setCustLoading(false);
        }
    }, [custPage, custAccount, custQuery, custMacFilter, custLinkFilter, custPipelineState]);

    const loadLogs = useCallback(async () => {
        const fetched = await Promise.all(
            LOG_PANES.map(async (p) => {
                const params = new URLSearchParams({ lines: "120" });
                if (logFilterAccount) params.set("account", logFilterAccount);
                try {
                    const res = await authFetch(`${API_URL}/pipeline/logs/${p.key}?${params.toString()}`);
                    if (handle401(res)) return [p.key, null] as const;
                    if (!res.ok) return [p.key, null] as const;
                    const j = (await res.json()) as LogTail;
                    return [p.key, j] as const;
                } catch {
                    return [p.key, null] as const;
                }
            })
        );
        setLogs((prev) => {
            const next = { ...prev };
            for (const [k, v] of fetched) next[k] = v;
            return next;
        });
    }, [logFilterAccount]);

    const loadActivity = useCallback(async () => {
        setActivityLoading(true);
        try {
            const params = new URLSearchParams({ limit: "100" });
            if (activityAccount) params.set("account", activityAccount);
            const res = await authFetch(`${API_URL}/pipeline/activity?${params.toString()}`);
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = (await res.json()) as ActivityResponse;
            setActivity(j);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Failed to load activity: ${msg}`);
        } finally {
            setActivityLoading(false);
        }
    }, [activityAccount]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const t = setInterval(() => { void load(); }, 30_000);
        return () => clearInterval(t);
    }, [load]);
    useEffect(() => { void loadCustomers(); }, [loadCustomers]);
    useEffect(() => { void loadLogs(); }, [loadLogs]);
    useEffect(() => {
        const t = setInterval(() => { void loadLogs(); }, 3_000);
        return () => clearInterval(t);
    }, [loadLogs]);
    useEffect(() => { void loadActivity(); }, [loadActivity]);
    useEffect(() => {
        const t = setInterval(() => { void loadActivity(); }, 5_000);
        return () => clearInterval(t);
    }, [loadActivity]);

    const stagesBy = useMemo(() => {
        if (!data) return null;
        const g: Record<Stage["category"], Stage[]> = { ingest: [], sync: [], binding: [], snmp: [] };
        for (const s of data.stages) g[s.category].push(s);
        return g;
    }, [data]);

    const macPct  = data ? pct(data.coverage.with_mac,     data.coverage.total) : 0;
    const bindPct = data ? pct(data.coverage.with_binding, data.coverage.total) : 0;

    const triggerScrape = useCallback(async (account: string | null, step: string) => {
        const key = `${account || "all"}:${step}`;
        setTriggering(key);
        try {
            const res = await authFetch(`${API_URL}/pipeline/scrape`, {
                method: "POST",
                body: JSON.stringify({ account, step }),
            });
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json();
            toast.success(`Scrape started (${step}${account ? ` · ${account}` : ""}) — pid ${j.pid}. Watch Live Logs.`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Scrape failed to start: ${msg}`);
        } finally {
            setTimeout(() => setTriggering(null), 1500);
        }
    }, []);

    const triggerBind = useCallback(async (username: string) => {
        try {
            const res = await authFetch(`${API_URL}/pipeline/customers/${username}/bind`, { method: "POST" });
            if (handle401(res)) return;
            if (!res.ok) { const t = await res.text(); throw new Error(t); }
            const j = await res.json();
            if (j.position) {
                toast.success(`Bound ${username} → ${j.position} (${j.binding_source})`);
            } else {
                toast.warning(`${username}: ${j.unmatched_reason || "no binding found"}`);
            }
            void loadCustomers();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Bind failed: ${msg.slice(0, 200)}`);
        }
    }, [loadCustomers]);

    const triggerSingleRescrape = useCallback(async (username: string) => {
        try {
            const res = await authFetch(`${API_URL}/pipeline/customers/${username}/rescrape`, { method: "POST" });
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success(`Re-scraping ${username}. Watch Live Logs.`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(`Re-scrape failed: ${msg}`);
        }
    }, []);

    return (
        <div className="flex min-h-screen bg-[#07070a] text-zinc-100">
            <MainSidebar />
            <main className="flex-1 overflow-y-auto" style={{ background: "radial-gradient(ellipse at 60% 0%, rgba(59,130,246,0.06) 0%, transparent 60%), #07070a" }}>
                <div className="px-9 py-9">
                    {/* Page header */}
                    <div className="mb-6">
                        <h1 className="text-[26px] font-bold tracking-tight">Pipeline Command Center</h1>
                        <p className="mt-1 text-[13px] text-zinc-400">
                            Real-time overview — Railwire ingest → sync → binding → SNMP → coverage
                        </p>
                    </div>

                    {/* Status bar */}
                    <StatusBar
                        data={data}
                        refreshing={refreshing}
                        onRefresh={load}
                    />

                    {error && (
                        <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4 text-sm text-red-300">
                            Error: {error}
                        </div>
                    )}

                    {/* KPI grid — pure collector totals */}
                    {data && (
                        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
                            <KpiCard label="Total Customers" value={num(data.coverage.total)}
                                     icon={<Users className="h-3 w-3" />} accent="text-blue-400" />
                            <KpiCard label="With MAC"        value={num(data.coverage.with_mac)}
                                     sub={`${macPct}% of total`} icon={<Wifi className="h-3 w-3" />} accent="text-orange-400" />
                            <KpiCard label="With Binding"    value={num(data.coverage.with_binding)}
                                     sub={`${bindPct}%`} icon={<Router className="h-3 w-3" />} accent="text-emerald-400" />
                            <KpiCard label="Drafts" value={num(data.coverage.draft)}
                                     sub="not in Railwire anymore" icon={<FileText className="h-3 w-3" />} accent="text-zinc-400" />
                        </div>
                    )}

                    {data?.truth_summary && <TruthSummaryPanel summary={data.truth_summary} />}

                    {/* Per-account cards */}
                    {data && data.per_account && data.per_account.length > 0 && (
                        <div className="mb-7">
                            <SectionTitle icon={<Database className="h-4 w-4 text-blue-400" />} title="Per Account"
                                          subtitle="Each Railwire account collects its own customer list. Both run in parallel via the scheduler." />
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                {data.per_account.filter(a => a.account !== "(untagged)").map((acc) => (
                                    <AccountStatCard
                                        key={acc.account}
                                        acc={acc}
                                        triggering={triggering}
                                        onScrape={(step) => triggerScrape(acc.account, step)}
                                    />
                                ))}
                            </div>
                            {data.per_account.find(a => a.account === "(untagged)") && (
                                <div className="mt-2 text-[11px] text-zinc-500">
                                    + {data.per_account.find(a => a.account === "(untagged)")?.total} legacy untagged rows (admin/test accounts)
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quick actions row */}
                    <div className="mb-7 flex flex-wrap gap-2.5">
                        <QuickAction color="blue" icon={<PlayCircle className="h-3.5 w-3.5" />}
                                     label={triggering === "reconcile" ? "Reconcile starting…" : "Trigger Engine Reconcile"}
                                     onClick={triggerReconcile} disabled={triggering === "reconcile"} />
                        <QuickAction color="green" icon={<Database className="h-3.5 w-3.5" />}
                                     label={triggering?.endsWith(":csv") ? "Scraping…" : "Scrape CSV (both accounts)"}
                                     onClick={() => triggerScrape(null, "csv")} disabled={!!triggering} />
                        <QuickAction color="orange" icon={<Search className="h-3.5 w-3.5" />}
                                     label={triggering?.endsWith(":mac") ? "Scraping…" : "Scrape MAC (both accounts)"}
                                     onClick={() => triggerScrape(null, "mac")} disabled={!!triggering} />
                        <a className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-transparent px-4 py-2 text-[13px] font-semibold text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                           href="/engine/monitor"><Cpu className="h-3.5 w-3.5" />Engine Monitor</a>
                        <a className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-transparent px-4 py-2 text-[13px] font-semibold text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                           href="/noc"><Server className="h-3.5 w-3.5" />NOC</a>
                    </div>

                    {loading && !data && <div className="text-sm text-zinc-500">Loading…</div>}

                    {/* Profile completeness — pipeline's main job: is identity data accurate + complete? */}
                    <ProfileCompletenessPanel />

                    {/* Investigation Center — categorised cases needing admin attention */}
                    <InvestigationCenter />

                    {/* Drift Center — open alerts + unified activity feed */}
                    <DriftCenter />

                    {/* Pipeline stages */}
                    {data && stagesBy && (
                        <div className="mb-7">
                            <SectionTitle icon={<GitBranch className="h-4 w-4 text-blue-400" />} title="Pipeline Stages"
                                          subtitle="One row per stage of the data flow. Status reflects freshness against per-stage SLOs." />
                            <div className="space-y-4">
                                <StageRow title="1 · Railwire Identity Ingest" stages={stagesBy.ingest} />
                                <StageRow title="2 · Scraper → Postgres Sync"  stages={stagesBy.sync} />
                                <StageRow title="3 · OLT Binding Reconcile"    stages={stagesBy.binding} />
                                <StageRow title="4 · SNMP Live Poll (per OLT)" stages={stagesBy.snmp} />
                            </div>
                        </div>
                    )}

                    {/* Backend workers */}
                    {data && data.workers && data.workers.length > 0 && (
                        <div className="mb-7">
                            <SectionTitle icon={<Zap className="h-4 w-4 text-blue-400" />} title="Backend Workers"
                                          subtitle="Long-running async loops inside the backend. Each cycle is logged to pipeline_runs." />
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                                {data.workers.map((w) => <WorkerCard key={w.worker_name} worker={w} />)}
                            </div>
                        </div>
                    )}

                    {/* Data Quality Breakdown — clickable chips drive the customer table filter */}
                    {data?.state_breakdown && (
                        <div className="mb-7">
                            <SectionTitle icon={<AlertCircle className="h-4 w-4 text-blue-400" />} title="Data Quality Breakdown"
                                          subtitle="Every customer falls into exactly one state. Click any chip to filter the table below." />
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                                {data.state_breakdown.states_order.map((state) => {
                                    const cnt = data.state_breakdown!.overall[state] ?? 0;
                                    const cfg = STATE_CFG[state] ?? STATE_CFG._fallback;
                                    const active = custPipelineState === state;
                                    return (
                                        <button
                                            key={state}
                                            onClick={() => { setCustPipelineState(active ? null : state); setCustPage(0); }}
                                            className={`rounded-xl border bg-[#0f0f14] p-3 text-left transition ${active ? "border-blue-500/50 bg-[#13131c]" : `${cfg.border} hover:border-white/20`}`}
                                            title={cfg.tip}
                                        >
                                            <div className={`flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider ${cfg.label}`}>
                                                {cfg.icon}{state.replace(/_/g, " ")}
                                            </div>
                                            <div className="mt-1 text-2xl font-bold">{cnt.toLocaleString()}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            {custPipelineState && (
                                <div className="mt-2 text-[11px] text-zinc-400">
                                    Filtering customer table by <span className="text-blue-300 font-semibold">{custPipelineState}</span>.
                                    <button className="ml-2 text-zinc-500 underline hover:text-zinc-200" onClick={() => { setCustPipelineState(null); setCustPage(0); }}>Clear</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Customers table — both accounts */}
                    <div className="mb-7">
                        <SectionTitle icon={<Users className="h-4 w-4 text-blue-400" />} title="Customers"
                                      subtitle="Every customer in Postgres tagged with their Railwire account. Filter, search, and drill in." />
                        <CustomersPanel
                            data={custs}
                            loading={custLoading}
                            account={custAccount}
                            setAccount={(a) => { setCustAccount(a); setCustPage(0); }}
                            query={custQuery}
                            setQuery={(q) => { setCustQuery(q); setCustPage(0); }}
                            macFilter={custMacFilter}
                            setMacFilter={(m) => { setCustMacFilter(m); setCustPage(0); }}
                            linkFilter={custLinkFilter}
                            setLinkFilter={(l) => { setCustLinkFilter(l); setCustPage(0); }}
                            page={custPage}
                            setPage={setCustPage}
                            pageSize={PAGE_SIZE}
                            onRefresh={loadCustomers}
                            onBind={triggerBind}
                            onRescrape={triggerSingleRescrape}
                        />
                    </div>

                    {/* Live Logs */}
                    <div className="mb-7">
                        <SectionTitle icon={<Terminal className="h-4 w-4 text-blue-400" />} title="Live Logs"
                                      subtitle="Tail every scraper log file. Filter by account. Auto-refresh every 5s." />
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <AccountChip label="All accounts" count={0} active={logFilterAccount === null}
                                         onClick={() => setLogFilterAccount(null)} />
                            {custs?.accounts.filter((a) => a.account !== "(untagged)").map((a) => (
                                <AccountChip key={a.account} label={a.account} count={a.cnt}
                                             active={logFilterAccount === a.account}
                                             onClick={() => setLogFilterAccount(a.account)} />
                            ))}
                            <button onClick={() => setLogAutoScroll((v) => !v)}
                                    className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] transition ${
                                        logAutoScroll ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/10 text-zinc-400 hover:bg-white/5"
                                    }`}>
                                <ArrowDown className="h-3.5 w-3.5" />
                                Auto-scroll {logAutoScroll ? "ON" : "OFF"}
                            </button>
                            <button onClick={() => void loadLogs()}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-zinc-300 transition hover:bg-white/5">
                                <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {LOG_PANES.map((p) => (
                                <LogPane key={p.key} pane={p} tail={logs[p.key]} autoScroll={logAutoScroll} />
                            ))}
                        </div>
                    </div>

                    {/* Activity Feed — user actions + scheduler runs, merged */}
                    <div className="mb-7">
                        <SectionTitle icon={<History className="h-4 w-4 text-blue-400" />} title="Activity Feed"
                                      subtitle="Your clicks (bind, scrape, re-scrape) + scheduler scraper runs, sorted by time. Auto-refresh every 5s." />
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <AccountChip label="All accounts" count={activity?.accounts.reduce((s, a) => s + a.cnt, 0) ?? 0}
                                         active={activityAccount === null} onClick={() => setActivityAccount(null)} />
                            {activity?.accounts.map((a) => (
                                <AccountChip key={a.account} label={a.account} count={a.cnt}
                                             active={activityAccount === a.account}
                                             onClick={() => setActivityAccount(a.account === "(untagged)" ? null : a.account)}
                                             disabled={a.account === "(untagged)"} />
                            ))}
                            <select value={activitySource} onChange={(e) => setActivitySource(e.target.value as "all" | "user" | "scheduler" | "worker")}
                                    className="rounded-lg border border-white/10 bg-[#16161e] px-3 py-1.5 text-[12px] text-zinc-100 focus:border-blue-500/40 focus:outline-none">
                                <option value="all">All sources</option>
                                <option value="user">User clicks</option>
                                <option value="scheduler">Scheduler (scraper)</option>
                                <option value="worker">Backend workers</option>
                            </select>
                            <button onClick={() => void loadActivity()} disabled={activityLoading}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-zinc-300 transition hover:bg-white/5 disabled:opacity-50">
                                <RefreshCw className={`h-3.5 w-3.5 ${activityLoading ? "animate-spin" : ""}`} />
                            </button>
                        </div>
                        <ActivityTable
                            items={(activity?.items ?? []).filter((i) =>
                                activitySource === "all" ? true :
                                activitySource === "user"      ? i.source === "user" :
                                activitySource === "worker"    ? i.source === "worker" :
                                activitySource === "scheduler" ? (i.source === "scheduler" || i.source === "cli") :
                                true
                            )}
                            loading={activityLoading}
                        />
                    </div>

                    {data && (
                        <div className="mt-10 mb-4 text-[11px] text-zinc-600">
                            Snapshot generated at {fmtDate(data.generated_at)} · auto-refresh every 30s
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

// ── Status bar ──────────────────────────────────────────────────────────────

function StatusBar({ data, refreshing, onRefresh }: { data: PipelineHealth | null; refreshing: boolean; onRefresh: () => void }) {
    const status: StageStatus = data?.overall_status ?? "unknown";
    const title = !data ? "Connecting…"
                : status === "green"   ? "All Systems Healthy"
                : status === "amber"   ? "Degraded — Action Recommended"
                : status === "red"     ? "Critical — Immediate Action"
                                       : "Status Unknown";
    const sub = data
        ? `${data.stages.length} stages · ${data.workers.length} workers · ${data.coverage.total.toLocaleString()} customers tracked`
        : "";

    return (
        <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#0f0f14] px-6 py-5">
            <div className={`relative grid h-12 w-12 place-items-center rounded-xl ${
                status === "green"   ? "bg-emerald-500/10 text-emerald-400" :
                status === "amber"   ? "bg-amber-500/10 text-amber-400" :
                status === "red"     ? "bg-red-500/10 text-red-400" :
                                       "bg-white/5 text-zinc-400"
            }`}>
                <Cpu className="h-5 w-5" />
                <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ${STATUS_DOT[status]} ${
                    status === "green" || status === "amber" || status === "red" ? "animate-pulse" : ""
                }`} />
            </div>
            <div className="flex-1">
                <div className="text-[15px] font-semibold">{title}</div>
                <div className="mt-0.5 text-[12px] text-zinc-400">{sub}</div>
            </div>
            <button onClick={onRefresh} disabled={refreshing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:bg-white/5 disabled:opacity-50">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh
            </button>
        </div>
    );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function TruthSummaryPanel({ summary }: { summary: TruthSummary }) {
    const tone = summary.verdict === "conflicted"
        ? "border-red-500/30 bg-red-500/[0.04] text-red-200"
        : summary.verdict === "needs_investigation"
        ? "border-amber-500/30 bg-amber-500/[0.04] text-amber-100"
        : "border-emerald-500/25 bg-emerald-500/[0.035] text-emerald-100";
    const label = summary.verdict === "conflicted"
        ? "Conflicts block trust"
        : summary.verdict === "usable_with_missing_olts"
        ? "Usable for connected OLTs"
        : summary.verdict === "needs_investigation"
        ? "Needs investigation"
        : "Operationally usable";
    const facts = [
        ["OLTs", `${summary.connected_olts}/${summary.expected_olts}`],
        ["Matched", `${summary.linked_customers.toLocaleString()} / ${summary.active_with_mac.toLocaleString()} (${summary.match_rate_pct}%)`],
        ["OLT slots seen", (summary.olt_slots_seen_24h ?? 0).toLocaleString()],
        ["Live now", summary.live_pon_matches.toLocaleString()],
        ["Held history", summary.held_from_history.toLocaleString()],
        ["Missing OLT likely", summary.missing_olt_likely.toLocaleString()],
        ["Unknown ONU slots", summary.orphan_onus_24h.toLocaleString()],
        ["Duplicate MAC", summary.duplicate_mac_alerts.toLocaleString()],
    ];
    return (
        <div className={`mb-7 rounded-2xl border p-5 ${tone}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-[15px] font-semibold">
                        <ShieldAlert className="h-4 w-4" />
                        {label}
                    </div>
                    <div className="mt-1 max-w-4xl text-[12px] opacity-85">{summary.next_action}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-right">
                    <div className="text-[10px] uppercase tracking-wider opacity-60">Map confidence</div>
                    <div className="text-2xl font-bold">{summary.match_rate_pct}%</div>
                </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                {facts.map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider opacity-55">{k}</div>
                        <div className="mt-1 text-[15px] font-semibold text-zinc-50">{v}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function KpiCard({ label, value, sub, icon, accent, highlight }: {
    label: string; value: string; sub?: string; icon: React.ReactNode; accent: string; highlight?: boolean;
}) {
    return (
        <div className={`rounded-2xl border bg-[#0f0f14] p-5 ${highlight ? "border-cyan-500/30 bg-cyan-500/[0.03]" : "border-white/[0.08]"}`}>
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                <span className={accent}>{icon}</span>{label}
            </div>
            <div className={`mt-2 text-[32px] font-bold leading-none ${accent}`}>{value}</div>
            {sub && <div className="mt-1.5 text-[11px] text-zinc-500">{sub}</div>}
        </div>
    );
}

function QuickAction({ label, icon, color, onClick, disabled, hint }: {
    label: string; icon: React.ReactNode; color: "blue" | "green" | "orange" | "purple"; onClick?: () => void; disabled?: boolean; hint?: string;
}) {
    const colors: Record<typeof color, string> = {
        blue:   "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/15",
        green:  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15",
        orange: "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15",
        purple: "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/15",
    };
    return (
        <button onClick={onClick} disabled={disabled} title={hint}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${colors[color]}`}>
            {icon}{label}
        </button>
    );
}

function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
    return (
        <div className="mb-3">
            <div className="flex items-center gap-2 text-[15px] font-semibold">{icon}{title}</div>
            {subtitle && <div className="mt-0.5 text-[12px] text-zinc-500">{subtitle}</div>}
        </div>
    );
}

function StageRow({ title, stages }: { title: string; stages: Stage[] }) {
    if (!stages || stages.length === 0) return null;
    return (
        <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{title}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {stages.map((s) => <StageCard key={s.key} stage={s} />)}
            </div>
        </div>
    );
}

function StageCard({ stage }: { stage: Stage }) {
    return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f14] p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium">{stage.name}</div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[stage.status]}`}>
                    {STATUS_ICON[stage.status]}{stage.status}
                </span>
            </div>
            <div className="text-[11px] text-zinc-500">last success: {fmtAge(stage.age_seconds)}</div>
            <StageDetails stage={stage} />
            {stage.operator_hint && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[11px] text-amber-200/80">
                    {stage.operator_hint}
                </div>
            )}
        </div>
    );
}

function StageDetails({ stage }: { stage: Stage }) {
    const d = stage.details as Record<string, unknown>;
    const rows: Array<[string, React.ReactNode]> = [];
    const push = (k: string, v: unknown) => { if (v == null || v === "") return; rows.push([k, String(v)]); };

    if (stage.category === "ingest") {
        push("admin",       d.railwire_admin);
        push("customers",   d.total);
        push("with_mac",    d.with_mac);
        push("archived",    d.archived);
    } else if (stage.category === "sync") {
        push("watermark",      d.watermark_value);
        push("sync_state_rows", d.customer_sync_state_rows);
        push("errors",         d.customer_sync_errors);
    } else if (stage.category === "binding") {
        push("total",       d.customers_total);
        push("resolved",    d.customers_resolved);
        push("unmatched",   d.customers_unmatched);
        push("unified_macs", d.unified_mac_count);
        push("changes",     d.changes_count);
        push("duration",    d.duration_seconds && `${d.duration_seconds}s`);
        push("last_attempt", d.last_attempt_ok === false ? "failed" : d.last_attempt_ok === true ? "ok" : undefined);
        push("attempt_error", d.last_attempt_error);
    } else if (stage.category === "snmp") {
        push("host",         d.olt_host);
        push("pon_tech",     d.pon_tech);
        push("firmware",     d.firmware);
        push("olt_status",   d.olt_health_status);
        push("fresh_onus24h", d.fresh_onus_24h);
    }
    if (!rows.length) return null;
    return (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {rows.map(([k, v]) => (
                <React.Fragment key={k}>
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="truncate text-right text-zinc-300">{v}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

function WorkerCard({ worker }: { worker: Worker }) {
    return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f14] p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium">{worker.worker_name}</div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[worker.status]}`}>
                    {STATUS_ICON[worker.status]}{worker.status}
                </span>
            </div>
            <div className="text-[11px] text-zinc-500">last cycle: {fmtAge(worker.age_seconds)}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                {worker.expected_interval_sec != null && (<>
                    <dt className="text-zinc-500">expected_every</dt><dd className="text-right text-zinc-300">{worker.expected_interval_sec}s</dd>
                </>)}
                {worker.last_status && (<>
                    <dt className="text-zinc-500">last_status</dt><dd className="text-right text-zinc-300">{worker.last_status}</dd>
                </>)}
                {worker.duration_seconds != null && (<>
                    <dt className="text-zinc-500">duration</dt><dd className="text-right text-zinc-300">{Number(worker.duration_seconds).toFixed(1)}s</dd>
                </>)}
                {worker.records_processed != null && (<>
                    <dt className="text-zinc-500">records</dt><dd className="text-right text-zinc-300">{worker.records_processed.toLocaleString()}</dd>
                </>)}
            </dl>
            {worker.notes && <div className="mt-2 truncate text-[11px] text-zinc-500" title={worker.notes}>{worker.notes}</div>}
            {worker.operator_hint && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[11px] text-amber-200/80">
                    {worker.operator_hint}
                </div>
            )}
        </div>
    );
}

function GapTable({ gapKey, rows }: { gapKey: GapKey; rows: GapCustomer[] }) {
    if (rows.length === 0) {
        return <div className="px-5 py-6 text-center text-sm text-zinc-400">No customers in this bucket. </div>;
    }
    const cols: { key: string; label: string }[] = (() => {
        switch (gapKey) {
            case "missing_mac":     return [
                { key: "username", label: "Username" }, { key: "name", label: "Name" },
                { key: "phone", label: "Phone" }, { key: "plan_name", label: "Plan" },
                { key: "expiry_date", label: "Expiry" }, { key: "connection_status", label: "Conn" },
            ];
            case "missing_binding": return [
                { key: "username", label: "Username" }, { key: "name", label: "Name" },
                { key: "mac_address", label: "MAC" }, { key: "link_status", label: "Link" },
                { key: "unlink_reason", label: "Reason" }, { key: "binding_source", label: "Source" },
                { key: "last_verified_at", label: "Verified" },
            ];
            case "draft":           return [
                { key: "username", label: "Username" }, { key: "name", label: "Name" },
                { key: "phone", label: "Phone" }, { key: "plan_name", label: "Plan" },
                { key: "railwire_admin", label: "Account" }, { key: "railwire_status", label: "RW Status" },
                { key: "last_seen_online", label: "Last seen" },
            ];
        }
    })();
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
                <thead>
                    <tr className="bg-[#13131c] text-left text-[10px] uppercase tracking-wider text-zinc-500">
                        {cols.map((c) => <th key={c.key} className="px-4 py-2.5 font-semibold">{c.label}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={r.username + i} className="border-t border-white/[0.03] text-zinc-300 transition hover:bg-white/[0.02]">
                            {cols.map((c) => <td key={c.key} className="px-4 py-2">{renderCell(r, c.key)}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function renderCell(r: GapCustomer, key: string): string {
    if (key === "name") {
        const f = (r.first_name as string) || ""; const l = (r.last_name as string) || "";
        return `${f} ${l}`.trim() || "—";
    }
    const v = (r as Record<string, unknown>)[key];
    if (v == null) return "—";
    if (key === "polled_at" || key === "last_seen_online" || key === "last_verified_at") {
        return fmtDate(String(v));
    }
    return String(v);
}

// ── Per-account stat card ───────────────────────────────────────────────────

function AccountStatCard({ acc, triggering, onScrape }: {
    acc: PerAccount;
    triggering: string | null;
    onScrape: (step: string) => void;
}) {
    const isBusy = !!triggering && triggering.startsWith(`${acc.account}:`);
    const macPct = acc.total > 0 ? Math.round((acc.with_mac / acc.total) * 100) : 0;
    const bindPct = acc.total > 0 ? Math.round((acc.with_binding / acc.total) * 100) : 0;
    return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f14] p-5">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Railwire Account</div>
                    <div className="mt-0.5 font-mono text-[15px] font-semibold text-blue-300">{acc.account}</div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total</div>
                    <div className="text-2xl font-bold">{acc.total.toLocaleString()}</div>
                </div>
            </div>
            <div className="mb-3 grid grid-cols-4 gap-2">
                <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.04] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">With MAC</div>
                    <div className="text-base font-semibold text-orange-300">{acc.with_mac}</div>
                    <div className="text-[10px] text-zinc-500">{macPct}%</div>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Binding</div>
                    <div className="text-base font-semibold text-emerald-300">{acc.with_binding}</div>
                    <div className="text-[10px] text-zinc-500">{bindPct}%</div>
                </div>
                <div className="rounded-lg border border-red-500/20 bg-red-500/[0.04] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">No MAC</div>
                    <div className="text-base font-semibold text-red-300">{acc.missing_mac}</div>
                </div>
                <div className="rounded-lg border border-zinc-500/20 bg-zinc-500/[0.04] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500">Drafts</div>
                    <div className="text-base font-semibold text-zinc-300">{acc.draft}</div>
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                <button onClick={() => onScrape("csv")} disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-300 transition hover:bg-emerald-500/15 disabled:opacity-60">
                    <Database className="h-3.5 w-3.5" /> Scrape CSV
                </button>
                <button onClick={() => onScrape("mac")} disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-[12px] font-semibold text-orange-300 transition hover:bg-orange-500/15 disabled:opacity-60">
                    <Search className="h-3.5 w-3.5" /> Scrape MAC ({acc.missing_mac})
                </button>
                <button onClick={() => onScrape("details")} disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-[12px] font-semibold text-purple-300 transition hover:bg-purple-500/15 disabled:opacity-60">
                    <FileText className="h-3.5 w-3.5" /> Scrape Details
                </button>
                <button onClick={() => onScrape("all")} disabled={isBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[12px] font-semibold text-blue-300 transition hover:bg-blue-500/15 disabled:opacity-60">
                    <PlayCircle className="h-3.5 w-3.5" /> All (CSV+Details+MAC)
                </button>
                {isBusy && <span className="self-center text-[11px] text-zinc-400">starting…</span>}
            </div>
        </div>
    );
}


// ── Customers panel ─────────────────────────────────────────────────────────

function CustomersPanel({
    data, loading, account, setAccount, query, setQuery, macFilter, setMacFilter,
    linkFilter, setLinkFilter,
    page, setPage, pageSize, onRefresh, onBind, onRescrape,
}: {
    data: CustomersResponse | null; loading: boolean;
    account: string | null; setAccount: (a: string | null) => void;
    query: string; setQuery: (q: string) => void;
    macFilter: "any" | "has" | "missing"; setMacFilter: (m: "any" | "has" | "missing") => void;
    linkFilter: "any" | "linked" | "unlinked"; setLinkFilter: (l: "any" | "linked" | "unlinked") => void;
    page: number; setPage: (p: number) => void; pageSize: number;
    onRefresh: () => void;
    onBind: (username: string) => void;
    onRescrape: (username: string) => void;
}) {
    const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
    return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f14] overflow-hidden">
            {/* Toolbar: account chips + search + filters */}
            <div className="border-b border-white/[0.06] px-5 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                    <AccountChip label="All accounts" count={data?.accounts.reduce((s, a) => s + a.cnt, 0) ?? 0}
                                 active={account === null} onClick={() => setAccount(null)} />
                    {data?.accounts.map((a) => (
                        <AccountChip key={a.account} label={a.account} count={a.cnt}
                                     active={account === a.account}
                                     onClick={() => setAccount(a.account === "(untagged)" ? null : a.account)}
                                     disabled={a.account === "(untagged)"} />
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[240px]">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search username / name / phone / MAC..."
                            className="w-full rounded-lg border border-white/10 bg-[#16161e] py-2 pl-9 pr-3 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:border-blue-500/40 focus:outline-none"
                        />
                    </div>
                    <select value={macFilter} onChange={(e) => setMacFilter(e.target.value as "any" | "has" | "missing")}
                            className="rounded-lg border border-white/10 bg-[#16161e] px-3 py-2 text-[13px] text-zinc-100 focus:border-blue-500/40 focus:outline-none">
                        <option value="any">MAC: Any</option>
                        <option value="has">MAC: Found</option>
                        <option value="missing">MAC: Missing</option>
                    </select>
                    <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value as "any" | "linked" | "unlinked")}
                            className="rounded-lg border border-white/10 bg-[#16161e] px-3 py-2 text-[13px] text-zinc-100 focus:border-blue-500/40 focus:outline-none">
                        <option value="any">Binding: Any</option>
                        <option value="linked">Binding: Linked</option>
                        <option value="unlinked">Binding: Unlinked</option>
                    </select>
                    <button onClick={onRefresh} disabled={loading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[13px] text-zinc-300 transition hover:bg-white/5 disabled:opacity-50">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    </button>
                </div>
                {data && (
                    <div className="mt-2 text-[11px] text-zinc-500">
                        {data.total.toLocaleString()} customers
                        {account && <span> · account <span className="text-zinc-300">{account}</span></span>}
                        {macFilter !== "any" && <span> · MAC {macFilter === "has" ? "found" : "missing"}</span>}
                        {linkFilter !== "any" && <span> · binding {linkFilter}</span>}
                        {query && <span> · matching <span className="text-zinc-300">&quot;{query}&quot;</span></span>}
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="max-h-[600px] overflow-auto">
                <table className="w-full text-[12px]">
                    <thead className="sticky top-0">
                        <tr className="bg-[#13131c] text-left text-[10px] uppercase tracking-wider text-zinc-500">
                            <th className="px-4 py-2.5 font-semibold">Username</th>
                            <th className="px-4 py-2.5 font-semibold">Name</th>
                            <th className="px-4 py-2.5 font-semibold">Phone</th>
                            <th className="px-4 py-2.5 font-semibold">Account</th>
                            <th className="px-4 py-2.5 font-semibold">MAC</th>
                            <th className="px-4 py-2.5 font-semibold">Plan</th>
                            <th className="px-4 py-2.5 font-semibold">Expiry</th>
                            <th className="px-4 py-2.5 font-semibold">Status</th>
                            <th className="px-4 py-2.5 font-semibold">Binding</th>
                            <th className="px-4 py-2.5 font-semibold">OLT</th>
                            <th className="px-4 py-2.5 font-semibold">Pipeline State</th>
                            <th className="px-4 py-2.5 font-semibold">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && !data?.customers?.length && (
                            <tr><td colSpan={12} className="px-4 py-6 text-center text-sm text-zinc-500">Loading…</td></tr>
                        )}
                        {!loading && data && data.customers.length === 0 && (
                            <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-zinc-500">No customers match the filters.</td></tr>
                        )}
                        {data?.customers.map((c) => {
                            const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "—";
                            const hasMac = !!c.mac_address;
                            const isUnlinked = c.link_status !== "linked";
                            return (
                                <tr key={c.username} className="border-t border-white/[0.03] text-zinc-300 transition hover:bg-white/[0.02]">
                                    <td className="px-4 py-2 font-medium text-zinc-100">{c.username}</td>
                                    <td className="px-4 py-2">{name}</td>
                                    <td className="px-4 py-2">{c.phone || "—"}</td>
                                    <td className="px-4 py-2">
                                        {c.railwire_admin
                                            ? <span className="inline-block rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300 border border-blue-500/25">{c.railwire_admin}</span>
                                            : <span className="text-zinc-500">—</span>}
                                    </td>
                                    <td className="px-4 py-2 font-mono text-[11px]">{c.mac_address || <span className="text-orange-400/70">missing</span>}</td>
                                    <td className="px-4 py-2 truncate max-w-[160px]">{c.plan_name || "—"}</td>
                                    <td className="px-4 py-2">{c.expiry_date || "—"}</td>
                                    <td className="px-4 py-2">
                                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                                            c.connection_status === "active"   ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25" :
                                            c.connection_status === "inactive" ? "bg-zinc-500/10 text-zinc-400 border-zinc-500/25" :
                                                                                  "bg-amber-500/10 text-amber-300 border-amber-500/25"
                                        }`}>{c.connection_status || "—"}</span>
                                    </td>
                                    <td className="px-4 py-2">
                                        {c.link_status === "linked"
                                            ? <span className="inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-500/25">linked</span>
                                            : c.link_status === "unlinked"
                                                ? <span className="inline-block rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300 border border-red-500/25">unlinked</span>
                                                : <span className="text-zinc-500">—</span>}
                                    </td>
                                    <td className="px-4 py-2 font-mono text-[11px]">
                                        {c.olt_host ? `${c.olt_host} ${c.pon_port || ""}:${c.onu_index ?? ""}` : "—"}
                                    </td>
                                    <td className="px-4 py-2 max-w-[260px]">
                                        {c.data_pipeline_status ? (() => {
                                            const cfg = STATE_CFG[c.data_pipeline_status] ?? STATE_CFG._fallback;
                                            const tip = [
                                                c.last_diagnosis,
                                                c.mac_last_error ? `last error: ${c.mac_last_error}` : null,
                                                (c.mac_scrape_attempts ?? 0) > 0 ? `attempts: ${c.mac_scrape_attempts}` : null,
                                            ].filter(Boolean).join("\n");
                                            return (
                                                <div title={tip}>
                                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${cfg.border} ${cfg.label}`}>
                                                        {cfg.icon}{c.data_pipeline_status.replace(/_/g, " ")}
                                                    </span>
                                                    {c.last_diagnosis && (
                                                        <div className="mt-1 truncate text-[10px] text-zinc-500" title={c.last_diagnosis}>
                                                            {c.last_diagnosis}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })() : <span className="text-zinc-600">—</span>}
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            <button onClick={() => onRescrape(c.username)}
                                                    title="Re-scrape this customer from Railwire"
                                                    className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 transition hover:bg-amber-500/20">
                                                Scrape
                                            </button>
                                            {hasMac && isUnlinked && (
                                                <button onClick={() => onBind(c.username)}
                                                        title="Search OLT for this customer's MAC and bind it"
                                                        className="rounded border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300 transition hover:bg-blue-500/20">
                                                    Bind
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {data && data.total > pageSize && (
                <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 text-[12px] text-zinc-400">
                    <div>Page {page + 1} of {totalPages} · showing {data.customers.length} of {data.total.toLocaleString()}</div>
                    <div className="flex gap-2">
                        <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                                className="rounded border border-white/10 px-3 py-1 transition hover:bg-white/5 disabled:opacity-40">
                            Previous
                        </button>
                        <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                                className="rounded border border-white/10 px-3 py-1 transition hover:bg-white/5 disabled:opacity-40">
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function AccountChip({ label, count, active, onClick, disabled }: {
    label: string; count: number; active: boolean; onClick: () => void; disabled?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={disabled}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                    active
                        ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                        : "border-white/10 bg-transparent text-zinc-400 hover:bg-white/5"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
            <span>{label}</span>
            <span className="text-[10px] text-zinc-500">{count.toLocaleString()}</span>
        </button>
    );
}


// ── Live log pane ───────────────────────────────────────────────────────────

function colorForLine(line: string): string {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("❌") || lower.includes("failed")) return "text-red-400";
    if (lower.includes("warn")  || lower.includes("⚠"))                                return "text-amber-400";
    if (lower.includes("success") || lower.includes("✅") || lower.includes(" ok ")) return "text-emerald-400";
    if (lower.includes("info"))                                                         return "text-zinc-400";
    return "text-zinc-500";
}

function highlightAccount(line: string): React.ReactNode {
    // Highlight any [<account-id>] occurrences in blue
    const re = /\[(\d{10,})\]/g;
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
        if (m.index > last) parts.push(line.slice(last, m.index));
        parts.push(
            <span key={m.index} className="rounded bg-blue-500/15 px-1 text-[10px] font-semibold text-blue-300">[{m[1]}]</span>
        );
        last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
}

function LogPane({ pane, tail, autoScroll }:
    { pane: { key: LogType; label: string; color: string; icon: React.ReactNode }; tail: LogTail | null; autoScroll: boolean }) {
    const bodyRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (autoScroll && bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [tail, autoScroll]);

    return (
        <div className="rounded-xl border border-white/[0.08] bg-[#08080c] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0f0f14] px-3 py-2">
                <span className={pane.color}>{pane.icon}</span>
                <span className="text-[12px] font-semibold text-zinc-200">{pane.label}</span>
                <span className="ml-auto text-[10px] text-zinc-500">
                    {tail?.exists === false ? "missing" : tail ? `${tail.returned_lines ?? 0} / ${tail.total_lines ?? 0} lines` : "loading…"}
                </span>
            </div>
            <div ref={bodyRef} className="h-[240px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
                {tail?.lines && tail.lines.length > 0
                    ? tail.lines.map((ln, i) => (
                        <div key={i} className={`${colorForLine(ln)} whitespace-pre-wrap break-all`}>
                            {highlightAccount(ln)}
                        </div>
                    ))
                    : <div className="text-zinc-600">{tail?.exists === false ? "log file not found" : "no lines yet"}</div>}
            </div>
        </div>
    );
}


// ── Activity table (user actions + scheduler runs, merged) ─────────────────

function ActivityTable({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
    const fmtDur = (s: number | null) => s == null ? "—" : s < 1 ? `${(s * 1000).toFixed(0)}ms` : s < 60 ? `${s.toFixed(1)}s` : `${(s/60).toFixed(1)}m`;

    // Status pill colors
    const statusColors: Record<string, string> = {
        ok:       "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
        success:  "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
        start:    "bg-blue-500/10 text-blue-300 border-blue-500/25",
        running:  "bg-blue-500/10 text-blue-300 border-blue-500/25",
        error:    "bg-red-500/10 text-red-300 border-red-500/25",
        failed:   "bg-red-500/10 text-red-300 border-red-500/25",
        miss:     "bg-amber-500/10 text-amber-300 border-amber-500/25",
        partial:  "bg-amber-500/10 text-amber-300 border-amber-500/25",
        skipped:  "bg-zinc-500/10 text-zinc-300 border-zinc-500/25",
    };

    // Source pill colors
    const sourceColors: Record<string, string> = {
        user:      "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
        scheduler: "bg-purple-500/10 text-purple-300 border-purple-500/25",
        cli:       "bg-zinc-500/10 text-zinc-300 border-zinc-500/25",
        worker:    "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    };

    // Kind pill colors
    const kindColors: Record<string, string> = {
        bind:                "bg-blue-500/10 text-blue-300 border-blue-500/25",
        rescrape:            "bg-orange-500/10 text-orange-300 border-orange-500/25",
        scrape_account:      "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
        "scrape:csv":        "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
        "scrape:details":    "bg-purple-500/10 text-purple-300 border-purple-500/25",
        "scrape:mac":        "bg-orange-500/10 text-orange-300 border-orange-500/25",
        "scrape:single":     "bg-blue-500/10 text-blue-300 border-blue-500/25",
        "scrape:daily":      "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
        "scrape:all":        "bg-pink-500/10 text-pink-300 border-pink-500/25",
        "scrape:session":    "bg-zinc-500/10 text-zinc-300 border-zinc-500/25",
        // Backend worker kinds
        engine_reconcile:    "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
        binding_reconciler:  "bg-cyan-500/10 text-cyan-300 border-cyan-500/25",
        retention:           "bg-purple-500/10 text-purple-300 border-purple-500/25",
        prediction_runner:   "bg-pink-500/10 text-pink-300 border-pink-500/25",
    };

    return (
        <div className="rounded-2xl border border-white/[0.08] bg-[#0f0f14] overflow-hidden">
            <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-[12px]">
                    <thead className="sticky top-0">
                        <tr className="bg-[#13131c] text-left text-[10px] uppercase tracking-wider text-zinc-500">
                            <th className="px-4 py-2.5 font-semibold">When</th>
                            <th className="px-4 py-2.5 font-semibold">Source</th>
                            <th className="px-4 py-2.5 font-semibold">Action</th>
                            <th className="px-4 py-2.5 font-semibold">Account</th>
                            <th className="px-4 py-2.5 font-semibold">Customer</th>
                            <th className="px-4 py-2.5 font-semibold">Status</th>
                            <th className="px-4 py-2.5 font-semibold">Duration</th>
                            <th className="px-4 py-2.5 font-semibold">By</th>
                            <th className="px-4 py-2.5 font-semibold">Result</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && items.length === 0 && (
                            <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-zinc-500">Loading…</td></tr>
                        )}
                        {!loading && items.length === 0 && (
                            <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-500">No activity yet. Click Scrape or Bind to start.</td></tr>
                        )}
                        {items.map((it) => {
                            const result = it.result_summary || it.error_message || "—";
                            const stillRunning = it.status === "start" || it.status === "running";
                            return (
                                <tr key={it.id} className="border-t border-white/[0.03] text-zinc-300 transition hover:bg-white/[0.02]">
                                    <td className="px-4 py-2 whitespace-nowrap text-zinc-400">{fmtDate(it.started_at)}</td>
                                    <td className="px-4 py-2">
                                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase border ${sourceColors[it.source] ?? sourceColors.cli}`}>{it.source}</span>
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase border ${kindColors[it.kind] ?? "bg-zinc-500/10 text-zinc-300 border-zinc-500/25"}`}>{it.kind}</span>
                                    </td>
                                    <td className="px-4 py-2">
                                        {it.account
                                            ? <span className="inline-block rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300 border border-blue-500/25">{it.account}</span>
                                            : <span className="text-zinc-600">—</span>}
                                    </td>
                                    <td className="px-4 py-2 font-mono text-[11px]">{it.customer || "—"}</td>
                                    <td className="px-4 py-2">
                                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase border ${statusColors[it.status] ?? statusColors.skipped} ${stillRunning ? "animate-pulse" : ""}`}>
                                            {it.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2 text-zinc-300">{fmtDur(it.duration_seconds)}</td>
                                    <td className="px-4 py-2 text-zinc-400">{it.triggered_by || "—"}</td>
                                    <td className="px-4 py-2 max-w-[440px] truncate text-zinc-300" title={result}>
                                        {it.error_message
                                            ? <span className="text-red-400">{result}</span>
                                            : result}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


// ── ProfileCompletenessPanel — pipeline's North-Star metric ───────────────

interface CompletenessFieldStat { filled: number; pct: number; }
interface CompletenessResponse {
    total_linked: number;
    completeness_pct: number;
    fields: Record<string, CompletenessFieldStat>;
}

const FIELD_LABELS: Record<string, string> = {
    mac_address:        "MAC address",
    olt_host:           "OLT host",
    pon_port:           "PON port",
    onu_index:          "ONU index",
    ont_serial_number:  "ONT serial number",
    ont_model:          "ONT model",
    router_mac_address: "Router MAC (when separate)",
};

const FIELD_NOTE: Record<string, string> = {
    mac_address:        "From Railwire scraper",
    olt_host:           "Filled by engine",
    pon_port:           "Filled by engine",
    onu_index:          "Filled by engine",
    ont_serial_number:  "From PG room scan / sticker OCR — needs field tech for the rest",
    ont_model:          "Filled by engine from OLT info",
    router_mac_address: "Only when ONU and router have different MACs (rare on combined boxes)",
};

function ProfileCompletenessPanel() {
    const [data, setData] = useState<CompletenessResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/pipeline/completeness`);
            if (handle401(res)) return;
            setData(await res.json());
        } catch (e) { console.warn("completeness load failed", e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const t = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(t);
    }, [load]);

    const runEnrich = async () => {
        setRunning(true);
        try {
            const res = await authFetch(`${API_URL}/pipeline/enrich`, { method: "POST" });
            if (handle401(res)) return;
            const j = await res.json();
            toast.success(`Enriched ${j.fields_filled} fields across ${j.rows_enriched} customers`);
            void load();
        } catch (e) { toast.error(String(e)); }
        finally { setRunning(false); }
    };

    if (loading && !data) return null;

    const overall = data?.completeness_pct ?? 0;
    const overallColor = overall >= 95 ? "text-emerald-400" : overall >= 75 ? "text-amber-400" : "text-red-400";

    return (
        <div className="mb-7 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-[15px] font-semibold tracking-tight">Profile Completeness</h2>
                    <span className="text-[11px] text-zinc-500">Per-field accuracy of identity data on each linked customer</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-[24px] font-bold ${overallColor}`}>{overall}%</span>
                    <button
                        onClick={runEnrich}
                        disabled={running}
                        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
                        {running ? "Enriching…" : "Run enrichment"}
                    </button>
                </div>
            </div>

            {data && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {Object.entries(data.fields).map(([field, stat]) => {
                        const filledColor = stat.pct >= 95
                            ? "bg-emerald-500"
                            : stat.pct >= 75 ? "bg-amber-500" : "bg-red-500";
                        return (
                            <div key={field} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                                    <span className="font-medium text-zinc-200">{FIELD_LABELS[field] || field}</span>
                                    <span className="font-mono text-zinc-300">
                                        {stat.filled.toLocaleString()}<span className="text-zinc-500"> / {data.total_linked.toLocaleString()}</span>
                                        <span className={`ml-2 ${stat.pct >= 95 ? "text-emerald-400" : stat.pct >= 75 ? "text-amber-400" : "text-red-400"}`}>{stat.pct}%</span>
                                    </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                                    <div className={`h-full ${filledColor}`} style={{ width: `${stat.pct}%` }} />
                                </div>
                                <div className="mt-1 text-[10.5px] text-zinc-500">{FIELD_NOTE[field]}</div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}


// ── Investigation Center — categorised case inbox ─────────────────────────

interface InvestigationCase {
    case_id: string;
    category: string;
    severity: "critical" | "warning" | "info";
    summary: string;
    customer_username?: string | null;
    olt_host?: string | null;
    pon_port?: string | null;
    onu_index?: number | null;
    details?: Record<string, unknown>;
    suggested_actions?: Array<{ label: string; kind: string; endpoint?: string; payload?: Record<string, unknown> }>;
}

interface InvestigationsResponse {
    by_category: Record<string, InvestigationCase[]>;
    counts: Record<string, number>;
    severity_counts: Record<string, number>;
    labels: Record<string, { label: string; why: string; action: string }>;
    total: number;
}

const CATEGORY_ICON_INV: Record<string, React.ReactNode> = {
    mac_drift:                <Search className="h-4 w-4" />,
    duplicate_mac:            <ShieldAlert className="h-4 w-4" />,
    unknown_online_onu:       <HelpCircle className="h-4 w-4" />,
    customer_offline_long:    <XCircle className="h-4 w-4" />,
    churned_active_onu:       <AlertTriangle className="h-4 w-4" />,
    device_swap_pending:      <ShieldAlert className="h-4 w-4" />,
    mac_admin_change_pending: <History className="h-4 w-4" />,
    profile_incomplete:       <AlertCircle className="h-4 w-4" />,
};

function InvestigationCenter() {
    const [data, setData] = useState<InvestigationsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [openCategory, setOpenCategory] = useState<string | null>(null);
    const [busyCase, setBusyCase] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/pipeline/investigations`);
            if (handle401(res)) return;
            setData(await res.json());
        } catch (e) { console.warn("investigation load failed", e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const t = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(t);
    }, [load]);

    const runAction = async (c: InvestigationCase, action: { label: string; kind: string; endpoint?: string; payload?: Record<string, unknown> }) => {
        setBusyCase(c.case_id);
        try {
            if (action.kind === "edit_mac") {
                const newMac = prompt(
                    `Edit MAC for ${c.customer_username}:`,
                    (action.payload?.mac_address as string) || ""
                );
                if (!newMac) return;
                const note = prompt("Reason (audit log):") || "Updated via Investigation Center";
                const res = await authFetch(`${API_URL}/pipeline/customers/${c.customer_username}/mac`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mac_address: newMac, note }),
                });
                if (handle401(res)) return;
                const j = await res.json();
                if (j.ok) toast.success(`MAC updated: ${j.old_mac || '(none)'} → ${j.new_mac}`);
                else toast.error(j.error || j.detail?.error || "Edit failed");
            } else if (action.kind === "confirm_swap" && action.endpoint) {
                const res = await authFetch(`${API_URL}${action.endpoint.replace(/^POST /, "")}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ note: "Confirmed via Investigation Center" }),
                });
                if (handle401(res)) return;
                const j = await res.json();
                if (j.ok) toast.success("Swap confirmed");
                else toast.error(j.error || j.detail?.error || "Failed");
            } else if (action.kind === "dismiss") {
                const note = prompt("Dismiss reason (required):");
                if (!note) return;
                const res = await authFetch(`${API_URL}/pipeline/investigations/${encodeURIComponent(c.case_id)}/dismiss`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ note }),
                });
                if (handle401(res)) return;
                await res.json();
                toast.success("Dismissed");
            } else if (action.kind === "enrich") {
                const res = await authFetch(`${API_URL}/pipeline/enrich`, { method: "POST" });
                if (handle401(res)) return;
                const j = await res.json();
                toast.success(`Enriched ${j.fields_filled} fields`);
            } else if (action.kind === "rebind") {
                if (!c.customer_username) return;
                const res = await authFetch(`${API_URL}/pipeline/customers/${c.customer_username}/rescrape`, { method: "POST" });
                if (handle401(res)) return;
                toast.success("Rebind triggered");
            } else if (action.kind === "external") {
                toast.info(`Manual action: ${action.label}`);
            }
            void load();
        } catch (e) { toast.error(String(e)); }
        finally { setBusyCase(null); }
    };

    const forceVerify = async (c: InvestigationCase) => {
        if (!c.customer_username) return;
        const note = prompt(`Force-verify ${c.customer_username}'s binding — physical confirmation note (required):`);
        if (!note) return;
        setBusyCase(c.case_id);
        try {
            const res = await authFetch(`${API_URL}/pipeline/customers/${c.customer_username}/force-verify`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note }),
            });
            if (handle401(res)) return;
            const j = await res.json();
            if (j.ok) toast.success(`${c.customer_username} marked verified`);
            else toast.error(j.error || j.detail?.error || "Failed");
            void load();
        } finally { setBusyCase(null); }
    };

    if (loading && !data) return null;
    if (!data) return null;

    const sevDot: Record<string, string> = {
        critical: "bg-red-500", warning: "bg-amber-500", info: "bg-blue-500",
    };

    return (
        <div className="mb-7 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-blue-400" />
                    <h2 className="text-[15px] font-semibold tracking-tight">Investigation Center</h2>
                    <span className="text-[11px] text-zinc-500">
                        Categorised cases needing a human look. Click a card to expand.
                    </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                    {data.severity_counts.critical > 0 && (
                        <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-300">
                            {data.severity_counts.critical} critical
                        </span>
                    )}
                    {data.severity_counts.warning > 0 && (
                        <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">
                            {data.severity_counts.warning} warning
                        </span>
                    )}
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-zinc-400">
                        {data.total} total
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
                {Object.entries(data.counts).map(([cat, n]) => {
                    const meta = data.labels[cat] || { label: cat, why: "", action: "" };
                    const isOpen = openCategory === cat;
                    return (
                        <button
                            key={cat}
                            onClick={() => setOpenCategory(isOpen ? null : cat)}
                            className={`rounded-lg border p-3 text-left transition ${
                                isOpen
                                    ? "border-blue-500/40 bg-blue-500/5"
                                    : n > 0
                                    ? "border-white/15 bg-black/30 hover:bg-white/[0.04]"
                                    : "border-white/10 bg-black/10 text-zinc-500"
                            }`}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-[12px] font-medium">
                                    {CATEGORY_ICON_INV[cat]}
                                    <span>{meta.label}</span>
                                </div>
                                <span className={`text-[16px] font-bold ${n > 0 ? "text-zinc-100" : "text-zinc-600"}`}>{n}</span>
                            </div>
                            <div className="mt-1 text-[10.5px] text-zinc-500 leading-snug">{meta.why}</div>
                        </button>
                    );
                })}
            </div>

            {openCategory && data.by_category[openCategory] && (
                <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <div className="text-[13px] font-semibold text-zinc-200">
                                {data.labels[openCategory]?.label || openCategory}
                            </div>
                            <div className="text-[11px] text-zinc-500">
                                {data.labels[openCategory]?.action}
                            </div>
                        </div>
                        <button onClick={() => setOpenCategory(null)}
                            className="text-[11px] text-zinc-500 hover:text-zinc-300">close</button>
                    </div>
                    {data.by_category[openCategory].length === 0 ? (
                        <div className="text-[12px] text-zinc-500">
                            ✅ No cases in this category right now.
                        </div>
                    ) : (
                        <div className="space-y-2 max-h-[480px] overflow-y-auto">
                            {data.by_category[openCategory].map(c => (
                                <div key={c.case_id}
                                    className="rounded-md border border-white/10 bg-black/40 p-3 text-[11.5px]">
                                    <div className="flex items-start gap-2">
                                        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${sevDot[c.severity]}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-zinc-100">{c.summary}</div>
                                            {c.customer_username && (
                                                <div className="mt-0.5 text-zinc-500">
                                                    <a href={`/customers?q=${encodeURIComponent(c.customer_username)}`}
                                                        className="font-mono text-blue-400 hover:underline">
                                                        {c.customer_username}
                                                    </a>
                                                    {c.olt_host && (
                                                        <span className="ml-2">
                                                            · {c.olt_host} {c.pon_port}/{c.onu_index ?? "?"}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            {c.details && Object.keys(c.details).length > 0 && (
                                                <details className="mt-1">
                                                    <summary className="cursor-pointer text-[10.5px] text-zinc-500 hover:text-zinc-300">
                                                        details
                                                    </summary>
                                                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 p-2 text-[10px] text-zinc-400">
{JSON.stringify(c.details, null, 2)}
                                                    </pre>
                                                </details>
                                            )}
                                        </div>
                                    </div>
                                    {(c.suggested_actions && c.suggested_actions.length > 0) || c.customer_username ? (
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {c.suggested_actions?.map((a, idx) => (
                                                <button key={idx}
                                                    disabled={busyCase === c.case_id}
                                                    onClick={() => runAction(c, a)}
                                                    className="rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1 text-[10.5px] text-blue-300 hover:bg-blue-500/15 disabled:opacity-50">
                                                    {a.label}
                                                </button>
                                            ))}
                                            {c.customer_username && c.olt_host && (
                                                <button
                                                    disabled={busyCase === c.case_id}
                                                    onClick={() => forceVerify(c)}
                                                    className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[10.5px] text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50">
                                                    Force-verify (physical check)
                                                </button>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}


// ── DriftCenter — alerts + categorized activity feed ──────────────────────

const SEVERITY_COLORS: Record<string, string> = {
    critical: "border-red-500/40 bg-red-500/10 text-red-300",
    warning:  "border-amber-500/40 bg-amber-500/10 text-amber-300",
    info:     "border-blue-500/30 bg-blue-500/5  text-blue-300",
};
const SEVERITY_DOT: Record<string, string> = {
    critical: "bg-red-500",
    warning:  "bg-amber-500",
    info:     "bg-blue-500",
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
    "customer.new_in_csv":          <Users className="h-3.5 w-3.5 text-emerald-400" />,
    "customer.removed_from_csv":    <FileText className="h-3.5 w-3.5 text-amber-400" />,
    "customer.restored_in_csv":     <Users className="h-3.5 w-3.5 text-emerald-400" />,
    "scraper.mac_found":            <Wifi className="h-3.5 w-3.5 text-emerald-400" />,
    "scraper.mac_failed":           <AlertCircle className="h-3.5 w-3.5 text-amber-400" />,
    "scraper.subscriber_expired":   <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />,
    "binding.resolved":             <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    "binding.unresolved":           <XCircle className="h-3.5 w-3.5 text-red-400" />,
    "binding.position_changed":     <GitBranch className="h-3.5 w-3.5 text-amber-400" />,
    "binding.online_to_offline":    <XCircle className="h-3.5 w-3.5 text-red-400" />,
    "binding.offline_to_online":    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    "binding.dying_gasp":           <Zap className="h-3.5 w-3.5 text-red-400" />,
    "binding.device_swap_detected": <ShieldAlert className="h-3.5 w-3.5 text-red-400" />,
    "binding.confidence_decayed":   <History className="h-3.5 w-3.5 text-zinc-400" />,
    "alert.raised":                 <Bell className="h-3.5 w-3.5 text-amber-400" />,
    "alert.resolved":               <Check className="h-3.5 w-3.5 text-emerald-400" />,
    "alert.acknowledged":           <Check className="h-3.5 w-3.5 text-blue-400" />,
    "alert.dismissed":              <XIcon className="h-3.5 w-3.5 text-zinc-400" />,
    "alert.auto_resolved":          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
};

function DriftCenter() {
    const [alerts, setAlerts] = useState<BindingAlert[] | null>(null);
    const [alertsLoading, setAlertsLoading] = useState(true);
    const [alertStatusFilter, setAlertStatusFilter] = useState<"open" | "ack" | "all">("open");
    const [acting, setActing] = useState<number | null>(null);

    const [events, setEvents] = useState<ActivityEvent[] | null>(null);
    const [eventsLoading, setEventsLoading] = useState(true);
    const [eventCategoryFilter, setEventCategoryFilter] = useState<string>("all");
    const [categories, setCategories] = useState<ActivityCategoriesResponse["categories"]>([]);

    const loadAlerts = useCallback(async () => {
        setAlertsLoading(true);
        try {
            const res = await authFetch(`${API_URL}/pipeline/alerts?status=${alertStatusFilter}&limit=200`);
            if (handle401(res)) return;
            const j = (await res.json()) as BindingAlertsResponse;
            setAlerts(j.alerts);
        } catch (e) {
            console.warn("alerts load failed", e);
        } finally {
            setAlertsLoading(false);
        }
    }, [alertStatusFilter]);

    const loadEvents = useCallback(async () => {
        setEventsLoading(true);
        try {
            const qs = new URLSearchParams({ limit: "200" });
            if (eventCategoryFilter !== "all") {
                if (eventCategoryFilter.endsWith("*")) {
                    qs.set("category_prefix", eventCategoryFilter.slice(0, -1));
                } else {
                    qs.set("category", eventCategoryFilter);
                }
            }
            const res = await authFetch(`${API_URL}/pipeline/events?${qs.toString()}`);
            if (handle401(res)) return;
            const j = (await res.json()) as ActivityEventsResponse;
            setEvents(j.events);
        } catch (e) {
            console.warn("events load failed", e);
        } finally {
            setEventsLoading(false);
        }
    }, [eventCategoryFilter]);

    const loadCategories = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/pipeline/events/categories`);
            if (handle401(res)) return;
            const j = (await res.json()) as ActivityCategoriesResponse;
            setCategories(j.categories);
        } catch (e) {
            console.warn("categories load failed", e);
        }
    }, []);

    useEffect(() => { void loadAlerts(); }, [loadAlerts]);
    useEffect(() => { void loadEvents(); }, [loadEvents]);
    useEffect(() => { void loadCategories(); }, [loadCategories]);

    // Auto-refresh both every 30s
    useEffect(() => {
        const t = setInterval(() => { void loadAlerts(); void loadEvents(); void loadCategories(); }, 30_000);
        return () => clearInterval(t);
    }, [loadAlerts, loadEvents, loadCategories]);

    const confirmSwap = async (alertId: number) => {
        setActing(alertId);
        try {
            const res = await authFetch(`${API_URL}/pipeline/alerts/${alertId}/confirm-swap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note: "Confirmed via /pipeline UI" }),
            });
            if (handle401(res)) return;
            const j = await res.json();
            if (!j.ok) { toast.error(j.error || j.detail?.error || "Confirm failed"); return; }
            toast.success(`Bound ${j.customer} → ${j.new_mac}`);
            void loadAlerts(); void loadEvents();
        } catch (e) {
            toast.error("Network error: " + String(e));
        } finally {
            setActing(null);
        }
    };

    const ackAlert = async (alertId: number) => {
        setActing(alertId);
        try {
            const res = await authFetch(`${API_URL}/pipeline/alerts/${alertId}/ack`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note: null }),
            });
            if (handle401(res)) return;
            await res.json();
            void loadAlerts();
        } finally { setActing(null); }
    };

    const dismissAlert = async (alertId: number) => {
        const note = prompt("Dismiss reason (required):");
        if (!note) return;
        setActing(alertId);
        try {
            const res = await authFetch(`${API_URL}/pipeline/alerts/${alertId}/dismiss`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ note }),
            });
            if (handle401(res)) return;
            await res.json();
            void loadAlerts();
        } finally { setActing(null); }
    };

    const counts = useMemo(() => {
        const c = { critical: 0, warning: 0, info: 0, total: 0 };
        (alerts ?? []).forEach(a => { c[a.severity] = (c[a.severity] || 0) + 1; c.total += 1; });
        return c;
    }, [alerts]);

    return (
        <div className="mb-7 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-400" />
                    <h2 className="text-[15px] font-semibold tracking-tight">Drift Center</h2>
                    <span className="text-[11px] text-zinc-500">Alerts + every event in one place</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {counts.critical > 0 && (
                        <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-300">
                            {counts.critical} critical
                        </span>
                    )}
                    {counts.warning > 0 && (
                        <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">
                            {counts.warning} warning
                        </span>
                    )}
                    {counts.total === 0 && !alertsLoading && (
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
                            ✓ No open alerts
                        </span>
                    )}
                </div>
            </div>

            {/* Alerts panel */}
            <div className="mb-5">
                <div className="mb-2 flex items-center gap-2 text-[12px] text-zinc-400">
                    <Bell className="h-3.5 w-3.5" />
                    <span className="font-medium text-zinc-300">Binding Alerts</span>
                    <div className="ml-2 inline-flex rounded-md border border-white/10 bg-white/5">
                        {(["open", "ack", "all"] as const).map(s => (
                            <button key={s}
                                onClick={() => setAlertStatusFilter(s)}
                                className={`px-2.5 py-1 text-[11px] ${alertStatusFilter === s ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
                {alertsLoading && !alerts && <div className="text-[12px] text-zinc-500">Loading alerts…</div>}
                {alerts && alerts.length === 0 && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[12px] text-zinc-500">
                        No {alertStatusFilter === "all" ? "" : alertStatusFilter} alerts. The drift monitor checks every 5 minutes.
                    </div>
                )}
                {alerts && alerts.length > 0 && (
                    <div className="space-y-2">
                        {alerts.slice(0, 12).map(a => (
                            <div key={a.id}
                                className={`rounded-lg border px-3 py-2.5 text-[12px] ${SEVERITY_COLORS[a.severity] || SEVERITY_COLORS.info}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[a.severity] || SEVERITY_DOT.info}`} />
                                            <span className="font-mono uppercase tracking-wide opacity-75">{a.category}</span>
                                            <span className="opacity-50">·</span>
                                            <span className="opacity-60">{fmtDate(a.opened_at, false)}</span>
                                            {a.customer_username && (
                                                <>
                                                    <span className="opacity-50">·</span>
                                                    <span className="font-mono">{a.customer_username}</span>
                                                </>
                                            )}
                                            {a.olt_host && (
                                                <>
                                                    <span className="opacity-50">·</span>
                                                    <span className="opacity-75">{a.olt_host} {a.pon_port}/{a.onu_index ?? "?"}</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="mt-1 text-zinc-100">{a.summary}</div>
                                        {a.suggested_action && (
                                            <div className="mt-1 text-[11px] italic opacity-80">
                                                → {a.suggested_action}
                                            </div>
                                        )}
                                    </div>
                                    {a.status === "open" && (
                                        <div className="flex shrink-0 flex-col gap-1.5">
                                            {a.category === "device_swap_detected" && (
                                                <button
                                                    disabled={acting === a.id}
                                                    onClick={() => confirmSwap(a.id)}
                                                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50">
                                                    {acting === a.id ? "…" : "Confirm swap"}
                                                </button>
                                            )}
                                            <button
                                                disabled={acting === a.id}
                                                onClick={() => ackAlert(a.id)}
                                                className="rounded-md border border-blue-500/30 bg-blue-500/5 px-2.5 py-1 text-[11px] text-blue-300 hover:bg-blue-500/15 disabled:opacity-50">
                                                Ack
                                            </button>
                                            <button
                                                disabled={acting === a.id}
                                                onClick={() => dismissAlert(a.id)}
                                                className="rounded-md border border-zinc-500/30 bg-zinc-500/5 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-500/15 disabled:opacity-50">
                                                Dismiss
                                            </button>
                                        </div>
                                    )}
                                    {a.status !== "open" && (
                                        <span className="shrink-0 rounded-md border border-zinc-500/30 bg-zinc-500/10 px-2 py-1 text-[10px] uppercase text-zinc-400">
                                            {a.status}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {alerts.length > 12 && (
                            <div className="text-center text-[11px] text-zinc-500">
                                + {alerts.length - 12} more alerts not shown
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Activity events panel */}
            <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-zinc-400">
                    <Activity className="h-3.5 w-3.5" />
                    <span className="font-medium text-zinc-300">Activity Events</span>
                    <select
                        className="ml-2 rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200"
                        value={eventCategoryFilter}
                        onChange={(e) => setEventCategoryFilter(e.target.value)}>
                        <option value="all">all categories</option>
                        <option value="customer.*">customer.* (new / removed)</option>
                        <option value="scraper.*">scraper.* (MAC scrape results)</option>
                        <option value="binding.*">binding.* (engine binding changes)</option>
                        <option value="alert.*">alert.* (alert lifecycle)</option>
                        <option value="olt.*">olt.* (OLT up/down)</option>
                        {categories
                            .filter(c => !["customer", "scraper", "binding", "alert", "olt"].includes(c.category.split(".")[0]))
                            .map(c => <option key={c.category} value={c.category}>{c.category} ({c.cnt_24h}/24h)</option>)
                        }
                    </select>
                    <span className="ml-auto text-[10px] text-zinc-500">auto-refresh 30s</span>
                </div>
                {eventsLoading && !events && <div className="text-[12px] text-zinc-500">Loading events…</div>}
                {events && events.length === 0 && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[12px] text-zinc-500">
                        No events for this filter yet. New customer detections, MAC scrapes, binding changes, and alerts all land here.
                    </div>
                )}
                {events && events.length > 0 && (
                    <div className="max-h-[420px] overflow-y-auto rounded-lg border border-white/10 bg-black/30">
                        <table className="w-full text-[11px]">
                            <thead className="sticky top-0 bg-zinc-900/95 text-[10px] uppercase tracking-wider text-zinc-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">When</th>
                                    <th className="px-3 py-2 text-left">Category</th>
                                    <th className="px-3 py-2 text-left">Customer</th>
                                    <th className="px-3 py-2 text-left">Detail</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map(ev => (
                                    <tr key={ev.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                                        <td className="whitespace-nowrap px-3 py-1.5 text-zinc-400">{fmtDate(ev.ts)}</td>
                                        <td className="px-3 py-1.5">
                                            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px]">
                                                {CATEGORY_ICON[ev.category] || <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[ev.severity] || SEVERITY_DOT.info}`} />}
                                                <span>{ev.category}</span>
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-zinc-300">{ev.customer_username || "—"}</td>
                                        <td className="px-3 py-1.5 text-zinc-200">{ev.summary}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}


export default function PipelinePage() {
    return (
        <ErrorBoundary fallbackTitle="Pipeline monitor failed to load">
            <PipelineContent />
        </ErrorBoundary>
    );
}
