"use client";
/**
 * NOC — Alarm Feed
 * =================
 * Paginated alarm history with lifecycle status (open/resolved).
 * Defaults to open alarms only. Live new alarms via WebSocket pushed to top.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { ErrorBanner } from "@/components/error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft, ArrowRight, Siren, Phone, X } from "lucide-react";
import { useNOCWebSocket } from "@/hooks/useNOCWebSocket";

interface AlarmItem {
    id: number;
    mac_address: string;
    event_type: string;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    received_at: string;
    customer_name: string | null;
    customer_phone: string | null;
    status: string;
    occurrence_count: number;
    resolved_at: string | null;
    duration_seconds: number | null;
}

function alarmBadgeClass(t: string) {
    if (t.includes("OFFLINE") || t.includes("DOWN")) return "bg-red-100 text-red-700 border-red-300";
    if (t.includes("ONLINE") || t.includes("RECOVER")) return "bg-green-100 text-green-700 border-green-300";
    if (t.includes("FIBER") || t.includes("SIGNAL")) return "bg-orange-100 text-orange-700 border-orange-300";
    if (t.includes("POWER") || t.includes("GASP")) return "bg-yellow-100 text-yellow-700 border-yellow-300";
    if (t.includes("SNMP")) return "bg-blue-100 text-blue-700 border-blue-300";
    return "bg-gray-100 text-gray-700 border-gray-300";
}

function fmtTime(iso: string) {
    return new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
}

function timeAgo(iso: string) {
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return `${Math.round(secs)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
}

function fmtDuration(secs: number | null) {
    if (secs == null) return null;
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h`;
    return `${Math.round(secs / 86400)}d`;
}

const PAGE_SIZE = 50;

function AlarmsPage() {
    const searchParams = useSearchParams();
    const macParam = searchParams.get("mac") || "";

    const [alarms, setAlarms] = useState<AlarmItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [liveCount, setLiveCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">(
        macParam ? "all" : "open"  // when filtering by MAC, show all statuses
    );
    const [eventTypeFilter, setEventTypeFilter] = useState("");
    const seenIds = useRef<Set<number>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page: String(page),
                page_size: String(PAGE_SIZE),
                status: statusFilter,
            });
            if (eventTypeFilter) params.set("event_type", eventTypeFilter);
            if (macParam) params.set("mac", macParam);

            const res = await fetch(`${API_URL}/noc/alarms?${params}`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (!res.ok) {
                setError(`Alarms API returned ${res.status} ${res.statusText}`);
                return;
            }
            const data = await res.json();
            setAlarms(data.alarms || []);
            setTotal(data.total || 0);
            data.alarms?.forEach((a: AlarmItem) => seenIds.current.add(a.id));
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Network error contacting backend";
            console.error("[Alarms]", e);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [page, statusFilter, eventTypeFilter, macParam]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); setLiveCount(0); }, [statusFilter, eventTypeFilter]);

    const { connected } = useNOCWebSocket("alarms", useCallback((msg: unknown) => {
        const m = msg as { type?: string; data?: AlarmItem };
        if (m?.type === "new_alarm" && m.data) {
            if (!seenIds.current.has(m.data.id)) {
                seenIds.current.add(m.data.id);
                setLiveCount(c => c + 1);
                if (page === 1 && statusFilter === "open") {
                    setAlarms(prev => [m.data!, ...prev].slice(0, PAGE_SIZE));
                    setTotal(t => t + 1);
                }
            }
        }
    }, [page, statusFilter]));

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <ErrorBoundary fallbackTitle="Alarms failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc" className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></Link>
                        <Siren className="h-5 w-5 text-red-500" />
                        <h1 className="text-xl font-bold text-gray-900">Alarm Feed</h1>
                        <Badge variant="outline" className="text-xs">{total.toLocaleString()} {statusFilter === "all" ? "total" : statusFilter}</Badge>
                        {macParam && (
                            <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                                <span className="text-xs font-mono text-blue-700">{macParam}</span>
                                <Link href="/noc/alarms" className="text-blue-400 hover:text-blue-700"><X className="h-3 w-3" /></Link>
                            </div>
                        )}
                        <Badge variant="outline" className={`text-xs ${connected ? "bg-green-50 text-green-700 border-green-300 animate-pulse" : "bg-gray-50 text-gray-400"}`}>
                            {connected ? "● Live" : "○ Offline"}
                        </Badge>
                        {liveCount > 0 && (
                            <Badge className="text-xs bg-red-100 text-red-700 border-red-300">{liveCount} new</Badge>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </header>

                {/* Filter bar */}
                <div className="bg-white border-b border-gray-200 px-6 py-2 flex flex-wrap gap-3 items-center flex-shrink-0">
                    {/* Status toggle */}
                    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                        {(["open", "resolved", "all"] as const).map(s => (
                            <button key={s}
                                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                                    statusFilter === s
                                        ? s === "open" ? "bg-red-600 text-white"
                                        : s === "resolved" ? "bg-green-600 text-white"
                                        : "bg-gray-700 text-white"
                                        : "text-gray-500 hover:text-gray-700"
                                }`}
                                onClick={() => setStatusFilter(s)}>
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                        ))}
                    </div>
                    {/* Event type filter */}
                    <select className="text-xs border border-gray-200 rounded-md px-2 h-8 bg-white"
                        value={eventTypeFilter} onChange={e => setEventTypeFilter(e.target.value)}>
                        <option value="">All Event Types</option>
                        <option value="ONU_OFFLINE">ONU Offline</option>
                        <option value="DYING_GASP">Dying Gasp</option>
                        <option value="FIBER_CRITICAL">Fiber Critical</option>
                        <option value="FIBER_WEAK">Fiber Weak</option>
                        <option value="HIGH_TEMP">High Temp</option>
                        <option value="SNMP_TRAP">SNMP Trap</option>
                    </select>
                </div>

                <div className="flex-1 overflow-auto">
                    {error && <div className="px-6 pt-4"><ErrorBanner title="Could not load alarms" message={error} onRetry={load} /></div>}
                    <table className="w-full text-sm">
                        <thead className="bg-white border-b border-gray-200 sticky top-0">
                            <tr>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Time</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Event Type</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">MAC / Port</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Occur</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Duration</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading && alarms.length === 0 && Array(20).fill(0).map((_, i) => (
                                <tr key={i} className="bg-white">
                                    {Array(8).fill(0).map((_, j) => (
                                        <td key={j} className="px-4 py-3">
                                            <div className="h-4 bg-gray-200 rounded animate-pulse" />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {alarms.map(alarm => (
                                <tr key={alarm.id} className={`hover:bg-gray-50 transition-colors ${
                                    alarm.status === "open" ? "bg-white" : "bg-gray-50"
                                }`}>
                                    {/* Status dot */}
                                    <td className="px-4 py-3">
                                        <div className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                                            alarm.status === "open"
                                                ? "bg-red-50 text-red-700"
                                                : "bg-green-50 text-green-700"
                                        }`}>
                                            <div className={`h-1.5 w-1.5 rounded-full ${alarm.status === "open" ? "bg-red-500" : "bg-green-500"}`} />
                                            {alarm.status}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-xs text-gray-700">{fmtTime(alarm.received_at)}</div>
                                        <div className="text-xs text-gray-400">{timeAgo(alarm.received_at)}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${alarmBadgeClass(alarm.event_type)}`}>
                                            {alarm.event_type.replace(/_/g, " ")}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-mono text-xs text-gray-700">{alarm.mac_address}</div>
                                        <div className="text-xs text-gray-400">
                                            {alarm.pon_port || "—"}
                                            {alarm.olt_host && ` · ${alarm.olt_host}`}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {alarm.customer_name ? (
                                            <>
                                                <div className="text-sm text-gray-800 font-medium">{alarm.customer_name}</div>
                                                {alarm.customer_phone && (
                                                    <a href={`tel:${alarm.customer_phone}`}
                                                        className="flex items-center gap-1 text-xs text-green-700 hover:underline">
                                                        <Phone className="h-3 w-3" />{alarm.customer_phone}
                                                    </a>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-xs text-gray-400 italic">Unlinked</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {alarm.occurrence_count > 1 ? (
                                            <span className="text-xs font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">
                                                ×{alarm.occurrence_count}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-400">1</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-500">
                                        {alarm.status === "resolved" && alarm.duration_seconds != null
                                            ? <span className="text-green-700">{fmtDuration(alarm.duration_seconds)}</span>
                                            : alarm.status === "open"
                                            ? <span className="text-red-500">{timeAgo(alarm.received_at)}</span>
                                            : "—"
                                        }
                                    </td>
                                    <td className="px-4 py-3">
                                        <Link href={`/noc/onus/${encodeURIComponent(alarm.mac_address)}`}
                                            className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                                            View →
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!loading && alarms.length === 0 && (
                        <div className="text-center p-12 text-gray-500">
                            {statusFilter === "open" ? "No open alarms — network is healthy!" : "No alarms found"}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
                        <span className="text-sm text-gray-500">
                            Page {page} of {totalPages} · {total.toLocaleString()} {statusFilter} alarms
                        </span>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </ErrorBoundary>
    );
}

// useSearchParams requires Suspense boundary in Next.js 15
export default function AlarmsPageWrapper() {
    return (
        <React.Suspense fallback={null}>
            <AlarmsPage />
        </React.Suspense>
    );
}
