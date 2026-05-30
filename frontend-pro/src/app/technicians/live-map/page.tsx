"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { API_URL } from "@/config";
import { authFetch } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft,
    Battery,
    Clock,
    Loader2,
    MapPin,
    Radio,
    RefreshCw,
    Signal,
    Users,
} from "lucide-react";
import type { TechPin } from "./TechMap";

const TechMap = dynamic(() => import("./TechMap"), {
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center h-[600px] text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading map…
        </div>
    ),
});

const POLL_INTERVAL = 15_000;

export default function LiveMapPage() {
    const [pins, setPins] = useState<TechPin[]>([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const fetchLocations = useCallback(async () => {
        try {
            const res = await authFetch(`${API_URL}/field-team/locations?hours=8`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setPins(data.locations || []);
            setLastRefresh(new Date());
        } catch (e: any) {
            toast.error(`Failed to load locations: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLocations();
        const id = setInterval(fetchLocations, POLL_INTERVAL);
        return () => clearInterval(id);
    }, [fetchLocations]);

    const stats = useMemo(() => {
        let active = 0;
        let idle = 0;
        let stale = 0;
        for (const p of pins) {
            if (p.minutes_ago <= 5) active++;
            else if (p.minutes_ago <= 30) idle++;
            else stale++;
        }
        return { total: pins.length, active, idle, stale };
    }, [pins]);

    return (
        <div className="flex min-h-screen bg-slate-50">
            <MainSidebar />
            <main className="flex-1 p-8">
                <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Link href="/technicians">
                            <Button variant="ghost" size="sm">
                                <ArrowLeft className="h-4 w-4 mr-1" />
                                Technicians
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                <Radio className="h-5 w-5 text-emerald-500" />
                                Live Technician Tracker
                            </h1>
                            <p className="text-slate-500 text-sm">
                                Real-time GPS positions — auto-refreshes every 15 seconds
                                {lastRefresh && (
                                    <span className="ml-2 text-slate-400">
                                        · Last update: {lastRefresh.toLocaleTimeString()}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    <Button variant="outline" onClick={fetchLocations} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-4 gap-4 mb-4">
                    <StatCard
                        icon={<Users className="h-4 w-4" />}
                        label="Total Online"
                        value={stats.total}
                        color="text-slate-700"
                    />
                    <StatCard
                        icon={<Signal className="h-4 w-4" />}
                        label="Active (< 5 min)"
                        value={stats.active}
                        color="text-emerald-600"
                        dotColor="bg-emerald-500"
                    />
                    <StatCard
                        icon={<Clock className="h-4 w-4" />}
                        label="Idle (5–30 min)"
                        value={stats.idle}
                        color="text-amber-600"
                        dotColor="bg-amber-500"
                    />
                    <StatCard
                        icon={<MapPin className="h-4 w-4" />}
                        label="Stale (> 30 min)"
                        value={stats.stale}
                        color="text-red-600"
                        dotColor="bg-red-500"
                    />
                </div>

                {/* Map */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            Field Team Locations
                            <span className="relative flex h-2.5 w-2.5 ml-1">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                            </span>
                            <span className="text-xs text-slate-400 font-normal ml-1">LIVE</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="h-[540px] w-full rounded-b-lg overflow-hidden">
                            <TechMap pins={pins} />
                        </div>
                    </CardContent>
                </Card>

                {/* Tech list below map */}
                {pins.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                        {pins
                            .sort((a, b) => a.minutes_ago - b.minutes_ago)
                            .map((p) => (
                                <TechCard key={p.technician_id} pin={p} />
                            ))}
                    </div>
                )}

                {!loading && pins.length === 0 && (
                    <Card className="mt-4">
                        <CardContent className="py-12 text-center text-slate-500">
                            <MapPin className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                            <p>No technician locations found in the last 8 hours.</p>
                            <p className="text-sm text-slate-400 mt-1">
                                Technicians need to be logged into the mobile app with GPS enabled.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </main>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
    color,
    dotColor,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    color: string;
    dotColor?: string;
}) {
    return (
        <Card>
            <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                    {dotColor && <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />}
                    {icon}
                    {label}
                </div>
                <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
            </CardContent>
        </Card>
    );
}

function TechCard({ pin }: { pin: TechPin }) {
    const name = pin.technician_name || `Tech #${pin.technician_id}`;
    const color =
        pin.minutes_ago <= 5
            ? "bg-emerald-100 text-emerald-700"
            : pin.minutes_ago <= 30
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700";
    const statusText =
        pin.minutes_ago <= 5
            ? "Active"
            : pin.minutes_ago <= 60
                ? `${Math.round(pin.minutes_ago)}m ago`
                : `${Math.round(pin.minutes_ago / 60)}h ago`;

    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-slate-800">{name}</div>
                    <Badge className={color}>{statusText}</Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                    </span>
                    {pin.battery_pct != null && (
                        <span className="flex items-center gap-1">
                            <Battery className="h-3 w-3" />
                            {pin.battery_pct}%
                        </span>
                    )}
                    {pin.accuracy_m != null && (
                        <span>±{Math.round(pin.accuracy_m)}m</span>
                    )}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                    Last seen: {new Date(pin.timestamp).toLocaleString()}
                </div>
            </CardContent>
        </Card>
    );
}
