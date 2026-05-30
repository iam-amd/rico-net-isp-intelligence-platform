"use client";
/**
 * NOC — Analytics
 * ================
 * 7-day trends: alarm counts, fault distribution, top problem ONUs,
 * signal degradation, worst uptime.
 */
import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { ErrorBanner } from "@/components/error-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft, BarChart3 } from "lucide-react";
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

interface AnalyticsSummary {
    total_alarms: number;
    days_analyzed: number;
    avg_network_uptime: number | null;
    problem_onu_count: number;
    degrading_onu_count: number;
}

interface AnalyticsResponse {
    summary: AnalyticsSummary;
    alarm_by_type: { event_type: string; count: number }[];
    alarm_trend: { day: string; count: number }[];
    alarm_by_port: { pon_port: string; olt_host: string; count: number }[];
    top_problem_onus: { mac_address: string; customer_name: string | null; alarm_count: number }[];
    uptime_sla: { day: string; online_pct: number }[];
    worst_uptime_onus: { mac_address: string; customer_name: string | null; online_pct: number }[];
    signal_degradation: { mac_address: string; customer_name: string | null; rx_slope: number; current_rx: number }[];
}

const FAULT_COLORS: Record<string, string> = {
    ONU_OFFLINE: "#EF4444",
    FIBER_CRITICAL: "#F97316",
    FIBER_WEAK: "#EAB308",
    FIBER_FLAP: "#A855F7",
    POWER_CUT: "#F59E0B",
    AUTO_RESOLVED: "#22C55E",
};

const PIE_COLORS = ["#EF4444", "#F97316", "#EAB308", "#A855F7", "#3B82F6", "#22C55E", "#64748B"];

export default function AnalyticsPage() {
    const [data, setData] = useState<AnalyticsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/noc/analytics`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (!res.ok) {
                setError(`Analytics API returned ${res.status} ${res.statusText}`);
                return;
            }
            setData(await res.json());
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Network error contacting backend";
            console.error("[Analytics]", e);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <ErrorBoundary fallbackTitle="Analytics failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc" className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></Link>
                        <BarChart3 className="h-5 w-5 text-blue-500" />
                        <h1 className="text-xl font-bold text-gray-900">Network Analytics</h1>
                        {data?.summary && (
                            <span className="text-sm text-gray-500">Last {data.summary.days_analyzed} days</span>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </header>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-[1400px] mx-auto space-y-6">

                        {error && <ErrorBanner title="Could not load analytics" message={error} onRetry={load} />}

                        {/* Summary KPIs */}
                        {data?.summary && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <Card>
                                    <CardContent className="p-4">
                                        <div className="text-xs text-gray-400 uppercase">Total Alarms (7d)</div>
                                        <div className="text-3xl font-bold text-red-600">{data.summary.total_alarms}</div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4">
                                        <div className="text-xs text-gray-400 uppercase">Avg Network Uptime</div>
                                        <div className="text-3xl font-bold text-green-600">
                                            {data.summary.avg_network_uptime != null ? `${data.summary.avg_network_uptime.toFixed(1)}%` : "—"}
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4">
                                        <div className="text-xs text-gray-400 uppercase">Problem ONUs</div>
                                        <div className="text-3xl font-bold text-orange-600">{data.summary.problem_onu_count}</div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="p-4">
                                        <div className="text-xs text-gray-400 uppercase">Degrading Signal</div>
                                        <div className="text-3xl font-bold text-yellow-600">{data.summary.degrading_onu_count}</div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {loading && !data && (
                            <div className="grid grid-cols-2 gap-4">
                                {[1,2,3,4].map(i => <div key={i} className="h-64 bg-white rounded-xl border animate-pulse" />)}
                            </div>
                        )}

                        {data && (
                            <>
                                {/* Alarm Trend + Fault Distribution */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <Card>
                                        <CardHeader><CardTitle className="text-sm">Daily Alarm Trend</CardTitle></CardHeader>
                                        <CardContent>
                                            <ResponsiveContainer width="100%" height={200}>
                                                <BarChart data={data.alarm_trend}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                                                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                                                    <YAxis tick={{ fontSize: 10 }} />
                                                    <Tooltip />
                                                    <Bar dataKey="count" fill="#EF4444" radius={[3, 3, 0, 0]} name="Alarms" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader><CardTitle className="text-sm">Fault Type Distribution</CardTitle></CardHeader>
                                        <CardContent>
                                            {data.alarm_by_type.length > 0 ? (
                                                <ResponsiveContainer width="100%" height={200}>
                                                    <PieChart>
                                                        <Pie data={data.alarm_by_type} dataKey="count" nameKey="event_type"
                                                            cx="50%" cy="50%" outerRadius={70} label={({ event_type, percent }) =>
                                                                `${event_type.replace(/_/g, " ")} ${(percent * 100).toFixed(0)}%`}>
                                                            {data.alarm_by_type.map((entry, i) => (
                                                                <Cell key={i} fill={FAULT_COLORS[entry.event_type] || PIE_COLORS[i % PIE_COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <Tooltip />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No alarm data</div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Network Uptime SLA */}
                                {data.uptime_sla.length > 0 && (
                                    <Card>
                                        <CardHeader><CardTitle className="text-sm">Daily Network Uptime %</CardTitle></CardHeader>
                                        <CardContent>
                                            <ResponsiveContainer width="100%" height={160}>
                                                <LineChart data={data.uptime_sla}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                                                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                                                    <YAxis domain={[80, 100]} tick={{ fontSize: 10 }} unit="%" />
                                                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "Uptime"]} />
                                                    <Line type="monotone" dataKey="online_pct" stroke="#22C55E" strokeWidth={2} dot={false} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </CardContent>
                                    </Card>
                                )}

                                {/* Top Problem ONUs + Signal Degradation */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <Card>
                                        <CardHeader><CardTitle className="text-sm">Top Problem ONUs</CardTitle></CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                {data.top_problem_onus.slice(0, 8).map((onu, i) => (
                                                    <div key={onu.mac_address} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                                                        <div>
                                                            <span className="text-xs font-mono text-gray-600">{onu.mac_address}</span>
                                                            {onu.customer_name && <div className="text-xs text-gray-500">{onu.customer_name}</div>}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-bold text-red-600">{onu.alarm_count}</span>
                                                            <span className="text-xs text-gray-400">alarms</span>
                                                            <Link href={`/noc/onus/${encodeURIComponent(onu.mac_address)}`}
                                                                className="text-xs text-blue-600 hover:underline">View</Link>
                                                        </div>
                                                    </div>
                                                ))}
                                                {data.top_problem_onus.length === 0 && (
                                                    <div className="text-sm text-gray-400 text-center py-4">No problem ONUs 🎉</div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <Card>
                                        <CardHeader><CardTitle className="text-sm">Signal Degradation (Rx slope &lt; 0)</CardTitle></CardHeader>
                                        <CardContent>
                                            <div className="space-y-2">
                                                {data.signal_degradation.slice(0, 8).map((onu) => (
                                                    <div key={onu.mac_address} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                                                        <div>
                                                            <span className="text-xs font-mono text-gray-600">{onu.mac_address}</span>
                                                            {onu.customer_name && <div className="text-xs text-gray-500">{onu.customer_name}</div>}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-orange-600 font-semibold">{onu.rx_slope.toFixed(2)} dBm/day</span>
                                                            <span className="text-xs text-gray-500">@ {onu.current_rx.toFixed(1)} dBm</span>
                                                            <Link href={`/noc/onus/${encodeURIComponent(onu.mac_address)}`}
                                                                className="text-xs text-blue-600 hover:underline">View</Link>
                                                        </div>
                                                    </div>
                                                ))}
                                                {data.signal_degradation.length === 0 && (
                                                    <div className="text-sm text-gray-400 text-center py-4">No degrading signals</div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
