"use client";

import React, { useEffect, useState } from "react";
import { API_URL } from "@/config";
import { getAuthHeaders } from "@/lib/auth-utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, User, ArrowRight, History, Loader2 } from "lucide-react";

interface AuditLogRow {
    id: number;
    customer_id: string;
    action: string;
    field_name: string | null;
    old_value: string | null;
    new_value: string | null;
    changed_by: string | null;
    changed_at: string;
}

const ACTION_STYLE: Record<string, string> = {
    CREATE: "bg-emerald-100 text-emerald-700",
    UPDATE: "bg-blue-100 text-blue-700",
    SURVEY: "bg-purple-100 text-purple-700",
    LOCATION_UPDATE: "bg-amber-100 text-amber-700",
    DELETE: "bg-red-100 text-red-700",
};

const FIELD_LABEL: Record<string, string> = {
    geo_lat: "GPS latitude",
    geo_long: "GPS longitude",
    gps_lat: "Survey GPS lat",
    gps_lng: "Survey GPS lng",
    gps_accuracy_m: "GPS accuracy (m)",
    rico_address: "Rico address",
    railwire_address: "Railwire address",
    mac_address: "MAC address",
    olt_host: "OLT host",
    pon_port: "PON port",
    onu_index: "ONU index",
    install_photo_url: "Install photo",
    wifi_ssid: "WiFi SSID",
    wifi_password: "WiFi password",
    phone: "Phone",
    email: "Email",
    notes: "Notes",
    plan_name: "Plan",
    status: "Status",
    balance: "Balance",
    expiry_date: "Expiry date",
    pole_id: "Pole ID",
    splitter_id: "Splitter port",
    pg_id: "Pole group",
    ont_model: "ONT model",
    ont_serial_number: "ONT serial",
    router_model: "Router model",
    router_serial: "Router serial",
    sticker_photo_url: "ONT sticker photo",
    router_sticker_photo_url: "Router sticker photo",
    first_name: "First name",
    last_name: "Last name",
};

function fmtValue(v: string | null): string {
    if (v === null || v === undefined || v === "") return "—";
    // Truncate long values
    if (v.length > 80) return v.slice(0, 77) + "…";
    return v;
}

function timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
}

export function CustomerHistory({ username }: { username: string }) {
    const [logs, setLogs] = useState<AuditLogRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch(`${API_URL}/audit/customers/${encodeURIComponent(username)}`, {
            headers: getAuthHeaders(),
        })
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((data) => {
                if (cancelled) return;
                setLogs(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch((e) => {
                if (cancelled) return;
                setError(e.message || "Failed to load history");
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [username]);

    return (
        <Card className="border-gray-200/60 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                    <History className="h-4 w-4 text-indigo-500" />
                    Change History
                    {logs.length > 0 && (
                        <span className="text-xs text-gray-400 ml-auto font-normal">
                            {logs.length} {logs.length === 1 ? "change" : "changes"}
                        </span>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {loading && (
                    <div className="flex items-center justify-center py-8 text-gray-400">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading history…
                    </div>
                )}
                {error && !loading && (
                    <div className="text-sm text-red-500 py-4">Error: {error}</div>
                )}
                {!loading && !error && logs.length === 0 && (
                    <p className="text-sm text-gray-400 italic text-center py-4">
                        No changes recorded yet.
                    </p>
                )}
                <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1">
                    {logs.map((log) => {
                        const action = log.action || "UPDATE";
                        const badgeClass = ACTION_STYLE[action] || "bg-gray-100 text-gray-700";
                        const fieldName = log.field_name
                            ? FIELD_LABEL[log.field_name] || log.field_name
                            : "(general)";
                        return (
                            <div
                                key={log.id}
                                className="border border-gray-100 rounded-lg p-3 bg-gray-50/30 hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    <Badge className={`${badgeClass} text-[10px] font-semibold`}>
                                        {action.replace("_", " ")}
                                    </Badge>
                                    <span className="text-xs font-medium text-gray-700">{fieldName}</span>
                                    <span className="text-xs text-gray-400 ml-auto" title={new Date(log.changed_at).toLocaleString()}>
                                        <Clock className="h-3 w-3 inline mr-1" />
                                        {timeAgo(log.changed_at)}
                                    </span>
                                </div>
                                {log.field_name && (
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="font-mono text-red-600 line-through truncate max-w-[45%]">
                                            {fmtValue(log.old_value)}
                                        </span>
                                        <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                                        <span className="font-mono text-emerald-700 truncate max-w-[45%]">
                                            {fmtValue(log.new_value)}
                                        </span>
                                    </div>
                                )}
                                {log.changed_by && (
                                    <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        {log.changed_by}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
