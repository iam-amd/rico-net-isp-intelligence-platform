"use client";
/**
 * NOC — ONU Full Profile
 * =======================
 * Complete device DNA: signal, alarms, predictions, bandwidth, customer.
 * Auto-refreshes live status every 30s.
 */
import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    RefreshCw, ArrowLeft, Phone, User, Zap, WifiOff, TrendingDown,
    Activity, AlertTriangle, Cpu, BarChart2, Info,
} from "lucide-react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
    ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

interface SignalPoint {
    timestamp: string;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    status: string | null;
}

interface PredictionSnapshot {
    health_score: number | null;
    fiber_risk: string | null;
    churn_risk: string | null;
    recommended_action: string | null;
    rx_slope_7d: number | null;
    rx_avg_7d: number | null;
    last_computed: string | null;
}

interface BandwidthSnapshot {
    rx_mbps: number;
    tx_mbps: number;
    sampled_at: string | null;
}

interface ONUDetail {
    mac_address: string;
    olt_host: string;
    pon_port: string | null;
    onu_index: number | null;
    status: string | null;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    temperature_c: number | null;
    voltage_mv: number | null;
    dying_gasp: boolean;
    polled_at: string | null;
    vendor_id: string | null;
    model_id: string | null;
    hw_version: string | null;
    sw_version: string | null;
    is_gpon: boolean;
    signal_available: boolean;
    alarm_count_24h: number;
    alarm_count_30d: number;
    flap_count_30d: number;
    open_alarms: number;
    prediction: PredictionSnapshot | null;
    bandwidth: BandwidthSnapshot | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_plan: string | null;
    customer_expiry: string | null;
    customer_status: string | null;
    customer_balance: number | null;
    customer_address: string | null;
    customer_id: number | null;
    history_24h: SignalPoint[];
}

function rxColor(rx: number | null) {
    if (rx == null) return "#94A3B8";
    if (rx >= -20) return "#22C55E";
    if (rx >= -24) return "#EAB308";
    if (rx >= -27) return "#F97316";
    return "#EF4444";
}

function rxLabel(rx: number | null) {
    if (rx == null) return "N/A";
    if (rx >= -20) return "Excellent";
    if (rx >= -24) return "Good";
    if (rx >= -27) return "Weak";
    return "Critical";
}

function riskColor(r: string | null) {
    if (!r || r === "LOW") return "bg-green-50 text-green-700 border-green-300";
    if (r === "MEDIUM") return "bg-yellow-50 text-yellow-700 border-yellow-300";
    if (r === "HIGH") return "bg-red-50 text-red-700 border-red-300";
    return "bg-purple-50 text-purple-700 border-purple-300"; // CRITICAL
}

function timeAgo(iso: string | null) {
    if (!iso) return "Never";
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return `${Math.round(secs)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
}

function fmtChartTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-xs text-gray-400">{label}</span>
            <span className={`text-xs font-medium text-gray-700 ${mono ? "font-mono" : ""}`}>{value}</span>
        </div>
    );
}

function HealthBar({ score }: { score: number | null }) {
    if (score == null) return <span className="text-gray-400 text-sm">—</span>;
    const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-400" : score >= 30 ? "bg-orange-500" : "bg-red-500";
    const textColor = score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : score >= 30 ? "text-orange-600" : "text-red-600";
    return (
        <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
            </div>
            <span className={`text-sm font-bold ${textColor}`}>{score}</span>
        </div>
    );
}

export default function ONUDetailPage() {
    const params = useParams();
    const mac = decodeURIComponent(params.mac as string);

    const [detail, setDetail] = useState<ONUDetail | null>(null);
    const [historyHours, setHistoryHours] = useState<168 | 24>(24);
    const [history, setHistory] = useState<SignalPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [rebooting, setRebooting] = useState(false);

    const loadDetail = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/noc/onus/${encodeURIComponent(mac)}`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (res.ok) {
                const data: ONUDetail = await res.json();
                setDetail(data);
                setHistory(data.history_24h || []);
            }
        } catch (e) {
            console.error("[ONUDetail]", e);
        } finally {
            setLoading(false);
        }
    }, [mac]);

    const loadHistory = useCallback(async (hours: number) => {
        setHistoryLoading(true);
        try {
            const res = await fetch(`${API_URL}/noc/onus/${encodeURIComponent(mac)}/history?hours=${hours}`, { headers: getAuthHeaders() });
            if (res.ok) setHistory(await res.json());
        } catch {}
        finally { setHistoryLoading(false); }
    }, [mac]);

    useEffect(() => {
        loadDetail();
        const t = setInterval(loadDetail, 30000);
        return () => clearInterval(t);
    }, [loadDetail]);

    const handleRangeChange = (h: 24 | 168) => {
        setHistoryHours(h);
        if (h === 168) loadHistory(168);
        else if (detail) setHistory(detail.history_24h || []);
    };

    const handleReboot = async () => {
        setRebooting(true);
        try {
            const res = await fetch(`${API_URL}/noc/reboot-onu`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ mac_address: mac }),
            });
            const data = await res.json();
            if (res.ok) toast.success(data.message || "Reboot command sent");
            else toast.error(data.detail || "Reboot failed");
        } catch {
            toast.error("Reboot request failed — check connection");
        } finally {
            setRebooting(false);
        }
    };

    const chartData = React.useMemo(() => {
        const pts = history.filter(p => p.rx_power_dbm != null);
        if (pts.length <= 300) return pts;
        const step = Math.ceil(pts.length / 300);
        return pts.filter((_, i) => i % step === 0);
    }, [history]);

    const avgRx = chartData.length > 0
        ? chartData.reduce((sum, p) => sum + (p.rx_power_dbm || 0), 0) / chartData.length
        : null;

    return (
        <ErrorBoundary fallbackTitle="ONU detail failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* Header */}
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc/onus" className="text-gray-400 hover:text-gray-700">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                        <span className="font-mono text-sm font-semibold text-gray-700">{mac}</span>
                        {detail && (
                            <>
                                <Badge variant="outline" className={`text-xs ${
                                    detail.dying_gasp ? "bg-purple-50 text-purple-700 border-purple-300" :
                                    detail.status === "online" ? "bg-green-50 text-green-700 border-green-300" :
                                    "bg-red-50 text-red-700 border-red-300"
                                }`}>
                                    {detail.dying_gasp ? "Dying Gasp" : detail.status === "online" ? "Online" : "Offline"}
                                </Badge>
                                {detail.is_gpon && (
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
                                        GPON
                                    </Badge>
                                )}
                                {detail.open_alarms > 0 && (
                                    <Badge className="text-xs bg-red-100 text-red-700 border border-red-300">
                                        {detail.open_alarms} open alarms
                                    </Badge>
                                )}
                            </>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={loadDetail} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleReboot} disabled={rebooting}>
                            {rebooting ? "Rebooting..." : "Reboot ONU"}
                        </Button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6">
                    {loading && !detail ? (
                        <div className="space-y-4">
                            {[1,2,3].map(i => <div key={i} className="h-32 bg-white rounded-xl border animate-pulse" />)}
                        </div>
                    ) : detail ? (
                        <div className="max-w-[1400px] mx-auto space-y-5">

                            {/* GPON signal unavailable notice */}
                            {detail.is_gpon && !detail.signal_available && (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                                    <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-sm font-semibold text-blue-800">GPON — Signal data not yet available via CLI</div>
                                        <div className="text-xs text-blue-600 mt-1">
                                            This ONU is on a GPON OLT. Rx/Tx power, temperature, and voltage require SNMP GET
                                            or a firmware optical command. Run <code className="bg-blue-100 px-1 rounded">probe_all_optical.py</code> from
                                            the office PC to discover which commands your OLT firmware supports.
                                            Online/offline status and dying gasp events are fully tracked.
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Top KPI strip */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                                {[
                                    {
                                        label: "Rx Power",
                                        value: detail.rx_power_dbm != null
                                            ? `${detail.rx_power_dbm.toFixed(1)} dBm`
                                            : (detail.is_gpon ? "GPON" : "N/A"),
                                        sub: detail.rx_power_dbm != null ? rxLabel(detail.rx_power_dbm) : undefined,
                                        color: rxColor(detail.rx_power_dbm),
                                    },
                                    {
                                        label: "Tx Power",
                                        value: detail.tx_power_dbm != null ? `${detail.tx_power_dbm.toFixed(1)} dBm` : "N/A",
                                        color: "#64748B",
                                    },
                                    {
                                        label: "Temperature",
                                        value: detail.temperature_c != null ? `${detail.temperature_c.toFixed(0)}°C` : "N/A",
                                        color: detail.temperature_c != null && detail.temperature_c > 60 ? "#EF4444" : "#64748B",
                                        sub: detail.temperature_c != null && detail.temperature_c > 60 ? "HOT" : undefined,
                                    },
                                    {
                                        label: "Voltage",
                                        value: detail.voltage_mv != null ? `${detail.voltage_mv} mV` : "N/A",
                                        color: detail.voltage_mv != null && detail.voltage_mv < 3000 ? "#F97316" : "#64748B",
                                    },
                                    {
                                        label: "Alarms 24h",
                                        value: String(detail.alarm_count_24h),
                                        color: detail.alarm_count_24h > 5 ? "#EF4444" : detail.alarm_count_24h > 0 ? "#F97316" : "#22C55E",
                                    },
                                    {
                                        label: "Flaps 30d",
                                        value: String(detail.flap_count_30d),
                                        color: detail.flap_count_30d > 10 ? "#EF4444" : detail.flap_count_30d > 3 ? "#F97316" : "#64748B",
                                        sub: detail.flap_count_30d > 3 ? "Check splice" : undefined,
                                    },
                                    {
                                        label: "Port",
                                        value: detail.pon_port || "—",
                                        color: "#64748B",
                                    },
                                    {
                                        label: "Last Poll",
                                        value: timeAgo(detail.polled_at),
                                        color: "#64748B",
                                    },
                                ].map(m => (
                                    <Card key={m.label}>
                                        <CardContent className="p-3">
                                            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">{m.label}</div>
                                            <div className="text-base font-bold leading-tight" style={{ color: m.color }}>{m.value}</div>
                                            {m.sub && <div className="text-xs mt-0.5" style={{ color: m.color }}>{m.sub}</div>}
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>

                            {/* Main content grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                                {/* Signal history chart */}
                                <div className="lg:col-span-2 space-y-5">
                                    <Card>
                                        <CardHeader className="pb-3">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                    <Activity className="h-4 w-4 text-blue-500" />
                                                    Rx Power History · {chartData.length} readings
                                                    {avgRx != null && (
                                                        <span className="text-xs font-normal" style={{ color: rxColor(avgRx) }}>
                                                            avg {avgRx.toFixed(1)} dBm
                                                        </span>
                                                    )}
                                                </CardTitle>
                                                <div className="flex gap-1">
                                                    {([24, 168] as const).map(h => (
                                                        <button key={h}
                                                            className={`text-xs px-2 py-1 rounded ${historyHours === h ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                                                            onClick={() => handleRangeChange(h)}>
                                                            {h === 24 ? "24h" : "7d"}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            {historyLoading ? (
                                                <div className="h-48 bg-gray-100 rounded animate-pulse" />
                                            ) : chartData.length > 1 ? (
                                                <ResponsiveContainer width="100%" height={220}>
                                                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                                                        <XAxis dataKey="timestamp" tickFormatter={fmtChartTime}
                                                            tick={{ fontSize: 9, fill: "#94A3B8" }} interval="preserveStartEnd" />
                                                        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "#94A3B8" }} unit=" dBm" />
                                                        <Tooltip
                                                            formatter={(v: number) => [`${v.toFixed(2)} dBm`, "Rx Power"]}
                                                            labelFormatter={(l) => new Date(l).toLocaleString("en-IN")}
                                                            contentStyle={{ fontSize: 11 }}
                                                        />
                                                        <ReferenceLine y={-27} stroke="#EF4444" strokeDasharray="4 3" strokeWidth={1}
                                                            label={{ value: "Critical -27", position: "insideLeft", fontSize: 9, fill: "#EF4444" }} />
                                                        <ReferenceLine y={-24} stroke="#F97316" strokeDasharray="4 3" strokeWidth={1}
                                                            label={{ value: "Weak -24", position: "insideLeft", fontSize: 9, fill: "#F97316" }} />
                                                        <Line type="monotone" dataKey="rx_power_dbm" dot={false}
                                                            stroke={rxColor(avgRx)} strokeWidth={2} />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                                                    {detail.is_gpon ? "Signal history not available for GPON ONUs yet" : "No signal history data"}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {/* Prediction intelligence */}
                                    {detail.prediction && (
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                    <TrendingDown className="h-4 w-4 text-purple-500" />
                                                    Risk Prediction
                                                    {detail.prediction.last_computed && (
                                                        <span className="text-xs font-normal text-gray-400 ml-auto">
                                                            computed {timeAgo(detail.prediction.last_computed)}
                                                        </span>
                                                    )}
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="flex items-center gap-3 mb-3">
                                                    <div className="flex-1">
                                                        <div className="text-xs text-gray-400 mb-1">Health Score</div>
                                                        <HealthBar score={detail.prediction.health_score} />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <Badge variant="outline" className={`text-xs ${riskColor(detail.prediction.fiber_risk)}`}>
                                                            Fiber: {detail.prediction.fiber_risk || "LOW"}
                                                        </Badge>
                                                        <Badge variant="outline" className={`text-xs ${riskColor(detail.prediction.churn_risk)}`}>
                                                            Churn: {detail.prediction.churn_risk || "LOW"}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                {detail.prediction.rx_slope_7d != null && (
                                                    <div className="text-xs text-gray-500 mb-2">
                                                        7d Rx slope: <span className={`font-bold ${detail.prediction.rx_slope_7d < -0.1 ? "text-red-600" : "text-gray-700"}`}>
                                                            {detail.prediction.rx_slope_7d > 0 ? "+" : ""}{detail.prediction.rx_slope_7d.toFixed(3)} dBm/day
                                                        </span>
                                                        {detail.prediction.rx_avg_7d != null && (
                                                            <span className="ml-2 text-gray-400">avg {detail.prediction.rx_avg_7d.toFixed(1)} dBm</span>
                                                        )}
                                                    </div>
                                                )}
                                                {detail.prediction.recommended_action && (
                                                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                                                        <div className="text-xs font-semibold text-blue-700">Recommended Action</div>
                                                        <div className="text-xs text-blue-800 mt-0.5">{detail.prediction.recommended_action}</div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    )}
                                </div>

                                {/* Right column */}
                                <div className="space-y-4">
                                    {/* Customer info */}
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                <User className="h-4 w-4" /> Customer
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-1.5">
                                            {detail.customer_name ? (
                                                <>
                                                    <div className="font-semibold text-gray-800">{detail.customer_name}</div>
                                                    {detail.customer_phone && (
                                                        <a href={`tel:${detail.customer_phone}`}
                                                            className="flex items-center gap-1.5 text-sm text-green-700 hover:underline">
                                                            <Phone className="h-3.5 w-3.5" />{detail.customer_phone}
                                                        </a>
                                                    )}
                                                    <div className="pt-1 space-y-1">
                                                        {detail.customer_plan && <Row label="Plan" value={detail.customer_plan} />}
                                                        {detail.customer_status && (
                                                            <Row label="Status" value={
                                                                <Badge variant="outline" className={`text-xs ${detail.customer_status === "active" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                                                                    {detail.customer_status}
                                                                </Badge>
                                                            } />
                                                        )}
                                                        {detail.customer_balance != null && (
                                                            <Row label="Balance" value={
                                                                <span className={detail.customer_balance < 0 ? "text-red-600 font-bold" : ""}>
                                                                    ₹{detail.customer_balance.toFixed(2)}
                                                                </span>
                                                            } />
                                                        )}
                                                        {detail.customer_expiry && (
                                                            <Row label="Expires" value={new Date(detail.customer_expiry).toLocaleDateString("en-IN")} />
                                                        )}
                                                    </div>
                                                    {detail.customer_address && (
                                                        <div className="text-xs text-gray-400 pt-1">{detail.customer_address}</div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="text-sm text-gray-400 italic">
                                                    {detail.is_gpon
                                                        ? "GPON ONU — scan barcode in field to link customer"
                                                        : "Not linked to any customer"}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>

                                    {/* Alarm activity */}
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                <AlertTriangle className="h-4 w-4 text-orange-500" /> Alarm Activity
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-1.5">
                                            <Row label="Open alarms" value={
                                                <span className={detail.open_alarms > 0 ? "text-red-600 font-bold" : "text-green-600"}>
                                                    {detail.open_alarms}
                                                </span>
                                            } />
                                            <Row label="Alarms (24h)" value={
                                                <span className={detail.alarm_count_24h > 5 ? "text-red-600 font-bold" : ""}>{detail.alarm_count_24h}</span>
                                            } />
                                            <Row label="Alarms (30d)" value={String(detail.alarm_count_30d)} />
                                            <Row label="Offline events (30d)" value={
                                                <span className={detail.flap_count_30d > 10 ? "text-red-600 font-bold" : detail.flap_count_30d > 3 ? "text-orange-600" : ""}>
                                                    {detail.flap_count_30d}
                                                </span>
                                            } />
                                            <div className="pt-1">
                                                <Link href={`/noc/alarms?mac=${encodeURIComponent(mac)}`}
                                                    className="text-xs text-blue-600 hover:underline">
                                                    View alarm history →
                                                </Link>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Device hardware */}
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                <Cpu className="h-4 w-4 text-gray-500" /> Device
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-1.5">
                                            <Row label="OLT" value={detail.olt_host} />
                                            <Row label="Port" value={detail.pon_port || "—"} />
                                            <Row label="ONU #" value={detail.onu_index != null ? String(detail.onu_index) : "—"} />
                                            <Row label="Type" value={detail.is_gpon ? "GPON" : "EPON"} />
                                            {detail.model_id && <Row label="Model" value={detail.model_id} />}
                                            {detail.vendor_id && <Row label="Vendor" value={detail.vendor_id} />}
                                            {detail.hw_version && <Row label="HW" value={detail.hw_version} mono />}
                                            {detail.sw_version && <Row label="FW" value={detail.sw_version} mono />}
                                            <Row label="Dying Gasp" value={
                                                detail.dying_gasp
                                                    ? <span className="text-purple-600 font-bold">YES — Power cut</span>
                                                    : <span className="text-gray-500">No</span>
                                            } />
                                        </CardContent>
                                    </Card>

                                    {/* Bandwidth (EPON only) */}
                                    {detail.bandwidth && (
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                                    <BarChart2 className="h-4 w-4 text-blue-500" /> Bandwidth
                                                    <span className="text-xs font-normal text-gray-400 ml-auto">
                                                        {detail.bandwidth.sampled_at ? timeAgo(detail.bandwidth.sampled_at) : ""}
                                                    </span>
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-1.5">
                                                <Row label="Download" value={<span className="text-green-600">{detail.bandwidth.rx_mbps.toFixed(2)} Mbps</span>} />
                                                <Row label="Upload" value={<span className="text-blue-600">{detail.bandwidth.tx_mbps.toFixed(2)} Mbps</span>} />
                                            </CardContent>
                                        </Card>
                                    )}
                                </div>
                            </div>

                        </div>
                    ) : (
                        <div className="text-center p-16 text-gray-500">ONU not found</div>
                    )}
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
