"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "@/config";
import { authFetch } from "@/lib/auth-utils";
import { toast } from "sonner";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    ArrowLeft,
    Loader2,
    PlusCircle,
    RefreshCw,
    Search,
    Trash2,
    UserPlus,
    UserMinus,
    MapPin,
    CheckCircle2,
    Link2,
} from "lucide-react";

interface PoleGroup {
    id: number;
    name: string;
    description?: string | null;
    area?: string | null;
    customer_count: number;
    surveyed_count: number;
    bound_count: number;
    created_at: string;
    updated_at?: string | null;
}

interface PoleGroupCustomer {
    username: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    rico_address?: string | null;
    has_binding: boolean;
    last_surveyed_at?: string | null;
}

interface PoleGroupDetail extends PoleGroup {
    customers: PoleGroupCustomer[];
}

interface BulkActionResponse {
    added: number;
    removed: number;
    not_found: string[];
    already_in_group: string[];
    moved_from_other_group: string[];
}

export default function PoleGroupsPage() {
    const [groups, setGroups] = useState<PoleGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detail, setDetail] = useState<PoleGroupDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Create PG dialog
    const [createOpen, setCreateOpen] = useState(false);
    const [createName, setCreateName] = useState("");
    const [createArea, setCreateArea] = useState("");
    const [createDesc, setCreateDesc] = useState("");
    const [creating, setCreating] = useState(false);

    // Bulk add dialog
    const [addOpen, setAddOpen] = useState(false);
    const [addPaste, setAddPaste] = useState("");
    const [adding, setAdding] = useState(false);

    // Single search-and-add
    const [quickSearch, setQuickSearch] = useState("");
    const [searchResults, setSearchResults] = useState<PoleGroupCustomer[]>([]);
    const [searching, setSearching] = useState(false);
    const [addingUser, setAddingUser] = useState<string | null>(null);

    const fetchGroups = useCallback(async () => {
        setLoading(true);
        try {
            const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
            const res = await authFetch(`${API_URL}/pole-groups${qs}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setGroups(data.items || []);
        } catch (e: any) {
            toast.error(`Failed to load pole groups: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }, [search]);

    const fetchDetail = useCallback(async (pgId: number) => {
        setDetailLoading(true);
        try {
            const res = await authFetch(`${API_URL}/pole-groups/${pgId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setDetail(data);
        } catch (e: any) {
            toast.error(`Failed to load PG detail: ${e.message}`);
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchGroups();
    }, [fetchGroups]);

    useEffect(() => {
        if (selectedId != null) fetchDetail(selectedId);
        else setDetail(null);
    }, [selectedId, fetchDetail]);

    const handleCreate = async () => {
        if (!createName.trim()) {
            toast.error("Name is required");
            return;
        }
        setCreating(true);
        try {
            const res = await authFetch(`${API_URL}/pole-groups`, {
                method: "POST",
                body: JSON.stringify({
                    name: createName.trim(),
                    area: createArea.trim() || null,
                    description: createDesc.trim() || null,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            toast.success(`Pole group "${createName}" created`);
            setCreateOpen(false);
            setCreateName("");
            setCreateArea("");
            setCreateDesc("");
            fetchGroups();
        } catch (e: any) {
            toast.error(`Create failed: ${e.message}`);
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (pg: PoleGroup) => {
        if (!confirm(`Delete pole group "${pg.name}"? Customers will be detached but not deleted.`)) return;
        try {
            const res = await authFetch(`${API_URL}/pole-groups/${pg.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success("Pole group deleted");
            if (selectedId === pg.id) setSelectedId(null);
            fetchGroups();
        } catch (e: any) {
            toast.error(`Delete failed: ${e.message}`);
        }
    };

    const handleBulkAdd = async () => {
        if (!selectedId || !addPaste.trim()) return;
        setAdding(true);
        try {
            const res = await authFetch(
                `${API_URL}/pole-groups/${selectedId}/add-customers`,
                {
                    method: "POST",
                    body: JSON.stringify({ usernames: [addPaste] }),
                }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const result: BulkActionResponse = await res.json();
            const parts = [
                `Added: ${result.added}`,
                result.moved_from_other_group.length ? `Moved: ${result.moved_from_other_group.length}` : null,
                result.already_in_group.length ? `Already in PG: ${result.already_in_group.length}` : null,
                result.not_found.length ? `Not found: ${result.not_found.length}` : null,
            ].filter(Boolean).join(" • ");
            toast.success(parts);
            if (result.not_found.length) {
                console.warn("Usernames not found:", result.not_found);
            }
            setAddOpen(false);
            setAddPaste("");
            fetchDetail(selectedId);
            fetchGroups();
        } catch (e: any) {
            toast.error(`Add failed: ${e.message}`);
        } finally {
            setAdding(false);
        }
    };

    // Debounced realtime customer search
    useEffect(() => {
        if (selectedId == null) return;
        const term = quickSearch.trim();
        if (term.length < 2) {
            setSearchResults([]);
            return;
        }
        let cancelled = false;
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const res = await authFetch(
                    `${API_URL}/customers/?search=${encodeURIComponent(term)}&limit=20`
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (cancelled) return;
                const items = (data.items || []).map((c: any) => ({
                    username: c.username,
                    first_name: c.first_name,
                    last_name: c.last_name,
                    phone: c.phone,
                    rico_address: c.rico_address,
                    has_binding: false,
                    last_surveyed_at: null,
                }));
                setSearchResults(items);
            } catch (e: any) {
                if (!cancelled) {
                    setSearchResults([]);
                    console.error("customer search failed:", e);
                }
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [quickSearch, selectedId]);

    const handleQuickAdd = async (username: string) => {
        if (!selectedId) return;
        setAddingUser(username);
        try {
            const res = await authFetch(
                `${API_URL}/pole-groups/${selectedId}/add-customers`,
                {
                    method: "POST",
                    body: JSON.stringify({ usernames: [username] }),
                }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            const result: BulkActionResponse = await res.json();
            if (result.added) {
                toast.success(`${username} added`);
            } else if (result.moved_from_other_group.length) {
                toast.success(`${username} moved from another PG`);
            } else if (result.already_in_group.length) {
                toast.info(`${username} already in this PG`);
            } else if (result.not_found.length) {
                toast.error(`${username} not found`);
            }
            setQuickSearch("");
            setSearchResults([]);
            fetchDetail(selectedId);
            fetchGroups();
        } catch (e: any) {
            toast.error(`Add failed: ${e.message}`);
        } finally {
            setAddingUser(null);
        }
    };

    const handleRemoveCustomer = async (username: string) => {
        if (!selectedId) return;
        if (!confirm(`Remove ${username} from this pole group?`)) return;
        try {
            const res = await authFetch(
                `${API_URL}/pole-groups/${selectedId}/remove-customers`,
                {
                    method: "POST",
                    body: JSON.stringify({ usernames: [username] }),
                }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success(`${username} removed`);
            fetchDetail(selectedId);
            fetchGroups();
        } catch (e: any) {
            toast.error(`Remove failed: ${e.message}`);
        }
    };

    const totals = useMemo(() => {
        return groups.reduce(
            (acc, g) => ({
                groups: acc.groups + 1,
                customers: acc.customers + g.customer_count,
                surveyed: acc.surveyed + g.surveyed_count,
                bound: acc.bound + g.bound_count,
            }),
            { groups: 0, customers: 0, surveyed: 0, bound: 0 }
        );
    }, [groups]);

    // ------------------------------------------------------------------
    // Detail view
    // ------------------------------------------------------------------
    if (selectedId != null) {
        return (
            <div className="flex min-h-screen bg-slate-50">
                <MainSidebar />
                <main className="flex-1 p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                            <ArrowLeft className="h-4 w-4 mr-1" />
                            All Pole Groups
                        </Button>
                    </div>

                    {detailLoading || !detail ? (
                        <div className="flex items-center gap-2 text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading…
                        </div>
                    ) : (
                        <>
                            <div className="flex items-start justify-between mb-6">
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-900">{detail.name}</h1>
                                    {detail.area && (
                                        <p className="text-slate-500 flex items-center gap-1 mt-1">
                                            <MapPin className="h-3 w-3" /> {detail.area}
                                        </p>
                                    )}
                                    {detail.description && (
                                        <p className="text-slate-600 mt-2 max-w-2xl">{detail.description}</p>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <Button onClick={() => setAddOpen(true)}>
                                        <UserPlus className="h-4 w-4 mr-1" />
                                        Bulk Add Customers
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-6">
                                <StatCard label="Customers" value={detail.customer_count} />
                                <StatCard
                                    label="Surveyed"
                                    value={detail.surveyed_count}
                                    hint={`${detail.customer_count ? Math.round((detail.surveyed_count / detail.customer_count) * 100) : 0}%`}
                                />
                                <StatCard
                                    label="ONU Bound"
                                    value={detail.bound_count}
                                    hint={`${detail.customer_count ? Math.round((detail.bound_count / detail.customer_count) * 100) : 0}%`}
                                />
                            </div>

                            <Card className="mb-6">
                                <CardHeader>
                                    <CardTitle className="text-base">Add customer by search</CardTitle>
                                    <CardDescription>
                                        Type a username, name, or phone — results appear as you type.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                        <Input
                                            placeholder="Start typing 2+ characters…"
                                            value={quickSearch}
                                            onChange={(e) => setQuickSearch(e.target.value)}
                                            className="pl-9"
                                            autoFocus
                                        />
                                        {searching && (
                                            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                                        )}
                                    </div>
                                    {quickSearch.trim().length >= 2 && (
                                        <div className="mt-3 border rounded-md divide-y max-h-80 overflow-auto">
                                            {searchResults.length === 0 && !searching ? (
                                                <div className="text-center py-6 text-sm text-slate-500">
                                                    No matches.
                                                </div>
                                            ) : (
                                                searchResults.map((c) => {
                                                    const inThisPg = detail.customers.some(
                                                        (x) => x.username === c.username
                                                    );
                                                    return (
                                                        <div
                                                            key={c.username}
                                                            className="flex items-center justify-between px-3 py-2 hover:bg-slate-50"
                                                        >
                                                            <div className="min-w-0 flex-1">
                                                                <div className="font-mono text-xs text-slate-700">
                                                                    {c.username}
                                                                </div>
                                                                <div className="text-sm text-slate-900 truncate">
                                                                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                                                                    {c.phone && (
                                                                        <span className="text-slate-500"> • {c.phone}</span>
                                                                    )}
                                                                </div>
                                                                {c.rico_address && (
                                                                    <div className="text-xs text-slate-500 truncate">
                                                                        {c.rico_address}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant={inThisPg ? "outline" : "default"}
                                                                disabled={inThisPg || addingUser === c.username}
                                                                onClick={() => handleQuickAdd(c.username)}
                                                            >
                                                                {addingUser === c.username ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : inThisPg ? (
                                                                    "In PG"
                                                                ) : (
                                                                    <>
                                                                        <UserPlus className="h-3 w-3 mr-1" />
                                                                        Add
                                                                    </>
                                                                )}
                                                            </Button>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Customers in this Pole Group</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {detail.customers.length === 0 ? (
                                        <div className="text-center py-8 text-slate-500">
                                            No customers yet. Use <strong>Bulk Add</strong> to paste usernames.
                                        </div>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Username</TableHead>
                                                    <TableHead>Name</TableHead>
                                                    <TableHead>Phone</TableHead>
                                                    <TableHead>Address</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead className="w-16"></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {detail.customers.map((c) => (
                                                    <TableRow key={c.username}>
                                                        <TableCell className="font-mono text-xs">{c.username}</TableCell>
                                                        <TableCell>
                                                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                                                        </TableCell>
                                                        <TableCell className="text-sm">{c.phone || "—"}</TableCell>
                                                        <TableCell className="text-sm text-slate-600 max-w-[240px] truncate">
                                                            {c.rico_address || "—"}
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex gap-1 flex-wrap">
                                                                {c.has_binding && (
                                                                    <Badge variant="secondary" className="gap-1">
                                                                        <Link2 className="h-3 w-3" /> Bound
                                                                    </Badge>
                                                                )}
                                                                {c.last_surveyed_at && (
                                                                    <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300">
                                                                        <CheckCircle2 className="h-3 w-3" /> Surveyed
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => handleRemoveCustomer(c.username)}
                                                                title="Remove from PG"
                                                            >
                                                                <UserMinus className="h-4 w-4 text-red-500" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    )}

                    {/* Bulk add dialog */}
                    <Dialog open={addOpen} onOpenChange={setAddOpen}>
                        <DialogContent className="max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>Bulk Add Customers</DialogTitle>
                                <DialogDescription>
                                    Paste usernames — one per line, or separated by commas / spaces. Customers already
                                    in another pole group will be moved.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label>Usernames</Label>
                                <Textarea
                                    rows={10}
                                    placeholder={"railwire_user_1\nrailwire_user_2\nrailwire_user_3"}
                                    value={addPaste}
                                    onChange={(e) => setAddPaste(e.target.value)}
                                    className="font-mono text-sm"
                                />
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setAddOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={handleBulkAdd} disabled={adding || !addPaste.trim()}>
                                    {adding && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                    Add to Pole Group
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </main>
            </div>
        );
    }

    // ------------------------------------------------------------------
    // List view
    // ------------------------------------------------------------------
    return (
        <div className="flex min-h-screen bg-slate-50">
            <MainSidebar />
            <main className="flex-1 p-8">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Pole Groups</h1>
                        <p className="text-slate-500">
                            Physical fiber split groups — segregate customers by pole.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={fetchGroups} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                        <Button onClick={() => setCreateOpen(true)}>
                            <PlusCircle className="h-4 w-4 mr-1" />
                            New Pole Group
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-4 mb-6">
                    <StatCard label="Pole Groups" value={totals.groups} />
                    <StatCard label="Customers" value={totals.customers} />
                    <StatCard label="Surveyed" value={totals.surveyed} />
                    <StatCard label="ONU Bound" value={totals.bound} />
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>All Pole Groups</CardTitle>
                            <div className="relative w-64">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    placeholder="Search by name or area…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-8"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading…
                            </div>
                        ) : groups.length === 0 ? (
                            <div className="text-center py-12 text-slate-500">
                                <MapPin className="h-10 w-10 mx-auto mb-2 text-slate-300" />
                                No pole groups yet. Click <strong>New Pole Group</strong> to create one.
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Area</TableHead>
                                        <TableHead className="text-right">Customers</TableHead>
                                        <TableHead className="text-right">Surveyed</TableHead>
                                        <TableHead className="text-right">Bound</TableHead>
                                        <TableHead className="w-16"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {groups.map((g) => (
                                        <TableRow
                                            key={g.id}
                                            className="cursor-pointer hover:bg-slate-50"
                                            onClick={() => setSelectedId(g.id)}
                                        >
                                            <TableCell className="font-medium">{g.name}</TableCell>
                                            <TableCell className="text-slate-600">{g.area || "—"}</TableCell>
                                            <TableCell className="text-right font-mono">{g.customer_count}</TableCell>
                                            <TableCell className="text-right font-mono text-emerald-700">
                                                {g.surveyed_count}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-blue-700">
                                                {g.bound_count}
                                            </TableCell>
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(g)}
                                                    title="Delete pole group"
                                                >
                                                    <Trash2 className="h-4 w-4 text-red-500" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>

                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>New Pole Group</DialogTitle>
                            <DialogDescription>
                                Create a new physical fiber split group. You can add customers after.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div>
                                <Label>Name *</Label>
                                <Input
                                    placeholder="e.g. PG-042 or Kamaraj Street Pole 3"
                                    value={createName}
                                    onChange={(e) => setCreateName(e.target.value)}
                                />
                            </div>
                            <div>
                                <Label>Area</Label>
                                <Input
                                    placeholder="e.g. Kamaraj Nagar"
                                    value={createArea}
                                    onChange={(e) => setCreateArea(e.target.value)}
                                />
                            </div>
                            <div>
                                <Label>Description</Label>
                                <Textarea
                                    rows={3}
                                    placeholder="Optional notes"
                                    value={createDesc}
                                    onChange={(e) => setCreateDesc(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                                {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                Create
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main>
        </div>
    );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="text-sm text-slate-500">{label}</div>
                <div className="text-3xl font-bold text-slate-900">{value.toLocaleString()}</div>
                {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
            </CardContent>
        </Card>
    );
}
