"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { API_URL } from "@/config";
import { authFetch } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBanner } from "@/components/error-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";

// Leaflet uses window — must be dynamic import, no SSR
const SurveyMap = dynamic(() => import("./SurveyMap"), {
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center h-[600px] text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading map…
        </div>
    ),
});

export interface SurveyMapRow {
    username: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    railwire_address?: string | null;
    rico_address?: string | null;
    survey_status: string;
    skip_reason?: string | null;
    collector_name?: string | null;
    completed_at?: string | null;
    gps_lat?: number | null;
    gps_lng?: number | null;
    has_binding: boolean;
}

export default function SurveyMapPage() {
    const [rows, setRows] = useState<SurveyMapRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Force a fresh Leaflet container on every page visit.
    // Each navigation creates a new component instance so mapKey gets a new value,
    // ensuring React never reuses a DOM node that already has a Leaflet _leaflet_id.
    const [mapKey] = useState(() => `map-${Date.now()}`);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await authFetch(`${API_URL}/collection/survey/map?limit=5000`);
            if (!res.ok) {
                setError(`Survey Map API returned ${res.status} ${res.statusText}`);
                return;
            }
            const data = await res.json();
            setRows(data.items || []);
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : "Network error contacting backend";
            console.error("[SurveyMap]", e);
            setError(msg);
            toast.error(`Map load failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const counts = useMemo(() => {
        const c = { done: 0, partial: 0, skipped: 0, pending: 0 };
        for (const r of rows) {
            if (r.survey_status === "done") c.done++;
            else if (r.survey_status === "partial" || r.survey_status === "needs_review") c.partial++;
            else if (r.survey_status === "skipped") c.skipped++;
            else c.pending++;
        }
        return c;
    }, [rows]);

    return (
        <div className="flex min-h-screen bg-slate-50">
            <MainSidebar />
            <main className="flex-1 p-8">
                <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Link href="/survey">
                            <Button variant="ghost" size="sm">
                                <ArrowLeft className="h-4 w-4 mr-1" />
                                Back
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">Survey Map</h1>
                            <p className="text-slate-500">
                                {rows.length.toLocaleString()} customers with confirmed GPS.
                            </p>
                        </div>
                    </div>
                    <Button variant="outline" onClick={fetchRows} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>

                {error && <ErrorBanner title="Could not load survey map" message={error} onRetry={fetchRows} />}

                <div className="grid grid-cols-4 gap-4 mb-4">
                    <LegendCard color="bg-emerald-500" label="Collected" value={counts.done} />
                    <LegendCard color="bg-amber-500" label="Partial / Review" value={counts.partial} />
                    <LegendCard color="bg-red-500" label="Skipped" value={counts.skipped} />
                    <LegendCard color="bg-slate-400" label="Pending" value={counts.pending} />
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Customer locations</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="h-[640px] w-full rounded-b-lg overflow-hidden">
                            <SurveyMap key={mapKey} rows={rows} />
                        </div>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}

function LegendCard({ color, label, value }: { color: string; label: string; value: number }) {
    return (
        <Card>
            <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className={`h-3 w-3 rounded-full ${color}`} />
                    {label}
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{value.toLocaleString()}</div>
            </CardContent>
        </Card>
    );
}
