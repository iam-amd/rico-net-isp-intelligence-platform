import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Activity, CheckCircle2, Inbox, AlertTriangle, Clock } from "lucide-react";
import { Ticket, TicketStats } from "../hooks/useTickets";

type StatusFilter = "All" | "Open" | "Assigned" | "Ongoing" | "Resolved" | "Closed";

interface StatsOverviewProps {
    tickets: Ticket[];
    stats: TicketStats | null;
    statusFilter: StatusFilter;
    setStatusFilter: (status: StatusFilter) => void;
}

export function StatsOverview({ tickets, stats, statusFilter, setStatusFilter }: StatsOverviewProps) {
    // Prefer API stats, fallback to client-side calculation
    const openCount = stats?.open_count ?? tickets.filter(t => t.status === "Open").length;
    const workingCount = stats ? (stats.assigned_count + stats.ongoing_count) : tickets.filter(t => t.status === "Assigned" || t.status === "Ongoing").length;
    const resolvedCount = stats ? (stats.resolved_count + stats.closed_count) : tickets.filter(t => t.status === "Resolved" || t.status === "Closed").length;
    const overdueCount = stats?.overdue_count ?? 0;
    const createdToday = stats?.created_today ?? 0;
    const resolvedToday = stats?.resolved_today ?? 0;

    return (
        <div className="space-y-4">
            {/* STAT CARDS GRID */}
            <div className="grid grid-cols-2 gap-4">
                {/* 1. PENDING (ORANGE) */}
                <div onClick={() => setStatusFilter('Open')} className="cursor-pointer transition-transform hover:scale-[1.02] col-span-1">
                    <Card className={`border-0 shadow-lg shadow-orange-500/10 bg-gradient-to-br from-orange-400 to-orange-500 text-white rounded-2xl overflow-hidden relative ${statusFilter === 'Open' ? 'ring-4 ring-orange-300 ring-offset-2' : ''} h-32`}>
                        <CardContent className="p-4 flex flex-col justify-between h-full relative z-10">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-white/20 w-fit rounded-lg backdrop-blur-sm"><AlertCircle className="h-4 w-4 text-white" /></div>
                                <h3 className="text-2xl font-bold">{openCount}</h3>
                            </div>
                            <div>
                                <p className="text-orange-50 font-bold text-xs opacity-90">Pending</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 2. IN PROGRESS (GREY/WORKING) */}
                <div onClick={() => setStatusFilter('Assigned')} className="cursor-pointer transition-transform hover:scale-[1.02] col-span-1">
                    <Card className={`border-0 shadow-sm bg-gray-200 text-gray-600 rounded-2xl overflow-hidden relative ${statusFilter === 'Assigned' || statusFilter === 'Ongoing' ? 'ring-4 ring-gray-400 ring-offset-2' : ''} h-32`}>
                        <CardContent className="p-4 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-white/40 w-fit rounded-lg"><Activity className="h-4 w-4" /></div>
                                <h3 className="text-2xl font-bold text-gray-800">{workingCount}</h3>
                            </div>
                            <div>
                                <p className="text-gray-500 text-xs">In Progress</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 3. COMPLETED (TEAL) */}
                <div onClick={() => setStatusFilter('Resolved')} className="cursor-pointer transition-transform hover:scale-[1.02] col-span-1">
                    <Card className={`border-0 shadow-sm bg-[#1B4D3E] text-white rounded-2xl overflow-hidden relative ${statusFilter === 'Resolved' ? 'ring-4 ring-emerald-500 ring-offset-2' : ''} h-32`}>
                        <CardContent className="p-4 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-white/10 w-fit rounded-lg"><CheckCircle2 className="h-4 w-4" /></div>
                                <h3 className="text-2xl font-bold">{resolvedCount}</h3>
                            </div>
                            <div>
                                <p className="text-emerald-100/70 text-xs text-nowrap">Completed</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 4. ALL TICKETS (INDIGO) */}
                <div onClick={() => setStatusFilter('All')} className="cursor-pointer transition-transform hover:scale-[1.02] col-span-1">
                    <Card className={`border-0 shadow-lg shadow-indigo-500/10 bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-2xl overflow-hidden relative ${statusFilter === 'All' ? 'ring-4 ring-indigo-300 ring-offset-2' : ''} h-32`}>
                        <CardContent className="p-4 flex flex-col justify-between h-full relative z-10">
                            <div className="flex justify-between items-start">
                                <div className="p-2 bg-white/20 w-fit rounded-lg backdrop-blur-sm"><Inbox className="h-4 w-4 text-white" /></div>
                                <h3 className="text-2xl font-bold">{stats ? (stats.open_count + stats.assigned_count + stats.ongoing_count + stats.resolved_count + stats.closed_count) : tickets.length}</h3>
                            </div>
                            <div>
                                <p className="text-indigo-100 font-medium text-xs">All Tickets</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* QUICK STATS BAR */}
            {stats && (
                <div className="flex items-center gap-3 text-xs">
                    {overdueCount > 0 && (
                        <div className="flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1.5 rounded-full font-semibold border border-red-100">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {overdueCount} Overdue
                        </div>
                    )}
                    <div className="flex items-center gap-1.5 bg-white text-gray-600 px-3 py-1.5 rounded-full border border-gray-200">
                        <Clock className="h-3.5 w-3.5" />
                        {createdToday} Created Today
                    </div>
                    <div className="flex items-center gap-1.5 bg-green-50 text-green-700 px-3 py-1.5 rounded-full border border-green-100">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {resolvedToday} Resolved Today
                    </div>
                </div>
            )}
        </div>
    );
}
