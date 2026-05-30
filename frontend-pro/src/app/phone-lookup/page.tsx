"use client";

import React, { useState, useEffect, useCallback } from "react";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Phone, Search, AlertCircle, User, CreditCard, Ticket, RefreshCw, Wifi, WifiOff, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface LookupResult {
    found: boolean;
    customer?: {
        username: string;
        first_name?: string;
        last_name?: string;
        phone?: string;
        status?: string;
        mac_address?: string;
        olt_host?: string;
        pon_port?: string;
        plan_name?: string;
        expiry_date?: string;
        balance?: number;
    };
    phone_label?: string;
    recent_tickets: Array<{
        id: number;
        issue_type: string;
        status: string;
        priority: string;
        created_at: string;
    }>;
    has_unpaid_balance: boolean;
    balance: number;
}

interface OnuLive {
    status: string | null;
    rx_power_dbm: number | null;
    dying_gasp: boolean;
    polled_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
    Open: "bg-blue-100 text-blue-700",
    Assigned: "bg-purple-100 text-purple-700",
    "In Progress": "bg-amber-100 text-amber-700",
    Ongoing: "bg-amber-100 text-amber-700",
    Resolved: "bg-green-100 text-green-700",
    Closed: "bg-gray-100 text-gray-600",
};

function timeAgo(iso: string) {
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return `${Math.round(secs)}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    return `${Math.round(secs / 3600)}h ago`;
}

function rxColor(rx: number | null) {
    if (rx == null) return "text-gray-400";
    if (rx >= -20) return "text-green-700";
    if (rx >= -24) return "text-yellow-700";
    if (rx >= -27) return "text-orange-700";
    return "text-red-700";
}

export default function PhoneLookupPage() {
    const [query, setQuery] = useState("");
    const [result, setResult] = useState<LookupResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);

    // Live ONU status — fetched after customer is found
    const [onuLive, setOnuLive] = useState<OnuLive | null>(null);
    const [onuLoading, setOnuLoading] = useState(false);

    const fetchOnuLive = useCallback(async (mac: string) => {
        setOnuLoading(true);
        try {
            const res = await fetch(`${API_URL}/noc/onus/${encodeURIComponent(mac)}`, {
                headers: getAuthHeaders(),
            });
            if (res.ok) {
                const d = await res.json();
                setOnuLive({ status: d.status, rx_power_dbm: d.rx_power_dbm, dying_gasp: d.dying_gasp, polled_at: d.polled_at });
            } else {
                setOnuLive(null);
            }
        } catch {
            setOnuLive(null);
        } finally {
            setOnuLoading(false);
        }
    }, []);

    const handleSearch = async () => {
        const cleaned = query.trim().replace(/[\s\-]/g, "");
        if (!cleaned) return;
        setLoading(true);
        setSearched(false);
        setOnuLive(null);
        try {
            const res = await fetch(`${API_URL}/phone-lookup/${encodeURIComponent(cleaned)}`, {
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (res.ok) {
                const data = await res.json();
                setResult(data);
                // Kick off ONU live fetch immediately if customer has a MAC
                if (data.found && data.customer?.mac_address) {
                    fetchOnuLive(data.customer.mac_address);
                }
            } else {
                setResult(null);
                if (res.status !== 404) toast.error("Phone lookup failed. Please try again.");
            }
        } catch {
            setResult(null);
            toast.error("Network error during phone lookup");
        }
        setSearched(true);
        setLoading(false);
    };

    return (
        <ErrorBoundary fallbackTitle="Phone lookup failed to load">
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 md:p-8 max-w-2xl mx-auto min-h-screen space-y-6">
                    <div className="flex items-center gap-3">
                        <Phone className="h-6 w-6 text-blue-600" />
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Call Pop-Up</h1>
                    </div>
                    <p className="text-sm text-gray-500">Enter the caller&apos;s phone number to instantly identify the customer.</p>

                    {/* Search Bar */}
                    <div className="flex gap-3">
                        <Input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleSearch()}
                            placeholder="Enter phone number…"
                            className="flex-1 font-mono text-lg h-12 border-gray-200"
                            autoFocus
                        />
                        <Button onClick={handleSearch} disabled={loading || !query.trim()} className="h-12 px-6 bg-blue-600 hover:bg-blue-700">
                            {loading ? (
                                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <Search className="h-5 w-5" />
                            )}
                        </Button>
                    </div>

                    {/* Not found */}
                    {searched && result && !result.found && (
                        <Card className="border-dashed border-gray-300 bg-white">
                            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                                <AlertCircle className="h-10 w-10 text-gray-300" />
                                <p className="text-gray-500 font-medium">No customer found for this number.</p>
                                <Link href="/customers">
                                    <Button variant="outline" size="sm">Browse Customers</Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}

                    {/* Found */}
                    {searched && result?.found && result.customer && (
                        <div className="space-y-4">
                            {/* Customer identity + ONU status in one card */}
                            <Card className="border-blue-100 bg-white shadow-sm">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <CardTitle className="text-base font-semibold flex items-center gap-2 text-gray-700">
                                            <User className="h-4 w-4 text-blue-500" />
                                            {result.customer.first_name} {result.customer.last_name}
                                        </CardTitle>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {result.phone_label && (
                                                <Badge variant="outline" className="text-xs border-blue-200 text-blue-700">{result.phone_label}</Badge>
                                            )}
                                            <Badge className={result.customer.status === "Active" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-600 hover:bg-gray-100"}>
                                                {result.customer.status || "Unknown"}
                                            </Badge>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {/* Phone */}
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <Phone className="h-4 w-4 text-gray-400" />
                                        <span className="font-mono">{result.customer.phone}</span>
                                    </div>

                                    {/* Plan + expiry */}
                                    {(result.customer.plan_name || result.customer.expiry_date) && (
                                        <div className="flex items-center gap-4 text-sm text-gray-500">
                                            {result.customer.plan_name && (
                                                <span className="font-medium text-gray-700">{result.customer.plan_name}</span>
                                            )}
                                            {result.customer.expiry_date && (
                                                <span>
                                                    Expires: {new Date(result.customer.expiry_date).toLocaleDateString("en-IN")}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Unpaid balance warning */}
                                    {result.has_unpaid_balance && (
                                        <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-100">
                                            <CreditCard className="h-4 w-4 text-red-500 flex-shrink-0" />
                                            <span className="text-sm font-medium text-red-700">
                                                Outstanding Balance: ₹{result.balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    )}

                                    {/* ── Live ONU status ── */}
                                    {result.customer.mac_address ? (
                                        <div className={`rounded-lg border px-4 py-3 ${
                                            onuLoading ? "border-gray-200 bg-gray-50" :
                                            !onuLive ? "border-gray-200 bg-gray-50" :
                                            onuLive.dying_gasp ? "border-purple-200 bg-purple-50" :
                                            onuLive.status === "online" ? "border-green-200 bg-green-50" :
                                            "border-red-200 bg-red-50"
                                        }`}>
                                            {onuLoading ? (
                                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                                    Checking ONU status…
                                                </div>
                                            ) : !onuLive ? (
                                                <div className="flex items-center gap-2 text-sm text-gray-400">
                                                    <WifiOff className="h-3.5 w-3.5" />
                                                    No live OLT data for this device
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                                    <div className="flex items-center gap-2">
                                                        {onuLive.dying_gasp ? (
                                                            <Zap className="h-4 w-4 text-purple-600" />
                                                        ) : onuLive.status === "online" ? (
                                                            <Wifi className="h-4 w-4 text-green-600" />
                                                        ) : (
                                                            <WifiOff className="h-4 w-4 text-red-600" />
                                                        )}
                                                        <span className={`text-sm font-semibold ${
                                                            onuLive.dying_gasp ? "text-purple-700" :
                                                            onuLive.status === "online" ? "text-green-700" : "text-red-700"
                                                        }`}>
                                                            {onuLive.dying_gasp ? "Dying Gasp — possible power cut" :
                                                             onuLive.status === "online" ? "ONU Online" : "ONU Offline"}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-sm">
                                                        {onuLive.rx_power_dbm != null && (
                                                            <span className={`font-bold ${rxColor(onuLive.rx_power_dbm)}`}>
                                                                Rx {onuLive.rx_power_dbm.toFixed(1)} dBm
                                                            </span>
                                                        )}
                                                        {onuLive.polled_at && (
                                                            <span className="text-xs text-gray-400">{timeAgo(onuLive.polled_at)}</span>
                                                        )}
                                                        <a href={`/noc/onus/${encodeURIComponent(result.customer.mac_address!)}`}
                                                           className="text-xs text-blue-600 hover:underline">
                                                            History →
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
                                            <WifiOff className="h-3.5 w-3.5" />
                                            No ONU linked to this account
                                        </div>
                                    )}

                                    <Link href={`/customers/show/${result.customer.username}`}>
                                        <Button className="w-full mt-1 bg-blue-600 hover:bg-blue-700" size="sm">
                                            Open Full Profile →
                                        </Button>
                                    </Link>
                                </CardContent>
                            </Card>

                            {/* Recent Tickets — links go directly to ticket detail */}
                            {result.recent_tickets.length > 0 && (
                                <Card className="bg-white shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-gray-600">
                                            <Ticket className="h-4 w-4" /> Recent Tickets
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        {result.recent_tickets.map(t => (
                                            <Link key={t.id} href={`/tickets/show/${t.id}`}
                                                className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors">
                                                <div>
                                                    <span className="text-xs font-mono text-gray-400 mr-2">#{t.id}</span>
                                                    <span className="text-sm font-medium text-gray-700">{t.issue_type}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[t.status] || "bg-gray-100 text-gray-600"}`}>
                                                        {t.status}
                                                    </span>
                                                    <span className="text-xs text-gray-400 hidden sm:block">
                                                        {new Date(t.created_at).toLocaleDateString("en-IN")}
                                                    </span>
                                                </div>
                                            </Link>
                                        ))}
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
