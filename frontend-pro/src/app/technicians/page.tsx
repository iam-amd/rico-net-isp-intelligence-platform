"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useApiUrl } from "@refinedev/core";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import {
    Users,
    UserCheck,
    UserX,
    Briefcase,
    LayoutGrid,
    List,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import type { TechnicianItem, TechStats } from "./types";
import { StatsCard } from "./components/StatsCard";
import { CreateTechnicianDialog } from "./components/CreateTechnicianDialog";
import { TechnicianTable } from "./components/TechnicianTable";
import { WorkloadHeatmap } from "./components/WorkloadHeatmap";

// ─── Constants ─────────────────────────────────────────────────
const PAGE_SIZE = 30;
const DEBOUNCE_MS = 300;

// ─── Debounce hook ─────────────────────────────────────────────
function useDebounce(value: string, delay: number) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

// ─── Main Page ─────────────────────────────────────────────────
export default function TechniciansPage() {
    const apiUrl = useApiUrl();

    // State
    const [techs, setTechs] = useState<TechnicianItem[]>([]);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState<TechStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);

    // Filters
    const [statusFilter, setStatusFilter] = useState("all");
    const [searchInput, setSearchInput] = useState("");
    const [specFilter, setSpecFilter] = useState("all");
    const [areaFilter, setAreaFilter] = useState("all");

    // Debounced search
    const debouncedSearch = useDebounce(searchInput, DEBOUNCE_MS);

    // View mode
    const [viewMode, setViewMode] = useState<"list" | "heatmap">("list");

    // Heatmap data
    const [workload, setWorkload] = useState<any[]>([]);
    const [workloadLoading, setWorkloadLoading] = useState(false);

    // Reload trigger
    const [reloadKey, setReloadKey] = useState(0);
    const triggerReload = useCallback(() => setReloadKey((k) => k + 1), []);

    // Fetch stats
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${apiUrl}/technicians/stats`, {
                    headers: getAuthHeaders(),
                });
                if (handle401(res)) return;
                if (res.ok) setStats(await res.json());
                else toast.error("Failed to load technician stats");
            } catch {
                toast.error("Failed to load technician stats");
            }
        })();
    }, [apiUrl, reloadKey]);

    // Fetch technicians list
    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const url = new URL(`${apiUrl}/technicians/`);
                url.searchParams.set("skip", String((page - 1) * PAGE_SIZE));
                url.searchParams.set("limit", String(PAGE_SIZE));
                if (debouncedSearch.trim())
                    url.searchParams.set("q", debouncedSearch.trim());
                if (statusFilter !== "all")
                    url.searchParams.set("status_filter", statusFilter);
                if (specFilter !== "all")
                    url.searchParams.set("specialization", specFilter);
                if (areaFilter !== "all")
                    url.searchParams.set("area", areaFilter);

                const res = await fetch(url.toString(), {
                    headers: getAuthHeaders(),
                });
                if (handle401(res)) return;
                if (res.ok) {
                    const data = await res.json();
                    setTechs(data.items || []);
                    setTotal(data.total || 0);
                } else {
                    toast.error("Failed to load technicians list");
                }
            } catch {
                toast.error("Failed to load technicians");
            }
            setLoading(false);
        })();
    }, [apiUrl, page, debouncedSearch, statusFilter, specFilter, areaFilter, reloadKey]);

    // Fetch workload data when switching to heatmap view
    useEffect(() => {
        if (viewMode !== "heatmap") return;
        (async () => {
            setWorkloadLoading(true);
            try {
                const res = await fetch(`${apiUrl}/technicians/workload`, {
                    headers: getAuthHeaders(),
                });
                if (handle401(res)) return;
                if (res.ok) {
                    const data = await res.json();
                    setWorkload(data.technicians || []);
                } else {
                    toast.error("Failed to load workload data");
                }
            } catch {
                toast.error("Failed to load workload data");
            }
            setWorkloadLoading(false);
        })();
    }, [apiUrl, viewMode, reloadKey]);

    // Reset page when filters change
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, statusFilter, specFilter, areaFilter]);

    // Derive filter options from stats
    const specOptions = stats
        ? Object.keys(stats.by_specialization).filter((s) => s !== "null")
        : [];
    const areaOptions = stats
        ? Object.keys(stats.by_area).filter((a) => a !== "null")
        : [];

    // Stats card configs
    const statsCards = [
        {
            title: "Total Technicians",
            value: String(stats?.total ?? "—"),
            icon: Users,
            iconColor: "text-blue-500",
            bgColor: "bg-blue-50",
            filter: "all",
        },
        {
            title: "Active",
            value: String(stats?.active ?? "—"),
            icon: UserCheck,
            iconColor: "text-emerald-500",
            bgColor: "bg-emerald-50",
            filter: "active",
        },
        {
            title: "Inactive",
            value: String(stats?.inactive ?? "—"),
            icon: UserX,
            iconColor: "text-red-500",
            bgColor: "bg-red-50",
            filter: "inactive",
        },
        {
            title: "On Duty",
            value: String(stats?.on_duty ?? "—"),
            icon: Briefcase,
            iconColor: "text-amber-500",
            bgColor: "bg-amber-50",
            filter: "on_duty",
        },
    ];

    return (
        <ErrorBoundary fallbackTitle="Technicians page failed to load">
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 md:p-8 space-y-8 max-w-[1600px] mx-auto min-h-screen">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Technicians</h1>
                            <p className="text-sm text-gray-500">
                                Manage your field team and track performance
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex bg-gray-100 rounded-lg p-1">
                                <Button
                                    variant={viewMode === "list" ? "default" : "ghost"}
                                    size="sm"
                                    className={`h-8 gap-1.5 ${viewMode === "list"
                                            ? "bg-white shadow-sm text-gray-900"
                                            : "text-gray-500"
                                        }`}
                                    onClick={() => setViewMode("list")}
                                >
                                    <List className="h-4 w-4" /> List
                                </Button>
                                <Button
                                    variant={viewMode === "heatmap" ? "default" : "ghost"}
                                    size="sm"
                                    className={`h-8 gap-1.5 ${viewMode === "heatmap"
                                            ? "bg-white shadow-sm text-gray-900"
                                            : "text-gray-500"
                                        }`}
                                    onClick={() => setViewMode("heatmap")}
                                >
                                    <LayoutGrid className="h-4 w-4" /> Workload
                                </Button>
                            </div>
                            <CreateTechnicianDialog onCreated={triggerReload} />
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        {/* G-08 FIX: "On Duty" was always resetting to "all"; now toggles normally like other cards. */}
                        {statsCards.map((card) => (
                            <StatsCard
                                key={card.filter}
                                {...card}
                                isActive={statusFilter === card.filter}
                                onClick={() =>
                                    setStatusFilter(
                                        statusFilter === card.filter ? "all" : card.filter
                                    )
                                }
                            />
                        ))}
                    </div>

                    {/* Content */}
                    {viewMode === "list" ? (
                        <TechnicianTable
                            techs={techs}
                            total={total}
                            loading={loading}
                            page={page}
                            pageSize={PAGE_SIZE}
                            statusFilter={statusFilter}
                            searchTerm={searchInput}
                            specFilter={specFilter}
                            areaFilter={areaFilter}
                            specOptions={specOptions}
                            areaOptions={areaOptions}
                            onSearchChange={setSearchInput}
                            onSpecFilterChange={setSpecFilter}
                            onAreaFilterChange={setAreaFilter}
                            onPageChange={setPage}
                            onReload={triggerReload}
                        />
                    ) : (
                        <WorkloadHeatmap
                            workload={workload}
                            loading={workloadLoading}
                        />
                    )}
                </div>
            </div>
        </div>
        </ErrorBoundary>
    );
}
