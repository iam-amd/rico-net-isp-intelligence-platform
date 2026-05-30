"use client";

import React, { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface TechPin {
    technician_id: number;
    technician_name: string | null;
    lat: number;
    lng: number;
    accuracy_m: number | null;
    battery_pct: number | null;
    timestamp: string;
    minutes_ago: number;
}

const FALLBACK_CENTER: [number, number] = [12.8342, 79.7036];
const ANIM_DURATION = 1500;
const TRAIL_MAX = 20;

function statusColor(minutesAgo: number): string {
    if (minutesAgo <= 5) return "#22c55e";
    if (minutesAgo <= 15) return "#f59e0b";
    return "#ef4444";
}

function statusLabel(minutesAgo: number): string {
    if (minutesAgo <= 5) return "Active now";
    if (minutesAgo <= 60) return `${Math.round(minutesAgo)}m ago`;
    return `${Math.round(minutesAgo / 60)}h ago`;
}

function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
}

function makePulsingIcon(color: string, initial: string, isActive: boolean) {
    const pulse = isActive
        ? `<div style="
            position:absolute;top:-6px;left:-6px;
            width:48px;height:48px;border-radius:50%;
            background:${color};opacity:0.3;
            animation:techPulse 2s ease-out infinite;
          "></div>`
        : "";

    return L.divIcon({
        className: "",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -22],
        html: `
            <div style="position:relative;width:36px;height:36px;">
                ${pulse}
                <div style="
                    position:relative;z-index:2;
                    width:36px;height:36px;border-radius:50%;
                    background:${color};
                    border:3px solid white;
                    box-shadow:0 3px 12px rgba(0,0,0,0.35);
                    display:flex;align-items:center;justify-content:center;
                    color:white;font-weight:800;font-size:15px;font-family:system-ui;
                ">${initial}</div>
            </div>`,
    });
}

function buildPopup(pin: TechPin): string {
    const name = pin.technician_name || `Tech #${pin.technician_id}`;
    const color = statusColor(pin.minutes_ago);
    return `
        <div style="font-family:system-ui;min-width:200px;">
            <div style="font-size:16px;font-weight:700;margin-bottom:6px;">${name}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};"></span>
                <span style="font-weight:600;font-size:13px;">${statusLabel(pin.minutes_ago)}</span>
            </div>
            ${pin.battery_pct != null ? `<div style="color:#475569;font-size:12px;">🔋 Battery: ${pin.battery_pct}%</div>` : ""}
            ${pin.accuracy_m != null ? `<div style="color:#64748b;font-size:11px;">📍 Accuracy: ±${Math.round(pin.accuracy_m)}m</div>` : ""}
            <div style="color:#94a3b8;font-size:11px;margin-top:4px;">
                🕐 ${new Date(pin.timestamp).toLocaleTimeString()}
            </div>
        </div>`;
}

interface MarkerState {
    marker: L.Marker;
    trail: L.Polyline;
    positions: [number, number][];
    animFrame: number;
}

export default function TechMap({ pins }: { pins: TechPin[] }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markersRef = useRef<Record<number, MarkerState>>({});

    // Inject pulse CSS
    useEffect(() => {
        if (typeof document === "undefined") return;
        const id = "tech-pulse-css";
        if (document.getElementById(id)) return;
        const style = document.createElement("style");
        style.id = id;
        style.textContent = `
            @keyframes techPulse {
                0% { transform: scale(1); opacity: 0.4; }
                100% { transform: scale(2.2); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }, []);

    // Create map once
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: FALLBACK_CENTER,
            zoom: 14,
            scrollWheelZoom: true,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org">OSM</a>',
        }).addTo(map);

        mapRef.current = map;

        return () => {
            Object.values(markersRef.current).forEach((s) => {
                cancelAnimationFrame(s.animFrame);
                s.marker.remove();
                s.trail.remove();
            });
            markersRef.current = {};
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Animate markers when pins change
    const updateMarkers = useCallback((pinList: TechPin[]) => {
        const map = mapRef.current;
        if (!map) return;

        const activeIds = new Set(pinList.map((p) => p.technician_id));

        // Remove markers for techs no longer in the list
        for (const [idStr, state] of Object.entries(markersRef.current)) {
            const id = Number(idStr);
            if (!activeIds.has(id)) {
                cancelAnimationFrame(state.animFrame);
                state.marker.remove();
                state.trail.remove();
                delete markersRef.current[id];
            }
        }

        for (const pin of pinList) {
            const id = pin.technician_id;
            const name = pin.technician_name || `Tech #${id}`;
            const color = statusColor(pin.minutes_ago);
            const initial = name[0].toUpperCase();
            const isActive = pin.minutes_ago <= 5;
            const icon = makePulsingIcon(color, initial, isActive);
            const newPos: [number, number] = [pin.lat, pin.lng];

            const existing = markersRef.current[id];

            if (!existing) {
                // New marker
                const marker = L.marker(newPos, { icon, zIndexOffset: isActive ? 1000 : 0 })
                    .bindPopup(buildPopup(pin))
                    .addTo(map);

                const trail = L.polyline([], {
                    color,
                    weight: 3,
                    opacity: 0.4,
                    dashArray: "6 8",
                    lineCap: "round",
                }).addTo(map);

                markersRef.current[id] = {
                    marker,
                    trail,
                    positions: [newPos],
                    animFrame: 0,
                };
            } else {
                // Update existing — animate to new position
                existing.marker.setIcon(icon);
                existing.marker.setPopupContent(buildPopup(pin));
                existing.marker.setZIndexOffset(isActive ? 1000 : 0);
                existing.trail.setStyle({ color });

                const oldLatLng = existing.marker.getLatLng();
                const start: [number, number] = [oldLatLng.lat, oldLatLng.lng];

                if (start[0] !== newPos[0] || start[1] !== newPos[1]) {
                    // Record trail
                    existing.positions.push(newPos);
                    if (existing.positions.length > TRAIL_MAX) {
                        existing.positions.shift();
                    }
                    existing.trail.setLatLngs(existing.positions);

                    // Smooth animate
                    cancelAnimationFrame(existing.animFrame);
                    const startTime = performance.now();

                    const animate = (time: number) => {
                        const elapsed = time - startTime;
                        const t = Math.min(elapsed / ANIM_DURATION, 1);
                        const eased = easeOutCubic(t);

                        const lat = start[0] + (newPos[0] - start[0]) * eased;
                        const lng = start[1] + (newPos[1] - start[1]) * eased;
                        existing.marker.setLatLng([lat, lng]);

                        if (t < 1) {
                            existing.animFrame = requestAnimationFrame(animate);
                        }
                    };

                    existing.animFrame = requestAnimationFrame(animate);
                }
            }
        }

        // Fit bounds if we have pins
        if (pinList.length > 0) {
            const bounds = L.latLngBounds(pinList.map((p) => [p.lat, p.lng]));
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
            }
        }
    }, []);

    useEffect(() => {
        updateMarkers(pins);
    }, [pins, updateMarkers]);

    return (
        <div
            ref={containerRef}
            className="h-full w-full"
            style={{ minHeight: 400 }}
        />
    );
}
