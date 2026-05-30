"use client";
/**
 * NOC Dashboard — Main Overview
 * ==============================
 * Real-time network command centre.
 * Data sources:
 *   GET /noc/summary   — KPI strip (refreshed every 30s + WebSocket live push)
 *   GET /noc/triage    — Active faults sorted by severity
 *   GET /noc/ports     — Per-PON-port breakdown
 *   GET /noc/alarms    — Latest 8 alarms
 *   WS  /ws/noc        — Instant KPI update after each OLT batch
 *   WS  /ws/alarms     — Instant alarm push
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNOCWebSocket } from "@/hooks/useNOCWebSocket";
import {
    Wifi, WifiOff, AlertTriangle, Activity, Zap, TrendingDown,
    RefreshCw, Radio, ArrowRight, Clock, Cpu, AlertCircle,
    CheckCircle2, Siren,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Summary {
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
    critical_signal: number;
    flapping: number;
    downstream_mbps: number;
    upstream_mbps: number;
}

interface FaultItem {
    mac_address: string;
    olt_host: string | null;
    pon_port: string | null;
    status: string | null;
    rx_power_dbm: number | null;
    dying_gasp: boolean;
    fault_type: string;
    severity: string;
    action: string;
    priority: number;
    customer_name: string | null;
    customer_phone: string | null;
    polled_at: string | null;
}

interface TriageResponse {
    summary: { total_faults: number; critical: number; high: number; medium: number };
    faults: FaultItem[];
}

interface PortStatus {
    pon_port: string;
    olt_host: string;
    total: number;
    online: number;
    offline: number;
    avg_rx: number | null;
    worst_rx: number | null;
}

interface AlarmItem {
    id: number;
    mac_address: string;
    event_type: string;
    olt_host: string | null;
    pon_port: string | null;
    received_at: string;
    customer_name: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rxColor(rx: number | null) {
    if (rx == null) return "text-gray-400";
    if (rx >= -20) return "text-green-600";
    if (rx >= -24) return "text-yellow-600";
    if (rx >= -27) return "text-orange-600";
    return "text-red-600";
}

function rxBg(rx: number | null) {
    if (rx == null) return "bg-gray-100";
    if (rx >= -20) return "bg-green-50 border-green-200";
    if (rx >= -24) return "bg-yellow-50 border-yellow-200";
    if (rx >= -27) return "bg-orange-50 border-orange-200";
    return "bg-red-50 border-red-200";
}

function severityColor(s: string) {
    if (s === "CRITICAL") return "bg-red-100 text-red-700 border-red-300";
    if (s === "HIGH") return "bg-orange-100 text-orange-700 border-orange-300";
    if (s === "MEDIUM") return "bg-yellow-100 text-yellow-700 border-yellow-300";
    return "bg-gray-100 text-gray-700 border-gray-300";
}

function faultTypeIcon(ft: string) {
    if (ft === "POWER_CUT") return <Zap className="h-4 w-4 text-yellow-500" />;
    if (ft.startsWith("FIBER")) return <TrendingDown className="h-4 w-4 text-orange-500" />;
    return <WifiOff className="h-4 w-4 text-red-500" />;
}

function alarmTypeColor(t: string) {
    if (t.includes("OFFLINE") || t.includes("DOWN")) return "bg-red-100 text-red-700";
    if (t.includes("ONLINE") || t.includes("RECOVER")) return "bg-green-100 text-green-700";
    if (t.includes("FIBER") || t.includes("SIGNAL")) return "bg-orange-100 text-orange-700";
    if (t.includes("POWER")) return "bg-yellow-100 text-yellow-700";
    return "bg-blue-100 text-blue-700";
}

function timeAgo(iso: string | null) {
    if (!iso) return "Never";
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return `${Math.round(secs)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NOCOverviewPage() {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [triage, setTriage] = useState<TriageResponse | null>(null);
    const [ports, setPorts] = useState<PortStatus[]>([]);
    const [alarms, setAlarms] = useState<AlarmItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const alarmSetRef = useRef<Set<number>>(new Set());

    const fetchAll = useCallback(async () => {
        try {
            const [sumRes, triRes, portRes, alarmRes] = await Promise.all([
                fetch(`${API_URL}/noc/summary`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/noc/triage`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/noc/ports`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/noc/alarms?page=1&page_size=8`, { headers: getAuthHeaders() }),
            ]);
            if (handle401(sumRes)) return;

            const [sumData, triData, portData, alarmData] = await Promise.all([
                sumRes.ok ? sumRes.json() : null,
                triRes.ok ? triRes.json() : null,
                portRes.ok ? portRes.json() : null,
                alarmRes.ok ? alarmRes.json() : null,
            ]);

            if (sumData) setSummary(sumData);
            if (triData) setTriage(triData);
            if (portData?.ports) setPorts(portData.ports);
            if (alarmData?.alarms) {
                setAlarms(alarmData.alarms);
                alarmData.alarms.forEach((a: AlarmItem) => alarmSetRef.current.add(a.id));
            }
            setLastRefresh(new Date());
        } catch (e) {
            console.error("[NOC] fetch error", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 30000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    // WebSocket: live KPI updates
    useNOCWebSocket("noc", useCallback((msg: unknown) => {
        const m = msg as { type?: string; data?: Summary };
        if (m?.type === "summary_update" && m.data) {
            setSummary(m.data);
            setLastRefresh(new Date());
        }
    }, []));

    // WebSocket: instant alarm push
    const { connected: alarmsConnected } = useNOCWebSocket("alarms", useCallback((msg: unknown) => {
        const m = msg as { type?: string; data?: AlarmItem };
        if (m?.type === "new_alarm" && m.data) {
            const alarm = m.data;
            if (!alarmSetRef.current.has(alarm.id)) {
                alarmSetRef.current.add(alarm.id);
                setAlarms(prev => [alarm, ...prev].slice(0, 8));
            }
        }
    }, []));

    const onlinePct = summary
        ? Math.round((summary.online / Math.max(summary.total_onus, 1)) * 100)
        : 0;

    return (
        <ErrorBoundary fallbackTitle="NOC Dashboard failed to load">
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* Header */}
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Radio className="h-5 w-5 text-emerald-600" />
                        <h1 className="text-xl font-bold text-gray-900">NOC Dashboard</h1>
                        <Badge
                            variant="outline"
                            className={alarmsConnected
                                ? "text-xs bg-green-50 text-green-700 border-green-300 animate-pulse"
                                : "text-xs bg-gray-50 text-gray-500 border-gray-300"}
                        >
                            {alarmsConnected ? "● Live" : "○ Polling"}
                        </Badge>
                        {summary?.data_is_stale && (
                            <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-300">
                                ⚠ OLT data {Math.round(summary.staleness_minutes)}m old
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">
                            Refreshed {timeAgo(lastRefresh.toISOString())}
                        </span>
                        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>
                </header>

                {/* NOC Nav sub-bar */}
                <div className="bg-white border-b border-gray-200 px-6 py-2 flex gap-4 text-sm flex-shrink-0">
                    {[
                        { href: "/noc", label: "Overview" },
                        { href: "/noc/triage", label: "Active Faults" },
                        { href: "/noc/onus", label: "ONU Inventory" },
                        { href: "/noc/alarms", label: "Alarms" },
                        { href: "/noc/analytics", label: "Analytics" },
                        { href: "/noc/maintenance", label: "Maintenance" },
                        { href: "/noc/predictions", label: "Risk Scores" },
                    ].map(item => (
                        <Link key={item.href} href={item.href}
                            className="text-gray-500 hover:text-gray-900 hover:underline px-1 py-0.5">
                            {item.label}
                        </Link>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-[1600px] mx-auto space-y-6">

                        {/* KPI Strip */}
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                            <KPICard label="Total ONUs" value={summary?.total_onus} icon={<Cpu className="h-4 w-4 text-blue-500" />} loading={loading} />
                            <KPICard label="Online" value={summary?.online} icon={<Wifi className="h-4 w-4 text-green-500" />} loading={loading}
                                valueClass="text-green-600" sub={`${onlinePct}%`} />
                            <KPICard label="Offline" value={summary?.offline} icon={<WifiOff className="h-4 w-4 text-red-500" />} loading={loading}
                                valueClass={summary?.offline ? "text-red-600" : "text-gray-700"} />
                            <KPICard label="Critical Signal" value={summary?.critical_signal} icon={<TrendingDown className="h-4 w-4 text-orange-500" />}
                                loading={loading} valueClass={summary?.critical_signal ? "text-orange-600" : "text-gray-700"} />
                            <KPICard label="Flapping" value={summary?.flapping} icon={<Activity className="h-4 w-4 text-purple-500" />}
                                loading={loading} valueClass={summary?.flapping ? "text-purple-600" : "text-gray-700"} />
                            <KPICard label="Alarms 24h" value={summary?.alarm_count_24h} icon={<Siren className="h-4 w-4 text-red-500" />}
                                loading={loading} valueClass={summary?.alarm_count_24h ? "text-red-600" : "text-gray-700"} />
                            <KPICard label="Downstream" value={summary?.downstream_mbps != null ? `${summary.downstream_mbps.toFixed(1)}` : undefined}
                                icon={<TrendingDown className="h-4 w-4 text-blue-500" />} loading={loading} sub="Mbps" />
                            <KPICard label="Last Poll" value={summary?.last_poll ? timeAgo(summary.last_poll) : undefined}
                                icon={<Clock className="h-4 w-4 text-gray-400" />} loading={loading}
                                valueClass={summary?.data_is_stale ? "text-red-500 text-xs font-medium" : "text-gray-700 text-xs font-medium"} />
                        </div>

                        {/* Active Faults + Recent Alarms */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                            {/* Active Faults (2/3 width) */}
                            <div className="lg:col-span-2">
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                                        Active Faults
                                        {triage?.summary.total_faults ? (
                                            <span className="ml-2 text-red-600">({triage.summary.total_faults})</span>
                                        ) : null}
                                    </h2>
                                    <Link href="/noc/triage" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                        View all <ArrowRight className="h-3 w-3" />
                                    </Link>
                                </div>
                                {triage?.summary && (
                                    <div className="flex gap-2 mb-3">
                                        {triage.summary.critical > 0 && <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-semibold">{triage.summary.critical} CRITICAL</span>}
                                        {triage.summary.high > 0 && <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold">{triage.summary.high} HIGH</span>}
                                        {triage.summary.medium > 0 && <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 font-semibold">{triage.summary.medium} MEDIUM</span>}
                                        {triage.summary.total_faults === 0 && <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-semibold flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> All Clear</span>}
                                    </div>
                                )}
                                <div className="space-y-2">
                                    {loading && !triage && [1,2,3].map(i => (
                                        <div key={i} className="h-16 bg-white rounded-lg border border-gray-200 animate-pulse" />
                                    ))}
                                    {triage?.faults.slice(0, 8).map(fault => (
                                        <FaultRow key={fault.mac_address} fault={fault} />
                                    ))}
                                    {triage && triage.faults.length === 0 && (
                                        <div className="flex items-center gap-2 p-4 bg-green-50 rounded-lg border border-green-200 text-green-700 text-sm">
                                            <CheckCircle2 className="h-5 w-5" />
                                            No active faults — network is healthy
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Recent Alarms (1/3 width) */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Recent Alarms</h2>
                                    <Link href="/noc/alarms" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                        View all <ArrowRight className="h-3 w-3" />
                                    </Link>
                                </div>
                                <div className="space-y-2">
                                    {loading && alarms.length === 0 && [1,2,3,4].map(i => (
                                        <div key={i} className="h-14 bg-white rounded-lg border border-gray-200 animate-pulse" />
                                    ))}
                                    {alarms.map(alarm => (
                                        <div key={alarm.id} className="bg-white rounded-lg border border-gray-200 p-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${alarmTypeColor(alarm.event_type)}`}>
                                                    {alarm.event_type.replace(/_/g, " ")}
                                                </span>
                                                <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(alarm.received_at)}</span>
                                            </div>
                                            <div className="mt-1 text-xs text-gray-600 font-mono">{alarm.mac_address}</div>
                                            {alarm.customer_name && (
                                                <div className="text-xs text-gray-500 truncate">{alarm.customer_name}</div>
                                            )}
                                        </div>
                                    ))}
                                    {!loading && alarms.length === 0 && (
                                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 text-sm text-center">
                                            No alarms in last 24h
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* PON Port Grid */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">PON Port Grid</h2>
                                <Link href="/noc/onus" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                    ONU Inventory <ArrowRight className="h-3 w-3" />
                                </Link>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                                {loading && ports.length === 0 && [1,2,3,4,5,6].map(i => (
                                    <div key={i} className="h-24 bg-white rounded-lg border border-gray-200 animate-pulse" />
                                ))}
                                {ports.map(port => (
                                    <PortCard key={`${port.olt_host}:${port.pon_port}`} port={port} />
                                ))}
                                {!loading && ports.length === 0 && (
                                    <div className="col-span-full p-4 bg-gray-50 rounded-lg border border-gray-200 text-gray-500 text-sm text-center">
                                        No OLT data yet — start the OLT poller
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function KPICard({
    label, value, icon, loading, valueClass = "text-gray-900", sub,
}: {
    label: string; value: string | number | undefined; icon: React.ReactNode;
    loading: boolean; valueClass?: string; sub?: string;
}) {
    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
                    {icon}
                </div>
                <div className={`text-2xl font-bold ${valueClass}`}>
                    {loading && value == null ? <div className="h-7 w-12 bg-gray-200 rounded animate-pulse" /> : (value ?? "—")}
                </div>
                {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
            </CardContent>
        </Card>
    );
}

function FaultRow({ fault }: { fault: FaultItem }) {
    return (
        <div className={`bg-white rounded-lg border p-3 flex items-center gap-3 ${
            fault.severity === "CRITICAL" ? "border-red-300 bg-red-50/40" :
            fault.severity === "HIGH" ? "border-orange-300 bg-orange-50/40" :
            "border-yellow-200 bg-yellow-50/20"
        }`}>
            <div className="flex-shrink-0">{faultTypeIcon(fault.fault_type)}</div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${severityColor(fault.severity)}`}>
                        {fault.severity}
                    </span>
                    <span className="text-xs font-semibold text-gray-700">{fault.fault_type.replace(/_/g, " ")}</span>
                    {fault.dying_gasp && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-300">DYING GASP</span>
                    )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 font-mono truncate">{fault.mac_address}</div>
                {fault.customer_name && (
                    <div className="text-xs text-gray-600 truncate">{fault.customer_name} {fault.customer_phone ? `· ${fault.customer_phone}` : ""}</div>
                )}
                <div className="text-xs text-gray-400 mt-0.5 truncate">{fault.action}</div>
            </div>
            <div className="flex-shrink-0 text-right">
                {fault.rx_power_dbm != null && (
                    <div className={`text-sm font-bold ${rxColor(fault.rx_power_dbm)}`}>
                        {fault.rx_power_dbm.toFixed(1)} dBm
                    </div>
                )}
                <div className="text-xs text-gray-400">{fault.pon_port || fault.olt_host}</div>
            </div>
        </div>
    );
}

function PortCard({ port }: { port: PortStatus }) {
    const offlinePct = port.total > 0 ? Math.round((port.offline / port.total) * 100) : 0;
    const borderColor = offlinePct > 30 ? "border-red-300" : offlinePct > 10 ? "border-orange-200" : "border-gray-200";
    return (
        <Link href={`/noc/onus?pon_port=${encodeURIComponent(port.pon_port)}&olt_host=${encodeURIComponent(port.olt_host)}`}>
            <Card className={`hover:shadow-md transition-shadow cursor-pointer border ${borderColor}`}>
                <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-700">Port {port.pon_port}</span>
                        <span className="text-[10px] text-gray-400">{port.olt_host.split(".").slice(-1)[0]}</span>
                    </div>
                    <div className="flex gap-2 text-xs mb-1">
                        <span className="text-green-600 font-semibold">{port.online} ↑</span>
                        <span className="text-red-500 font-semibold">{port.offline} ↓</span>
                    </div>
                    {/* Online bar */}
                    <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div
                            className={`h-full rounded-full ${offlinePct > 30 ? "bg-red-500" : offlinePct > 10 ? "bg-orange-400" : "bg-green-500"}`}
                            style={{ width: `${100 - offlinePct}%` }}
                        />
                    </div>
                    {port.avg_rx != null && (
                        <div className={`text-[10px] mt-1 ${rxColor(port.avg_rx)}`}>
                            avg {port.avg_rx.toFixed(1)} dBm
                        </div>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}
