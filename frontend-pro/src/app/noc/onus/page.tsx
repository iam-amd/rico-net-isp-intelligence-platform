"use client";
/**
 * NOC — ONU Inventory
 * ====================
 * Paginated, filterable table of all ONUs.
 * Filters: status, pon_port, olt_host, signal_max, search, linked
 */
import React, { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ArrowLeft, ArrowRight, Search, Filter } from "lucide-react";

interface ONUListItem {
    mac_address: string;
    olt_host: string;
    pon_port: string | null;
    status: string | null;
    rx_power_dbm: number | null;
    tx_power_dbm: number | null;
    dying_gasp: boolean;
    polled_at: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_plan: string | null;
}

function rxLabel(rx: number | null): { text: string; cls: string } {
    if (rx == null) return { text: "N/A", cls: "text-gray-400" };
    if (rx >= -20) return { text: `${rx.toFixed(1)} dBm`, cls: "text-green-600 font-semibold" };
    if (rx >= -24) return { text: `${rx.toFixed(1)} dBm`, cls: "text-yellow-600 font-semibold" };
    if (rx >= -27) return { text: `${rx.toFixed(1)} dBm`, cls: "text-orange-600 font-semibold" };
    return { text: `${rx.toFixed(1)} dBm`, cls: "text-red-600 font-bold" };
}

function timeAgo(iso: string | null) {
    if (!iso) return "—";
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.round(secs / 60)}m`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h`;
    return `${Math.round(secs / 86400)}d`;
}

function ONUListContent() {
    const searchParams = useSearchParams();
    const [items, setItems] = useState<ONUListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
    const [portFilter, setPortFilter] = useState(searchParams.get("pon_port") || "");
    const [oltFilter, setOltFilter] = useState(searchParams.get("olt_host") || "");
    const [linkedFilter, setLinkedFilter] = useState("");

    const PAGE_SIZE = 50;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                page_size: String(PAGE_SIZE),
            });
            if (search) params.set("search", search);
            if (statusFilter) params.set("status", statusFilter);
            if (portFilter) params.set("pon_port", portFilter);
            if (oltFilter) params.set("olt_host", oltFilter);
            if (linkedFilter) params.set("linked", linkedFilter);

            const res = await fetch(`${API_URL}/noc/onus?${params}`, { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (res.ok) {
                const data = await res.json();
                setItems(data.onus || []);
                setTotal(data.total || 0);
            }
        } catch (e) {
            console.error("[ONUList]", e);
        } finally {
            setLoading(false);
        }
    }, [page, search, statusFilter, portFilter, oltFilter, linkedFilter]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [search, statusFilter, portFilter, oltFilter, linkedFilter]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <ErrorBoundary fallbackTitle="ONU list failed to load">
        <div className="flex h-screen bg-[#F4F5F7] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 px-6 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <Link href="/noc" className="text-gray-400 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></Link>
                        <h1 className="text-xl font-bold text-gray-900">ONU Inventory</h1>
                        <Badge variant="outline" className="text-xs">{total.toLocaleString()} ONUs</Badge>
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </header>

                {/* Filter bar */}
                <div className="bg-white border-b border-gray-200 px-6 py-3 flex flex-wrap gap-3 items-center flex-shrink-0">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search MAC / customer..."
                            className="pl-8 h-8 text-sm"
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") setSearch(searchInput); }}
                        />
                    </div>
                    <select className="text-sm border border-gray-200 rounded-md px-3 h-8 bg-white"
                        value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="">All Status</option>
                        <option value="online">Online</option>
                        <option value="offline">Offline</option>
                    </select>
                    <select className="text-sm border border-gray-200 rounded-md px-3 h-8 bg-white"
                        value={linkedFilter} onChange={e => setLinkedFilter(e.target.value)}>
                        <option value="">All ONUs</option>
                        <option value="linked">Linked to customer</option>
                        <option value="unlinked">Unlinked</option>
                    </select>
                    {portFilter && (
                        <Badge variant="outline" className="text-xs gap-1">
                            Port {portFilter}
                            <button onClick={() => setPortFilter("")} className="ml-1 text-gray-400 hover:text-gray-700">×</button>
                        </Badge>
                    )}
                    {oltFilter && (
                        <Badge variant="outline" className="text-xs gap-1">
                            OLT {oltFilter}
                            <button onClick={() => setOltFilter("")} className="ml-1 text-gray-400 hover:text-gray-700">×</button>
                        </Badge>
                    )}
                    <Button size="sm" variant="ghost" className="text-xs text-gray-500" onClick={() => {
                        setSearch(""); setSearchInput(""); setStatusFilter(""); setPortFilter(""); setOltFilter(""); setLinkedFilter("");
                    }}>
                        <Filter className="h-3 w-3 mr-1" /> Clear
                    </Button>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-white border-b border-gray-200 sticky top-0">
                            <tr>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">MAC Address</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Port</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Rx Power</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Polled</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading && items.length === 0 && Array(15).fill(0).map((_, i) => (
                                <tr key={i} className="bg-white">
                                    {Array(8).fill(0).map((_, j) => (
                                        <td key={j} className="px-4 py-3">
                                            <div className="h-4 bg-gray-200 rounded animate-pulse" />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {items.map(onu => {
                                const rx = rxLabel(onu.rx_power_dbm);
                                const isOnline = onu.status === "online";
                                return (
                                    <tr key={onu.mac_address} className="bg-white hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className={`h-2 w-2 rounded-full ${onu.dying_gasp ? "bg-purple-500" : isOnline ? "bg-green-500" : "bg-red-500"}`} />
                                                <span className={`text-xs font-medium ${onu.dying_gasp ? "text-purple-600" : isOnline ? "text-green-600" : "text-red-600"}`}>
                                                    {onu.dying_gasp ? "Dying" : isOnline ? "Online" : "Offline"}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{onu.mac_address}</td>
                                        <td className="px-4 py-3 text-xs text-gray-500">
                                            {onu.pon_port || "—"}
                                            <div className="text-gray-400">{onu.olt_host}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={rx.cls}>{rx.text}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {onu.customer_name ? (
                                                <>
                                                    <div className="text-sm text-gray-800 font-medium">{onu.customer_name}</div>
                                                    {onu.customer_phone && <div className="text-xs text-gray-500">{onu.customer_phone}</div>}
                                                </>
                                            ) : (
                                                <span className="text-xs text-gray-400 italic">Unlinked</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{onu.customer_plan || "—"}</td>
                                        <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(onu.polled_at)}</td>
                                        <td className="px-4 py-3">
                                            <Link href={`/noc/onus/${encodeURIComponent(onu.mac_address)}`}
                                                className="text-xs text-blue-600 hover:underline">
                                                Detail →
                                            </Link>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {!loading && items.length === 0 && (
                        <div className="text-center p-12 text-gray-500">No ONUs found matching filters</div>
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
                        <span className="text-sm text-gray-500">
                            Page {page} of {totalPages} · {total} total
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

export default function ONUListPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
            <ONUListContent />
        </Suspense>
    );
}
