"use client";

import React, { useState, useMemo } from "react";
import { useTickets, Ticket } from "./hooks/useTickets";
import { TicketList } from "./components/TicketList";
import { StatsOverview } from "./components/StatsOverview";
import { CreateTicketDialog } from "./components/CreateTicketDialog";
import { TicketDetailsSheet } from "./components/TicketDetailsSheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, ChevronRight, Filter, Calendar as CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

export default function TicketsPage() {
    // G-04 FIX: Also destructure addComment/fetchAuditLog/fetchSingleTicket to pass down as props.
    const { tickets, technicians, stats, createTicket, updateTicket, deleteTicket, fetchTickets, fetchStats, addComment, fetchAuditLog, fetchSingleTicket } = useTickets();
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState<"All" | "Open" | "Assigned" | "Ongoing" | "Resolved" | "Closed">("All");
    const [priorityFilter, setPriorityFilter] = useState<"All" | "Critical" | "High" | "Normal" | "Low">("All");
    const [date, setDate] = useState<DateRange | undefined>();

    // Dialog & Sheet State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    const handleEditStart = (ticket: Ticket) => {
        setEditingTicket(ticket);
        setIsCreateOpen(true);
    };

    const handleDetailsOpen = (ticket: Ticket) => {
        setSelectedTicket(ticket);
        setIsSheetOpen(true);
    };

    // --- CSV EXPORT ---
    const handleExport = () => {
        const filtered = filteredTickets;
        if (filtered.length === 0) return;

        const headers = ["ID", "Customer", "Issue Type", "Sub Issue", "Status", "Priority", "Assigned Tech", "Description", "Created At", "Resolved At"];
        const rows = filtered.map(t => [
            t.id,
            t.customer_id,
            t.issue_type,
            t.sub_issue || "",
            t.status,
            t.priority,
            t.assigned_tech || "",
            `"${(t.description || "").replace(/"/g, '""')}"`,
            new Date(t.created_at).toLocaleDateString(),
            t.resolved_at ? new Date(t.resolved_at).toLocaleDateString() : "",
        ].join(","));

        const csv = [headers.join(","), ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tickets_export_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // --- FILTERED TICKETS (client-side on loaded data) ---
    const filteredTickets = useMemo(() => {
        let result = [...tickets];

        // Status filter
        if (statusFilter !== "All") {
            if (statusFilter === "Assigned") {
                result = result.filter(t => t.status === "Assigned" || t.status === "Ongoing");
            } else if (statusFilter === "Resolved") {
                result = result.filter(t => t.status === "Resolved" || t.status === "Closed");
            } else {
                result = result.filter(t => t.status === statusFilter);
            }
        }

        // Priority filter
        if (priorityFilter !== "All") {
            result = result.filter(t => t.priority === priorityFilter);
        }

        // Date range filter
        if (date?.from) {
            result = result.filter(t => new Date(t.created_at) >= date.from!);
        }
        if (date?.to) {
            const toDate = new Date(date.to);
            toDate.setHours(23, 59, 59, 999);
            result = result.filter(t => new Date(t.created_at) <= toDate);
        }

        // Search filter
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            result = result.filter(t =>
                String(t.customer_id || "").toLowerCase().includes(q) ||
                String(t.issue_type || "").toLowerCase().includes(q) ||
                String(t.description || "").toLowerCase().includes(q) ||
                String(t.id).includes(q) ||
                String(t.customer?.first_name || "").toLowerCase().includes(q)
            );
        }

        return result;
    }, [tickets, statusFilter, priorityFilter, date, searchTerm]);

    // Refresh the sheet ticket after status updates
    const handleTicketRefresh = (freshTicket: Ticket) => {
        setSelectedTicket(freshTicket);
    };

    // Wrap updateTicket to also refresh stats & list
    const handleUpdate = async (id: number, data: any): Promise<boolean> => {
        const ok = await updateTicket(id, data);
        if (ok) {
            fetchTickets();
            fetchStats();
        }
        return ok;
    };

    return (
        <ErrorBoundary fallbackTitle="Tickets page failed to load">
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* HEAD */}
                <header className="px-8 py-4 bg-white border-b border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm text-gray-500 font-medium">
                            <span className="hover:text-gray-900 cursor-pointer">Home</span>
                            <ChevronRight className="h-4 w-4" />
                            <span className="text-gray-900 font-bold">Tickets</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" className="h-9 text-gray-600 border-gray-200 hover:bg-gray-50 text-sm" onClick={handleExport}>
                                <Download className="mr-1.5 h-3.5 w-3.5 text-gray-400" /> Export CSV
                            </Button>
                            <Button onClick={() => { setEditingTicket(null); setIsCreateOpen(true); }} className="h-9 bg-[#0C3B2E] hover:bg-[#062b21] text-white shadow-lg shadow-emerald-900/20 text-sm">
                                Create New Ticket
                            </Button>
                        </div>
                    </div>

                    {/* Filters Row */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative group flex-1 min-w-[200px] max-w-[300px]">
                            <Search className="absolute left-3 top-2 h-4 w-4 text-gray-400 group-hover:text-emerald-600 transition-colors" />
                            <Input
                                placeholder="Search tickets..."
                                className="pl-9 h-9 bg-gray-50 border-gray-200 rounded-lg text-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        {/* Priority Filter */}
                        <div className="flex items-center gap-1.5">
                            <Filter className="h-3.5 w-3.5 text-gray-400" />
                            <select
                                className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none"
                                value={priorityFilter}
                                onChange={(e) => setPriorityFilter(e.target.value as any)}
                            >
                                <option value="All">All Priorities</option>
                                <option value="Critical">Critical</option>
                                <option value="High">High</option>
                                <option value="Normal">Normal</option>
                                <option value="Low">Low</option>
                            </select>
                        </div>

                        {/* Date Range */}
                        <div className={cn("grid gap-2")}>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn(
                                            "h-9 w-[260px] justify-start text-left font-normal bg-white border-gray-200 text-sm",
                                            !date && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4 text-gray-400" />
                                        {date?.from ? (
                                            date.to ? (
                                                <>
                                                    {format(date.from, "LLL dd, y")} -{" "}
                                                    {format(date.to, "LLL dd, y")}
                                                </>
                                            ) : (
                                                format(date.from, "LLL dd, y")
                                            )
                                        ) : (
                                            <span>Pick a date range</span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={date?.from}
                                        selected={date}
                                        onSelect={setDate}
                                        numberOfMonths={2}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Active Filters */}
                        {(priorityFilter !== "All" || date) && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-red-500 hover:text-red-700 h-9"
                                onClick={() => { setPriorityFilter("All"); setDate(undefined); }}
                            >
                                Clear Filters
                            </Button>
                        )}
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8">
                    <div className="grid grid-cols-12 gap-8 max-w-[1600px] mx-auto relative">
                        {/* LEFT COL: TICKET LIST (8 SPAN) */}
                        <div className="col-span-12 lg:col-span-8">
                            <TicketList
                                tickets={filteredTickets}
                                onEdit={handleEditStart}
                                onDelete={deleteTicket}
                                onViewDetails={handleDetailsOpen}
                                searchTerm={searchTerm}
                                statusFilter={statusFilter}
                                setStatusFilter={setStatusFilter as any}
                                stats={stats}
                            />
                        </div>

                        {/* RIGHT COL: STATS WIDGETS (STICKY) */}
                        <div className="col-span-12 lg:col-span-4 h-fit sticky top-0">
                            <StatsOverview
                                tickets={filteredTickets}
                                stats={stats}
                                statusFilter={statusFilter}
                                setStatusFilter={setStatusFilter}
                            />

                            {/* EXTRA: Top Categories (Dynamic) */}
                            <div className="mt-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-gray-900">Top Categories</h3>
                                </div>
                                {Object.entries(
                                    tickets.reduce((acc, t) => {
                                        acc[t.issue_type] = (acc[t.issue_type] || 0) + 1;
                                        return acc;
                                    }, {} as Record<string, number>)
                                )
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 3)
                                    .map(([category, count], idx) => (
                                        <div key={category} className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between ${idx > 0 ? 'mt-2' : ''}`}>
                                            <span className="font-bold text-sm">{category}</span>
                                            <Badge className={`${idx === 0 ? 'bg-[#0C3B2E]' : idx === 1 ? 'bg-orange-500' : 'bg-indigo-500'} text-white font-mono`}>
                                                {count}
                                            </Badge>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>

                <CreateTicketDialog
                    open={isCreateOpen}
                    onOpenChange={setIsCreateOpen}
                    onCreate={createTicket}
                    onUpdate={updateTicket}
                    editingTicket={editingTicket}
                />

                {/* G-04 FIX: Pass functions as props so TicketDetailsSheet doesn't call useTickets() itself. */}
                <TicketDetailsSheet
                    ticket={selectedTicket}
                    open={isSheetOpen}
                    onOpenChange={setIsSheetOpen}
                    onUpdate={handleUpdate}
                    technicians={technicians}
                    onTicketRefresh={handleTicketRefresh}
                    addComment={addComment}
                    fetchAuditLog={fetchAuditLog}
                    fetchSingleTicket={fetchSingleTicket}
                />
            </div>
        </div>
        </ErrorBoundary>
    );
}
