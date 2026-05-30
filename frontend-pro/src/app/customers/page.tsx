"use client";

import React, { useMemo, useState } from "react";
import { useTable, useApiUrl, useCustom, useDelete, useNotification } from "@refinedev/core";
import { CreateCustomerDialog } from "@/components/customers/create-customer-dialog";
import {
  Search,
  Filter,
  Award,
  Clock,
  FileText,
  Briefcase,
  MoreVertical,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Eye
} from "lucide-react";
import { format, subDays, addDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import Link from "next/link";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

// Mock data generator for fields missing in API
// const MOCK_EMAILS = ["amazon@gmail.com", "cloud@apple.com", "hello@spotify.com", "support@hp.com", "help@evernote.com"];
// const MOCK_NOTES = ["Authorization Created", "Apple Note", "Web Authorization", "Admission Advisor", "Authorization Created"];
// const MOCK_SESSIONS = [324, 215, 564, 812, 143];

const StatsCard = ({
  title,
  value,
  trend,
  trendUp,
  icon: Icon,
  iconColor,
  bgColor,
  onClick, // NEW
  isActive // NEW
}: {
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  icon: any;
  iconColor: string;
  bgColor: string;
  onClick?: () => void;
  isActive?: boolean;
}) => (
  <Card
    onClick={onClick}
    className={`border-none shadow-sm transition-all duration-200 cursor-pointer ${isActive
      ? 'ring-2 ring-blue-500 bg-blue-50/50'
      : 'bg-white hover:shadow-md hover:bg-gray-50'
      }`}
  >
    <CardContent className="p-6">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-full ${isActive ? 'bg-white' : bgColor} flex items-center justify-center`}>
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
        {/* Helper Dot for Active State */}
        {isActive && <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />}
      </div>
      <div className="space-y-1">
        <h3 className={`text-sm font-medium ${isActive ? 'text-blue-700' : 'text-gray-500'}`}>{title}</h3>
        <div className="flex items-baseline gap-3">
          <span className={`text-2xl font-bold ${isActive ? 'text-blue-900' : 'text-gray-900'}`}>{value}</span>
          {trend && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${trendUp ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
              {trend}
            </span>
          )}
        </div>
      </div>
    </CardContent>
  </Card>
);

export default function CustomerList() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // "all", "active", "inactive", "today" (acts as Expiry mode)
  // M-07 FIX: Added showFilters state so the Filter button actually toggles a filter panel.
  const [showFilters, setShowFilters] = useState(false);

  // Date Filter State for "today" (Expiry) mode
  const [dateFilterRange, setDateFilterRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: new Date(),
    to: new Date()
  });
  const [dateFilterLabel, setDateFilterLabel] = useState("today"); // "today", "yesterday", "tomorrow", "custom", etc.

  // Skip calling setFilters on first mount — useTable's initial fetch already uses no filters.
  const hasMounted = React.useRef(false);

  const apiUrl = useApiUrl();

  const {
    tableQuery: tableQueryResult,
    setCurrentPage: setCurrent,
    currentPage: current,
    pageCount,
    setFilters
  } = useTable({
    resource: "customers",
    pagination: {
      current: 1,
      pageSize: 10,
    } as any,
    syncWithLocation: false,
  });

  // Effect to handle search AND filtering
  React.useEffect(() => {
    // Skip the first render — the default empty state matches useTable's initial query.
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    const filters: any[] = [
      {
        field: "q",
        operator: "eq",
        value: searchTerm,
      }
    ];

    // Apply Active Filter to Refine Table
    if (activeFilter === "active") {
      filters.push({ field: "status", operator: "eq", value: "Active" });
    } else if (activeFilter === "inactive") {
      filters.push({ field: "status", operator: "eq", value: "Inactive" });
    } else if (activeFilter === "today") {
      // Advanced Date Logic
      // We always use expiry_start and expiry_end for robustness
      if (dateFilterRange.from) {
        filters.push({ field: "expiry_start", operator: "eq", value: format(dateFilterRange.from, 'yyyy-MM-dd') });
      }
      if (dateFilterRange.to) {
        filters.push({ field: "expiry_end", operator: "eq", value: format(dateFilterRange.to, 'yyyy-MM-dd') });
      }
    }

    setFilters(filters, "replace");
    setCurrent(1); // Force reset to page 1 to prevent "Page 16 of 8" issues
  }, [searchTerm, activeFilter, dateFilterRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete Mutation
  const { mutate: deleteMutate } = useDelete();
  const { open: openNotification } = useNotification();

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this customer?")) {
      deleteMutate({
        resource: "customers",
        id: id,
      }, {
        onSuccess: () => {
          openNotification?.({
            type: "success",
            message: "Deleted",
            description: "Customer deleted successfully",
          });
        }
      });
    }
  };

  const rawData = tableQueryResult?.data?.data ?? [];

  const isLoading = tableQueryResult?.isLoading;

  // Data Fetching: Stats (Native Fetch to avoid Provider wrapping issues)
  const [statsValues, setStatsValues] = useState({
    total_outstanding: 0,
    overdue_count: 0,
    active_customers: 0,
    inactive_customers: 0,
    total_customers: 0,
    expiring_today_count: 0
  });

  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${apiUrl}/customers/dashboard-stats`, {
          headers: getAuthHeaders()
        });
        if (handle401(res)) return;
        if (res.ok) {
          const data = await res.json();
          setStatsValues(data);
        } else {
          toast.error("Failed to load customer statistics");
        }
      } catch (err) {
        console.error("Native Stats Fetch Error:", err);
        toast.error("Failed to load customer statistics");
      }
    };
    fetchStats();
  }, [apiUrl]);

  const stats = [
    {
      title: "Total Customers",
      value: (statsValues.total_customers || 0).toString(),
      icon: Award,
      iconColor: "text-blue-500",
      bgColor: "bg-blue-50",
      isActive: activeFilter === 'all',
      onClick: () => setActiveFilter('all')
    },
    {
      title: "Active Subscribers",
      value: (statsValues.active_customers || 0).toString(),
      icon: FileText,
      iconColor: "text-green-500",
      bgColor: "bg-green-50",
      isActive: activeFilter === 'active',
      onClick: () => setActiveFilter('active')
    },
    {
      title: "Expiring Today",
      value: (statsValues.expiring_today_count || 0).toString(),
      icon: Clock,
      iconColor: "text-orange-500",
      bgColor: "bg-orange-50",
      isActive: activeFilter === 'today',
      onClick: () => setActiveFilter('today')
    },
    {
      title: "Inactive Subscribers",
      value: (statsValues.inactive_customers || 0).toString(),
      icon: Briefcase,
      iconColor: "text-purple-500",
      bgColor: "bg-purple-50",
      isActive: activeFilter === 'inactive',
      onClick: () => setActiveFilter('inactive')
    },
  ];

  const processedData = useMemo(() => {
    if (!rawData) return [];

    return rawData.map((item: any) => {
      const daysUntilExpiry = item.expiry_date
        ? Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / 86400000)
        : null;

      let expiryClass = "text-gray-600";
      let expiryBadge = null;
      if (daysUntilExpiry !== null) {
        if (daysUntilExpiry <= 0) {
          expiryClass = "text-red-600 font-semibold";
          expiryBadge = "Expired";
        } else if (daysUntilExpiry <= 1) {
          expiryClass = "text-red-600 font-semibold";
          expiryBadge = "Today";
        } else if (daysUntilExpiry <= 3) {
          expiryClass = "text-orange-600 font-medium";
          expiryBadge = `${daysUntilExpiry}d`;
        } else if (daysUntilExpiry <= 7) {
          expiryClass = "text-amber-600";
          expiryBadge = `${daysUntilExpiry}d`;
        }
      }

      return {
        ...item,
        email: item.email || "—",
        sessions: item.sessions || 0,
        notes: item.notes || "—",
        formattedBalance: new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(item.balance || 0),
        formattedDate: item.expiry_date ? new Date(item.expiry_date).toISOString().split('T')[0] : '—',
        daysUntilExpiry,
        expiryClass,
        expiryBadge,
      };
    });
  }, [rawData]);

  // Date Filter Logic
  const handleDatePreset = (preset: string) => {
    const today = new Date();
    let from = today;
    let to = today;

    switch (preset) {
      case "day-before-yesterday":
        from = subDays(today, 2);
        to = subDays(today, 2);
        break;
      case "yesterday":
        from = subDays(today, 1);
        to = subDays(today, 1);
        break;
      case "today":
        from = today;
        to = today;
        break;
      case "tomorrow":
        from = addDays(today, 1);
        to = addDays(today, 1);
        break;
      case "day-after-tomorrow":
        from = addDays(today, 2);
        to = addDays(today, 2);
        break;
      // Calendar will handle custom
    }
    setDateFilterLabel(preset);
    setDateFilterRange({ from, to });
  };

  return (
    <ErrorBoundary fallbackTitle="Customers page failed to load">
    <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
      <MainSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8 bg-gray-50/30 min-h-screen font-sans" >

          {/* Header */}
          {/* Q-03 FIX: Removed dead non-functional search input (had wrong placeholder and no state binding). */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Customers</h1>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {
              stats.map((stat, i) => (
                <StatsCard key={i} {...stat} />
              ))
            }
          </div>

          {/* M-07 FIX: Filter panel shown when Filter button is toggled. */}
          {showFilters && (
            <div className="flex flex-wrap items-center gap-2 p-4 bg-white rounded-xl border border-gray-100 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
              <span className="text-sm font-medium text-gray-500 mr-2">Status:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'inactive', label: 'Inactive' },
                { id: 'today', label: 'Expiring' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-all ${activeFilter === f.id ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Advanced Date Filters (Only visible when Expiring/Today filter is active) */}
          {activeFilter === 'today' && (
            <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Presets */}
              {[
                { id: 'day-before-yesterday', label: 'Day Before Yesterday' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                { id: 'day-after-tomorrow', label: 'Day After Tomorrow' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleDatePreset(preset.id)}
                  className={`
                 px-4 py-2 text-sm font-medium rounded-lg transition-all border
                 ${dateFilterLabel === preset.id
                      ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900'}
               `}
                >
                  {preset.label}
                </button>
              ))}

              {/* Calendar Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-[240px] justify-start text-left font-normal border-dashed",
                      !dateFilterRange.from && "text-muted-foreground",
                      dateFilterLabel === 'custom' && "border-blue-300 bg-blue-50/50"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFilterRange.from ? (
                      dateFilterRange.to ? (
                        <>
                          {format(dateFilterRange.from, "LLL dd, y")} -{" "}
                          {format(dateFilterRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(dateFilterRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={dateFilterRange.from}
                    selected={{ from: dateFilterRange.from, to: dateFilterRange.to }}
                    onSelect={(range) => {
                      setDateFilterRange((range as any) || { from: undefined, to: undefined });
                      setDateFilterLabel("custom");
                    }}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Main Content */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100/50 overflow-hidden">
            {/* Table Header Controls */}
            <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">Customers List</h2>
                  {/* Filtered Count Display */}
                  <span className="text-2xl font-bold text-blue-600">
                    {tableQueryResult?.data?.total || 0}
                  </span>
                </div>
                {/* G-07 FIX: Was hardcoded to 10; now uses real total from API response. */}
                <p className="text-sm text-gray-500">Total {tableQueryResult?.data?.total || 0} customers</p>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search customers..."
                    className="pl-9 h-10 bg-gray-50/50 border-gray-200 focus:bg-white transition-all rounded-lg"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(v => !v)}
                  className={`gap-2 h-10 px-4 border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-gray-900 ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : ''}`}
                >
                  <Filter className="h-4 w-4" />
                  Filter
                </Button>
                <CreateCustomerDialog>
                  <Button className="h-10 px-4 bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200">
                    New Customer
                  </Button>
                </CreateCustomerDialog>
              </div>
            </div>

            {/* Table */}
            <div className="relative w-full overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-gray-100">
                    <TableHead className="w-[50px] pl-6">
                      <Checkbox className="border-gray-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
                    </TableHead>
                    <TableHead className="w-[150px] text-xs font-semibold text-gray-500 uppercase tracking-wider pl-4">Username</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Package</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Renewal Date</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider pr-4">Balance</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider pl-4">Mobile No.</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Registration Date</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 15 }).map((_, i) => (
                      <TableRow key={i} className="animate-pulse h-10 border-b border-gray-100">
                        <TableCell colSpan={10} className="h-10 bg-gray-50/20" />
                      </TableRow>
                    ))
                  ) : processedData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="h-32 text-center text-muted-foreground text-sm">
                        No customers found matching your criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    processedData.map((customer: any) => (
                      <TableRow
                        key={customer.username}
                        className="group hover:bg-blue-50/30 transition-colors border-b border-gray-100 h-10"
                      >
                        <TableCell className="pl-6 py-2">
                          <Checkbox className="border-gray-200 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
                        </TableCell>
                        <TableCell 
                          className="pl-4 py-2 text-xs font-medium text-blue-600 cursor-pointer hover:underline group-hover:text-blue-700"
                          onClick={() => window.location.href = `/customers/show/${customer.username}`}
                        >
                          <span className="mr-2 text-blue-400 font-bold">IN</span>
                          {customer.username}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-gray-700 font-medium">
                          {customer.plan_name || "—"}
                        </TableCell>
                        <TableCell className="py-2">
                          {/* Determine Fallback (Mock logic based on Status) */}
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${customer.status?.toLowerCase() === 'active'
                            ? 'bg-green-50 text-green-700 border-green-100'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                            }`}>
                            {customer.status || "Unknown"}
                          </span>
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs ${customer.expiryClass}`}>{customer.formattedDate}</span>
                            {customer.expiryBadge && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                customer.daysUntilExpiry <= 1
                                  ? "bg-red-100 text-red-700"
                                  : customer.daysUntilExpiry <= 3
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}>
                                {customer.expiryBadge}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 text-right pr-4">
                          <span className={`text-xs font-mono font-medium ${(customer.balance || 0) > 0 ? 'text-red-600' : 'text-gray-400'
                            }`}>
                            {customer.formattedBalance}
                          </span>
                        </TableCell>
                        <TableCell className="pl-4 py-2 text-xs text-gray-700 font-mono">
                          {customer.phone || "—"}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-blue-600 hover:underline cursor-pointer">
                          {customer.email || "—"}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-gray-500">
                          {customer.created_at ? new Date(customer.created_at).toISOString().replace('T', ' ').substring(0, 19) : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-right pr-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => window.location.href = `/customers/show/${customer.username}`}
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
                              <DropdownMenuItem className="cursor-pointer" onClick={() => window.location.href = `/customers/show/${customer.username}`}>
                                View Profile
                              </DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer" onClick={() => window.location.href = `/customers/edit/${customer.username}`}>
                                Edit Details
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600 focus:text-red-600 cursor-pointer" onClick={() => handleDelete(customer.username)}>
                                Delete Customer
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

            {/* Pagination Controls */}
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between bg-gray-50/50">
              <div className="text-sm text-gray-500">
                Page {current} of {pageCount}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrent(current - 1)}
                  disabled={current <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrent(current + 1)}
                  disabled={current >= pageCount}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}