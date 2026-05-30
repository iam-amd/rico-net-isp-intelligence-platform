import React, { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    MessageSquare, Clock, User, AlertTriangle, Undo2, MapPin, Phone,
    History, Send, ChevronDown, ChevronUp, ArrowRight,
} from "lucide-react";
// G-04 FIX: No longer imports useTickets — functions are passed as props to avoid duplicate API calls.
import { Ticket, TechnicianInfo, AuditLogEntry } from "../hooks/useTickets";
import { TechReportViewer } from "./TechReportViewer";

interface TicketDetailsSheetProps {
    ticket: Ticket | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUpdate: (id: number, data: any) => Promise<boolean>;
    technicians: TechnicianInfo[];
    onTicketRefresh?: (ticket: Ticket) => void;
    // G-04 FIX: Functions passed as props instead of calling useTickets() internally.
    addComment: (ticketId: number, content: string, isInternal?: boolean) => Promise<boolean>;
    fetchAuditLog: (ticketId: number) => Promise<AuditLogEntry[]>;
    fetchSingleTicket: (ticketId: number) => Promise<Ticket | null>;
}

// Helper: format relative time
function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) {
        const mins = Math.floor(diff / (1000 * 60));
        return `${mins}m ago`;
    }
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// Helper: is ticket overdue?
function isOverdue(ticket: Ticket): boolean {
    const hours = (Date.now() - new Date(ticket.created_at).getTime()) / (1000 * 60 * 60);
    if (["Open", "Assigned"].includes(ticket.status) && hours > 24) return true;
    if (ticket.status === "Ongoing" && ticket.started_at) {
        const ongoingHours = (Date.now() - new Date(ticket.started_at).getTime()) / (1000 * 60 * 60);
        if (ongoingHours > 48) return true;
    }
    return false;
}

const STATUS_COLORS: Record<string, string> = {
    Open: "bg-orange-50 text-orange-700 border-orange-200",
    Assigned: "bg-blue-50 text-blue-700 border-blue-200",
    Ongoing: "bg-purple-50 text-purple-700 border-purple-200",
    Resolved: "bg-green-50 text-green-700 border-green-200",
    Closed: "bg-gray-50 text-gray-600 border-gray-200",
};

const PRIORITY_COLORS: Record<string, string> = {
    Critical: "text-red-700 bg-red-50 border-red-200",
    High: "text-orange-600 bg-orange-50 border-orange-200",
    Normal: "text-yellow-600 bg-yellow-50 border-yellow-200",
    Low: "text-gray-600 bg-gray-50 border-gray-200",
};

const AUDIT_ACTION_LABELS: Record<string, { label: string; color: string }> = {
    status_change: { label: "Status Changed", color: "text-blue-600" },
    resolution: { label: "Resolved", color: "text-green-600" },
    enrichment: { label: "Data Updated", color: "text-purple-600" },
    assignment: { label: "Assigned", color: "text-amber-600" },
};

// G-04 FIX: Accepts addComment/fetchAuditLog/fetchSingleTicket as props; removed internal useTickets() call.
export function TicketDetailsSheet({ ticket, open, onOpenChange, onUpdate, technicians, onTicketRefresh, addComment, fetchAuditLog, fetchSingleTicket }: TicketDetailsSheetProps) {
    const [internalNoteInput, setInternalNoteInput] = useState("");
    const [commentInput, setCommentInput] = useState("");
    const [selectedTech, setSelectedTech] = useState<string>("");
    const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
    const [auditOpen, setAuditOpen] = useState(false);
    const [auditLoading, setAuditLoading] = useState(false);
    const [posting, setPosting] = useState(false);
    const [liveTicket, setLiveTicket] = useState<Ticket | null>(null);

    // Use liveTicket (refreshed) or fallback to prop
    const t = liveTicket || ticket;

    useEffect(() => {
        if (ticket) {
            setInternalNoteInput(ticket.internal_notes || "");
            setSelectedTech(ticket.assigned_tech || "");
            setLiveTicket(null); // Reset on new ticket
            setAuditLog([]);
            setAuditOpen(false);
        }
    }, [ticket]);

    // Load audit log when expanded
    useEffect(() => {
        if (auditOpen && t) {
            setAuditLoading(true);
            fetchAuditLog(t.id).then(entries => {
                setAuditLog(entries);
                setAuditLoading(false);
            });
        }
    }, [auditOpen, t?.id, t, fetchAuditLog]);

    const refreshTicket = async () => {
        if (!t) return;
        const fresh = await fetchSingleTicket(t.id);
        if (fresh) {
            setLiveTicket(fresh);
            onTicketRefresh?.(fresh);
        }
    };

    const handleSaveNote = async () => {
        if (!t) return;
        const ok = await onUpdate(t.id, { internal_notes: internalNoteInput });
        if (ok) await refreshTicket();
    };

    const handlePostComment = async () => {
        if (!t || !commentInput.trim()) return;
        setPosting(true);
        const ok = await addComment(t.id, commentInput.trim());
        if (ok) {
            setCommentInput("");
            await refreshTicket();
        }
        setPosting(false);
    };

    // --- STATUS TRANSITIONS (all refresh after action) ---
    const doAction = async (data: any, close = false) => {
        if (!t) return;
        const ok = await onUpdate(t.id, data);
        if (ok) {
            await refreshTicket();
            if (close) onOpenChange(false);
        }
    };

    const handleAssign = () => doAction({ assigned_tech: selectedTech }, true);
    const handleStartWork = () => doAction({ status: "Ongoing" });
    const handleResolve = () => doAction({ status: "Resolved" });
    const handleClose = () => doAction({ status: "Closed" }, true);
    // G-05 FIX: Closed tickets reopen to "Open" (no assignee required); Resolved tickets go to "Ongoing".
    const handleReopen = () => t?.status === "Closed"
        ? doAction({ status: "Open", assigned_tech: null })
        : doAction({ status: "Ongoing" });
    const handleUnassign = () => doAction({ status: "Open", assigned_tech: null });

    if (!t) return null;

    const overdue = isOverdue(t);
    const customerName = [t.customer?.first_name, t.customer?.last_name].filter(Boolean).join(" ") || t.customer_id;
    const customerAddress = t.customer?.rico_address || t.customer?.railwire_address || "No address on file";
    const customerPhone = t.customer?.phone || "No phone on file";

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-[540px] w-full p-0 flex flex-col bg-white border-l-0 shadow-2xl overflow-hidden">
                {/* HEADER - Clean and minimal */}
                <div className="px-8 pt-8 pb-6 border-b border-gray-100 bg-white z-10">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-400 uppercase tracking-widest">#{t.id}</span>
                            {overdue && (
                                <Badge variant="destructive" className="text-[10px] px-2 py-0.5 bg-red-50 text-red-600 border border-red-100 hover:bg-red-50 rounded-full font-medium shadow-none">
                                    <AlertTriangle className="h-3 w-3 mr-1" /> OVERDUE
                                </Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="secondary" className={`px-2.5 py-0.5 rounded-full font-medium shadow-none bg-opacity-50 ${PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.Normal}`}>
                                {t.priority}
                            </Badge>
                            <Badge variant="secondary" className={`px-2.5 py-0.5 rounded-full font-medium shadow-none bg-opacity-50 ${STATUS_COLORS[t.status] || ""}`}>
                                {t.status}
                            </Badge>
                        </div>
                    </div>

                    <SheetTitle className="text-2xl font-semibold tracking-tight text-gray-900 mb-1">
                        {t.issue_type}
                    </SheetTitle>
                    {t.sub_issue && (
                        <p className="text-base text-gray-500">
                            {t.sub_issue}
                        </p>
                    )}
                </div>

                {/* CONTENT AREA */}
                <div className="flex-1 overflow-y-auto px-8 py-8 space-y-10">
                    {/* Section: Customer */}
                    <section>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Customer Details</h4>
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-lg font-medium text-gray-900">{customerName}</h3>
                                <p className="text-sm text-gray-500 mb-3">@{t.customer_id}</p>
                                <div className="space-y-2">
                                    <div className="flex items-start gap-2.5 text-sm text-gray-600">
                                        <MapPin className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                        <span className="leading-tight flex-1">{customerAddress}</span>
                                    </div>
                                    <div className="flex items-center gap-2.5 text-sm text-gray-600">
                                        <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                        <span>{customerPhone}</span>
                                    </div>
                                </div>
                            </div>
                            {customerPhone !== "No phone on file" && (
                                <a href={`tel:${customerPhone}`} className="transition-transform hover:scale-105 active:scale-95 ml-4">
                                    <div className="h-10 w-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100">
                                        <Phone className="h-4 w-4" />
                                    </div>
                                </a>
                            )}
                        </div>
                    </section>
                    
                    <hr className="border-gray-100" />

                    {/* Section: Description */}
                    <section>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Description</h4>
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {t.description || "No description provided."}
                        </p>
                        {t.tags && t.tags.trim() && (
                            <div className="flex flex-wrap gap-2 mt-4">
                                {t.tags.split(",").filter((tag: string) => tag.trim()).map((tag: string) => (
                                    <span key={tag} className="px-2.5 py-1 bg-gray-50 border border-gray-100 text-gray-600 text-xs rounded-md font-medium">
                                        {tag.trim()}
                                    </span>
                                ))}
                            </div>
                        )}
                    </section>

                    <hr className="border-gray-100" />

                    {/* Section: Technician Assignment */}
                    {t.status === "Open" && (
                        <>
                            <section>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Assignment</h4>
                                <Select value={selectedTech} onValueChange={setSelectedTech}>
                                    <SelectTrigger className="w-full h-12 bg-gray-50 border-gray-200 text-sm focus:ring-gray-200 rounded-xl px-4 transition-colors hover:bg-white">
                                        <SelectValue placeholder="Select a technician to assign..." />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-gray-100 shadow-xl">
                                        {technicians.map(tech => (
                                            <SelectItem key={tech.username} value={tech.username} className="py-3">
                                                <div className="flex items-center justify-between w-full pr-2">
                                                    <span className="font-medium text-gray-900">{tech.full_name}</span>
                                                    <span className="text-xs text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">{tech.active_tickets} active</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </section>
                            <hr className="border-gray-100" />
                        </>
                    )}

                    {/* Section: Completion Report */}
                    {(t.status === "Resolved" || t.status === "Closed") && (
                        <>
                            <section>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Completion Report</h4>
                                {t.resolution_remarks && (
                                    <div className="mb-5 bg-emerald-50/50 border border-emerald-100 p-4 rounded-xl">
                                        <h5 className="text-[10px] font-bold text-emerald-600/80 uppercase tracking-wider mb-2">Remarks</h5>
                                        <p className="text-sm text-emerald-950 leading-relaxed font-medium">{t.resolution_remarks}</p>
                                    </div>
                                )}
                                <TechReportViewer notes={t.internal_notes} media={t.media} materials={t.materials_used} />
                            </section>
                            <hr className="border-gray-100" />
                        </>
                    )}

                    {/* Section: Comments */}
                    <section>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5 flex items-center justify-between">
                            <span>Comments</span>
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px]">{t.comments?.length || 0}</span>
                        </h4>
                        
                        <div className="space-y-6 mb-6">
                            {t.comments && t.comments.length > 0 ? (
                                t.comments.map(comment => (
                                    <div key={comment.id} className="relative pl-4 border-l-[3px] border-gray-100/80">
                                        <div className="flex items-center gap-2.5 mb-1.5">
                                            <span className="font-semibold text-sm text-gray-900">{comment.author}</span>
                                            <span className="text-xs text-gray-400 font-medium">{timeAgo(comment.created_at)}</span>
                                            {comment.is_internal && (
                                                <span className="text-[10px] font-bold text-amber-700 bg-amber-100/50 px-1.5 py-0.5 rounded tracking-wide uppercase">Internal</span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600 leading-relaxed">{comment.content}</p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-gray-400 italic">No comments yet</p>
                            )}
                        </div>

                        <div className="relative flex items-end gap-2">
                            <Input
                                placeholder="Write a comment..."
                                className="bg-gray-50 border-gray-200 focus:bg-white text-sm h-12 px-4 rounded-xl flex-1 pr-14 focus-visible:ring-2 focus-visible:ring-gray-200 focus-visible:border-gray-300 transition-all font-medium placeholder:font-normal"
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handlePostComment()}
                                disabled={posting}
                            />
                            <Button
                                size="icon"
                                className="absolute right-1.5 top-1.5 h-9 w-9 bg-gray-900 hover:bg-gray-800 text-white rounded-lg shadow-sm transition-transform active:scale-95"
                                onClick={handlePostComment}
                                disabled={posting || !commentInput.trim()}
                            >
                                <Send className="h-4 w-4 ml-0.5" />
                            </Button>
                        </div>
                    </section>

                    {/* Section: Internal Note */}
                    {!["Resolved", "Closed"].includes(t.status) && (
                        <section className="bg-gradient-to-br from-amber-50/80 to-amber-50/30 p-5 -mx-5 rounded-2xl border border-amber-100/60 shadow-sm">
                            <h4 className="text-[10px] font-bold text-amber-600/80 uppercase tracking-widest mb-3 px-1">Internal Staff Note</h4>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <Input 
                                    placeholder="Add private note for staff..." 
                                    className="bg-white/80 backdrop-blur-sm border-amber-200/50 text-sm h-11 px-4 shadow-sm focus-visible:ring-amber-200 focus-visible:border-amber-300 rounded-xl placeholder:text-amber-300/80 flex-1 font-medium" 
                                    value={internalNoteInput} 
                                    onChange={(e) => setInternalNoteInput(e.target.value)} 
                                    onKeyDown={(e) => e.key === "Enter" && handleSaveNote()} 
                                />
                                <Button size="sm" variant="ghost" className="h-11 px-4 text-amber-700 bg-amber-100/50 hover:bg-amber-200/50 hover:text-amber-900 rounded-xl font-medium transition-colors" onClick={handleSaveNote}>
                                    Save Note
                                </Button>
                            </div>
                        </section>
                    )}

                    {/* Section: Timeline & Activity log merged visually */}
                    <section>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-6">Timeline</h4>
                        <div className="relative border-l-2 border-gray-100 ml-2.5 space-y-7 pb-2">
                            {/* Created */}
                            <div className="relative pl-6">
                                <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-white border-2 border-gray-300 ring-4 ring-white" />
                                <p className="text-sm font-semibold text-gray-900 leading-none mb-1.5">Ticket Created</p>
                                <p className="text-xs text-gray-500 font-medium">{new Date(t.created_at).toLocaleString()}</p>
                            </div>

                            {/* Assigned */}
                            {t.assigned_at && (
                                <div className="relative pl-6">
                                    <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-white border-2 border-blue-400 ring-4 ring-white" />
                                    <p className="text-sm font-semibold text-gray-900 leading-none mb-1.5">Assigned to {t.assigned_tech}</p>
                                    <p className="text-xs text-gray-500 font-medium">{new Date(t.assigned_at).toLocaleString()}</p>
                                </div>
                            )}

                            {/* Ongoing */}
                            {t.started_at && (
                                <div className="relative pl-6">
                                    <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-white border-2 border-purple-400 ring-4 ring-white" />
                                    <p className="text-sm font-semibold text-gray-900 leading-none mb-1.5">Work Started</p>
                                    <p className="text-xs text-gray-500 font-medium">{new Date(t.started_at).toLocaleString()}</p>
                                </div>
                            )}

                            {/* Resolved */}
                            {t.resolved_at && (
                                <div className="relative pl-6">
                                    <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-white border-2 border-emerald-400 ring-4 ring-white" />
                                    <p className="text-sm font-semibold text-gray-900 leading-none mb-1.5">Resolved</p>
                                    <p className="text-xs text-gray-500 font-medium">{new Date(t.resolved_at).toLocaleString()}</p>
                                </div>
                            )}

                            {/* Closed */}
                            {t.closed_at && (
                                <div className="relative pl-6">
                                    <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-white border-2 border-gray-900 ring-4 ring-white" />
                                    <p className="text-sm font-semibold text-gray-900 leading-none mb-1.5">Closed</p>
                                    <p className="text-xs text-gray-500 font-medium">{new Date(t.closed_at).toLocaleString()}</p>
                                </div>
                            )}
                        </div>

                        {/* Collapsible Audit Trail */}
                        <div className="mt-10 border border-gray-100 rounded-2xl overflow-hidden bg-gray-50/50 transition-all hover:bg-gray-50">
                            <button
                                onClick={() => setAuditOpen(!auditOpen)}
                                className="w-full flex items-center justify-between p-4 bg-transparent text-sm font-semibold text-gray-700"
                            >
                                <span className="flex items-center gap-2">
                                    <History className="h-4 w-4 text-gray-400" /> 
                                    Detailed History Logs
                                    {auditLog.length > 0 && <span className="text-xs font-medium text-gray-500 bg-gray-200/50 px-2 py-0.5 rounded-full ml-1">{auditLog.length}</span>}
                                </span>
                                {auditOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            
                            {auditOpen && (
                                <div className="p-4 border-t border-gray-100/80 bg-white/50 space-y-5">
                                    {auditLoading ? (
                                        <p className="text-center text-xs text-gray-400 py-4 font-medium animate-pulse">Loading logs...</p>
                                    ) : auditLog.length === 0 ? (
                                        <p className="text-center text-xs text-gray-400 py-4 font-medium">No detailed logs found.</p>
                                    ) : (
                                        auditLog.map(entry => {
                                            const meta = AUDIT_ACTION_LABELS[entry.action] || { label: entry.action, color: "text-gray-900" };
                                            return (
                                                <div key={entry.id} className="text-xs relative pl-3 before:absolute before:left-0 before:top-1.5 before:w-1.5 before:h-1.5 before:bg-gray-200 before:rounded-full">
                                                    <div className="flex items-center gap-1.5 mb-1.5">
                                                        <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                                                        <span className="text-gray-300">•</span>
                                                        <span className="text-gray-500 font-medium">{new Date(entry.changed_at).toLocaleString()}</span>
                                                    </div>
                                                    <div className="text-gray-700">
                                                        {entry.field_name && <span className="mr-1.5 font-medium text-gray-500">{entry.field_name.replace("_", " ")}:</span>}
                                                        {entry.old_value && entry.new_value ? (
                                                            <span className="inline-flex items-center gap-2">
                                                                <span className="line-through text-gray-400">{entry.old_value}</span>
                                                                <ArrowRight className="h-3 w-3 text-gray-300" />
                                                                <span className="text-gray-900 font-semibold bg-gray-100/80 px-1.5 py-0.5 rounded shadow-sm">{entry.new_value}</span>
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-500 font-medium italic">Record updated</span>
                                                        )}
                                                        <p className="text-gray-400 mt-1.5 text-[10px] uppercase font-bold tracking-wider">by User ID {entry.changed_by}</p>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* FOOTER ACTIONS - Sleek fixed bottom with glassmorphism */}
                <div className="px-8 py-5 border-t border-gray-100 bg-white/95 backdrop-blur-md shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.08)] z-10 w-full">
                    <div className="w-full">
                        {t.status === "Open" && (
                            <Button
                                className="w-full h-12 text-sm font-semibold bg-gray-900 hover:bg-gray-800 text-white rounded-xl shadow-lg shadow-gray-200 transition-all active:scale-[0.98]"
                                onClick={handleAssign}
                                disabled={!selectedTech}
                            >
                                <User className="h-4 w-4 mr-2" /> 
                                {selectedTech ? `Assign to ${selectedTech}` : "Select a technician"}
                            </Button>
                        )}

                        {t.status === "Assigned" && (
                            <div className="flex gap-3">
                                <Button
                                    className="flex-1 h-12 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-lg shadow-purple-200 transition-all active:scale-[0.98]"
                                    onClick={handleStartWork}
                                >
                                    Start Working
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-12 px-5 rounded-xl border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                                    onClick={handleUnassign}
                                >
                                    <Undo2 className="h-4 w-4" />
                                </Button>
                            </div>
                        )}

                        {t.status === "Ongoing" && (
                            <Button
                                className="w-full h-12 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg shadow-emerald-200 transition-all active:scale-[0.98]"
                                onClick={handleResolve}
                            >
                                Mark as Resolved
                            </Button>
                        )}

                        {t.status === "Resolved" && (
                            <div className="flex gap-3">
                                <Button
                                    className="flex-1 h-12 text-sm font-semibold bg-gray-900 hover:bg-gray-800 text-white rounded-xl shadow-lg shadow-gray-200 transition-all active:scale-[0.98]"
                                    onClick={handleClose}
                                >
                                    Close Ticket
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1 h-12 text-sm font-semibold border-amber-200 text-amber-700 hover:bg-amber-50 rounded-xl transition-colors"
                                    onClick={handleReopen}
                                >
                                    Reopen
                                </Button>
                            </div>
                        )}

                        {t.status === "Closed" && (
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-500 font-semibold flex items-center gap-1.5">
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" /> 
                                    Ticket Securely Closed
                                </span>
                                <Button
                                    variant="ghost"
                                    className="text-amber-700 font-semibold hover:text-amber-800 hover:bg-amber-50 rounded-lg px-4 transition-colors"
                                    onClick={handleReopen}
                                >
                                    Reopen
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
