"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
    Search,
    MoreVertical,
    Wrench,
    MapPin,
    Phone,
    Eye,
    Edit,
    Power,
    Download,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { RoleBadge } from "./RoleBadge";
import { StatusBadge } from "./StatusBadge";
import { ConfirmDialog } from "./ConfirmDialog";
import { getInitials } from "../utils";
import type { TechnicianItem } from "../types";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { useApiUrl } from "@refinedev/core";

interface TechnicianTableProps {
    techs: TechnicianItem[];
    total: number;
    loading: boolean;
    page: number;
    pageSize: number;
    statusFilter: string;
    searchTerm: string;
    specFilter: string;
    areaFilter: string;
    specOptions: string[];
    areaOptions: string[];
    onSearchChange: (value: string) => void;
    onSpecFilterChange: (value: string) => void;
    onAreaFilterChange: (value: string) => void;
    onPageChange: (page: number) => void;
    onReload: () => void;
}

export function TechnicianTable({
    techs,
    total,
    loading,
    page,
    pageSize,
    statusFilter,
    searchTerm,
    specFilter,
    areaFilter,
    specOptions,
    areaOptions,
    onSearchChange,
    onSpecFilterChange,
    onAreaFilterChange,
    onPageChange,
    onReload,
}: TechnicianTableProps) {
    const router = useRouter();
    const apiUrl = useApiUrl();
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    // Confirm dialog state
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmTarget, setConfirmTarget] = useState<TechnicianItem | null>(null);
    const [confirmLoading, setConfirmLoading] = useState(false);

    const handleToggleStatus = (tech: TechnicianItem) => {
        setConfirmTarget(tech);
        setConfirmOpen(true);
    };

    const executeToggle = async () => {
        if (!confirmTarget) return;
        setConfirmLoading(true);
        try {
            const res = await fetch(
                `${apiUrl}/technicians/${confirmTarget.id}/toggle-status`,
                { method: "PUT", headers: getAuthHeaders() }
            );
            if (handle401(res)) return;
            if (res.ok) {
                toast.success(`${confirmTarget.full_name} status updated`);
                onReload();
            } else {
                const data = await res.json();
                toast.error(data.detail || "Failed to toggle status.");
            }
        } catch {
            toast.error("Network error. Please try again.");
        }
        setConfirmLoading(false);
        setConfirmOpen(false);
        setConfirmTarget(null);
    };

    const handleExportCSV = async () => {
        try {
            // Fetch ALL records for export, not just the current page
            const url = new URL(`${apiUrl}/technicians/`);
            url.searchParams.set("skip", "0");
            url.searchParams.set("limit", "10000");
            if (searchTerm.trim()) url.searchParams.set("q", searchTerm.trim());
            if (statusFilter !== "all")
                url.searchParams.set("status_filter", statusFilter);
            if (specFilter !== "all")
                url.searchParams.set("specialization", specFilter);
            if (areaFilter !== "all") url.searchParams.set("area", areaFilter);

            const res = await fetch(url.toString(), { headers: getAuthHeaders() });
            if (handle401(res)) return;
            if (!res.ok) {
                toast.error("Failed to export data");
                return;
            }
            const data = await res.json();
            const allTechs: TechnicianItem[] = data.items || [];

            const rows = allTechs.map((t) =>
                [
                    t.full_name,
                    t.username,
                    t.role,
                    t.specialization || "",
                    t.area_assigned || "",
                    t.phone || "",
                    t.email || "",
                    t.is_active ? "Active" : "Inactive",
                    t.active_tickets,
                    t.resolved_tickets,
                ].join(",")
            );
            const csv =
                "Name,Username,Role,Specialization,Area,Phone,Email,Status,Active Jobs,Resolved\n" +
                rows.join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const csvUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = csvUrl;
            a.download = `technicians_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(csvUrl);
            toast.success("Export completed");
        } catch {
            toast.error("Failed to export data.");
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100/50 overflow-hidden">
            {/* Table Header Controls */}
            <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Team Members
                        </h2>
                        <span className="text-2xl font-bold text-emerald-600">{total}</span>
                    </div>
                    <p className="text-sm text-gray-500">
                        {statusFilter === "all"
                            ? "All technicians"
                            : `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} technicians`}
                    </p>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
                    <div className="relative w-full md:w-56">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Search technicians..."
                            className="pl-9 h-10 bg-gray-50/50 border-gray-200 focus:bg-white transition-all rounded-lg"
                        />
                    </div>
                    {specOptions.length > 0 && (
                        <select
                            value={specFilter}
                            onChange={(e) => onSpecFilterChange(e.target.value)}
                            className="h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50/50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-all"
                        >
                            <option value="all">All Specializations</option>
                            {specOptions.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    )}
                    {areaOptions.length > 0 && (
                        <select
                            value={areaFilter}
                            onChange={(e) => onAreaFilterChange(e.target.value)}
                            className="h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50/50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:bg-white transition-all"
                        >
                            <option value="all">All Areas</option>
                            {areaOptions.map((a) => (
                                <option key={a} value={a}>
                                    {a}
                                </option>
                            ))}
                        </select>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-10 gap-1.5 text-gray-600 hover:text-emerald-700 hover:border-emerald-300"
                        onClick={handleExportCSV}
                    >
                        <Download className="h-4 w-4" /> Export
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="relative w-full overflow-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-gray-100">
                            <TableHead className="w-[250px] text-xs font-semibold text-gray-500 uppercase tracking-wider pl-6">
                                Technician
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Role
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Specialization
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Area
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Phone
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">
                                Active Jobs
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">
                                Resolved
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Status
                            </TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i} className="animate-pulse h-14 border-b border-gray-100">
                                    <TableCell colSpan={9} className="h-14 bg-gray-50/20" />
                                </TableRow>
                            ))
                        ) : techs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground text-sm">
                                    No technicians found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            techs.map((tech) => (
                                <TableRow
                                    key={tech.id}
                                    className="group hover:bg-emerald-50/30 transition-colors border-b border-gray-100 h-14"
                                >
                                    <TableCell
                                        className="pl-6 py-2 cursor-pointer group/name"
                                        onClick={() => router.push(`/technicians/show/${tech.id}`)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-9 w-9 border border-gray-100 group-hover/name:border-emerald-200 transition-colors">
                                                <AvatarFallback className="bg-emerald-100 text-emerald-700 text-xs font-semibold group-hover/name:bg-emerald-200 transition-colors">
                                                    {getInitials(tech.full_name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900 group-hover/name:text-emerald-700 group-hover/name:underline transition-colors">
                                                    {tech.full_name}
                                                </p>
                                                <p className="text-xs text-gray-400">@{tech.username}</p>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="py-2">
                                        <RoleBadge role={tech.role} />
                                    </TableCell>
                                    <TableCell className="py-2">
                                        <div className="flex items-center gap-1.5 text-xs text-gray-600">
                                            <Wrench className="h-3 w-3 text-gray-400" />
                                            {tech.specialization || "General"}
                                        </div>
                                    </TableCell>
                                    <TableCell className="py-2">
                                        {tech.area_assigned ? (
                                            <div className="flex items-center gap-1.5 text-xs text-gray-600">
                                                <MapPin className="h-3 w-3 text-gray-400" />
                                                {tech.area_assigned}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-300">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="py-2">
                                        {tech.phone ? (
                                            <div className="flex items-center gap-1.5 text-xs text-gray-600 font-mono">
                                                <Phone className="h-3 w-3 text-gray-400" />
                                                {tech.phone}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-300">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="py-2 text-center">
                                        <span
                                            className={`text-sm font-semibold ${tech.active_tickets > 0 ? "text-amber-600" : "text-gray-300"
                                                }`}
                                        >
                                            {tech.active_tickets}
                                        </span>
                                    </TableCell>
                                    <TableCell className="py-2 text-center">
                                        <span className="text-sm font-medium text-gray-500">
                                            {tech.resolved_tickets}
                                        </span>
                                    </TableCell>
                                    <TableCell className="py-2">
                                        <StatusBadge isActive={tech.is_active} />
                                    </TableCell>
                                    <TableCell className="py-2 pr-4">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                                onClick={() => router.push(`/technicians/show/${tech.id}`)}
                                                title="View Profile"
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-600">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        className="cursor-pointer gap-2"
                                                        onClick={() => router.push(`/technicians/show/${tech.id}`)}
                                                    >
                                                        <Eye className="h-4 w-4" /> View Profile
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="cursor-pointer gap-2"
                                                        onClick={() => router.push(`/technicians/edit/${tech.id}`)}
                                                    >
                                                        <Edit className="h-4 w-4" /> Edit Details
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        className="cursor-pointer gap-2"
                                                        onClick={() => handleToggleStatus(tech)}
                                                    >
                                                        <Power className="h-4 w-4" />
                                                        {tech.is_active === 1 ? "Deactivate" : "Activate"}
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/50">
                <div className="text-sm text-gray-500">
                    Page {page} of {pageCount}
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1}
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= pageCount}
                    >
                        Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </div>
            </div>

            {/* Confirm Dialog */}
            <ConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={
                    confirmTarget?.is_active === 1
                        ? "Deactivate Technician"
                        : "Activate Technician"
                }
                description={
                    confirmTarget
                        ? `Are you sure you want to ${confirmTarget.is_active === 1 ? "deactivate" : "activate"
                        } ${confirmTarget.full_name}?`
                        : ""
                }
                confirmLabel={
                    confirmTarget?.is_active === 1 ? "Deactivate" : "Activate"
                }
                variant={confirmTarget?.is_active === 1 ? "danger" : "default"}
                loading={confirmLoading}
                onConfirm={executeToggle}
            />
        </div>
    );
}
