"use client";

import React, { useState } from "react";
import { API_URL } from "@/config";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Clock,
    Wifi,
    FileText,
    AlertCircle,
    Plus,
    Search,
    ChevronDown,
    ChevronUp,
    MessageSquare,
    CheckCircle2,
    Activity,
    MoreHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TechReportViewer } from "@/app/tickets/components/TechReportViewer";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/auth-utils";
import { format, formatDistanceToNow } from "date-fns";

interface TicketHistoryProps {
    tickets: any[];
    customerId: string;
    onTicketCreate: () => void;
    onTicketUpdate: () => void;
}

export function TicketHistory({ tickets = [], customerId, onTicketCreate, onTicketUpdate }: TicketHistoryProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("All");
    const [expandedTicketId, setExpandedTicketId] = useState<number | null>(null);

    // Internal note state for the expanded ticket
    const [noteInput, setNoteInput] = useState("");
    const [isSavingNote, setIsSavingNote] = useState(false);

    const filteredTickets = tickets.filter(ticket => {
        const matchesSearch =
            ticket.issue_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            ticket.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            ticket.id?.toString().includes(searchTerm);
        const matchesStatus = statusFilter === "All" || ticket.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const toggleExpand = (ticket: any) => {
        if (expandedTicketId === ticket.id) {
            setExpandedTicketId(null);
            setNoteInput("");
        } else {
            setExpandedTicketId(ticket.id);
            setNoteInput(ticket.internal_notes || "");
        }
    };

    const handleSaveNote = async (ticketId: number, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setIsSavingNote(true);
        try {
            const res = await fetch(`${API_URL}/tickets/${ticketId}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({ internal_notes: noteInput })
            });

            if (!res.ok) throw new Error("Failed");

            toast.success("Note saved");
            onTicketUpdate();
        } catch (e) {
            console.error(e);
            toast.error("Failed to save note");
        } finally {
            setIsSavingNote(false);
        }
    };

    return (
        <Card className="border-gray-200/60 shadow-sm h-full flex flex-col bg-white">
            <CardHeader className="pb-3 border-b border-gray-50 flex flex-row items-center justify-between sticky top-0 bg-white z-10 rounded-t-xl">
                <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                    <Clock className="h-4 w-4 text-purple-500" />
                    Ticket History
                    <Badge variant="secondary" className="ml-2 bg-purple-50 text-purple-600 border border-purple-100">{tickets.length}</Badge>
                </CardTitle>
                <Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg border-dashed text-gray-500 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50" onClick={onTicketCreate}>
                    <Plus className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">New</span>
                </Button>
            </CardHeader>

            <div className="p-3 bg-gray-50/50 border-b border-gray-100 grid grid-cols-[1fr,auto] gap-2">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                    <Input
                        placeholder="Search tickets..."
                        className="h-9 pl-8 bg-white text-xs border-gray-200 focus-visible:ring-purple-500/20"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-[100px] bg-white text-xs border-gray-200">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="All">All Status</SelectItem>
                        <SelectItem value="Open">Open</SelectItem>
                        <SelectItem value="Assigned">Assigned</SelectItem>
                        <SelectItem value="Resolved">Resolved</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <CardContent className="p-0 flex-1 min-h-[300px]">
                <ScrollArea className="h-[600px] p-4">
                    {filteredTickets.length > 0 ? (
                        <div className="space-y-4">
                            {filteredTickets.map((ticket) => {
                                const isExpanded = expandedTicketId === ticket.id;

                                // Progress Logic
                                let progressPercent = 0;
                                let progressColor = 'bg-red-500';
                                let activeText = '';
                                let activeColor = 'text-red-600';

                                if (ticket.status === 'Open') {
                                    progressPercent = 15;
                                    progressColor = 'bg-red-500';
                                    activeText = `Active for ${formatDistanceToNow(new Date(ticket.created_at), { addSuffix: false }).replace('about ', '')}`;
                                    activeColor = 'text-red-600';
                                } else if (ticket.status === 'Assigned' || ticket.status === 'Ongoing') {
                                    progressPercent = 50;
                                    progressColor = 'bg-orange-500';
                                    activeText = `Active for ${formatDistanceToNow(new Date(ticket.created_at), { addSuffix: false }).replace('about ', '')}`;
                                    activeColor = 'text-orange-600';
                                } else if (ticket.status === 'Resolved') {
                                    progressPercent = 100;
                                    progressColor = 'bg-teal-500';
                                    activeText = `Resolved in ${formatDistanceToNow(new Date(ticket.created_at), { addSuffix: false }).replace('about ', '')}`;
                                    activeColor = 'text-teal-600';
                                }

                                return (
                                    <div
                                        key={ticket.id}
                                        onClick={() => toggleExpand(ticket)}
                                        className={cn(
                                            "group flex items-start gap-4 bg-white p-5 rounded-2xl border transition-all cursor-pointer hover:shadow-md relative overflow-hidden",
                                            isExpanded ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/20' : 'border-gray-200/80 shadow-sm'
                                        )}
                                    >
                                        {/* LEFT STRIP */}
                                        <div className={cn("absolute left-0 top-0 bottom-0 w-1.5",
                                            ticket.status === 'Resolved' ? "bg-teal-500" :
                                                (ticket.status === 'Assigned' || ticket.status === 'Ongoing') ? "bg-orange-500" : "bg-red-500"
                                        )}></div>

                                        {/* AVATAR */}
                                        <div className="flex-shrink-0 pt-1">
                                            <div className="h-10 w-10 rounded-xl overflow-hidden bg-gray-100 border border-gray-100 shadow-inner">
                                                <img
                                                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${ticket.customer_id}&backgroundColor=b6e3f4,c0aede,d1d4f9`}
                                                    alt="avatar"
                                                    className="h-full w-full object-cover"
                                                />
                                            </div>
                                        </div>

                                        {/* MAIN CONTENT */}
                                        <div className="flex-1 flex flex-col gap-2 min-w-0">

                                            {/* HEADER */}
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="font-bold text-gray-900 text-sm">@{customerId}</h3>
                                                        <span className="text-gray-300 text-xs font-medium">#{ticket.id}</span>
                                                        <Badge variant="secondary" className={cn("text-[10px] h-4 border-0 font-bold px-1.5",
                                                            ticket.priority === 'High' ? 'bg-red-100 text-red-600' :
                                                                ticket.priority === 'Low' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700'
                                                        )}>
                                                            {ticket.priority}
                                                        </Badge>
                                                    </div>
                                                    <div className="text-gray-400 text-[11px] font-medium mt-0.5">
                                                        {format(new Date(ticket.created_at), "EEE, MMM dd h:mm a")}
                                                    </div>
                                                </div>
                                                <div className="text-gray-300">
                                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                </div>
                                            </div>

                                            {/* TITLE & DESCRIPTION */}
                                            <div className="mt-1">
                                                <p className={cn("font-bold text-gray-900 text-sm mb-2 leading-snug", isExpanded ? "" : "line-clamp-2")}>
                                                    {ticket.description || ticket.issue_type}
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-medium border border-gray-200 text-[10px] px-2 h-5 rounded-md">
                                                        {ticket.issue_type}
                                                    </Badge>
                                                    {ticket.sub_issue && (
                                                        <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-medium border border-gray-200 text-[10px] px-2 h-5 rounded-md">
                                                            {ticket.sub_issue}
                                                        </Badge>
                                                    )}
                                                    {ticket.status === 'Open' && <Badge className="bg-red-50 text-red-600 border border-red-100 text-[10px] px-2 h-5 rounded-md">Active Issue</Badge>}
                                                </div>
                                            </div>

                                            {/* PROGRESS BAR */}
                                            <div className="mt-3">
                                                <div className="flex justify-between items-end mb-1.5">
                                                    <span className="font-bold text-gray-300 tracking-wider text-[9px] uppercase">Progress</span>
                                                    <span className={cn("font-bold text-[9px]", activeColor)}>{activeText}</span>
                                                </div>
                                                <div className="relative h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                                    <div className={cn("absolute top-0 left-0 h-full rounded-full", progressColor)} style={{ width: `${progressPercent}%` }}></div>
                                                </div>
                                                <div className="flex justify-between mt-1 text-[9px] text-gray-400">
                                                    <span>Created</span>
                                                    <span className={ticket.assigned_tech ? "text-gray-700 font-semibold" : ""}>Assigned</span>
                                                    <span className={ticket.status === 'Resolved' ? "text-teal-600 font-semibold" : ""}>Resolved</span>
                                                </div>
                                            </div>

                                            {/* EXPANDED DETAILS */}
                                            {isExpanded && (
                                                <div className="mt-4 pt-4 border-t border-dashed border-gray-100 animate-in fade-in slide-in-from-top-1 duration-200">

                                                    {/* Description */}
                                                    {ticket.description && (
                                                        <div className="mb-4 bg-gray-50/50 p-2.5 rounded-lg border border-gray-100">
                                                            <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description</h5>
                                                            <p className="text-xs text-gray-700 leading-relaxed">{ticket.description}</p>
                                                        </div>
                                                    )}

                                                    {ticket.status === 'Resolved' ? (
                                                        <>
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                                                    <CheckCircle2 className="h-3 w-3" />
                                                                </div>
                                                                <h4 className="text-[11px] font-bold text-gray-900 uppercase tracking-wider">Completion Report</h4>
                                                            </div>
                                                            <TechReportViewer
                                                                notes={ticket.internal_notes}
                                                                media={ticket.media}
                                                                materials={ticket.materials_used}
                                                                compact={true}
                                                            />
                                                        </>
                                                    ) : (
                                                        <div className="space-y-3">
                                                            <div className="flex items-center gap-2">
                                                                <div className={`h-2 w-2 rounded-full ${ticket.status === 'Assigned' ? 'bg-blue-500' : 'bg-red-500'}`}></div>
                                                                <h5 className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                                                                    {ticket.status === 'Assigned' ? `Ongoing (${ticket.assigned_tech || 'Unassigned'})` : 'Action Required'}
                                                                </h5>
                                                            </div>

                                                            {/* Internal Notes Input */}
                                                            <div className="bg-gray-50/80 p-3 rounded-xl border border-gray-200/60 shadow-sm" onClick={(e) => e.stopPropagation()}>
                                                                <div className="flex items-center gap-1.5 mb-2">
                                                                    <MessageSquare className="h-3 w-3 text-gray-400" />
                                                                    <h5 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Internal Notes</h5>
                                                                </div>
                                                                <div className="flex flex-col gap-2">
                                                                    <Input
                                                                        placeholder="Add update or note..."
                                                                        className="bg-white text-xs h-8 border-gray-200 focus-visible:ring-emerald-500/20"
                                                                        value={noteInput}
                                                                        onChange={(e) => setNoteInput(e.target.value)}
                                                                        onKeyDown={(e) => e.key === "Enter" && handleSaveNote(ticket.id)}
                                                                    />
                                                                    <div className="flex justify-end">
                                                                        <Button size="sm" className="h-7 px-3 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-700/10" onClick={(e) => handleSaveNote(ticket.id, e)} disabled={isSavingNote}>
                                                                            {isSavingNote ? "Saving..." : "Save Note"}
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Footer Info */}
                                                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50 text-[10px] text-gray-400">
                                                        <div className="flex items-center gap-2">
                                                            <span>Assignee</span>
                                                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 font-bold">
                                                                {ticket.assigned_tech ? (
                                                                    <>
                                                                        <div className="h-3.5 w-3.5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[8px]">{ticket.assigned_tech[0]}</div>
                                                                        <span>{ticket.assigned_tech}</span>
                                                                    </>
                                                                ) : (
                                                                    <span>Unassigned</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <Clock className="h-3 w-3" />
                                                            <span>Est: Today</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-[300px] text-center p-6">
                            <div className="h-12 w-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                <Search className="h-6 w-6 text-gray-300" />
                            </div>
                            <p className="text-sm font-medium text-gray-900">No tickets found</p>
                            <p className="text-xs text-gray-500 mt-1 max-w-[180px]">Try adjusting your search or filters</p>
                        </div>
                    )}
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
