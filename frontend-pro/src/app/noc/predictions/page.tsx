"use client";
/**
 * NOC — Risk Predictions
 * =======================
 * Nightly ML-free risk scores per ONU.
 * Fiber risk, churn risk, health score (0-100), recommended action.
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
import { RefreshCw, ArrowLeft, TrendingDown, Phone } from "lucide-react";

interface PredictionItem {
    mac_address: string;
    customer_name: string | null;
    customer_phone: string | null;
    olt_host: string | null;
    pon_port: string | null;
    rx_slope_7d: number | null;
    rx_avg_7d: number | null;
    alarm_count_30d: number;
    offline_count_30d: number;
    fiber_risk: string | null;
    churn_risk: string | null;
    health_score: number | null;
    recommended_action: string | null;
    last_computed: string | null;
}

interface PredictionsResponse {
    predictions: PredictionItem[];
    total: number;
    last_run: string | null;
}

function HealthBar({ score }: { score: number | null }) {
    if (score == null) return <div className="text-xs text-gray-400">N/A</div>;
    const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-400" : score >= 30 ? "bg-orange-500" : "bg-red-500";
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden w-16">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
            </div>
            <span className={`text-sm font-bold ${score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : score >= 30 ? "text-orange-600" : "text-red-600"}`}>
                {score}
            </span>
        </div>
    );
}

function riskChip(risk: string | null, label: string) {
    if (!risk || risk === "LOW") return <span className="text-xs text-gray-400">{label}: Low</span>;
    const cls = risk === "HIGH" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700";
    return <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${cls}`}>{label}: {risk}</span>;
}

export default function PredictionsPage() {
    const [data, setData] = useState<PredictionsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<"health_score" | "fiber_risk" | "alarm_count_30d">("health_score");

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/noc/predictions`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (!res.ok) {
                setError(`Predictions API returned ${res.status} ${res.statusText}`);
                return;
            }
            setData(await res.json());
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Network error contacting backend";
            console.error("[Predictions]", e);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const sorted = React.useMemo(() => {
        if (!data?.predictions) return [];
        return [...data.predictions].sort((a, b) => {
            if (sortBy === "health_score") return (a.health_score ?? 100) - (b.health_score ?? 100);
            if (sortBy === "fiber_risk") {
                const rMap: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                return (rMap[a.fiber_risk || "LOW"] ?? 2) - (rMap[b.fiber_risk || "LOW"] ?? 2);
            }
            return b.alarm_count_30d - a.alarm_count_30d;
        });
    }, [data, sortBy]);

    return (
        <ErrorBoundary fallbackTitle="Predictions failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc" className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></Link>
                        <TrendingDown className="h-5 w-5 text-purple-500" />
                        <h1 className="text-xl font-bold text-gray-900">Risk Predictions</h1>
                        {data && (
                            <>
                                <Badge variant="outline" className="text-xs">{data.total} ONUs scored</Badge>
                                {data.last_run && (
                                    <span className="text-xs text-gray-400">
                                        Last run: {new Date(data.last_run).toLocaleString("en-IN")}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </header>

                {/* Sort controls */}
                <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-gray-500">Sort by:</span>
                    {[
                        { key: "health_score" as const, label: "Lowest Health" },
                        { key: "fiber_risk" as const, label: "Fiber Risk" },
                        { key: "alarm_count_30d" as const, label: "Most Alarms" },
                    ].map(s => (
                        <button key={s.key}
                            className={`text-xs px-3 py-1 rounded-full border ${sortBy === s.key ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}
                            onClick={() => setSortBy(s.key)}>
                            {s.label}
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-auto">
                    {error && <ErrorBanner title="Could not load predictions" message={error} onRetry={load} />}
                    <table className="w-full text-sm">
                        <thead className="bg-white border-b border-gray-200 sticky top-0">
                            <tr>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">ONU / Customer</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Health</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Risk</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rx Trend</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Alarms 30d</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Recommended Action</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading && !data && Array(15).fill(0).map((_, i) => (
                                <tr key={i} className="bg-white">
                                    {Array(7).fill(0).map((_, j) => (
                                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                                    ))}
                                </tr>
                            ))}
                            {sorted.map(p => (
                                <tr key={p.mac_address} className="bg-white hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="font-mono text-xs text-gray-600">{p.mac_address}</div>
                                        {p.customer_name && <div className="text-sm font-medium text-gray-800">{p.customer_name}</div>}
                                        {p.customer_phone && (
                                            <a href={`tel:${p.customer_phone}`}
                                                className="flex items-center gap-1 text-xs text-green-700 hover:underline">
                                                <Phone className="h-3 w-3" />{p.customer_phone}
                                            </a>
                                        )}
                                    </td>
                                    <td className="px-4 py-3"><HealthBar score={p.health_score} /></td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col gap-1">
                                            {riskChip(p.fiber_risk, "Fiber")}
                                            {riskChip(p.churn_risk, "Churn")}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {p.rx_slope_7d != null ? (
                                            <span className={`text-sm font-semibold ${p.rx_slope_7d < -0.1 ? "text-red-600" : p.rx_slope_7d < 0 ? "text-orange-600" : "text-green-600"}`}>
                                                {p.rx_slope_7d > 0 ? "+" : ""}{p.rx_slope_7d.toFixed(2)} dBm/d
                                            </span>
                                        ) : <span className="text-gray-400">—</span>}
                                        {p.rx_avg_7d != null && (
                                            <div className="text-xs text-gray-400">avg {p.rx_avg_7d.toFixed(1)} dBm</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-sm font-bold ${p.alarm_count_30d > 10 ? "text-red-600" : p.alarm_count_30d > 3 ? "text-orange-600" : "text-gray-600"}`}>
                                            {p.alarm_count_30d}
                                        </span>
                                        {p.offline_count_30d > 0 && (
                                            <div className="text-xs text-gray-400">{p.offline_count_30d} offline events</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-blue-700 max-w-[200px]">
                                        {p.recommended_action || <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Link href={`/noc/onus/${encodeURIComponent(p.mac_address)}`}
                                            className="text-xs text-blue-600 hover:underline">View →</Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!loading && sorted.length === 0 && (
                        <div className="text-center p-12 text-gray-500">
                            No predictions yet — they run nightly at 2 AM
                        </div>
                    )}
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
