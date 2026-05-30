"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    ArrowLeft, Clock, User, MessageSquare, Send, AlertTriangle,
    FileText, MapPin, Phone, CheckCircle2, Wifi, WifiOff, Zap, RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const priorityColors: Record<string, string> = {
    Critical: "bg-red-100 text-red-700 border-red-200",
    High: "bg-orange-100 text-orange-700 border-orange-200",
    Normal: "bg-blue-100 text-blue-700 border-blue-200",
    Low: "bg-gray-100 text-gray-600 border-gray-200",
};

const statusColors: Record<string, string> = {
    Open: "bg-red-500",
    Assigned: "bg-blue-500",
    Ongoing: "bg-orange-500",
    Resolved: "bg-green-500",
    Closed: "bg-gray-400",
};

function TicketShowContent() {
    const params = useParams();
    const ticketId = params?.id;

    const [ticket, setTicket] = useState<any>(null);
    const [comments, setComments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [commentText, setCommentText] = useState("");
    const [sendingComment, setSendingComment] = useState(false);
    const [technicians, setTechnicians] = useState<any[]>([]);
    const [updating, setUpdating] = useState(false);

    // Live ONU status
    const [onuLive, setOnuLive] = useState<{ status: string | null; rx_power_dbm: number | null; dying_gasp: boolean; polled_at: string | null } | null>(null);
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

    const fetchTicket = useCallback(async () => {
        if (!ticketId) return;
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
                headers: getAuthHeaders(),
            });
            if (handle401(res)) return;
            if (!res.ok) {
                toast.error("Ticket not found");
                return;
            }
            const data = await res.json();
            setTicket(data);
            setComments(data.comments || []);
            if (data.customer?.mac_address) {
                fetchOnuLive(data.customer.mac_address);
            }
        } catch {
            toast.error("Failed to load ticket");
        } finally {
            setLoading(false);
        }
    }, [ticketId, fetchOnuLive]);

    useEffect(() => {
        fetchTicket();
    }, [fetchTicket]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_URL}/auth/technicians-simple`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) setTechnicians(await res.json());
            } catch { /* silent */ }
        })();
    }, []);

    const handleUpdate = async (field: string, value: string) => {
        setUpdating(true);
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({ [field]: value }),
            });
            if (handle401(res)) return;
            if (res.ok) {
                toast.success("Ticket updated");
                fetchTicket();
            } else {
                const err = await res.json();
                toast.error(err.detail || "Update failed");
            }
        } catch {
            toast.error("Network error");
        } finally {
            setUpdating(false);
        }
    };

    const handleSendComment = async () => {
        if (!commentText.trim()) return;
        setSendingComment(true);
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}/comments`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ content: commentText, is_internal: 0 }),
            });
            if (handle401(res)) return;
            if (res.ok) {
                toast.success("Comment added");
                setCommentText("");
                fetchTicket();
            } else {
                toast.error("Failed to add comment");
            }
        } catch {
            toast.error("Network error");
        } finally {
            setSendingComment(false);
        }
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

    if (loading) {
        return (
            <div className="flex h-screen bg-[#F4F5F7]">
                <MainSidebar />
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-pulse text-gray-400">Loading ticket...</div>
                </div>
            </div>
        );
    }

    if (!ticket) {
        return (
            <div className="flex h-screen bg-[#F4F5F7]">
                <MainSidebar />
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <AlertTriangle className="h-12 w-12 text-gray-300" />
                    <p className="text-gray-500 font-medium">Ticket not found</p>
                    <Link href="/tickets">
                        <Button variant="outline">Back to Tickets</Button>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 md:p-8 max-w-[1000px] mx-auto space-y-6">
                    {/* Back + Header */}
                    <div className="flex items-center justify-between">
                        <Link href="/tickets">
                            <Button variant="ghost" className="gap-2 text-gray-500 hover:text-gray-700 -ml-3">
                                <ArrowLeft className="h-4 w-4" /> Back to Tickets
                            </Button>
                        </Link>
                        <Badge variant="outline" className="font-mono text-xs">#{ticket.id}</Badge>
                    </div>

                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">{ticket.issue_type}</h1>
                            {ticket.sub_issue && (
                                <p className="text-sm text-gray-500 mt-1">{ticket.sub_issue}</p>
                            )}
                        </div>
                        <Badge className={`${priorityColors[ticket.priority] || priorityColors.Normal} border`}>
                            {ticket.priority} Priority
                        </Badge>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Content */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Description */}
                            {ticket.description && (
                                <Card className="border-none shadow-sm">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-semibold text-gray-500 flex items-center gap-2">
                                            <FileText className="h-4 w-4" /> Description
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Internal Notes */}
                            {ticket.internal_notes && (
                                <Card className="border-none shadow-sm border-l-4 border-l-amber-400">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-semibold text-gray-500">Internal Notes</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{ticket.internal_notes}</p>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Comments */}
                            <Card className="border-none shadow-sm">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-sm font-semibold text-gray-500 flex items-center gap-2">
                                        <MessageSquare className="h-4 w-4" /> Comments ({comments.length})
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <ScrollArea className={comments.length > 4 ? "h-[300px]" : ""}>
                                        {comments.length === 0 ? (
                                            <p className="text-sm text-gray-400 text-center py-4">No comments yet</p>
                                        ) : (
                                            <div className="space-y-3 pr-2">
                                                {comments.map((c: any) => (
                                                    <div key={c.id} className={`p-3 rounded-lg border ${c.is_internal ? "bg-amber-50/50 border-amber-100" : "bg-gray-50/50 border-gray-100"}`}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-bold text-gray-700">{c.author}</span>
                                                            <span className="text-[10px] text-gray-400">
                                                                {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-gray-600">{c.content}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </ScrollArea>

                                    {/* Add Comment */}
                                    <div className="flex gap-2 pt-2 border-t border-gray-100">
                                        <Input
                                            placeholder="Write a comment..."
                                            value={commentText}
                                            onChange={(e) => setCommentText(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendComment()}
                                            className="text-sm"
                                        />
                                        <Button
                                            size="sm"
                                            onClick={handleSendComment}
                                            disabled={sendingComment || !commentText.trim()}
                                            className="bg-blue-600 hover:bg-blue-700 text-white gap-1"
                                        >
                                            <Send className="h-3.5 w-3.5" />
                                            {sendingComment ? "..." : "Send"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-4">
                            {/* Status & Controls */}
                            <Card className="border-none shadow-sm">
                                <CardContent className="p-4 space-y-4">
                                    {/* Status */}
                                    <div>
                                        <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Status</p>
                                        <div className="flex items-center gap-2">
                                            <div className={`h-3 w-3 rounded-full ${statusColors[ticket.status] || "bg-gray-400"}`} />
                                            <Select
                                                value={ticket.status}
                                                onValueChange={(v) => handleUpdate("status", v)}
                                                disabled={updating}
                                            >
                                                <SelectTrigger className="h-8 text-sm">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {["Open", "Assigned", "Ongoing", "Resolved", "Closed"].map((s) => (
                                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {/* Assigned Tech */}
                                    <div>
                                        <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Assigned To</p>
                                        <Select
                                            value={ticket.assigned_tech || ""}
                                            onValueChange={(v) => handleUpdate("assigned_tech", v)}
                                            disabled={updating}
                                        >
                                            <SelectTrigger className="h-8 text-sm">
                                                <SelectValue placeholder="Unassigned" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {technicians.map((t: any) => (
                                                    <SelectItem key={t.username} value={t.username}>
                                                        {t.full_name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Priority */}
                                    <div>
                                        <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Priority</p>
                                        <Select
                                            value={ticket.priority}
                                            onValueChange={(v) => handleUpdate("priority", v)}
                                            disabled={updating}
                                        >
                                            <SelectTrigger className="h-8 text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {["Critical", "High", "Normal", "Low"].map((p) => (
                                                    <SelectItem key={p} value={p}>{p}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Customer Info */}
                            <Card className="border-none shadow-sm">
                                <CardContent className="p-4 space-y-3">
                                    <p className="text-xs font-semibold text-gray-400 uppercase">Customer</p>
                                    <Link href={`/customers/show/${ticket.customer_id}`} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium">
                                        <User className="h-4 w-4" />
                                        {ticket.customer?.first_name || ticket.customer_id}
                                    </Link>
                                    {ticket.customer?.phone && (
                                        <a href={`tel:${ticket.customer.phone}`} className="flex items-center gap-2 text-xs text-gray-500">
                                            <Phone className="h-3.5 w-3.5" /> {ticket.customer.phone}
                                        </a>
                                    )}

                                    {/* Live ONU status */}
                                    {ticket.customer?.mac_address ? (
                                        <div className={`rounded-lg border px-3 py-2 text-xs ${
                                            onuLoading ? "border-gray-200 bg-gray-50" :
                                            !onuLive ? "border-gray-200 bg-gray-50" :
                                            onuLive.dying_gasp ? "border-purple-200 bg-purple-50" :
                                            onuLive.status === "online" ? "border-green-200 bg-green-50" :
                                            "border-red-200 bg-red-50"
                                        }`}>
                                            {onuLoading ? (
                                                <div className="flex items-center gap-1.5 text-gray-400">
                                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                                    Checking ONU…
                                                </div>
                                            ) : !onuLive ? (
                                                <div className="flex items-center gap-1.5 text-gray-400">
                                                    <WifiOff className="h-3 w-3" /> No live data
                                                </div>
                                            ) : (
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-1.5">
                                                        {onuLive.dying_gasp ? (
                                                            <Zap className="h-3 w-3 text-purple-600" />
                                                        ) : onuLive.status === "online" ? (
                                                            <Wifi className="h-3 w-3 text-green-600" />
                                                        ) : (
                                                            <WifiOff className="h-3 w-3 text-red-600" />
                                                        )}
                                                        <span className={`font-semibold ${
                                                            onuLive.dying_gasp ? "text-purple-700" :
                                                            onuLive.status === "online" ? "text-green-700" : "text-red-700"
                                                        }`}>
                                                            {onuLive.dying_gasp ? "Dying Gasp" :
                                                             onuLive.status === "online" ? "ONU Online" : "ONU Offline"}
                                                        </span>
                                                        {onuLive.rx_power_dbm != null && (
                                                            <span className={`ml-auto font-bold ${rxColor(onuLive.rx_power_dbm)}`}>
                                                                {onuLive.rx_power_dbm.toFixed(1)} dBm
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center justify-between text-gray-400">
                                                        {onuLive.polled_at && <span>{timeAgo(onuLive.polled_at)}</span>}
                                                        <a href={`/noc/onus/${encodeURIComponent(ticket.customer.mac_address)}`}
                                                           className="text-blue-500 hover:underline ml-auto">
                                                            History →
                                                        </a>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                            <WifiOff className="h-3 w-3" /> No ONU linked
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Timestamps */}
                            <Card className="border-none shadow-sm">
                                <CardContent className="p-4 space-y-2">
                                    <p className="text-xs font-semibold text-gray-400 uppercase">Timeline</p>
                                    <div className="text-xs text-gray-500 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <Clock className="h-3.5 w-3.5" />
                                            Created: {format(new Date(ticket.created_at), "MMM dd, yyyy h:mm a")}
                                        </div>
                                        {ticket.assigned_at && (
                                            <div className="flex items-center gap-2">
                                                <User className="h-3.5 w-3.5" />
                                                Assigned: {format(new Date(ticket.assigned_at), "MMM dd, yyyy h:mm a")}
                                            </div>
                                        )}
                                        {ticket.resolved_at && (
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                                Resolved: {format(new Date(ticket.resolved_at), "MMM dd, yyyy h:mm a")}
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function TicketShowPage() {
    return (
        <ErrorBoundary fallbackTitle="Ticket details failed to load">
            <TicketShowContent />
        </ErrorBoundary>
    );
}
