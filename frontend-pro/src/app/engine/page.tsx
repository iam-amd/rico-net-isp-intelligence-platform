"use client";
/**
 * OLT Engine — Test page.
 * Type a customer name or username, get the full picture: Railwire profile,
 * binding, live ONT signal, alarms, tickets, predictions, PG context.
 * Backed by GET /noc/customers/{username}/dna (existing endpoint).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Search, RefreshCw, Wifi, WifiOff, AlertTriangle,
    User, Phone, MapPin, CheckCircle2, AlertCircle, Activity,
    Cpu, Radio, Clock, FileText, ShieldCheck, ShieldAlert, ShieldX,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LookupRow { username: string; display: string }

interface DNAResponse {
    customer: any;
    binding: any | null;
    onu: any | null;
    bandwidth?: any;
    prediction?: any | null;
    alarms?: any[];
    tickets?: any[];
    survey?: any | null;
    pg?: any | null;
    identity_conflicts?: any[];
    olt_capability?: any;
    open_ticket_count?: number;
    fault_type?: string | null;
    diagnosis?: any;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const signalColor = (rx: number | null | undefined): string => {
    if (rx == null) return "text-zinc-400";
    if (rx >= -20) return "text-emerald-500";
    if (rx >= -24) return "text-yellow-500";
    if (rx >= -27) return "text-orange-500";
    return "text-red-500";
};

const signalLabel = (rx: number | null | undefined): string => {
    if (rx == null) return "—";
    if (rx >= -20) return "Excellent";
    if (rx >= -24) return "Good";
    if (rx >= -27) return "Weak";
    return "Critical";
};

const linkStatusBadge = (link_status: string | null | undefined, last_verified_at: string | null | undefined) => {
    if (link_status === "linked") {
        const fresh = last_verified_at && (Date.now() - new Date(last_verified_at).getTime() < 20 * 60_000);
        if (fresh) return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />linked (fresh)</Badge>;
        return <Badge className="bg-yellow-600 hover:bg-yellow-600 text-white"><ShieldAlert className="h-3 w-3 mr-1" />linked (held)</Badge>;
    }
    if (link_status === "unlinked") return <Badge className="bg-red-600 hover:bg-red-600 text-white"><AlertCircle className="h-3 w-3 mr-1" />unlinked</Badge>;
    return <Badge variant="outline">unknown</Badge>;
};

// Legacy — kept until /noc/customers/{u}/dna stops returning confidence
const confidenceBadge = (c: string | null | undefined) => {
    if (c === "verified") return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white"><ShieldCheck className="h-3 w-3 mr-1" />verified</Badge>;
    if (c === "probable") return <Badge className="bg-yellow-600 hover:bg-yellow-600 text-white"><ShieldAlert className="h-3 w-3 mr-1" />probable</Badge>;
    if (c === "guess")    return <Badge className="bg-red-600    hover:bg-red-600    text-white"><ShieldX     className="h-3 w-3 mr-1" />guess</Badge>;
    return <Badge variant="outline">unknown</Badge>;
};

const fmt = (v: any) => v === null || v === undefined || v === "" ? "—" : String(v);

const fmtDate = (s: string | null | undefined): string => {
    if (!s) return "—";
    try { return new Date(s).toLocaleString(); } catch { return s; }
};

const ageString = (s: string | null | undefined): string => {
    if (!s) return "—";
    try {
        const ms = Date.now() - new Date(s).getTime();
        if (ms < 60_000)    return `${Math.round(ms / 1000)}s ago`;
        if (ms < 3600_000)  return `${Math.round(ms / 60_000)}m ago`;
        if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`;
        return `${Math.round(ms / 86400_000)}d ago`;
    } catch { return s; }
};

// ─── Subcomponents ───────────────────────────────────────────────────────────

const ageMs = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? Date.now() - t : null;
};

const isFreshPoll = (s: string | null | undefined): boolean => {
    const ms = ageMs(s);
    return ms !== null && ms <= 10 * 60_000;
};

const engineAsOnu = (engineDna: any | null) => {
    if (!engineDna?.optical_mac || !engineDna?.olt_host || engineDna?.onu_index === null || engineDna?.onu_index === undefined) return null;
    return {
        mac_address: engineDna.optical_mac,
        olt_host: engineDna.olt_host,
        pon_port: engineDna.pon_port,
        onu_index: engineDna.onu_index,
        status: engineDna.status,
        rx_power_dbm: engineDna.rx_power_dbm,
        tx_power_dbm: engineDna.tx_power_dbm,
        temperature_c: engineDna.temperature_c,
        voltage_mv: engineDna.voltage_mv,
        dying_gasp: engineDna.dying_gasp,
        polled_at: engineDna.polled_at,
        signal_level: engineDna.signal_label,
        from_engine_cache: true,
    };
};

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
    return (
        <div className="flex justify-between gap-3 py-1 border-b border-zinc-200/40 last:border-0">
            <span className="text-xs text-zinc-500">{label}</span>
            <span className={`text-sm text-right font-medium ${accent ? "text-blue-600 font-mono" : ""}`}>{value}</span>
        </div>
    );
}

function CustomerCard({ c }: { c: any }) {
    if (!c) return null;
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><User className="h-4 w-4" /> Customer</CardTitle></CardHeader>
            <CardContent>
                <Row label="Username"     value={<span className="font-mono">{c.username}</span>} />
                <Row label="Name"         value={fmt(c.name)} />
                <Row label="Phone"        value={fmt(c.phone)} />
                <Row label="Alt phone"    value={fmt(c.alt_phone)} />
                <Row label="Email"        value={fmt(c.email)} />
                <Row label="Plan"         value={fmt(c.plan_name)} />
                <Row label="Expiry"       value={fmtDate(c.expiry_date)} />
                <Row label="Balance"      value={c.balance != null ? `₹ ${c.balance.toFixed(2)}` : "—"} />
                <Row label="Status"       value={<Badge variant={c.status === "Active" ? "default" : "secondary"}>{fmt(c.status)}</Badge>} />
                <Row label="Framed IP"    value={<span className="font-mono">{fmt(c.framed_ip)}</span>} />
                <Row label="Railwire MAC" value={<span className="font-mono">{fmt(c.mac_address)}</span>} accent />
                <Row label="Router MAC"   value={<span className="font-mono">{fmt(c.router_mac_address)}</span>} />
                <Row label="ONT serial"   value={<span className="font-mono">{fmt(c.ont_serial_number)}</span>} />
                <Row label="ONT model"    value={fmt(c.ont_model)} />
                <Row label="Address"      value={<span className="text-xs">{fmt(c.railwire_address)}</span>} />
                <Row label="GPS"          value={c.gps_lat != null && c.gps_lng != null
                    ? <a className="text-blue-500 underline" href={`https://maps.google.com/?q=${c.gps_lat},${c.gps_lng}`} target="_blank" rel="noreferrer">{c.gps_lat.toFixed(5)}, {c.gps_lng.toFixed(5)}</a>
                    : "—"} />
                <Row label="Last surveyed" value={fmtDate(c.last_surveyed_at)} />
            </CardContent>
        </Card>
    );
}

function BindingCard({ b }: { b: any | null }) {
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><Cpu className="h-4 w-4" /> ONU Binding</CardTitle></CardHeader>
            <CardContent>
                {!b ? <div className="text-sm text-red-500">No active binding for this customer.</div> : (<>
                    <Row label="Binding ID"      value={b.id} />
                    <Row label="Source"          value={<Badge variant="outline">{fmt(b.binding_source)}</Badge>} />
                    <Row label="Identity (used)" value={<span className="font-mono">{fmt(b.onu_identifier)}</span>} accent />
                    <Row label="MAC col"         value={<span className="font-mono">{fmt(b.mac_address)}</span>} />
                    <Row label="Serial col"      value={<span className="font-mono">{fmt(b.serial_number)}</span>} />
                    <Row label="ONU type"        value={fmt(b.onu_type)} />
                    <Row label="OLT host"        value={<span className="font-mono">{fmt(b.olt_host)}</span>} />
                    <Row label="PON port"        value={<span className="font-mono">{fmt(b.pon_port)}</span>} />
                    <Row label="ONU index"       value={<span className="font-mono">{fmt(b.onu_index)}</span>} />
                    <Row label="Verified at"     value={fmtDate(b.verified_at)} />
                    <Row label="First seen"      value={fmtDate(b.first_seen)} />
                    <Row label="Last seen"       value={fmtDate(b.last_seen)} />
                </>)}
            </CardContent>
        </Card>
    );
}

function LiveOnuCard({ onu, bandwidth, conflicts }: { onu: any | null; bandwidth: any; conflicts: any[] | undefined }) {
    const rx = onu?.rx_power_dbm;
    const stale = !!onu && (onu.stale || onu.from_engine_cache || !isFreshPoll(onu.polled_at));
    const statusLabel = stale ? `last known ${fmt(onu?.status)}` : fmt(onu?.status);
    return (
        <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2"><Radio className="h-4 w-4" /> {stale ? "Last-Known ONT" : "Live ONT"}</CardTitle>
                {onu && <Badge variant={stale ? "outline" : onu.status === "online" ? "default" : "destructive"}>
                    {!stale && onu.status === "online" ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
                    {statusLabel}
                </Badge>}
            </CardHeader>
            <CardContent>
                {!onu ? <div className="text-sm text-zinc-500">No live ONT data for this customer.</div> : (<>
                    {stale && (
                        <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                            No fresh OLT sample for this verified ONT. Values below are historical only; do not use them for dispatch or closure.
                        </div>
                    )}
                    <div className="flex items-center gap-4 mb-3 mt-1">
                        <div className={`text-3xl font-bold ${stale ? "text-zinc-400" : signalColor(rx)}`}>{rx != null ? `${rx.toFixed(2)} dBm` : "—"}</div>
                        <div className={`text-sm ${stale ? "text-zinc-400" : signalColor(rx)}`}>{stale ? "historical" : signalLabel(rx)}</div>
                    </div>
                    <Row label="ONU MAC (auth)" value={<span className="font-mono">{fmt(onu.mac_address)}</span>} accent />
                    <Row label="Position"       value={<span className="font-mono">{fmt(onu.olt_host)} / {fmt(onu.pon_port)} / idx {fmt(onu.onu_index)}</span>} />
                    <Row label="Rx power"       value={onu.rx_power_dbm != null ? `${onu.rx_power_dbm.toFixed(2)} dBm` : "—"} />
                    <Row label="Tx power"       value={onu.tx_power_dbm != null ? `${onu.tx_power_dbm.toFixed(2)} dBm` : "—"} />
                    <Row label="Temperature"    value={onu.temperature_c != null ? `${onu.temperature_c.toFixed(1)} °C` : "—"} />
                    <Row label="Voltage"        value={onu.voltage_mv != null ? `${(onu.voltage_mv / 1000).toFixed(2)} V` : "—"} />
                    <Row label="Dying gasp"     value={onu.dying_gasp ? <Badge variant="destructive">YES</Badge> : <span className="text-zinc-500">no</span>} />
                    <Row label="Vendor / model" value={`${fmt(onu.vendor_id)} / ${fmt(onu.model_id)}`} />
                    <Row label="HW / SW"        value={`${fmt(onu.hw_version)} / ${fmt(onu.sw_version)}`} />
                    <Row label="Alive"          value={onu.alive_time_sec != null ? `${Math.round(onu.alive_time_sec / 3600)} h` : "—"} />
                    <Row label="Polled"         value={`${fmtDate(onu.polled_at)} (${ageString(onu.polled_at)})`} />

                    {onu.from_engine_cache && (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                            Engine cache is displayed as a clue only. Verified ONT binding remains the customer identity source.
                        </div>
                    )}

                    {bandwidth && bandwidth.supported && bandwidth.source_status === "ok" && (
                        <>
                            <div className="text-xs text-zinc-500 mt-3 mb-1">Live bandwidth</div>
                            <Row label="Rx (down)" value={bandwidth.rx_mbps != null ? `${bandwidth.rx_mbps.toFixed(1)} Mbps` : "—"} />
                            <Row label="Tx (up)"   value={bandwidth.tx_mbps != null ? `${bandwidth.tx_mbps.toFixed(1)} Mbps` : "—"} />
                        </>
                    )}

                    {conflicts && conflicts.length > 0 && (
                        <div className="mt-3 p-2 border border-yellow-500/30 bg-yellow-50 rounded text-xs text-yellow-700">
                            <div className="font-medium flex items-center gap-1 mb-1"><AlertTriangle className="h-3 w-3" />{conflicts.length} identity conflict(s):</div>
                            <ul className="list-disc pl-4">{conflicts.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
                        </div>
                    )}
                </>)}
            </CardContent>
        </Card>
    );
}

function PredictionCard({ p, diagnosis }: { p: any; diagnosis: any }) {
    if (!p && !diagnosis) return null;
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><Activity className="h-4 w-4" /> Health & Diagnosis</CardTitle></CardHeader>
            <CardContent>
                {diagnosis && diagnosis.fault_type && (<>
                    <Row label="Fault"      value={<Badge variant="destructive">{fmt(diagnosis.fault_type)}</Badge>} />
                    <Row label="Label"      value={fmt(diagnosis.label)} />
                    <Row label="Action"     value={<span className="text-xs">{fmt(diagnosis.action)}</span>} />
                </>)}
                {p && (<>
                    <Row label="Health score"       value={p.health_score != null ? `${p.health_score} / 100` : "—"} />
                    <Row label="Fiber risk"         value={fmt(p.fiber_risk)} />
                    <Row label="Churn risk"         value={fmt(p.churn_risk)} />
                    <Row label="Rx slope (7d)"      value={p.rx_slope_7d != null ? p.rx_slope_7d.toFixed(3) : "—"} />
                    <Row label="Rx avg (7d)"        value={p.rx_avg_7d != null ? `${p.rx_avg_7d.toFixed(2)} dBm` : "—"} />
                    <Row label="Recommended"        value={<span className="text-xs">{fmt(p.recommended_action)}</span>} />
                    <Row label="Computed"           value={fmtDate(p.last_computed)} />
                </>)}
            </CardContent>
        </Card>
    );
}

function AlarmsCard({ alarms }: { alarms: any[] | undefined }) {
    if (!alarms || alarms.length === 0) return (
        <Card><CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Recent Alarms (24h)</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-emerald-600 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> No alarms.</div></CardContent></Card>
    );
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Recent Alarms ({alarms.length})</CardTitle></CardHeader>
            <CardContent>
                <div className="space-y-2">
                    {alarms.slice(0, 8).map((a) => (
                        <div key={a.id} className="text-xs border-l-2 border-orange-500 pl-2">
                            <div className="flex justify-between">
                                <span className="font-medium">{a.event_type}</span>
                                <Badge variant="outline" className="text-[10px]">{a.status}</Badge>
                            </div>
                            <div className="text-zinc-500">{fmtDate(a.received_at)} — {ageString(a.received_at)}</div>
                            <div className="font-mono text-[11px]">{a.olt_host} / {a.pon_port} / idx {a.onu_index}</div>
                            {a.occurrence_count > 1 && <div className="text-orange-500">×{a.occurrence_count} occurrences</div>}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function TicketsCard({ tickets, openCount }: { tickets: any[] | undefined; openCount: number | undefined }) {
    if (!tickets || tickets.length === 0) return (
        <Card><CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><FileText className="h-4 w-4" /> Tickets</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-zinc-500">No tickets.</div></CardContent></Card>
    );
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><FileText className="h-4 w-4" /> Tickets ({openCount || 0} open / {tickets.length} shown)</CardTitle></CardHeader>
            <CardContent>
                <div className="space-y-2">
                    {tickets.slice(0, 6).map((t) => (
                        <div key={t.id} className="text-xs">
                            <div className="flex justify-between">
                                <span className="font-medium">#{t.id} — {t.issue_type}</span>
                                <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                            </div>
                            <div className="text-zinc-500">{fmtDate(t.created_at)} — {t.priority} — {fmt(t.assigned_tech)}</div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function PgCard({ pg }: { pg: any | null }) {
    if (!pg) return null;
    return (
        <Card>
            <CardHeader className="pb-2"><CardTitle className="text-lg flex items-center gap-2"><MapPin className="h-4 w-4" /> PG / Building</CardTitle></CardHeader>
            <CardContent>
                <Row label="Building"      value={`${fmt(pg.building_name)} (${fmt(pg.building_type)})`} />
                <Row label="Floor / Room"  value={`F${fmt(pg.floor_number)} / R${fmt(pg.room_number)}`} />
                <Row label="Status"        value={fmt(pg.room_status)} />
                <Row label="Connection"    value={fmt(pg.connection_type)} />
                <Row label="Router group"  value={fmt(pg.router_group_name)} />
                <Row label="ONT serial"    value={<span className="font-mono">{fmt(pg.room_ont_serial)}</span>} />
                <Row label="MAC"           value={<span className="font-mono">{fmt(pg.room_mac_address)}</span>} />
                <Row label="Collected"     value={fmtDate(pg.collected_at)} />
            </CardContent>
        </Card>
    );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function EnginePage() {
    const [query, setQuery]       = useState("");
    const [matches, setMatches]   = useState<LookupRow[]>([]);
    const [allRows, setAllRows]   = useState<LookupRow[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [dna, setDna]           = useState<DNAResponse | null>(null);
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Load full lookup list once
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_URL}/customers/lookup`, { headers: getAuthHeaders() });
                if (handle401(res)) return;
                if (!res.ok) throw new Error(`lookup ${res.status}`);
                const data = await res.json();
                setAllRows(Array.isArray(data) ? data : []);
            } catch (e: any) { setError(e.message); }
        })();
    }, []);

    // Filter as user types
    useEffect(() => {
        const q = query.trim().toLowerCase();
        if (!q) { setMatches([]); return; }
        const hit = allRows.filter(r =>
            r.username.toLowerCase().includes(q) ||
            r.display.toLowerCase().includes(q)
        ).slice(0, 12);
        setMatches(hit);
    }, [query, allRows]);

    const [engineDna, setEngineDna] = useState<any | null>(null);

    const loadCustomer = async (username: string) => {
        setSelected(username);
        setLoading(true);
        setError(null);
        setMatches([]);
        try {
            // Pull the rich NOC view AND the engine-authoritative view in parallel.
            const [nocRes, engRes] = await Promise.all([
                fetch(`${API_URL}/noc/customers/${encodeURIComponent(username)}/dna`,    { headers: getAuthHeaders() }),
                fetch(`${API_URL}/engine/customer/${encodeURIComponent(username)}/dna`,  { headers: getAuthHeaders() }),
            ]);
            if (handle401(nocRes)) return;
            if (!nocRes.ok) throw new Error(`${nocRes.status}: ${(await nocRes.text()).slice(0, 200)}`);
            setDna(await nocRes.json());
            if (engRes.ok) {
                const e = await engRes.json();
                setEngineDna(e?.dna || null);
            } else {
                setEngineDna(null);
            }
        } catch (e: any) { setError(e.message); setDna(null); setEngineDna(null); }
        finally { setLoading(false); }
    };

    const refresh = () => selected && loadCustomer(selected);

    const refreshLive = async () => {
        if (!selected) return;
        try {
            const res = await fetch(`${API_URL}/engine/customer/${encodeURIComponent(selected)}/live`, { headers: getAuthHeaders() });
            if (res.status === 404) {
                let detail = "Customer has no bound ONU yet — wait for next reconcile cycle or check Engine Monitor.";
                try { const j = await res.json(); detail = j?.detail || detail; } catch {}
                alert(detail);
                return;
            }
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`${res.status}: ${txt.slice(0, 200)}`);
            }
            const live = await res.json();
            alert(`Live SNMP refresh:\nRX: ${live.rx_power_dbm} dBm\nTX: ${live.tx_power_dbm} dBm\nStatus: ${live.status}\nPolled: ${live.polled_at}`);
            refresh();
        } catch (e: any) {
            alert(`Live refresh failed: ${e.message}`);
        }
    };

    const c = dna?.customer;
    const onu = dna?.onu || null;
    const bindingIds = new Set(
        [dna?.binding?.onu_identifier, dna?.binding?.mac_address, dna?.binding?.serial_number]
            .filter(Boolean)
            .map((v) => String(v).toUpperCase())
    );
    const engineOptical = engineDna?.optical_mac ? String(engineDna.optical_mac).toUpperCase() : null;
    const engineMatchesBinding = !!engineOptical && bindingIds.has(engineOptical);
    const engineFresh = isFreshPoll(engineDna?.polled_at);
    const engineAuthoritative = engineMatchesBinding && engineFresh;

    return (
        <div className="flex min-h-screen bg-zinc-50">
            <MainSidebar />
            <main className="flex-1 p-6">
                <ErrorBoundary fallbackTitle="Engine page crashed">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold">OLT Engine — Customer Lookup</h1>
                            <p className="text-sm text-zinc-500">Type a customer name or username. See everything we know plus live ONT signal.</p>
                        </div>
                        {selected && (
                            <div className="flex gap-2">
                                <Button onClick={refresh} disabled={loading} variant="outline" size="sm">
                                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
                                </Button>
                                <Button onClick={refreshLive} disabled={loading} size="sm">
                                    <Radio className="h-4 w-4 mr-2" /> Live SNMP
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Search */}
                    <Card className="mb-4">
                        <CardContent className="pt-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                                <Input
                                    ref={inputRef}
                                    className="pl-9"
                                    placeholder="Type name, username or phone… (e.g. bagrudeen)"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && matches.length > 0) {
                                            loadCustomer(matches[0].username);
                                            setQuery(matches[0].display);
                                        }
                                    }}
                                />
                            </div>
                            {matches.length > 0 && (
                                <div className="mt-2 border rounded-md max-h-64 overflow-y-auto bg-white">
                                    {matches.map(m => (
                                        <div
                                            key={m.username}
                                            className="px-3 py-2 text-sm hover:bg-zinc-100 cursor-pointer border-b last:border-0"
                                            onClick={() => { loadCustomer(m.username); setQuery(m.display); }}>
                                            <div className="font-mono text-xs text-zinc-500">{m.username}</div>
                                            <div>{m.display}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="text-xs text-zinc-400 mt-2">{allRows.length} customers loaded · click a result or press Enter to load the first match</div>
                        </CardContent>
                    </Card>

                    {error && (
                        <Card className="mb-4 border-red-500 bg-red-50">
                            <CardContent className="pt-4 text-sm text-red-600 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" /> {error}
                            </CardContent>
                        </Card>
                    )}

                    {loading && <div className="text-sm text-zinc-500">Loading…</div>}

                    {engineDna && !loading && (
                        <Card className={`mb-4 ${engineAuthoritative ? "border-blue-300 bg-blue-50/30" : "border-amber-300 bg-amber-50/40"}`}>
                            <CardContent className="pt-4 text-sm flex flex-wrap gap-3 items-center">
                                <span className="font-semibold">{engineAuthoritative ? "OLT Engine view:" : "OLT Engine cache/clue:"}</span>
                                {engineAuthoritative ? linkStatusBadge(engineDna.link_status, engineDna.last_verified_at) : (
                                    <Badge variant="outline" className="border-amber-400 text-amber-700">not customer truth</Badge>
                                )}
                                {engineDna.last_verified_at && (
                                    <span className="text-xs text-zinc-500">
                                        last verified {ageString(engineDna.last_verified_at)}
                                    </span>
                                )}
                                {engineDna.optical_mac && <span className="font-mono text-xs">optical MAC: {engineDna.optical_mac}</span>}
                                {engineDna.olt_host && <span className="font-mono text-xs">@ {engineDna.olt_host} {engineDna.pon_port}/{engineDna.onu_index}</span>}
                                {engineDna.polled_at && <span className="font-mono text-xs">polled {ageString(engineDna.polled_at)}</span>}
                                {!engineMatchesBinding && (
                                    <Badge variant="outline" className="border-amber-400 text-amber-700">differs from verified binding</Badge>
                                )}
                                {!engineFresh && (
                                    <Badge variant="outline" className="border-red-400 text-red-700">stale cache</Badge>
                                )}
                                {engineDna.railwire_to_optical_offset !== null && engineDna.railwire_to_optical_offset !== undefined && (
                                    <Badge variant="outline">offset: {engineDna.railwire_to_optical_offset > 0 ? "+" : ""}{engineDna.railwire_to_optical_offset}</Badge>
                                )}
                                {engineDna.signal_label && <Badge variant="outline">signal: {engineDna.signal_label}</Badge>}
                                {engineDna.fault_type && <Badge variant="destructive">{engineDna.fault_type}</Badge>}
                            </CardContent>
                        </Card>
                    )}

                    {dna && !loading && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <CustomerCard c={c} />
                            <BindingCard b={dna.binding} />
                            <LiveOnuCard onu={onu} bandwidth={dna.bandwidth} conflicts={dna.identity_conflicts} />
                            <PredictionCard p={dna.prediction} diagnosis={dna.diagnosis} />
                            <AlarmsCard alarms={dna.alarms} />
                            <TicketsCard tickets={dna.tickets} openCount={dna.open_ticket_count} />
                            <PgCard pg={dna.pg} />
                        </div>
                    )}
                </ErrorBoundary>
            </main>
        </div>
    );
}
