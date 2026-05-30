"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import type { SurveyMapRow } from "./page";

// Kanchipuram, Tamil Nadu (rough fallback center)
const FALLBACK_CENTER: [number, number] = [12.8342, 79.7036];
const FALLBACK_ZOOM = 13;

function colorFor(status: string): string {
    if (status === "done") return "#10b981"; // emerald
    if (status === "partial" || status === "needs_review") return "#f59e0b"; // amber
    if (status === "skipped") return "#ef4444"; // red
    return "#94a3b8"; // slate
}

/**
 * Sets the map view ONCE when real GPS data arrives (center !== fallback).
 * After that, hasSetView is true and the effect never runs again —
 * so the user's pan/zoom is fully preserved across every data refresh.
 */
function InitialViewSetter({ center, zoom }: { center: [number, number]; zoom: number }) {
    const map = useMap();
    const hasSetView = useRef(false);

    useEffect(() => {
        if (
            !hasSetView.current &&
            (center[0] !== FALLBACK_CENTER[0] || center[1] !== FALLBACK_CENTER[1])
        ) {
            map.setView(center, zoom, { animate: false });
            hasSetView.current = true;
        }
    }, [center, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
}

export default function SurveyMap({ rows }: { rows: SurveyMapRow[] }) {
    // Strict-mode guard: leaflet's MapContainer cannot tolerate React 18's double-mount,
    // so we delay rendering until after the first effect runs (i.e. real mount).
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const valid = useMemo(
        () => rows.filter((r) => r.gps_lat != null && r.gps_lng != null),
        [rows]
    );

    const center: [number, number] = useMemo(() => {
        if (!valid.length) return FALLBACK_CENTER;
        const lat = valid.reduce((a, r) => a + (r.gps_lat || 0), 0) / valid.length;
        const lng = valid.reduce((a, r) => a + (r.gps_lng || 0), 0) / valid.length;
        return [lat, lng];
    }, [valid]);

    if (!mounted) {
        return (
            <div className="flex items-center justify-center h-full w-full text-slate-400 text-sm">
                Initializing map…
            </div>
        );
    }

    return (
        // MapContainer uses static FALLBACK props so it never remounts due to prop changes.
        // InitialViewSetter handles the one-time fly-to when real GPS data first arrives.
        <MapContainer
            center={FALLBACK_CENTER}
            zoom={FALLBACK_ZOOM}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom
        >
            <InitialViewSetter center={center} zoom={valid.length ? 14 : FALLBACK_ZOOM} />
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {valid.map((r) => (
                <CircleMarker
                    key={r.username}
                    center={[r.gps_lat!, r.gps_lng!]}
                    radius={7}
                    pathOptions={{
                        color: colorFor(r.survey_status),
                        fillColor: colorFor(r.survey_status),
                        fillOpacity: 0.85,
                        weight: 1.5,
                    }}
                >
                    <Popup>
                        <div className="min-w-[200px]">
                            <div className="font-semibold text-slate-900">
                                {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.username}
                            </div>
                            <div className="font-mono text-xs text-slate-500">{r.username}</div>
                            {r.phone && (
                                <div className="text-sm mt-1">
                                    <a href={`tel:${r.phone}`} className="text-blue-600">
                                        📞 {r.phone}
                                    </a>
                                </div>
                            )}
                            {(r.rico_address || r.railwire_address) && (
                                <div className="text-xs text-slate-600 mt-1">
                                    {r.rico_address || r.railwire_address}
                                </div>
                            )}
                            <div className="text-xs mt-2">
                                <span
                                    className="inline-block px-2 py-0.5 rounded-full text-white font-medium"
                                    style={{ backgroundColor: colorFor(r.survey_status) }}
                                >
                                    {r.survey_status}
                                </span>
                                {r.skip_reason && (
                                    <span className="text-slate-500 ml-1">— {r.skip_reason}</span>
                                )}
                            </div>
                            {r.collector_name && (
                                <div className="text-xs text-slate-500 mt-1">
                                    by {r.collector_name}
                                </div>
                            )}
                            <Link
                                href={`/customers/show/${r.username}`}
                                className="text-xs text-blue-600 hover:underline mt-2 block"
                            >
                                Open customer →
                            </Link>
                        </div>
                    </Popup>
                </CircleMarker>
            ))}
        </MapContainer>
    );
}
