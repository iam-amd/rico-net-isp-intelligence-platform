"use client";
/**
 * NOC — Maintenance Schedule
 * ===========================
 * Priority-ordered list of ONUs that need proactive maintenance,
 * generated nightly by the prediction engine.
 */
import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft, Wrench, Phone } from "lucide-react";

interface MaintenanceItem {
    mac_address: string;
    olt_host: string;
    pon_port: string | null;
    onu_index: number | null;
    rx_power_dbm: number | null;
    rx_slope_7d: number | null;
    signal_level: string;        // "weak" | "critical"
    recommended_action: string;
    customer_name: string | null;
    customer_phone: string | null;
    priority: number;            // 1=dispatch now, 2=48h, 3=monitor
}

interface MaintenanceResponse {
    items: MaintenanceItem[];
    total: number;
    critical_count: number;
    high_count: number;
}

function priorityLabel(p: number) {
    if (p === 1) return { text: "Dispatch Now", cls: "bg-red-100 text-red-700 border-red-300" };
    if (p === 2) return { text: "Within 48h", cls: "bg-orange-100 text-orange-700 border-orange-300" };
    return { text: "Monitor", cls: "bg-yellow-100 text-yellow-700 border-yellow-300" };
}

function signalBadge(level: string) {
    const cls = level === "critical" ? "bg-red-100 text-red-700 border-red-300" : "bg-orange-100 text-orange-700 border-orange-300";
    return <Badge variant="outline" className={`text-xs ${cls}`}>{level.toUpperCase()} SIGNAL</Badge>;
}

export default function MaintenancePage() {
    const [data, setData] = useState<MaintenanceResponse | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/noc/maintenance-schedule`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (res.ok) setData(await res.json());
        } catch (e) {
            console.error("[Maintenance]", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <ErrorBoundary fallbackTitle="Maintenance schedule failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc" className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></Link>
                        <Wrench className="h-5 w-5 text-blue-500" />
                        <h1 className="text-xl font-bold text-gray-900">Maintenance Schedule</h1>
                        {data && (
                            <>
                                <Badge variant="outline" className="text-xs">{data.total} items</Badge>
                                {data.critical_count > 0 && <Badge className="text-xs bg-red-100 text-red-700">{data.critical_count} critical</Badge>}
                                {data.high_count > 0 && <Badge className="text-xs bg-orange-100 text-orange-700">{data.high_count} high</Badge>}
                            </>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </header>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-[1200px] mx-auto space-y-3">
                        {loading && !data && Array(8).fill(0).map((_, i) => (
                            <div key={i} className="h-24 bg-white rounded-xl border animate-pulse" />
                        ))}

                        {data?.items.length === 0 && (
                            <div className="text-center p-16 bg-white rounded-xl border border-gray-200">
                                <div className="text-3xl mb-2">✅</div>
                                <div className="font-semibold text-gray-700">No maintenance required</div>
                                <div className="text-sm text-gray-400 mt-1">All ONUs are in good health. Run predictions nightly to update.</div>
                            </div>
                        )}

                        {data?.items.map((item, idx) => {
                            const pLabel = priorityLabel(item.priority);
                            return (
                            <Card key={item.mac_address} className={`border-l-4 ${
                                item.priority === 1 ? "border-l-red-500" :
                                item.priority === 2 ? "border-l-orange-400" :
                                "border-l-yellow-300"
                            }`}>
                                <CardContent className="p-4">
                                    <div className="flex items-start gap-4">
                                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <Badge variant="outline" className={`text-xs ${pLabel.cls}`}>{pLabel.text}</Badge>
                                                {signalBadge(item.signal_level)}
                                            </div>
                                            <div className="font-mono text-xs text-gray-500">{item.mac_address}</div>
                                            {item.customer_name && (
                                                <div className="font-semibold text-gray-800 mt-0.5">{item.customer_name}</div>
                                            )}
                                            <div className="mt-2 text-sm text-blue-700 bg-blue-50 rounded px-3 py-1.5 inline-block">
                                                → {item.recommended_action}
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0 text-right space-y-1">
                                            {item.rx_power_dbm != null && (
                                                <div className={`text-sm font-bold ${
                                                    item.rx_power_dbm >= -20 ? "text-green-600" :
                                                    item.rx_power_dbm >= -24 ? "text-yellow-600" :
                                                    item.rx_power_dbm >= -27 ? "text-orange-600" : "text-red-600"
                                                }`}>
                                                    {item.rx_power_dbm.toFixed(1)} dBm
                                                </div>
                                            )}
                                            {item.rx_slope_7d != null && (
                                                <div className="text-xs text-gray-500">
                                                    {item.rx_slope_7d > 0 ? "+" : ""}{item.rx_slope_7d.toFixed(2)} dBm/day
                                                </div>
                                            )}
                                            <div className="text-xs text-gray-400">Port {item.pon_port || "?"}</div>
                                            {item.customer_phone && (
                                                <a href={`tel:${item.customer_phone}`}
                                                    className="flex items-center gap-1 text-xs text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded px-2 py-1">
                                                    <Phone className="h-3 w-3" />
                                                    {item.customer_phone}
                                                </a>
                                            )}
                                            <Link href={`/noc/onus/${encodeURIComponent(item.mac_address)}`}
                                                className="block text-xs text-blue-600 hover:underline">
                                                Signal history →
                                            </Link>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
