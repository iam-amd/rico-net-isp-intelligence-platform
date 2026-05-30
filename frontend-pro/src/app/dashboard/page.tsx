"use client";

import React, { useState, useEffect, useCallback } from "react";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
    Users, Wifi, WifiOff, Zap, AlertCircle, CheckCircle2,
    Clock, Phone, CreditCard, Calendar, Ticket, TrendingUp,
    RefreshCw, ArrowRight, Signal, Activity, IndianRupee,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerItem {
    username: string;
    name: string;
    phone?: string;
    plan_name?: string;
    expiry_date?: string;
    balance: number;
}

interface OfflineItem {
    username: string;
    name: string;
    phone?: string;
    mac_address: string;
    offline_since?: string;
    olt_host: string;
    rx_power_dbm?: number;
}

interface Summary {
    business: {
        total_customers: number;
        active_customers: number;
        inactive_customers: number;
        total_outstanding: number;
        overdue_count: number;
        expiring_today_count: number;
        expiring_week_count: number;
    };
    network: {
        total_monitored: number;
        unmonitored: number;
        online: number;
        offline: number;
        dying_gasp: number;
        weak_signal: number;
        critical_signal: number;
    };
    tickets: {
        open: number;
        assigned: number;
        ongoing: number;
        overdue: number;
        created_today: number;
        resolved_today: number;
        active_total: number;
        recent_open: Array<{
            id: number;
            customer_id: string;
            issue_type: string;
            status: string;
            priority: string;
            created_at: string;
        }>;
    };
    attention: {
        expiring_today: CustomerItem[];
        expiring_week: CustomerItem[];
        unpaid: CustomerItem[];
        offline_no_ticket: OfflineItem[];
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return `${Math.round(secs)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
}

function inr(amount: number) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function daysUntil(isoDate?: string) {
    if (!isoDate) return null;
    const d = Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000);
    return d;
}

const PRIORITY_COLOR: Record<string, string> = {
    Critical: "bg-red-500",
    High: "bg-orange-400",
    Normal: "bg-blue-400",
    Low: "bg-gray-300",
};

const STATUS_COLOR: Record<string, string> = {
    Open: "text-red-600 bg-red-50",
    Assigned: "text-blue-600 bg-blue-50",
    Ongoing: "text-amber-600 bg-amber-50",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color, href }: {
    icon: any; label: string; value: string | number; sub?: string;
    color: string; href?: string;
}) {
    const inner = (
        <Card className={`border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer`}>
            <CardContent className="p-5">
                <div className={`inline-flex p-2.5 rounded-xl mb-3 ${color}`}>
                    <Icon className="h-5 w-5 text-white" />
                </div>
                <div className="text-2xl font-bold text-gray-900 leading-none mb-1">{value}</div>
                <div className="text-sm font-medium text-gray-500">{label}</div>
                {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
            </CardContent>
        </Card>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
}

function SectionHeader({ title, count, countColor }: { title: string; count?: number; countColor?: string }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">{title}</h3>
            {count !== undefined && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${countColor || "bg-gray-100 text-gray-600"}`}>
                    {count}
                </span>
            )}
        </div>
    );
}

function CustomerAttentionRow({ c, badge }: { c: CustomerItem; badge: React.ReactNode }) {
    return (
        <Link href={`/customers/show/${c.username}`}
            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-blue-50 transition-colors group">
            <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{c.name}</div>
                <div className="text-xs text-gray-400 font-mono">{c.phone || c.username}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {badge}
                <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-blue-500 transition-colors" />
            </div>
        </Link>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex items-center gap-2 p-3 text-xs text-gray-400">
            <CheckCircle2 className="h-4 w-4 text-green-400" />
            {message}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OperationsCentrePage() {
    const [data, setData] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [tab, setTab] = useState<"expiring_today" | "expiring_week" | "unpaid" | "offline">("expiring_today");

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const res = await window.fetch(`${API_URL}/customers/operations-summary`, {
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (res.ok) {
                setData(await res.json());
                setLastRefresh(new Date());
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

    // Auto-refresh every 3 minutes
    useEffect(() => {
        const t = setInterval(fetch, 3 * 60 * 1000);
        return () => clearInterval(t);
    }, [fetch]);

    const b = data?.business;
    const n = data?.network;
    const t = data?.tickets;
    const a = data?.attention;

    const networkOnlinePct = n && n.total_monitored > 0
        ? Math.round((n.online / n.total_monitored) * 100)
        : null;

    const tabCounts = {
        expiring_today: a?.expiring_today.length ?? 0,
        expiring_week: a?.expiring_week.length ?? 0,
        unpaid: a?.unpaid.length ?? 0,
        offline: a?.offline_no_ticket.length ?? 0,
    };

    return (
        <ErrorBoundary fallbackTitle="Operations centre failed to load">
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-6">

                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Operations Centre</h1>
                            <p className="text-sm text-gray-400 mt-0.5">
                                {lastRefresh ? `Last updated ${timeAgo(lastRefresh.toISOString())}` : "Loading…"}
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetch}
                            disabled={loading}
                            className="gap-2 text-gray-600"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>

                    {/* ── Row 1: Business KPIs ─────────────────────────────────────── */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <KpiCard
                            icon={Users}
                            label="Active Customers"
                            value={loading ? "—" : (b?.active_customers ?? 0)}
                            sub={`${b?.inactive_customers ?? 0} inactive`}
                            color="bg-blue-500"
                            href="/customers?activeFilter=active"
                        />
                        <KpiCard
                            icon={IndianRupee}
                            label="Outstanding Balance"
                            value={loading ? "—" : inr(b?.total_outstanding ?? 0)}
                            sub={`${b?.overdue_count ?? 0} accounts`}
                            color="bg-orange-500"
                        />
                        <KpiCard
                            icon={Ticket}
                            label="Active Tickets"
                            value={loading ? "—" : (t?.active_total ?? 0)}
                            sub={`${t?.overdue ?? 0} overdue · ${t?.created_today ?? 0} today`}
                            color={t?.overdue ? "bg-red-500" : "bg-purple-500"}
                            href="/tickets"
                        />
                        <KpiCard
                            icon={Wifi}
                            label="Network Online"
                            value={loading ? "—" : (networkOnlinePct !== null ? `${networkOnlinePct}%` : "—")}
                            sub={n ? `${n.online} online · ${n.offline} offline` : undefined}
                            color={networkOnlinePct !== null && networkOnlinePct < 90 ? "bg-red-500" : "bg-green-500"}
                            href="/noc/onus"
                        />
                    </div>

                    {/* ── Row 2: Attention + Network ───────────────────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                        {/* Attention Panel — 3 cols */}
                        <Card className="lg:col-span-3 border-none shadow-sm">
                            <CardHeader className="pb-2 pt-4 px-5">
                                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 text-amber-500" />
                                    Needs Attention
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-3 pb-4">
                                {/* Tabs */}
                                <div className="flex gap-1 mb-3 bg-gray-100 p-1 rounded-lg">
                                    {([
                                        { key: "expiring_today", label: "Today", color: "text-red-600 bg-red-50" },
                                        { key: "expiring_week", label: "This Week", color: "text-amber-600 bg-amber-50" },
                                        { key: "unpaid", label: "Unpaid", color: "text-orange-600 bg-orange-50" },
                                        { key: "offline", label: "ONU Down", color: "text-purple-600 bg-purple-50" },
                                    ] as const).map(({ key, label, color }) => (
                                        <button
                                            key={key}
                                            onClick={() => setTab(key)}
                                            className={`flex-1 text-xs font-semibold py-1.5 px-2 rounded-md transition-all ${
                                                tab === key ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700"
                                            }`}
                                        >
                                            {label}
                                            {tabCounts[key] > 0 && (
                                                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                                    tab === key ? color : "bg-gray-200 text-gray-500"
                                                }`}>
                                                    {tabCounts[key]}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>

                                {/* Tab Content */}
                                <div className="max-h-72 overflow-y-auto space-y-0.5">
                                    {loading ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse mb-1" />
                                        ))
                                    ) : tab === "expiring_today" ? (
                                        a?.expiring_today.length === 0
                                            ? <EmptyState message="No renewals due today" />
                                            : a?.expiring_today.map(c => (
                                                <CustomerAttentionRow key={c.username} c={c} badge={
                                                    <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                                                        Expires today
                                                    </span>
                                                } />
                                            ))
                                    ) : tab === "expiring_week" ? (
                                        a?.expiring_week.length === 0
                                            ? <EmptyState message="No renewals due this week" />
                                            : a?.expiring_week.map(c => {
                                                const days = daysUntil(c.expiry_date);
                                                return (
                                                    <CustomerAttentionRow key={c.username} c={c} badge={
                                                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                                            {days}d left
                                                        </span>
                                                    } />
                                                );
                                            })
                                    ) : tab === "unpaid" ? (
                                        a?.unpaid.length === 0
                                            ? <EmptyState message="No outstanding balances" />
                                            : a?.unpaid.map(c => (
                                                <CustomerAttentionRow key={c.username} c={c} badge={
                                                    <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">
                                                        {inr(c.balance)}
                                                    </span>
                                                } />
                                            ))
                                    ) : (
                                        a?.offline_no_ticket.length === 0
                                            ? <EmptyState message="All monitored ONUs are online" />
                                            : a?.offline_no_ticket.map(c => (
                                                <Link key={c.username} href={`/customers/show/${c.username}`}
                                                    className="flex items-center justify-between p-2.5 rounded-lg hover:bg-purple-50 transition-colors group">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-semibold text-gray-800 truncate">{c.name}</div>
                                                        <div className="text-xs text-gray-400 font-mono">{c.phone || c.username}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <WifiOff className="h-3.5 w-3.5 text-purple-500" />
                                                        <span className="text-xs text-purple-600 font-semibold">
                                                            {c.offline_since ? timeAgo(c.offline_since) : "Offline"}
                                                        </span>
                                                        <span className="text-xs text-gray-400 hidden sm:block">No ticket</span>
                                                        <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-purple-500 transition-colors" />
                                                    </div>
                                                </Link>
                                            ))
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Network Health — 2 cols */}
                        <Card className="lg:col-span-2 border-none shadow-sm">
                            <CardHeader className="pb-2 pt-4 px-5">
                                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                    <Signal className="h-4 w-4 text-blue-500" />
                                    Network Health
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-4 space-y-3">
                                {/* Online/Offline bar */}
                                {n && n.total_monitored > 0 && (
                                    <div>
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                            <span>ONU Status</span>
                                            <span>{n.total_monitored} monitored</span>
                                        </div>
                                        <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-gray-100">
                                            <div
                                                className="bg-green-500 rounded-l-full transition-all"
                                                style={{ width: `${(n.online / n.total_monitored) * 100}%` }}
                                            />
                                            <div
                                                className="bg-red-400 transition-all"
                                                style={{ width: `${(n.offline / n.total_monitored) * 100}%` }}
                                            />
                                            {n.dying_gasp > 0 && (
                                                <div
                                                    className="bg-purple-400 rounded-r-full transition-all"
                                                    style={{ width: `${(n.dying_gasp / n.total_monitored) * 100}%` }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    {[
                                        { label: "Online", value: n?.online, color: "text-green-700", dot: "bg-green-500" },
                                        { label: "Offline", value: n?.offline, color: "text-red-600", dot: "bg-red-400" },
                                        { label: "Dying Gasp", value: n?.dying_gasp, color: "text-purple-700", dot: "bg-purple-500" },
                                        { label: "Weak Signal", value: n?.weak_signal, color: "text-amber-700", dot: "bg-amber-400" },
                                        { label: "Critical Signal", value: n?.critical_signal, color: "text-red-700", dot: "bg-red-600" },
                                        { label: "Not Monitored", value: n?.unmonitored, color: "text-gray-500", dot: "bg-gray-300" },
                                    ].map(({ label, value, color, dot }) => (
                                        <div key={label} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2">
                                                <div className={`h-2 w-2 rounded-full ${dot}`} />
                                                <span className="text-gray-600">{label}</span>
                                            </div>
                                            <span className={`font-bold tabular-nums ${color}`}>
                                                {loading ? "—" : (value ?? "—")}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <Link href="/noc/onus">
                                    <Button variant="outline" size="sm" className="w-full mt-2 text-xs gap-1.5">
                                        <Activity className="h-3.5 w-3.5" />
                                        Open NOC Dashboard
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    </div>

                    {/* ── Row 3: Tickets + Alerts ──────────────────────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

                        {/* Recent open tickets — 3 cols */}
                        <Card className="lg:col-span-3 border-none shadow-sm">
                            <CardHeader className="pb-2 pt-4 px-5">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                        <Ticket className="h-4 w-4 text-purple-500" />
                                        Active Tickets
                                    </CardTitle>
                                    <Link href="/tickets">
                                        <Button variant="ghost" size="sm" className="text-xs text-blue-600 h-7 px-2">
                                            View All →
                                        </Button>
                                    </Link>
                                </div>
                            </CardHeader>
                            <CardContent className="px-3 pb-4">
                                {loading ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse mb-1.5" />
                                    ))
                                ) : t?.recent_open.length === 0 ? (
                                    <EmptyState message="No active tickets right now" />
                                ) : (
                                    <div className="space-y-1">
                                        {t?.recent_open.map(ticket => (
                                            <Link key={ticket.id} href={`/tickets/show/${ticket.id}`}
                                                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-gray-50 transition-colors group">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className={`h-2 w-2 rounded-full shrink-0 ${PRIORITY_COLOR[ticket.priority] || "bg-gray-300"}`} />
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium text-gray-800 truncate">{ticket.issue_type}</div>
                                                        <div className="text-xs text-gray-400 font-mono">{ticket.customer_id} · {timeAgo(ticket.created_at)}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[ticket.status] || "bg-gray-100 text-gray-600"}`}>
                                                        {ticket.status}
                                                    </span>
                                                    <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-600 transition-colors" />
                                                </div>
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Ticket stats sidebar — 2 cols */}
                        <Card className="lg:col-span-2 border-none shadow-sm">
                            <CardHeader className="pb-2 pt-4 px-5">
                                <CardTitle className="text-base font-semibold text-gray-800">Ticket Breakdown</CardTitle>
                            </CardHeader>
                            <CardContent className="px-5 pb-4 space-y-2.5">
                                {[
                                    { label: "Open (unassigned)", value: t?.open, color: "text-red-600", bg: "bg-red-400" },
                                    { label: "Assigned", value: t?.assigned, color: "text-blue-600", bg: "bg-blue-400" },
                                    { label: "In Progress", value: t?.ongoing, color: "text-amber-600", bg: "bg-amber-400" },
                                    { label: "Overdue (>24h)", value: t?.overdue, color: "text-red-700 font-bold", bg: "bg-red-600" },
                                    { label: "Created today", value: t?.created_today, color: "text-gray-700", bg: "bg-gray-400" },
                                    { label: "Resolved today", value: t?.resolved_today, color: "text-green-700", bg: "bg-green-500" },
                                ].map(({ label, value, color, bg }) => (
                                    <div key={label} className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2">
                                            <div className={`h-2 w-2 rounded-full ${bg}`} />
                                            <span className="text-gray-600">{label}</span>
                                        </div>
                                        <span className={`font-bold tabular-nums ${color}`}>
                                            {loading ? "—" : (value ?? 0)}
                                        </span>
                                    </div>
                                ))}

                                <div className="pt-2 border-t border-gray-100 flex justify-between text-sm">
                                    <span className="text-gray-500">Resolution rate</span>
                                    <span className="font-bold text-green-700">
                                        {loading ? "—" : `${t?.resolved_today ?? 0} / ${t?.created_today ?? 0} today`}
                                    </span>
                                </div>

                                <Link href="/tickets">
                                    <Button variant="outline" size="sm" className="w-full mt-1 text-xs gap-1.5">
                                        <Ticket className="h-3.5 w-3.5" />
                                        Manage Tickets
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    </div>

                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
