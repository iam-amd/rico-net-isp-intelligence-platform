import React, { useState } from "react";
import { Ticket } from "../hooks/useTickets";
import { TicketCard } from "./TicketCard";
import { LayoutGrid, List as ListIcon, Calendar, ChevronRight, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TicketListProps {
    tickets: Ticket[];
    onEdit: (ticket: Ticket) => void;
    onDelete: (id: number) => void;
    onViewDetails: (ticket: Ticket) => void;
    searchTerm: string;
    statusFilter: string;
    setStatusFilter: (status: string) => void;
    stats: any;
}

export function TicketList({ tickets, onEdit, onDelete, onViewDetails, searchTerm, statusFilter, setStatusFilter, stats }: TicketListProps) {
    const [expandedTicketId, setExpandedTicketId] = useState<number | null>(null);
    const [viewMode, setViewMode] = useState<"list" | "grid">("list");

    const filteredTickets = tickets
        .filter(t => {
            const term = searchTerm.toLowerCase();
            return String(t.customer_id || "").toLowerCase().includes(term) ||
                String(t.issue_type || "").toLowerCase().includes(term) ||
                String(t.description || "").toLowerCase().includes(term) ||
                String(t.id).includes(term) ||
                String(t.customer?.first_name || "").toLowerCase().includes(term);
        })
        .filter(t => {
            if (statusFilter === "All") return true;
            if (statusFilter === "Assigned") return t.status === "Assigned" || t.status === "Ongoing";
            return t.status === statusFilter;
        })
        .sort((a, b) => {
            const statusOrder: Record<string, number> = { "Open": 1, "Assigned": 2, "Ongoing": 2, "Resolved": 3, "Closed": 4 };
            const orderDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
            if (orderDiff !== 0) return orderDiff;
            // Within same status, newest first
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-bold text-gray-900">Tickets</h2>
                    <p className="text-sm text-gray-500">Manage and track all customer support requests.</p>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto bg-gray-100/50 p-1 rounded-xl w-full overflow-x-auto hide-scrollbar">
                    {["All", "Open", "Assigned", "Ongoing", "Resolved", "Closed"].map((tab) => {
                        let count = 0;
                        if (tab === "All") count = tickets.length;
                        else if (stats) {
                            if (tab === "Open") count = stats.open_count;
                            else if (tab === "Assigned") count = stats.assigned_count;
                            else if (tab === "Ongoing") count = stats.ongoing_count;
                            else if (tab === "Resolved") count = stats.resolved_count;
                            else if (tab === "Closed") count = stats.closed_count;
                        } else {
                            count = tickets.filter(t => t.status === tab).length;
                        }

                        return (
                            <button
                                key={tab}
                                onClick={() => setStatusFilter(tab)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${statusFilter === tab
                                    ? "bg-white text-[#0C3B2E] shadow-sm ring-1 ring-gray-200/50"
                                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-200/50"
                                    }`}
                            >
                                {tab}
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusFilter === tab
                                        ? "bg-emerald-50 text-emerald-600"
                                        : "bg-gray-200/50 text-gray-500"
                                    }`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode("grid")}
                        className={`h-9 aspect-square p-0 rounded-lg border ${viewMode === "grid" ? "bg-[#0C3B2E] text-white border-[#0C3B2E]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                    >
                        <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewMode("list")}
                        className={`h-9 aspect-square p-0 rounded-lg border ${viewMode === "list" ? "bg-[#0C3B2E] text-white border-[#0C3B2E]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}
                    >
                        <ListIcon className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className={filteredTickets.length === 0 ? "" : (viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-4")}>
                {filteredTickets.length === 0 ? (
                    <div className="py-20 text-center flex flex-col items-center justify-center text-gray-500 bg-white rounded-3xl border border-gray-100 border-dashed animate-in fade-in duration-500">
                        <div className="h-16 w-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <Inbox className="h-8 w-8 text-gray-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">No tickets found</h3>
                        <p className="text-sm max-w-[250px]">We could not find any tickets that match your current filters.</p>
                    </div>
                ) : (
                    filteredTickets.map((ticket) => (
                        <TicketCard
                            key={ticket.id}
                            ticket={ticket}
                            isExpanded={viewMode === "list" && expandedTicketId === ticket.id}
                            onToggleExpand={() => setExpandedTicketId(expandedTicketId === ticket.id ? null : ticket.id)}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onViewDetails={onViewDetails}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

