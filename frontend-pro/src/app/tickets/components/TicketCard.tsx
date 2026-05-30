import React, { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { MoreHorizontal, AlertCircle, Activity, CheckCircle2, Clock, Trash2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Ticket } from "../hooks/useTickets";
import { TechReportViewer } from "./TechReportViewer";

interface TicketCardProps {
    ticket: Ticket;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onEdit: (ticket: Ticket) => void;
    onDelete: (id: number) => void;
    onViewDetails: (ticket: Ticket) => void;
}

export function TicketCard({ ticket, isExpanded, onToggleExpand, onEdit, onDelete, onViewDetails }: TicketCardProps) {
    const isPending = ticket.status === 'Open';
    const isResolved = ticket.status === 'Resolved';
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

    // Status & Progress Logic
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

    const avatarSeed = ticket.customer_id;

    return (
        <div onClick={onToggleExpand}
            className={cn(
                "group flex items-start gap-5 bg-white p-6 rounded-3xl border transition-all cursor-pointer hover:shadow-md relative overflow-hidden",
                isExpanded ? 'border-emerald-500 shadow-lg' : 'border-gray-100 shadow-sm'
            )}>
            {/* LEFT STRIP (Color Coded) */}
            <div className={cn("absolute left-0 top-0 bottom-0 w-1.5",
                ticket.status === 'Resolved' ? "bg-teal-500" :
                    (ticket.status === 'Assigned' || ticket.status === 'Ongoing') ? "bg-orange-500" : "bg-yellow-500"
            )}></div>

            {/* AVATAR */}
            <div className="flex-shrink-0">
                <div className="h-16 w-16 rounded-2xl overflow-hidden bg-gray-100 border border-gray-100 shadow-inner">
                    <img
                        src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}&backgroundColor=b6e3f4,c0aede,d1d4f9`}
                        alt="avatar"
                        className="h-full w-full object-cover"
                    />
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">

                {/* HEADER */}
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2">
                            <Link href={`/customers/show/${ticket.customer_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                                <h3 className="font-bold text-gray-900 text-lg">@{ticket.customer_id}</h3>
                            </Link>
                            <span className="text-gray-300 text-sm font-medium">#{ticket.id}</span>
                            <Badge variant="secondary" className={cn("text-[10px] h-5 border-0 font-bold",
                                ticket.priority === 'High' ? 'bg-red-100 text-red-600' :
                                    ticket.priority === 'Low' ? 'bg-gray-100 text-gray-500' : 'bg-yellow-100 text-yellow-700'
                            )}>
                                {ticket.priority}
                            </Badge>
                        </div>
                        <div className="text-gray-400 text-xs font-medium mt-0.5">
                            {format(new Date(ticket.created_at), "EEE, MMM dd h:mm a")}
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-300 hover:text-gray-900 -mr-2" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewDetails(ticket); }}>View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(ticket); }}>Edit Ticket</DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setIsDeleteDialogOpen(true); }} className="text-red-600">Delete Ticket</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                        <AlertDialogContent className="max-w-md">
                            <AlertDialogHeader>
                                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 mb-4">
                                    <Trash2 className="h-8 w-8 text-red-600" aria-hidden="true" />
                                </div>
                                <AlertDialogTitle className="text-center text-2xl font-bold">Delete Ticket?</AlertDialogTitle>
                                <AlertDialogDescription className="text-center text-gray-500 text-base">
                                    Are you sure you want to delete <span className="font-bold text-gray-900">Ticket #{ticket.id}</span>?
                                    This action cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="sm:justify-center gap-3 mt-4">
                                <AlertDialogCancel className="w-full sm:w-auto h-11 px-8 rounded-xl font-medium">Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={(e) => { e.stopPropagation(); onDelete(ticket.id); setIsDeleteDialogOpen(false); }}
                                    className="w-full sm:w-auto h-11 px-8 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md font-medium"
                                >
                                    Yes, Delete
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>

                {/* DESCRIPTION & TAGS */}
                <div>
                    <p className={cn("text-sm font-semibold text-gray-800 mb-2 transition-all", isExpanded ? "line-clamp-none" : "line-clamp-2")}>
                        {ticket.description || "No description provided."}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-medium border border-gray-200">{ticket.issue_type}</Badge>
                        {ticket.sub_issue && <Badge variant="secondary" className="bg-gray-100 text-gray-600 font-medium border border-gray-200">{ticket.sub_issue}</Badge>}
                    </div>
                </div>

                {/* PROGRESS SECTION */}
                <div className="mt-2 text-xs">
                    <div className="flex justify-between items-end mb-2">
                        <span className="font-bold text-gray-400 tracking-wider text-[10px] uppercase">Progress</span>
                        <span className={cn("font-bold text-[10px]", activeColor)}>{activeText}</span>
                    </div>
                    <div className="relative h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className={cn("absolute top-0 left-0 h-full rounded-full transition-all duration-1000", progressColor)} style={{ width: `${progressPercent}%` }}></div>
                    </div>
                    <div className="flex justify-between items-center mt-2 text-[10px] text-gray-400 font-medium">
                        <div className="text-left">
                            <span className="text-gray-900 font-bold block">Created</span>
                            <span className="scale-90 origin-left block opacity-70">{format(new Date(ticket.created_at), "EEE, MMM dd h:mm a")}</span>
                        </div>
                        <div className="text-center">
                            <div className={ticket.assigned_at || ticket.status === 'Assigned' || ticket.status === 'Ongoing' || ticket.status === 'Resolved' ? 'text-gray-900 font-bold' : ''}>Assigned</div>
                            {(ticket.assigned_at || ticket.status === 'Assigned' || ticket.status === 'Ongoing' || ticket.status === 'Resolved') && (
                                <span className="scale-90 block opacity-70">
                                    {ticket.assigned_at
                                        ? format(new Date(ticket.assigned_at), "EEE, MMM dd h:mm a")
                                        : format(new Date(ticket.created_at), "EEE, MMM dd h:mm a")}
                                </span>
                            )}
                        </div>
                        <div className="text-right">
                            <div className={ticket.status === 'Resolved' ? 'text-teal-700 font-bold' : ''}>Resolved</div>
                            {ticket.closed_at && <span className="text-teal-600 scale-90 origin-right block">{format(new Date(ticket.closed_at), "EEE, MMM dd h:mm a")}</span>}
                        </div>
                    </div>
                </div>

                {/* EXPANDED CONTENT: COMPLETION REPORT */}
                {isExpanded && ticket.status === 'Resolved' && (
                    <div className="mt-5 pt-5 border-t border-dashed border-gray-200 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                            </div>
                            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Completion Report</h4>
                        </div>

                        <TechReportViewer
                            notes={ticket.internal_notes}
                            media={ticket.media}
                            materials={ticket.materials_used}
                            compact={true}
                        />
                    </div>
                )}

                {/* FOOTER */}
                <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-50">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-medium">Assignee</span>
                        <div className="flex items-center gap-1.5 p-1 pr-2 rounded-full hover:bg-gray-50 transition-colors">
                            <Avatar className="h-5 w-5 bg-gray-200 border border-white shadow-sm">
                                <AvatarFallback className="text-[9px] bg-indigo-100 text-indigo-700">
                                    {ticket.assigned_tech ? ticket.assigned_tech[0] : "?"}
                                </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-bold text-gray-700">{ticket.assigned_tech || "Unassigned"}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">Status</span>
                            {ticket.status === 'Open' && <Badge className="bg-lime-50 text-lime-700 hover:bg-lime-100 border-lime-200 shadow-none font-bold px-2 py-0.5"><AlertCircle className="h-3 w-3 mr-1" /> Pending</Badge>}
                            {(ticket.status === 'Assigned' || ticket.status === 'Ongoing') && <Badge className="bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200 shadow-none font-bold px-2 py-0.5"><Activity className="h-3 w-3 mr-1" /> In Progress</Badge>}
                            {ticket.status === 'Resolved' && <Badge className="bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200 shadow-none font-bold px-2 py-0.5"><CheckCircle2 className="h-3 w-3 mr-1" /> Completed</Badge>}
                        </div>

                        <div className="flex items-center gap-1 text-gray-400 text-xs font-medium">
                            <Clock className="h-3.5 w-3.5" />
                            <span>Est: Today</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
