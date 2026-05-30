"use client";

import React from "react";
import Link from "next/link";
import { getInitials } from "../utils";

interface WorkloadItem {
    id: number;
    full_name: string;
    username: string;
    role: string;
    specialization: string;
    area: string | null;
    active_tickets: number;
    resolved_this_month: number;
    total_resolved: number;
    profile_photo: string | null;
}

export function WorkloadHeatmap({
    workload,
    loading,
}: {
    workload: WorkloadItem[];
    loading: boolean;
}) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100/50 p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Team Workload</h2>
                    <p className="text-sm text-gray-500">
                        Current ticket distribution across technicians
                    </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-green-100 border border-green-300" />
                        Low
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" />
                        Medium
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-red-100 border border-red-300" />
                        High
                    </span>
                </div>
            </div>
            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-36 bg-gray-50 rounded-xl animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {workload.map((w) => {
                        const load = w.active_tickets;
                        const bg =
                            load === 0
                                ? "bg-gray-50 border-gray-200"
                                : load <= 2
                                    ? "bg-green-50 border-green-200"
                                    : load <= 5
                                        ? "bg-amber-50 border-amber-200"
                                        : "bg-red-50 border-red-200";
                        const textColor =
                            load === 0
                                ? "text-gray-500"
                                : load <= 2
                                    ? "text-green-700"
                                    : load <= 5
                                        ? "text-amber-700"
                                        : "text-red-700";
                        return (
                            <Link key={w.id} href={`/technicians/show/${w.id}`}>
                                <div
                                    className={`p-4 rounded-xl border ${bg} hover:shadow-md transition-all cursor-pointer group`}
                                >
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="h-10 w-10 rounded-full bg-white border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">
                                            {getInitials(w.full_name)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-800 truncate">
                                                {w.full_name}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {w.specialization} · {w.role}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="text-center">
                                            <p className={`text-xl font-bold ${textColor}`}>
                                                {w.active_tickets}
                                            </p>
                                            <p className="text-[10px] text-gray-400">Active</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xl font-bold text-blue-600">
                                                {w.resolved_this_month}
                                            </p>
                                            <p className="text-[10px] text-gray-400">This Month</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xl font-bold text-gray-600">
                                                {w.total_resolved}
                                            </p>
                                            <p className="text-[10px] text-gray-400">Total</p>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
