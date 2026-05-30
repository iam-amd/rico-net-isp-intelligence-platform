"use client";
/**
 * OLT Engine Monitor â€” counters + reason breakdown + run log + change feed.
 */
import React, { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
    RefreshCw, ShieldCheck, ShieldAlert, ShieldX, Wifi, Activity,
    CheckCircle2, AlertCircle, Cpu, PlayCircle, Clock, History, GitBranch, FileWarning,
} from "lucide-react";

interface ByOlt { olt_host: string; cnt: number }
interface OltDetail {
    olt_host: string;
    customers: number;
    linked: number;
    fresh_in_20min: number;
    live_now: number;
    held_offline: number;
    sticker_scan: number;
    pon_mac_count: number | null;
    optical_count: number | null;
    orphan_macs: number;
    walk_error: string | null;
}
interface OrphanOnu {
    mac_address: string;
    olt_host: string;
    pon_port: string;
    onu_index: number;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    status: string | null;
    first_seen_at: string;
    last_seen_at: string;
}
interface ReasonRow { unmatched_reason: string; cnt: number }
interface UnmatchedCustomer {
    username: string; first_name: string | null; last_name: string | null;
    phone: string | null; railwire_mac: string | null;
    railwire_status: string | null;
    unmatched_reason: string | null;
    binding_source: string | null;
    confidence: string | null;
    olt_host: string | null;
    pon_port: string | null;
    onu_index: number | null;
    optical_mac: string | null;
    last_seen_online: string | null;
}
interface UnmatchedByOlt {
    olt_host: string;       // "10.10.10.100" / "__none__"
    total: number;
    held_offline: number;
    no_olt_match: number;
}
interface Status {
    total: number;
    linked: number; unlinked: number; freshly_verified: number;
    resolved: number;
    sticker_scan: number; pon_mac_table: number; stale_pon_mac: number; no_olt_match: number;
    verified: number; probable: number; guess: number;
    online_now: number; offline_now: number; dying_gasp: number;
    last_reconciled_at: string | null;
    by_olt: ByOlt[];
    olts: OltDetail[];
    unmatched_reasons: ReasonRow[];
}
interface Run {
    id: number; started_at: string; finished_at: string | null; duration_seconds: number | null;
    ok: boolean; error: string | null;
    customers_total: number; customers_resolved: number; customers_unmatched: number;
    unified_mac_count: number; changes_count: number;
    olt_100_pon_mac: number | null; olt_100_optical: number | null; olt_100_error: string | null;
    olt_200_pon_mac: number | null; olt_200_optical: number | null; olt_200_error: string | null;
    olt_210_pon_mac: number | null; olt_210_optical: number | null; olt_210_error: string | null;
}
interface Change { id: number; occurred_at: string; username: string; change_type: string; from_value: string | null; to_value: string | null }

const fmtAge = (s: string | null): string => {
    if (!s) return "never";
    const ms = Date.now() - new Date(s).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3600_000)}h ago`;
};

const fmtDateTime = (s: string | null): string => {
    if (!s) return "â€”";
    try { return new Date(s).toLocaleString(); } catch { return s; }
};

const REASON_LABEL: Record<string, string> = {
    no_railwire_mac:     "No Railwire MAC (scraper gap)",
    mac_format_invalid:  "MAC format invalid",
    not_in_olt_table:    "MAC not in any OLT â€” never seen / no binding history",
    position_no_optical: "Position found but no optical data",
    held_offline:        "Offline now â€” last-known position preserved",
};

const CHANGE_COLOR: Record<string, string> = {
    resolved:          "bg-emerald-500",
    unresolved:        "bg-red-500",
    position_changed:  "bg-yellow-500",
    online_to_offline: "bg-orange-500",
    offline_to_online: "bg-emerald-500",
    dying_gasp:        "bg-red-700",
    source_changed:    "bg-blue-500",
    confidence_changed:"bg-purple-500",
};

function StatCard({ title, value, sub, icon }: { title: string; value: React.ReactNode; sub?: string; icon: React.ReactNode }) {
    return (
        <Card>
            <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs uppercase tracking-wider text-zinc-500">{title}</div>
                        <div className="text-3xl font-bold mt-1">{value}</div>
                        {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
                    </div>
                    <div className="text-zinc-400">{icon}</div>
                </div>
            </CardContent>
        </Card>
    );
}

export default function EngineMonitorPage() {
    const [status, setStatus]     = useState<Status | null>(null);
    const [runs, setRuns]         = useState<Run[]>([]);
    const [changes, setChanges]   = useState<Change[]>([]);
    const [unmatched, setUnmatched] = useState<UnmatchedCustomer[]>([]);
    const [unmByOlt,  setUnmByOlt]  = useState<UnmatchedByOlt[]>([]);
    const [unmReason, setUnmReason] = useState<string>("");
    const [unmOlt,    setUnmOlt]    = useState<string>("");      // "", "10.10.10.100", "__none__"
    const [orphans,   setOrphans]   = useState<OrphanOnu[]>([]);
    const [orphanOlt, setOrphanOlt] = useState<string>("");
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const [reconciling, setReconciling] = useState(false);
    const [resolving, setResolving] = useState<string | null>(null);   // username currently being re-linked

    const resolveOne = async (username: string) => {
        setResolving(username);
        try {
            const res = await fetch(`${API_URL}/engine/customer/${encodeURIComponent(username)}/resolve`, {
                method: "POST", headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
            const r = await res.json();
            if (r.binding_source === "no_olt_match") {
                toast.warning(`${username} still unmatched (${r.unmatched_reason}).`);
            } else if (r.binding_source === "stale_pon_mac") {
                toast.info(`${username} held at ${r.position} (offline). OLTs failed: ${r.olts_failed?.join(", ") || "none"}.`);
            } else {
                toast.success(`${username} â†’ ${r.position} (${r.binding_source} / ${r.confidence})${r.rx_power_dbm != null ? `, RX ${r.rx_power_dbm} dBm` : ""}`);
            }
            refresh();
        } catch (e: any) { toast.error(`Resolve failed: ${e.message}`); }
        finally { setResolving(null); }
    };

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const unmParams = new URLSearchParams({ limit: "2000" });
            if (unmReason) unmParams.set("reason", unmReason);
            if (unmOlt)    unmParams.set("olt_host", unmOlt);
            const unmUrl = `${API_URL}/engine/unmatched?${unmParams.toString()}`;

            const orphParams = new URLSearchParams({ limit: "1000" });
            if (orphanOlt) orphParams.set("olt_host", orphanOlt);
            const orphUrl = `${API_URL}/engine/orphans?${orphParams.toString()}`;

            const [s, r, c, u, o] = await Promise.all([
                fetch(`${API_URL}/engine/status`,           { headers: getAuthHeaders() }),
                fetch(`${API_URL}/engine/runs?limit=15`,    { headers: getAuthHeaders() }),
                fetch(`${API_URL}/engine/changes?limit=50`, { headers: getAuthHeaders() }),
                fetch(unmUrl,                               { headers: getAuthHeaders() }),
                fetch(orphUrl,                              { headers: getAuthHeaders() }),
            ]);
            if (handle401(s)) return;
            if (s.status === 404)  throw new Error("Backend missing /engine/* routes â€” restart backend.");
            if (!s.ok)             throw new Error(`status ${s.status}`);
            setStatus(await s.json());
            if (r.ok) setRuns(((await r.json())?.runs) || []);
            if (c.ok) setChanges(((await c.json())?.changes) || []);
            if (u.ok) {
                const j = await u.json();
                setUnmatched(j?.customers || []);
                setUnmByOlt(j?.by_olt || []);
            }
            if (o.ok) {
                const j = await o.json();
                setOrphans(j?.orphans || []);
            }
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { refresh(); const id = setInterval(refresh, 30_000); return () => clearInterval(id); }, [refresh, unmReason, unmOlt, orphanOlt]);

    const trigger = async () => {
        setReconciling(true);
        try {
            const res = await fetch(`${API_URL}/engine/reconcile`, { method: "POST", headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
            toast.success("Reconcile queued â€” runs in background.");
            setTimeout(refresh, 4000);
        } catch (e: any) { toast.error(e.message); }
        finally { setReconciling(false); }
    };

    const coverage = status ? (status.total ? Math.round(100 * status.resolved / status.total) : 0) : 0;

    return (
        <div className="flex min-h-screen bg-zinc-50">
            <MainSidebar />
            <main className="flex-1 p-6">
                <ErrorBoundary fallbackTitle="Engine monitor crashed">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h1 className="text-2xl font-bold">OLT Engine Monitor</h1>
                            <p className="text-sm text-zinc-500">
                                Tracks customer â†” ONU mapping across all OLTs. Powers every NOC / mobile / engine read.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                            </Button>
                            <Button size="sm" onClick={trigger} disabled={reconciling}>
                                <PlayCircle className={`h-4 w-4 mr-2 ${reconciling ? "animate-spin" : ""}`} /> Reconcile now
                            </Button>
                        </div>
                    </div>

                    {error && (
                        <Card className="mb-4 border-red-500 bg-red-50">
                            <CardContent className="pt-4 text-sm text-red-600 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" /> {error}
                            </CardContent>
                        </Card>
                    )}

                    {status && (<>
                        {/* Top counters â€” primary linked/unlinked */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            <StatCard title="Customers"        value={status.total}    icon={<Cpu className="h-6 w-6" />} />
                            <StatCard title="LINKED"           value={status.linked ?? status.resolved} sub={`${coverage}% of total`} icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />} />
                            <StatCard title="UNLINKED"         value={status.unlinked ?? status.no_olt_match} sub="see list below" icon={<AlertCircle className="h-6 w-6 text-red-500" />} />
                            <StatCard title="Fresh â‰¤20m"       value={status.freshly_verified ?? 0} sub={`live PON MAC walks confirm`} icon={<Activity className="h-6 w-6 text-blue-500" />} />
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            <StatCard title="Online now"       value={status.online_now} sub={`${status.offline_now ?? 0} offline`} icon={<Wifi className="h-6 w-6 text-emerald-500" />} />
                            <StatCard title="Dying gasp"       value={status.dying_gasp ?? 0} sub="immediate triage" icon={<AlertCircle className="h-6 w-6 text-red-700" />} />
                            <StatCard title="Last reconciled"  value={fmtAge(status.last_reconciled_at)} sub={status.last_reconciled_at?.slice(0, 19) || "â€”"} icon={<Clock className="h-6 w-6" />} />
                            <StatCard title="Held (offline)"   value={status.stale_pon_mac ?? 0} sub="preserved bindings" icon={<ShieldAlert className="h-6 w-6 text-yellow-500" />} />
                        </div>

                        {/* Link state + Why unlinked */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <Card>
                                <CardHeader className="pb-2"><CardTitle className="text-base">By link state</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> linked â€” fresh <span className="text-zinc-400">(OLT confirmed â‰¤20m ago)</span></span>
                                            <Badge className="bg-emerald-600 text-white">{status.freshly_verified ?? 0}</Badge>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3 text-yellow-500" /> linked â€” held <span className="text-zinc-400">(offline now, position preserved)</span></span>
                                            <Badge className="bg-yellow-500 text-white">{Math.max(0, (status.linked ?? 0) - (status.freshly_verified ?? 0))}</Badge>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-red-500" /> unlinked <span className="text-zinc-400">(needs action â€” see Why)</span></span>
                                            <Badge variant="destructive">{status.unlinked ?? 0}</Badge>
                                        </div>
                                        <div className="border-t mt-3 pt-3 text-xs text-zinc-500">
                                            Linked = stable customerâ†”device binding stored. Once linked, position only updates if the ONU's index actually changes on the OLT â€” never lost just because the customer goes offline briefly.
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileWarning className="h-4 w-4" /> Why unlinked ({status.unlinked ?? 0})</CardTitle></CardHeader>
                                <CardContent>
                                    {!status.unmatched_reasons || status.unmatched_reasons.length === 0 ? (
                                        <div className="text-sm text-zinc-500">No unlinked customers, or reason not computed yet.</div>
                                    ) : (
                                        <div className="space-y-2 text-sm">
                                            {status.unmatched_reasons.filter(r => r.unmatched_reason !== "held_offline").map(r => (
                                                <div key={r.unmatched_reason} className="flex justify-between gap-3">
                                                    <span className="text-xs">{REASON_LABEL[r.unmatched_reason] || r.unmatched_reason}</span>
                                                    <Badge variant="outline">{r.cnt}</Badge>
                                                </div>
                                            ))}
                                            {status.unmatched_reasons.every(r => r.unmatched_reason === "held_offline") && (
                                                <div className="text-sm text-emerald-600">No real gaps â€” only held-offline customers (counted as linked).</div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* By OLT â€” total ONUs / linked / held / orphans */}
                        <Card className="mb-4">
                            <CardHeader className="pb-2"><CardTitle className="text-base">By OLT â€” full detail</CardTitle></CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {(status.olts || []).map(o => {
                                        const oltUnmatched = unmByOlt.find(x => x.olt_host === o.olt_host);
                                        const unlinkedCount = oltUnmatched?.total ?? 0;
                                        const isActive = unmOlt === o.olt_host;
                                        return (
                                            <div key={o.olt_host} className={`border rounded-md p-3 ${o.walk_error || (o.pon_mac_count ?? 0) === 0 ? "border-red-300 bg-red-50/30" : ""} ${isActive ? "ring-2 ring-blue-500" : ""}`}>
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="text-sm font-semibold">{o.olt_host}</div>
                                                    {o.walk_error ? <Badge variant="destructive" title={o.walk_error}>walk error</Badge>
                                                      : (o.pon_mac_count ?? 0) === 0 ? <Badge variant="destructive">silent</Badge>
                                                      : <Badge className="bg-emerald-500 text-white">ok</Badge>}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                    <div>ONUs on OLT: <span className="font-mono">{o.pon_mac_count ?? "â€”"}</span></div>
                                                    <div>Linked to customer: <span className="font-mono text-emerald-600">{o.linked}</span></div>
                                                    <div>Fresh in 20m: <span className="font-mono text-blue-600">{o.fresh_in_20min}</span></div>
                                                    <div>Held (offline): <span className="font-mono text-yellow-600">{o.held_offline}</span></div>
                                                    <div>Optical readings: <span className="font-mono">{o.optical_count ?? "â€”"}</span></div>
                                                    <div>
                                                        Orphan ONUs:{" "}
                                                        <button
                                                            className={`font-mono px-1 rounded ${orphanOlt === o.olt_host ? "bg-orange-500 text-white" : "text-orange-600 hover:underline"}`}
                                                            onClick={() => setOrphanOlt(orphanOlt === o.olt_host ? "" : o.olt_host)}
                                                            title="MACs the OLT sees but no Railwire customer has"
                                                        >
                                                            {o.orphan_macs}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="text-xs text-zinc-400 mt-2 flex items-center justify-between">
                                                    <span>Total Customers: <span className="font-mono">{o.customers}</span></span>
                                                    <button
                                                        className={`text-xs px-2 py-0.5 rounded border ${isActive ? "bg-blue-500 text-white border-blue-500" : "border-zinc-300 hover:bg-zinc-100"}`}
                                                        onClick={() => setUnmOlt(isActive ? "" : o.olt_host)}
                                                    >
                                                        {unlinkedCount} unlinked {isActive ? "âœ“" : ""}
                                                    </button>
                                                </div>
                                                {o.walk_error && <div className="text-xs text-red-600 mt-1 break-words">{o.walk_error.slice(0, 200)}</div>}
                                            </div>
                                        );
                                    })}

                                    {/* "Unknown OLT" card for no_olt_match customers without any history */}
                                    {(() => {
                                        const noneRow = unmByOlt.find(x => x.olt_host === "__none__");
                                        if (!noneRow || noneRow.total === 0) return null;
                                        const isActive = unmOlt === "__none__";
                                        return (
                                            <div className={`border rounded-md p-3 border-zinc-300 bg-zinc-50 ${isActive ? "ring-2 ring-blue-500" : ""}`}>
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="text-sm font-semibold">Unknown OLT</div>
                                                    <Badge variant="outline">no history</Badge>
                                                </div>
                                                <div className="text-xs text-zinc-500">
                                                    Customers never seen on any OLT â€” likely no Railwire MAC OR MAC never learned.
                                                </div>
                                                <div className="text-xs text-zinc-400 mt-3 flex items-center justify-between">
                                                    <span>Total: <span className="font-mono">{noneRow.total}</span></span>
                                                    <button
                                                        className={`text-xs px-2 py-0.5 rounded border ${isActive ? "bg-blue-500 text-white border-blue-500" : "border-zinc-300 hover:bg-zinc-100"}`}
                                                        onClick={() => setUnmOlt(isActive ? "" : "__none__")}
                                                    >
                                                        {noneRow.total} unlinked {isActive ? "âœ“" : ""}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                                <div className="text-xs text-zinc-500 mt-3">
                                    <strong>Orphan MACs</strong> = MACs visible on the OLT but no Railwire customer owns that MAC.
                                    These are either (a) ONUs not yet provisioned in Railwire, (b) router/LAN MACs the OLT learned downstream, or (c) old MACs the OLT hasn't aged out.
                                </div>
                            </CardContent>
                        </Card>

                        {/* Orphan ONUs â€” devices visible on OLT but no Railwire customer */}
                        <Card className="mb-4">
                            <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
                                <div>
                                    <CardTitle className="text-base">Orphan ONUs ({orphans.length})</CardTitle>
                                    <div className="text-xs text-zinc-500">
                                        MACs the OLT sees but no Railwire customer claims them â€” devices on network without a billing account.
                                        {orphanOlt && <Badge variant="outline" className="ml-2 text-[10px]">OLT={orphanOlt}<button className="ml-1" onClick={() => setOrphanOlt("")}>Ã—</button></Badge>}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {orphans.length === 0 ? (
                                    <div className="text-sm text-zinc-500">No orphan ONUs (all OLT MACs match a Railwire customer).</div>
                                ) : (
                                    <div className="overflow-x-auto max-h-80 overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="sticky top-0 bg-white">
                                                <tr className="text-left text-zinc-500 border-b">
                                                    <th className="py-1 pr-3">OLT</th>
                                                    <th className="py-1 pr-3">port / idx</th>
                                                    <th className="py-1 pr-3">mac</th>
                                                    <th className="py-1 pr-3">status</th>
                                                    <th className="py-1 pr-3">rx (dBm)</th>
                                                    <th className="py-1 pr-3">tx (dBm)</th>
                                                    <th className="py-1 pr-3">first seen</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {orphans.map(o => (
                                                    <tr key={`${o.mac_address}-${o.olt_host}`} className="border-b last:border-0 hover:bg-zinc-50">
                                                        <td className="py-1 pr-3 font-mono">{o.olt_host}</td>
                                                        <td className="py-1 pr-3 font-mono">{o.pon_port}/{o.onu_index}</td>
                                                        <td className="py-1 pr-3 font-mono">{o.mac_address}</td>
                                                        <td className="py-1 pr-3">{o.status || "â€”"}</td>
                                                        <td className="py-1 pr-3 font-mono">{o.rx_power_dbm != null ? o.rx_power_dbm.toFixed(2) : "â€”"}</td>
                                                        <td className="py-1 pr-3 font-mono">{o.tx_power_dbm != null ? o.tx_power_dbm.toFixed(2) : "â€”"}</td>
                                                        <td className="py-1 pr-3 text-zinc-500">{fmtDateTime(o.first_seen_at)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Unmatched customer list â€” with phone + reason + per-OLT filter */}
                        <Card className="mb-4">
                            <CardHeader className="pb-2 flex flex-row items-center justify-between flex-wrap gap-2">
                                <div>
                                    <CardTitle className="text-base">Unmatched customers ({unmatched.length})</CardTitle>
                                    {(unmOlt || unmReason) && (
                                        <div className="text-xs text-zinc-500 mt-1">
                                            filtered by:
                                            {unmOlt && <Badge variant="outline" className="ml-1 text-[10px]">OLT={unmOlt === "__none__" ? "Unknown" : unmOlt}<button className="ml-1" onClick={() => setUnmOlt("")}>Ã—</button></Badge>}
                                            {unmReason && <Badge variant="outline" className="ml-1 text-[10px]">reason={unmReason}<button className="ml-1" onClick={() => setUnmReason("")}>Ã—</button></Badge>}
                                        </div>
                                    )}
                                </div>
                                <select
                                    className="text-xs border rounded p-1"
                                    value={unmReason}
                                    onChange={(e) => setUnmReason(e.target.value)}
                                >
                                    <option value="">All reasons</option>
                                    <option value="held_offline">held_offline (preserved)</option>
                                    <option value="not_in_olt_table">not_in_olt_table (real gap)</option>
                                    <option value="no_railwire_mac">no_railwire_mac (scraper gap)</option>
                                    <option value="mac_format_invalid">mac_format_invalid</option>
                                    <option value="position_no_optical">position_no_optical</option>
                                </select>
                            </CardHeader>
                            <CardContent>
                                {unmatched.length === 0 ? (
                                    <div className="text-sm text-zinc-500">No unmatched customers in this category.</div>
                                ) : (
                                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="sticky top-0 bg-white">
                                                <tr className="text-left text-zinc-500 border-b">
                                                    <th className="py-1 pr-3">username</th>
                                                    <th className="py-1 pr-3">name</th>
                                                    <th className="py-1 pr-3">phone</th>
                                                    <th className="py-1 pr-3">railwire mac</th>
                                                    <th className="py-1 pr-3">last known OLT pos</th>
                                                    <th className="py-1 pr-3">reason</th>
                                                    <th className="py-1 pr-3">last online</th>
                                                    <th className="py-1 pr-3"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {unmatched.map(u => (
                                                    <tr key={u.username} className="border-b last:border-0 hover:bg-zinc-50">
                                                        <td className="py-1 pr-3 font-mono">{u.username}</td>
                                                        <td className="py-1 pr-3">{[u.first_name, u.last_name].filter(Boolean).join(" ") || "â€”"}</td>
                                                        <td className="py-1 pr-3">{u.phone || "â€”"}</td>
                                                        <td className="py-1 pr-3 font-mono text-[10px]">{u.railwire_mac || "â€”"}</td>
                                                        <td className="py-1 pr-3 font-mono text-[10px] text-zinc-500">
                                                            {u.olt_host ? `${u.olt_host} ${u.pon_port}/${u.onu_index}` : "â€”"}
                                                        </td>
                                                        <td className="py-1 pr-3">
                                                            <Badge variant="outline" className={`text-[10px] ${u.binding_source === "stale_pon_mac" ? "bg-yellow-50" : ""}`}>
                                                                {u.unmatched_reason || "â€”"}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-1 pr-3 text-zinc-500">{fmtDateTime(u.last_seen_online)}</td>
                                                        <td className="py-1 pr-3">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                disabled={resolving === u.username}
                                                                onClick={() => resolveOne(u.username)}
                                                            >
                                                                {resolving === u.username
                                                                    ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Re-linkingâ€¦</>
                                                                    : <>Re-link</>}
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Recent runs */}
                        <Card className="mb-4">
                            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Recent reconcile runs ({runs.length})</CardTitle></CardHeader>
                            <CardContent>
                                {runs.length === 0 ? (
                                    <div className="text-sm text-zinc-500">No runs recorded yet. Click "Reconcile now" to fire one.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="text-left text-zinc-500 border-b">
                                                    <th className="py-1 pr-3">started</th>
                                                    <th className="py-1 pr-3">duration</th>
                                                    <th className="py-1 pr-3">ok</th>
                                                    <th className="py-1 pr-3">customers</th>
                                                    <th className="py-1 pr-3">resolved</th>
                                                    <th className="py-1 pr-3">unmatched</th>
                                                    <th className="py-1 pr-3">unified MAC</th>
                                                    <th className="py-1 pr-3">changes</th>
                                                    <th className="py-1 pr-3">.100 mac/opt</th>
                                                    <th className="py-1 pr-3">.200 mac/opt</th>
                                                    <th className="py-1 pr-3">.210 mac/opt</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {runs.map(r => (
                                                    <tr key={r.id} className="border-b last:border-0">
                                                        <td className="py-1 pr-3 font-mono">{r.started_at?.slice(0, 19)}</td>
                                                        <td className="py-1 pr-3">{r.duration_seconds != null ? `${r.duration_seconds}s` : "â€”"}</td>
                                                        <td className="py-1 pr-3">{r.ok ? <Badge className="bg-emerald-500 text-white">ok</Badge> : <Badge variant="destructive">err</Badge>}</td>
                                                        <td className="py-1 pr-3">{r.customers_total}</td>
                                                        <td className="py-1 pr-3 text-emerald-600">{r.customers_resolved}</td>
                                                        <td className="py-1 pr-3 text-red-600">{r.customers_unmatched}</td>
                                                        <td className="py-1 pr-3">{r.unified_mac_count}</td>
                                                        <td className="py-1 pr-3">{r.changes_count}</td>
                                                        <td className="py-1 pr-3">{r.olt_100_pon_mac ?? "â€”"}/{r.olt_100_optical ?? "â€”"}{r.olt_100_error && <span title={r.olt_100_error} className="text-red-500"> âš </span>}</td>
                                                        <td className="py-1 pr-3">{r.olt_200_pon_mac ?? "â€”"}/{r.olt_200_optical ?? "â€”"}{r.olt_200_error && <span title={r.olt_200_error} className="text-red-500"> âš </span>}</td>
                                                        <td className="py-1 pr-3">{r.olt_210_pon_mac ?? "â€”"}/{r.olt_210_optical ?? "â€”"}{r.olt_210_error && <span title={r.olt_210_error} className="text-red-500"> âš </span>}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Recent state changes */}
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><GitBranch className="h-4 w-4" /> Recent state changes ({changes.length})</CardTitle></CardHeader>
                            <CardContent>
                                {changes.length === 0 ? (
                                    <div className="text-sm text-zinc-500">No state changes recorded yet.</div>
                                ) : (
                                    <div className="space-y-1 text-xs max-h-96 overflow-y-auto">
                                        {changes.map(c => (
                                            <div key={c.id} className="flex items-center gap-3 py-1 border-b border-zinc-100 last:border-0">
                                                <span className={`inline-block w-2 h-2 rounded-full ${CHANGE_COLOR[c.change_type] || "bg-zinc-400"}`}></span>
                                                <span className="font-mono w-44 text-zinc-500">{fmtDateTime(c.occurred_at)}</span>
                                                <Badge variant="outline" className="text-[10px]">{c.change_type}</Badge>
                                                <span className="font-mono w-40">{c.username}</span>
                                                <span className="text-zinc-500">
                                                    {c.from_value || "â€”"} â†’ {c.to_value || "â€”"}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </>)}
                </ErrorBoundary>
            </main>
        </div>
    );
}
