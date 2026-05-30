"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import {
    Building2, MapPin, User, Phone, Search, RefreshCw,
    ChevronRight, AlertCircle, CheckCircle2, Clock, Home,
    Wifi, WifiOff, Hash,
} from "lucide-react";
import { toast } from "sonner";

interface PGBuilding {
    id: string; name: string; pg_type: "Ladies" | "Gents" | "Mixed";
    address?: string; owner_name?: string; owner_mobile?: string;
    gps_lat?: number; gps_lng?: number; photo_url?: string;
    total_floors: number; total_rooms: number; done_rooms: number; pending_rooms: number;
    created_at: string;
}

const resolveUploadUrl = (url?: string | null) =>
    url ? (url.startsWith("/") ? `${API_URL}${url}` : url) : "";

const PG_TYPE_COLORS: Record<string, string> = {
    Ladies: "bg-pink-100 text-pink-800 border border-pink-300",
    Gents:  "bg-blue-100 text-blue-800 border border-blue-300",
    Mixed:  "bg-purple-100 text-purple-800 border border-purple-300",
};

function CompletionBar({ done, total }: { done: number; total: number }) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const color = pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
    return (
        <div className="mt-2">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                <span>{done}/{total} rooms collected</span>
                <span className="font-bold">{pct}%</span>
            </div>
            <div className="h-1.5 bg-[#0f172a] rounded-full overflow-hidden">
                <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

export default function PGListPage() {
    const [buildings, setBuildings] = useState<PGBuilding[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");

    const fetchBuildings = useCallback(async (q?: string) => {
        setLoading(true); setError(null);
        const targetUrl = `${API_URL}/pg/buildings`;
        try {
            const url = new URL(targetUrl);
            if (q?.trim()) url.searchParams.set("search", q.trim());
            const res = await fetch(url.toString(), { headers: getAuthHeaders() });
            if (res.status === 401) { window.location.href = "/login"; return; }
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            setBuildings(await res.json());
        } catch (e: any) {
            let msg: string;
            if (e?.message === "Failed to fetch" || e instanceof TypeError) {
                msg = `Cannot reach backend at ${targetUrl}\n\nThe server is not responding. Start it with:\ncd backend && uvicorn main:app --reload`;
            } else if (e?.message?.match(/^HTTP 5/)) {
                msg = `Backend server error (${e.message}). Check backend logs for details.`;
            } else {
                msg = e?.message ?? "Failed to load buildings";
            }
            setError(msg);
            toast.error("Could not load PG buildings");
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchBuildings(); }, [fetchBuildings]);

    const totalRooms = buildings.reduce((s, b) => s + b.total_rooms, 0);
    const totalDone  = buildings.reduce((s, b) => s + b.done_rooms, 0);
    const overallPct = totalRooms === 0 ? 0 : Math.round((totalDone / totalRooms) * 100);

    return (
        <div className="flex h-screen bg-[#0f1523] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 max-w-[1400px] mx-auto">

                    {/* Page header */}
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-3">
                                <Building2 className="text-orange-500" size={22} />
                                <h1 className="text-2xl font-black tracking-widest text-orange-500 uppercase">PG Properties</h1>
                            </div>
                            <p className="text-slate-500 text-sm font-semibold tracking-wide mt-1">
                                Paying Guest building survey · {buildings.length} properties enrolled
                            </p>
                        </div>
                        <button
                            onClick={() => fetchBuildings(search)}
                            className="flex items-center gap-2 bg-[#16203d] border-2 border-[#1e293b] text-slate-400 hover:text-orange-400 px-4 py-2 text-xs font-bold tracking-widest uppercase"
                            style={{ boxShadow: "3px 3px 0 #0f172a" }}
                        >
                            <RefreshCw size={13} />
                            REFRESH
                        </button>
                    </div>

                    {/* Summary row */}
                    {buildings.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            {[
                                { label: "BUILDINGS",   value: buildings.length,  color: "text-orange-400" },
                                { label: "TOTAL ROOMS", value: totalRooms,        color: "text-blue-400" },
                                { label: "COLLECTED",   value: totalDone,         color: "text-green-400" },
                                { label: "COMPLETION",  value: `${overallPct}%`,  color: "text-amber-400" },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="bg-[#16203d] border-2 border-[#1e293b] p-4"
                                    style={{ boxShadow: "4px 4px 0 #0f172a" }}>
                                    <p className={`text-2xl font-black ${color}`}>{value}</p>
                                    <p className="text-slate-500 text-[10px] font-bold tracking-widest mt-1 uppercase">{label}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Search */}
                    <form onSubmit={e => { e.preventDefault(); fetchBuildings(search); }} className="flex gap-3 mb-6">
                        <div className="flex-1 flex items-center gap-2 bg-[#16203d] border-2 border-[#1e293b] px-4 py-2">
                            <Search size={16} className="text-slate-500" />
                            <input
                                className="flex-1 bg-transparent text-white text-sm font-semibold placeholder:text-slate-600 outline-none"
                                placeholder="Search by name, owner, address..."
                                value={search} onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                        <button type="submit"
                            className="bg-orange-500 text-black font-black px-5 text-sm tracking-widest uppercase border-2 border-[#0f172a]"
                            style={{ boxShadow: "3px 3px 0 #0f172a" }}>
                            SEARCH
                        </button>
                        <button type="button" onClick={() => { setSearch(""); fetchBuildings(); }}
                            className="bg-[#16203d] text-slate-400 border-2 border-[#1e293b] p-2 hover:text-white" title="Refresh">
                            <RefreshCw size={16} />
                        </button>
                    </form>

                    {/* Error */}
                    {error && (
                        <div className={`border-2 px-4 py-3 mb-6 ${
                            error.includes("Cannot reach")
                                ? "bg-amber-900/20 border-amber-600 text-amber-300"
                                : "bg-red-900/30 border-red-700 text-red-300"
                        }`}>
                            <div className="flex items-start gap-3">
                                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    {error.includes("Cannot reach") ? (
                                        <>
                                            <p className="text-sm font-bold tracking-wide">Backend server unreachable</p>
                                            <p className="text-xs font-mono mt-1 text-amber-400 break-all">
                                                {error.split("\n\n")[0].replace("Cannot reach backend at ", "")}
                                            </p>
                                            <p className="text-xs mt-2 text-amber-300/80">
                                                Fix: open a terminal and run{" "}
                                                <code className="bg-black/40 px-1.5 py-0.5 text-amber-200 font-mono">
                                                    cd backend &amp;&amp; uvicorn main:app --reload
                                                </code>
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-sm font-semibold whitespace-pre-line">{error}</p>
                                    )}
                                </div>
                                <button onClick={() => fetchBuildings()} className="ml-auto text-xs underline flex-shrink-0">
                                    Retry
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Skeletons */}
                    {loading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="bg-[#16203d] border-2 border-[#1e293b] h-48 animate-pulse" />
                            ))}
                        </div>
                    )}

                    {/* Empty */}
                    {!loading && !error && buildings.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-600">
                            <Building2 size={52} strokeWidth={1} />
                            <p className="font-bold tracking-widest text-sm uppercase">
                                {search ? "No buildings match your query" : "No PG buildings synced yet"}
                            </p>
                            {!search && (
                                <div className="bg-[#16203d] border-2 border-[#1e293b] p-4 max-w-md text-center">
                                    <p className="text-slate-400 text-xs font-semibold leading-relaxed">
                                        Field technicians create PG buildings in the mobile app. Data syncs automatically when online.
                                    </p>
                                    <p className="text-slate-600 text-xs mt-2 font-mono">
                                        Mobile: PG Properties → Add New PG → save → auto-syncs to server
                                    </p>
                                    <button
                                        onClick={() => fetchBuildings()}
                                        className="mt-3 bg-orange-500/20 border border-orange-500/40 text-orange-400 text-xs font-bold px-4 py-2 uppercase tracking-widest hover:bg-orange-500/30"
                                    >
                                        Check Again
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Cards */}
                    {!loading && !error && (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {buildings.map(b => (
                                <Link key={b.id} href={`/pg/${b.id}`}>
                                    <div className="bg-[#16203d] border-2 border-[#1e293b] overflow-hidden cursor-pointer hover:border-orange-500/60 transition-colors group"
                                        style={{ boxShadow: "4px 4px 0 #0f172a" }}>
                                        {/* Photo */}
                                        <div className="relative h-40 bg-[#0d1627]">
                                            {b.photo_url ? (
                                                <img src={resolveUploadUrl(b.photo_url)} alt={b.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-700">
                                                    <Building2 size={36} strokeWidth={1} />
                                                    <span className="text-[10px] font-bold tracking-widest">NO PHOTO</span>
                                                </div>
                                            )}
                                            <div className="absolute top-2 left-2 bg-black/80 border border-[#1e293b] px-2 py-1">
                                                <span className="text-slate-400 text-[10px] font-black tracking-widest">
                                                    ID: {b.id.slice(-6).toUpperCase()}
                                                </span>
                                            </div>
                                            <div className={`absolute top-2 right-2 text-[10px] font-black px-2 py-1 ${PG_TYPE_COLORS[b.pg_type] ?? ""}`}>
                                                {b.pg_type.toUpperCase()}
                                            </div>
                                        </div>

                                        {/* Body */}
                                        <div className="p-4 border-b-2 border-[#1e293b]">
                                            <h3 className="text-orange-400 font-black text-base tracking-wide uppercase truncate group-hover:text-orange-300">
                                                {b.name}
                                            </h3>
                                            {b.address && (
                                                <div className="flex items-start gap-1.5 mt-1.5">
                                                    <MapPin size={12} className="text-slate-600 mt-0.5 flex-shrink-0" />
                                                    <p className="text-slate-400 text-xs leading-snug line-clamp-2">{b.address}</p>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                <User size={12} className="text-slate-600 flex-shrink-0" />
                                                <p className="text-slate-300 text-xs font-semibold">{b.owner_name || "Owner pending"}</p>
                                                {b.owner_mobile && (
                                                    <><Phone size={10} className="text-slate-700 ml-1" /><p className="text-slate-500 text-xs">{b.owner_mobile}</p></>
                                                )}
                                            </div>
                                            <CompletionBar done={b.done_rooms} total={b.total_rooms} />
                                        </div>

                                        {/* Footer */}
                                        <div className="flex items-center justify-between px-4 py-2.5 bg-black/20">
                                            <div className="flex gap-2 text-xs text-slate-600 font-semibold">
                                                <span>{b.total_floors} floor{b.total_floors !== 1 ? "s" : ""}</span>
                                                <span>·</span>
                                                <span>{b.total_rooms} room{b.total_rooms !== 1 ? "s" : ""}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-slate-500 text-xs font-bold tracking-widest group-hover:text-orange-400">
                                                VIEW <ChevronRight size={14} />
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
