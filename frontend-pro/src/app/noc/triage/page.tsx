"use client";
/**
 * NOC Triage — Active Faults
 * ===========================
 * All faults sorted by priority: CRITICAL → HIGH → MEDIUM
 * Auto-refreshes every 30s.
 */
import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { ErrorBanner } from "@/components/error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Zap, TrendingDown, WifiOff, Phone, ArrowLeft } from "lucide-react";

interface FaultItem {
    mac_address: string;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    status: string | null;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    temperature_c: number | null;
    dying_gasp: boolean;
    fault_type: string;
    severity: string;
    action: string;
    priority: number;
    alarm_count_24h: number;
    customer_name: string | null;
    customer_phone: string | null;
    polled_at: string | null;
}

interface TriageSummary {
    total_faults: number;
    total_healthy: number;
    critical: number;
    high: number;
    medium: number;
}

interface TriageResponse {
    summary: TriageSummary;
    fault_breakdown: { fault_type: string; count: number; severity: string }[];
    faults: FaultItem[];
}

function rxColor(rx: number | null) {
    if (rx == null) return "text-gray-400";
    if (rx >= -20) return "text-green-600";
    if (rx >= -24) return "text-yellow-600";
    if (rx >= -27) return "text-orange-600";
    return "text-red-600";
}

function severityBg(s: string) {
    if (s === "CRITICAL") return "border-l-red-500 bg-red-50/60";
    if (s === "HIGH") return "border-l-orange-500 bg-orange-50/40";
    return "border-l-yellow-400 bg-yellow-50/30";
}

function faultIcon(ft: string) {
    if (ft === "POWER_CUT") return <Zap className="h-5 w-5 text-yellow-500" />;
    if (ft.startsWith("FIBER")) return <TrendingDown className="h-5 w-5 text-orange-500" />;
    return <WifiOff className="h-5 w-5 text-red-500" />;
}

export default function TriagePage() {
    const [data, setData] = useState<TriageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const res = await fetch(`${API_URL}/noc/triage`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (!res.ok) {
                setError(`Triage API returned ${res.status} ${res.statusText}`);
                return;
            }
            setData(await res.json());
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Network error contacting backend";
            console.error("[Triage]", e);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    return (
        <ErrorBoundary fallbackTitle="Triage failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc" className="text-gray-400 hover:text-gray-700">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <h1 className="text-xl font-bold text-gray-900">Active Faults</h1>
                        {data?.summary && (
                            <div className="flex gap-2">
                                {data.summary.critical > 0 && <Badge className="bg-red-100 text-red-700 border-red-300">{data.summary.critical} Critical</Badge>}
                                {data.summary.high > 0 && <Badge className="bg-orange-100 text-orange-700 border-orange-300">{data.summary.high} High</Badge>}
                                {data.summary.medium > 0 && <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">{data.summary.medium} Medium</Badge>}
                            </div>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </header>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-[1400px] mx-auto space-y-4">

                        {error && <ErrorBanner title="Could not load triage" message={error} onRetry={load} />}

                        {/* Breakdown summary */}
                        {data?.fault_breakdown && data.fault_breakdown.length > 0 && (
                            <div className="flex gap-3 flex-wrap">
                                {data.fault_breakdown.map(fb => (
                                    <div key={fb.fault_type} className="bg-white rounded-lg border border-gray-200 px-4 py-2 text-sm">
                                        <span className="font-semibold text-gray-700">{fb.fault_type.replace(/_/g, " ")}</span>
                                        <span className="ml-2 text-gray-500">{fb.count} ONUs</span>
                                    </div>
                                ))}
                                {data.summary.total_healthy > 0 && (
                                    <div className="bg-green-50 rounded-lg border border-green-200 px-4 py-2 text-sm">
                                        <span className="font-semibold text-green-700">{data.summary.total_healthy} Healthy</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Fault list */}
                        {loading && !data && (
                            <div className="space-y-3">
                                {[1,2,3,4,5].map(i => <div key={i} className="h-24 bg-white rounded-lg border animate-pulse" />)}
                            </div>
                        )}

                        {data?.faults.length === 0 && (
                            <div className="text-center p-16 bg-white rounded-xl border border-gray-200">
                                <div className="text-4xl mb-3">✅</div>
                                <div className="text-lg font-semibold text-gray-700">No active faults</div>
                                <div className="text-sm text-gray-500 mt-1">Network is healthy</div>
                            </div>
                        )}

                        {data?.faults.map((fault, idx) => (
                            <div key={`${fault.mac_address}-${idx}`}
                                className={`bg-white rounded-xl border-l-4 border border-gray-200 p-4 ${severityBg(fault.severity)}`}>
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 mt-0.5">{faultIcon(fault.fault_type)}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center flex-wrap gap-2 mb-1">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                                fault.severity === "CRITICAL" ? "bg-red-100 text-red-700" :
                                                fault.severity === "HIGH" ? "bg-orange-100 text-orange-700" :
                                                "bg-yellow-100 text-yellow-700"
                                            }`}>{fault.severity}</span>
                                            <span className="font-semibold text-gray-800">{fault.fault_type.replace(/_/g, " ")}</span>
                                            {fault.dying_gasp && (
                                                <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">DYING GASP</span>
                                            )}
                                            {fault.alarm_count_24h > 0 && (
                                                <span className="text-xs text-gray-500">{fault.alarm_count_24h} alarms today</span>
                                            )}
                                        </div>
                                        <div className="text-sm text-gray-500 font-mono mb-1">{fault.mac_address}</div>
                                        {fault.customer_name && (
                                            <div className="text-sm font-medium text-gray-700">{fault.customer_name}</div>
                                        )}
                                        <div className="mt-2 text-sm text-blue-700 bg-blue-50 rounded px-3 py-1.5 inline-block">
                                            → {fault.action}
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0 text-right">
                                        {fault.rx_power_dbm != null && (
                                            <div className={`text-lg font-bold ${rxColor(fault.rx_power_dbm)}`}>
                                                {fault.rx_power_dbm.toFixed(1)} dBm
                                            </div>
                                        )}
                                        <div className="text-xs text-gray-400 mt-1">
                                            {fault.pon_port && `Port ${fault.pon_port}`}
                                        </div>
                                        {fault.customer_phone && (
                                            <a href={`tel:${fault.customer_phone}`}
                                                className="mt-2 flex items-center gap-1 text-xs text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded px-2 py-1">
                                                <Phone className="h-3 w-3" />
                                                {fault.customer_phone}
                                            </a>
                                        )}
                                        <Link href={`/noc/onus/${encodeURIComponent(fault.mac_address)}`}
                                            className="mt-1 block text-xs text-blue-600 hover:underline text-right">
                                            View ONU →
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
