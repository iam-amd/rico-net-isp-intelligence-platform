"use client";

import React from "react";
import { API_URL } from "@/config";
import { useOne, useNavigation } from "@refinedev/core";
import {
    User,
    MapPin,
    Wifi,
    Activity,
    Clock,
    Phone,
    Mail,
    Calendar,
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    ArrowLeft,
    Eye,
    EyeOff,
    Plus,
    Trash2,
    Cpu,
    Edit2,
    Save,
    X,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { ErrorBoundary } from "@/components/error-boundary";

import { TicketHistory } from "@/components/customers/TicketHistory";
import { CustomerHistory } from "@/components/customers/CustomerHistory";
import { Input } from "@/components/ui/input";

function DeviceField({
    label, value, editMode, inputValue, onChange, mono = false, highlight = false,
}: {
    label: string; value?: string | null; editMode: boolean;
    inputValue: string; onChange: (v: string) => void; mono?: boolean; highlight?: boolean;
}) {
    return (
        <div>
            <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
            {editMode ? (
                <Input
                    value={inputValue}
                    onChange={e => onChange(e.target.value)}
                    className={`h-8 text-sm ${mono ? "font-mono" : ""}`}
                    placeholder={`Enter ${label.toLowerCase()}`}
                />
            ) : (
                <p className={`text-sm px-2 py-1 rounded ${mono ? "font-mono" : ""} ${highlight && value ? "bg-violet-50 text-violet-900 border border-violet-100 font-semibold" : "text-gray-700"}`}>
                    {value || <span className="text-gray-300">—</span>}
                </p>
            )}
        </div>
    );
}

export default function CustomerShow({ params }: { params: Promise<{ id: string }> }) {
    const { id } = React.use(params);
    const { list } = useNavigation();
    const [customer, setCustomer] = React.useState<any>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isError, setIsError] = React.useState(false);

    const [showWifiPassword, setShowWifiPassword] = React.useState(false);

    // Live ONU signal state — fetched when customer.mac_address is known
    const [onuLive, setOnuLive] = React.useState<any>(null);
    const [onuLiveLoading, setOnuLiveLoading] = React.useState(false);

    // M-04 FIX: State for linked phones management (add/delete).
    const [newPhone, setNewPhone] = React.useState({ phone_number: "", label: "" });
    const [phonesSaving, setPhonesSaving] = React.useState(false);

    const handleAddPhone = async () => {
        if (!newPhone.phone_number.trim()) return;
        setPhonesSaving(true);
        try {
            const res = await fetch(`${API_URL}/customers/${id}/phones`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ phone_number: newPhone.phone_number, label: newPhone.label || "Other", is_primary: false }),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
            toast.success("Phone number added");
            setNewPhone({ phone_number: "", label: "" });
            fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() }).then(r => r.json()).then(d => setCustomer(d));
        } catch (e: any) { toast.error(e.message); }
        setPhonesSaving(false);
    };

    const handleDeletePhone = async (phoneId: number) => {
        if (!confirm("Remove this phone number?")) return;
        try {
            const res = await fetch(`${API_URL}/customers/${id}/phones/${phoneId}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
            toast.success("Phone number removed");
            fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() }).then(r => r.json()).then(d => setCustomer(d));
        } catch (e: any) { toast.error(e.message); }
    };

    // Device / ONU inline edit
    const [deviceEditMode, setDeviceEditMode] = React.useState(false);
    const [deviceForm, setDeviceForm] = React.useState({
        mac_address: "", olt_host: "", pon_port: "", ont_model: "",
        ont_serial_number: "", router_model: "", router_serial: "",
        wifi_ssid: "", wifi_ssid_5g: "", wifi_password: "",
    });
    const [deviceSaving, setDeviceSaving] = React.useState(false);
    const [lightbox, setLightbox] = React.useState<string | null>(null);

    const openDeviceEdit = () => {
        setDeviceForm({
            mac_address: customer?.mac_address || "",
            olt_host: customer?.olt_host || "",
            pon_port: customer?.pon_port || "",
            ont_model: customer?.ont_model || "",
            ont_serial_number: customer?.ont_serial_number || "",
            router_model: customer?.router_model || "",
            router_serial: customer?.router_serial || "",
            wifi_ssid: customer?.wifi_ssid || "",
            wifi_ssid_5g: customer?.wifi_ssid_5g || "",
            wifi_password: customer?.wifi_password || "",
        });
        setDeviceEditMode(true);
    };

    const handleDeviceSave = async () => {
        setDeviceSaving(true);
        try {
            const patch: Record<string, any> = { change_reason: "Admin device details update" };
            const fields = ["mac_address", "olt_host", "pon_port", "ont_model", "ont_serial_number", "router_model", "router_serial", "wifi_ssid", "wifi_ssid_5g", "wifi_password"] as const;
            fields.forEach(f => { patch[f] = deviceForm[f].trim() || null; });
            const res = await fetch(`${API_URL}/customers/${id}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify(patch),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
            toast.success("Device details saved");
            setDeviceEditMode(false);
            fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() }).then(r => r.json()).then(d => setCustomer(d));
        } catch (e: any) { toast.error(e.message); }
        setDeviceSaving(false);
    };

    // Complaint Modal State
    const [isComplaintOpen, setIsComplaintOpen] = React.useState(false);
    const [complaintSaving, setComplaintSaving] = React.useState(false);
    const [complaintForm, setComplaintForm] = React.useState({
        issue_type: "Slow Speed",
        priority: "Normal",
        description: ""
    });

    const handleComplaintSubmit = async () => {
        setComplaintSaving(true);
        try {
            const payload = {
                customer_id: id, // The username
                ...complaintForm,
                status: "Open"
            };
            const res = await fetch(`${API_URL}/tickets/`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error("Failed to create ticket");

            toast.success("Complaint registered successfully!");
            setIsComplaintOpen(false);
            setComplaintForm({ issue_type: "Slow Speed", priority: "Normal", description: "" });
            // Optional: Refresh customer data to show new ticket immediately
            fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() })
                .then(r => r.json())
                .then(d => setCustomer(d));

        } catch (error) {
            console.error(error);
            toast.error("Failed to log complaint");
        } finally {
            setComplaintSaving(false);
        }
    };

    React.useEffect(() => {
        if (!id) return;

        fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() })
            .then(res => {
                if (handle401(res)) return Promise.reject(new Error("Unauthorized"));
                if (!res.ok) throw new Error("Failed to load customer");
                return res.json();
            })
            .then(data => {
                if (data) {
                    setCustomer(data);
                    setIsLoading(false);
                }
            })
            .catch(err => {
                console.error("Manual Fetch Error:", err);
                if (err.message !== "Unauthorized") {
                    toast.error("Failed to load customer profile");
                }
                setIsError(true);
                setIsLoading(false);
            });
    }, [id]);

    // Fetch live ONU status — EPON: use mac_address; GPON: use SN:{ont_serial_number}
    React.useEffect(() => {
        // EPON customers have mac_address; GPON customers have ont_serial_number only
        const identifier = customer?.mac_address ||
            (customer?.ont_serial_number ? `SN:${customer.ont_serial_number}` : null);
        if (!identifier) return;
        setOnuLiveLoading(true);
        fetch(`${API_URL}/noc/onus/${encodeURIComponent(identifier)}`, { headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(d => setOnuLive(d))
            .catch(() => setOnuLive(null))
            .finally(() => setOnuLiveLoading(false));
    }, [customer?.mac_address, customer?.ont_serial_number]);

    if (isLoading) return <div className="p-10 flex justify-center"><div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent"></div></div>;
    if (isError) return <div className="p-10 text-red-500 text-center">Error loading customer profile. Please try again.</div>;
    if (!customer) return <div className="p-10 text-center text-gray-500">Customer not found.</div>;


    return (
        <ErrorBoundary fallbackTitle="Customer profile failed to load">
            <div className="p-6 md:p-8 max-w-[1600px] mx-auto min-h-screen font-sans space-y-6">

                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <Button variant="ghost" size="icon" onClick={() => list("customers")}>
                        <ArrowLeft className="h-5 w-5 text-gray-500" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
                            {customer.first_name} {customer.last_name}
                            <Badge className={customer.status === "Active" ? "bg-green-100 text-green-700 hover:bg-green-100" : "bg-red-100 text-red-700 hover:bg-red-100"}>
                                {customer.status}
                            </Badge>
                        </h1>
                        <p className="text-gray-500 text-sm font-mono mt-1">@{customer.username}</p>
                    </div>
                    <div className="ml-auto flex gap-2">
                        <Button variant="outline" onClick={() => window.location.href = `/customers/edit/${customer.username}`}>
                            Edit Profile
                        </Button>

                        <Dialog open={isComplaintOpen} onOpenChange={setIsComplaintOpen}>
                            <DialogTrigger asChild>
                                <Button className="bg-red-600 hover:bg-red-700">Log Complaint</Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[500px]">
                                <DialogHeader>
                                    <DialogTitle>Log New Complaint</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label className="text-right">Issue Type</Label>
                                        <Select
                                            value={complaintForm.issue_type}
                                            onValueChange={(val) => setComplaintForm({ ...complaintForm, issue_type: val })}
                                        >
                                            <SelectTrigger className="col-span-3">
                                                <SelectValue placeholder="Select Issue" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="LOS">LOS (Red Light)</SelectItem>
                                                <SelectItem value="Slow Speed">Slow Speed</SelectItem>
                                                <SelectItem value="Billing">Billing Issue</SelectItem>
                                                <SelectItem value="Physical Damage">Physical Damage</SelectItem>
                                                <SelectItem value="Other">Other</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label className="text-right">Priority</Label>
                                        <Select
                                            value={complaintForm.priority}
                                            onValueChange={(val) => setComplaintForm({ ...complaintForm, priority: val })}
                                        >
                                            <SelectTrigger className="col-span-3">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="High">High (Urgent)</SelectItem>
                                                <SelectItem value="Normal">Normal</SelectItem>
                                                <SelectItem value="Low">Low</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label className="text-right">Description</Label>
                                        <Textarea
                                            className="col-span-3"
                                            placeholder="Describe the issue..."
                                            value={complaintForm.description}
                                            onChange={(e) => setComplaintForm({ ...complaintForm, description: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button type="submit" onClick={handleComplaintSubmit} disabled={complaintSaving}>
                                        {complaintSaving ? "Saving..." : "Create Ticket"}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* COL 1: IDENTITY & BILLING */}
                    <div className="space-y-6">
                        <Card className="border-gray-200/60 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                                    <User className="h-4 w-4 text-blue-500" />
                                    Identity & Contact
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-start gap-3">
                                    <div className="bg-blue-50 p-2 rounded-full mt-1">
                                        <Phone className="h-4 w-4 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Mobile</p>
                                        <a href={`tel:${customer.phone}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline">
                                            {customer.phone || "—"}
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="bg-purple-50 p-2 rounded-full mt-1">
                                        <Mail className="h-4 w-4 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Email</p>
                                        <a href={`mailto:${customer.email}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline">
                                            {customer.email || "—"}
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="bg-gray-50 p-2 rounded-full mt-1">
                                        <MapPin className="h-4 w-4 text-gray-600" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Address</p>
                                        <p className="text-sm text-gray-700 leading-relaxed">
                                            {customer.railwire_address || "No address provided"}
                                        </p>
                                    </div>
                                </div>
                                {customer.pg_name && (
                                    <div className="flex items-start gap-3">
                                        <div className="bg-violet-50 p-2 rounded-full mt-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">PG Group</p>
                                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full mt-0.5">
                                                {customer.pg_name}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* M-04 FIX: Linked phones management card, surfacing full multi-phone CRUD from the backend. */}
                        <Card className="border-gray-200/60 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                                    <Phone className="h-4 w-4 text-blue-500" />
                                    Linked Phone Numbers
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {(customer.phones || []).length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">No linked numbers yet.</p>
                                ) : (
                                    (customer.phones || []).map((p: any) => (
                                        <div key={p.id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg">
                                            <div>
                                                <p className="text-sm font-mono text-gray-900">{p.phone_number}</p>
                                                <p className="text-xs text-gray-400">{p.label}{p.is_primary ? " · Primary" : ""}</p>
                                            </div>
                                            {!p.is_primary && (
                                                <button onClick={() => handleDeletePhone(p.id)} className="text-red-400 hover:text-red-600 transition-colors" title="Remove">
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))
                                )}
                                <div className="flex gap-2 pt-1">
                                    <input
                                        type="tel"
                                        placeholder="Phone number"
                                        value={newPhone.phone_number}
                                        onChange={e => setNewPhone(p => ({ ...p, phone_number: e.target.value }))}
                                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Label (e.g. Wife)"
                                        value={newPhone.label}
                                        onChange={e => setNewPhone(p => ({ ...p, label: e.target.value }))}
                                        className="w-28 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                                    />
                                    <button onClick={handleAddPhone} disabled={phonesSaving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">
                                        <Plus className="h-4 w-4" />
                                    </button>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200/60 shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                                    <Activity className="h-4 w-4 text-green-500" />
                                    Plan & Billing
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                                    <p className="text-xs text-gray-500">Current Plan</p>
                                    <p className="text-lg font-bold text-gray-900">{customer.plan_name}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <Clock className="h-3 w-3 text-gray-400" />
                                        <span className="text-xs text-gray-500">
                                            Expires: {customer.expiry_date ? new Date(customer.expiry_date).toLocaleDateString() : "N/A"}
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-1">Account Balance</p>
                                    <p className={`text-3xl font-mono font-bold ${(customer.balance || 0) > 0 ? "text-red-500" : "text-green-600"}`}>
                                        ₹ {(customer.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </p>
                                    {(customer.balance || 0) > 0 && (
                                        <p className="text-xs text-red-500 mt-1 font-medium">Payment Overdue</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* COL 2: NETWORK & GIS + DEVICE */}
                    <div className="space-y-6">
                        {/* Map card */}
                        <Card className="border-gray-200/60 shadow-sm">
                            <CardHeader className="pb-3 border-b border-gray-50">
                                <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                                    <Wifi className="h-4 w-4 text-orange-500" />
                                    Network Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6 space-y-4">
                                <div className="w-full aspect-video bg-blue-50/50 rounded-xl border border-blue-100 flex flex-col items-center justify-center relative overflow-hidden group">
                                    {customer.geo_lat && customer.geo_long ? (
                                        <iframe width="100%" height="100%" frameBorder="0" scrolling="no" marginHeight={0} marginWidth={0}
                                            src={`https://maps.google.com/maps?q=${customer.geo_lat},${customer.geo_long}&hl=es&z=14&output=embed`} />
                                    ) : (
                                        <div className="text-center p-4">
                                            <MapPin className="h-8 w-8 text-blue-200 mx-auto mb-2" />
                                            <p className="text-sm text-gray-400 font-medium">No Coordinates Available</p>
                                        </div>
                                    )}
                                    {customer.geo_lat && (
                                        <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="sm" className="bg-white text-blue-600 border border-blue-200 shadow-sm hover:bg-blue-50"
                                                onClick={() => window.open(`https://www.google.com/maps?q=${customer.geo_lat},${customer.geo_long}`, '_blank')}>
                                                <ExternalLink className="h-3 w-3 mr-2" /> Open Maps
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-xs text-gray-500 font-medium mb-1">Pole ID</p>
                                        <p className="text-sm font-mono text-gray-900">{customer.pole_id || "—"}</p>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded-lg">
                                        <p className="text-xs text-gray-500 font-medium mb-1">Splitter Port</p>
                                        <p className="text-sm font-mono text-gray-900">{customer.splitter_id || "—"}</p>
                                    </div>
                                </div>
                                {/* WiFi Details */}
                                {(customer.wifi_ssid || customer.wifi_ssid_5g || customer.wifi_password) && (
                                    <div className="space-y-2 pt-1">
                                        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">WiFi Credentials</p>
                                        {customer.wifi_ssid && (
                                            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/60 border border-blue-100 rounded-lg">
                                                <Wifi className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                                <span className="text-xs text-gray-500 w-12 flex-shrink-0">2.4 GHz</span>
                                                <span className="text-sm font-medium text-gray-900 font-mono truncate">{customer.wifi_ssid}</span>
                                            </div>
                                        )}
                                        {customer.wifi_ssid_5g && (
                                            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50/60 border border-blue-100 rounded-lg">
                                                <Wifi className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                                <span className="text-xs text-gray-500 w-12 flex-shrink-0">5 GHz</span>
                                                <span className="text-sm font-medium text-gray-900 font-mono truncate">{customer.wifi_ssid_5g}</span>
                                            </div>
                                        )}
                                        {customer.wifi_password && (
                                            <div className="p-3 bg-yellow-50/50 border border-yellow-100 rounded-lg flex justify-between items-center gap-2">
                                                <span className="text-xs text-gray-500 w-12 flex-shrink-0">Password</span>
                                                <p className="text-sm font-mono text-gray-800 flex-1 truncate">
                                                    {showWifiPassword ? customer.wifi_password : "••••••••••••"}
                                                </p>
                                                <button onClick={() => setShowWifiPassword(v => !v)} className="text-yellow-600 hover:text-yellow-800 flex-shrink-0">
                                                    {showWifiPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <Badge variant="outline" className="text-xs border-yellow-200 bg-yellow-100 text-yellow-700 flex-shrink-0">Confidential</Badge>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Device & ONU card */}
                        <Card className="border-gray-200/60 shadow-sm">
                            <CardHeader className="pb-3 border-b border-gray-50">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                                        <Cpu className="h-4 w-4 text-violet-500" />
                                        Device & ONU
                                    </CardTitle>
                                    {!deviceEditMode ? (
                                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openDeviceEdit}>
                                            <Edit2 className="h-3 w-3 mr-1" /> Edit
                                        </Button>
                                    ) : (
                                        <div className="flex gap-1">
                                            <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => setDeviceEditMode(false)} disabled={deviceSaving}>
                                                <X className="h-3 w-3 mr-1" /> Cancel
                                            </Button>
                                            <Button size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700" onClick={handleDeviceSave} disabled={deviceSaving}>
                                                <Save className="h-3 w-3 mr-1" /> {deviceSaving ? "Saving…" : "Save"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="p-4 space-y-3">
                                {/* Live ONU signal panel — EPON uses mac_address, GPON uses SN:ont_serial */}
                                {(customer.mac_address || customer.ont_serial_number) && (
                                    <div className={`rounded-lg border px-4 py-3 ${
                                        onuLiveLoading ? "border-gray-200 bg-gray-50" :
                                        !onuLive ? "border-gray-200 bg-gray-50" :
                                        onuLive.dying_gasp ? "border-purple-200 bg-purple-50" :
                                        onuLive.status === "online" ? "border-green-200 bg-green-50" :
                                        "border-red-200 bg-red-50"
                                    }`}>
                                        {onuLiveLoading ? (
                                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                                <div className="h-2 w-2 rounded-full bg-gray-300 animate-pulse" />
                                                Checking live status…
                                            </div>
                                        ) : !onuLive ? (
                                            <div className="flex items-center gap-2 text-sm text-gray-400">
                                                <div className="h-2 w-2 rounded-full bg-gray-300" />
                                                No live data yet — OLT has not polled this device
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-2">
                                                    <div className={`h-2.5 w-2.5 rounded-full ${
                                                        onuLive.dying_gasp ? "bg-purple-500" :
                                                        onuLive.status === "online" ? "bg-green-500" : "bg-red-500"
                                                    }`} />
                                                    <span className={`text-sm font-semibold ${
                                                        onuLive.dying_gasp ? "text-purple-700" :
                                                        onuLive.status === "online" ? "text-green-700" : "text-red-700"
                                                    }`}>
                                                        {onuLive.dying_gasp ? "Dying Gasp (power cut?)" :
                                                         onuLive.status === "online" ? "Online" : "Offline"}
                                                    </span>
                                                </div>
                                                {onuLive.rx_power_dbm != null && (
                                                    <span className={`text-sm font-bold ${
                                                        onuLive.rx_power_dbm >= -20 ? "text-green-700" :
                                                        onuLive.rx_power_dbm >= -24 ? "text-yellow-700" :
                                                        onuLive.rx_power_dbm >= -27 ? "text-orange-700" : "text-red-700"
                                                    }`}>
                                                        Rx {onuLive.rx_power_dbm.toFixed(1)} dBm
                                                    </span>
                                                )}
                                                <div className="flex items-center gap-2 ml-auto">
                                                    {onuLive.polled_at && (
                                                        <span className="text-xs text-gray-400">
                                                            {(() => {
                                                                const secs = (Date.now() - new Date(onuLive.polled_at).getTime()) / 1000;
                                                                if (secs < 60) return `${Math.round(secs)}s ago`;
                                                                if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
                                                                return `${Math.round(secs / 3600)}h ago`;
                                                            })()}
                                                        </span>
                                                    )}
                                                    <a
                                                        href={`/noc/onus/${encodeURIComponent(customer.mac_address || `SN:${customer.ont_serial_number}`)}`}
                                                        className="text-xs text-blue-600 hover:underline"
                                                    >
                                                        Full history →
                                                    </a>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* MAC Address */}
                                <DeviceField
                                    label="MAC Address / GPON SN"
                                    value={customer.mac_address}
                                    editMode={deviceEditMode}
                                    inputValue={deviceForm.mac_address}
                                    onChange={v => setDeviceForm(f => ({ ...f, mac_address: v.toUpperCase() }))}
                                    mono
                                    highlight={!!customer.mac_address}
                                />
                                {/* OLT / PON */}
                                <div className="grid grid-cols-2 gap-2">
                                    <DeviceField label="OLT Host" value={customer.olt_host} editMode={deviceEditMode}
                                        inputValue={deviceForm.olt_host} onChange={v => setDeviceForm(f => ({ ...f, olt_host: v }))} mono />
                                    <DeviceField label="PON Port" value={customer.pon_port} editMode={deviceEditMode}
                                        inputValue={deviceForm.pon_port} onChange={v => setDeviceForm(f => ({ ...f, pon_port: v }))} mono />
                                </div>
                                {/* ONT model */}
                                <DeviceField label="ONT Model" value={customer.ont_model} editMode={deviceEditMode}
                                    inputValue={deviceForm.ont_model} onChange={v => setDeviceForm(f => ({ ...f, ont_model: v }))} />
                                <DeviceField label="ONT Serial Number" value={customer.ont_serial_number} editMode={deviceEditMode}
                                    inputValue={deviceForm.ont_serial_number} onChange={v => setDeviceForm(f => ({ ...f, ont_serial_number: v }))} mono />
                                {/* Router */}
                                <DeviceField label="Router Model" value={customer.router_model} editMode={deviceEditMode}
                                    inputValue={deviceForm.router_model} onChange={v => setDeviceForm(f => ({ ...f, router_model: v }))} />
                                <DeviceField label="Router Serial" value={customer.router_serial} editMode={deviceEditMode}
                                    inputValue={deviceForm.router_serial} onChange={v => setDeviceForm(f => ({ ...f, router_serial: v }))} mono />

                                {/* WiFi fields — editable */}
                                {deviceEditMode && (
                                    <div className="space-y-2 pt-1 border-t border-gray-100">
                                        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mt-1">WiFi Credentials</p>
                                        <DeviceField label="WiFi SSID (2.4 GHz)" value={customer.wifi_ssid} editMode={deviceEditMode}
                                            inputValue={deviceForm.wifi_ssid} onChange={v => setDeviceForm(f => ({ ...f, wifi_ssid: v }))} />
                                        <DeviceField label="WiFi SSID (5 GHz)" value={customer.wifi_ssid_5g} editMode={deviceEditMode}
                                            inputValue={deviceForm.wifi_ssid_5g} onChange={v => setDeviceForm(f => ({ ...f, wifi_ssid_5g: v }))} />
                                        <DeviceField label="WiFi Password" value={customer.wifi_password} editMode={deviceEditMode}
                                            inputValue={deviceForm.wifi_password} onChange={v => setDeviceForm(f => ({ ...f, wifi_password: v }))} />
                                    </div>
                                )}

                                {/* Survey Photos */}
                                {(customer.install_photo_url || customer.sticker_photo_url || customer.router_sticker_photo_url) && (
                                    <div>
                                        <p className="text-xs text-gray-500 font-medium mb-1.5">Survey Photos</p>
                                        <div className="flex gap-2 flex-wrap">
                                            {customer.install_photo_url && (
                                                <button type="button" onClick={() => setLightbox(`${API_URL}${customer.install_photo_url}`)}
                                                    className="relative h-20 w-28 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 hover:border-green-400 transition-colors">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={`${API_URL}${customer.install_photo_url}`} alt="Install" className="w-full h-full object-cover" />
                                                    <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] bg-black/50 text-white py-0.5">Install</span>
                                                </button>
                                            )}
                                            {customer.sticker_photo_url && (
                                                <button type="button" onClick={() => setLightbox(`${API_URL}${customer.sticker_photo_url}`)}
                                                    className="relative h-20 w-28 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 hover:border-violet-400 transition-colors">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={`${API_URL}${customer.sticker_photo_url}`} alt="ONT sticker" className="w-full h-full object-contain" />
                                                    <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] bg-black/50 text-white py-0.5">ONT</span>
                                                </button>
                                            )}
                                            {customer.router_sticker_photo_url && (
                                                <button type="button" onClick={() => setLightbox(`${API_URL}${customer.router_sticker_photo_url}`)}
                                                    className="relative h-20 w-28 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 hover:border-blue-400 transition-colors">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={`${API_URL}${customer.router_sticker_photo_url}`} alt="Router sticker" className="w-full h-full object-contain" />
                                                    <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] bg-black/50 text-white py-0.5">Router</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Survey & Data Quality Summary */}
                        {(customer.last_surveyed_at || customer.mac_address || customer.ont_serial_number || customer.gps_lat) && (
                            <Card className="border-gray-200/60 shadow-sm">
                                <CardHeader className="pb-3 border-b border-gray-50">
                                    <CardTitle className="text-base font-medium flex items-center gap-2 text-gray-700">
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                        Survey & Data Quality
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-4 space-y-3">
                                    {/* ONU Type badge */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500 font-medium">OLT Link Type</span>
                                        {customer.mac_address ? (
                                            <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100">
                                                EPON — MAC
                                            </Badge>
                                        ) : customer.ont_serial_number ? (
                                            <Badge className="bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-100">
                                                GPON — Serial
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-gray-400">Not Set</Badge>
                                        )}
                                    </div>
                                    {/* OLT identifier */}
                                    {(customer.mac_address || customer.ont_serial_number) && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500 font-medium">OLT Identifier</span>
                                            <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-800">
                                                {customer.mac_address || customer.ont_serial_number}
                                            </span>
                                        </div>
                                    )}
                                    {/* GPS */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500 font-medium">GPS Location</span>
                                        {customer.gps_lat ? (
                                            <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Confirmed ({customer.gps_lat?.toFixed(4)}, {customer.gps_lng?.toFixed(4)})
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs text-gray-400">
                                                <AlertCircle className="h-3 w-3" />
                                                Not collected
                                            </span>
                                        )}
                                    </div>
                                    {/* Survey date */}
                                    {customer.last_surveyed_at && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500 font-medium">Last Surveyed</span>
                                            <span className="text-xs text-gray-700">
                                                {new Date(customer.last_surveyed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </span>
                                        </div>
                                    )}
                                    {/* OLT placement */}
                                    {(customer.olt_host || customer.pon_port) && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-gray-500 font-medium">OLT Placement</span>
                                            <span className="text-xs font-mono text-gray-700">
                                                {[customer.olt_host, customer.pon_port, customer.onu_index ? `#${customer.onu_index}` : null].filter(Boolean).join(" / ")}
                                            </span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Lightbox */}
                    {lightbox && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85" onClick={() => setLightbox(null)}>
                            <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}>
                                <X className="h-8 w-8" />
                            </button>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={lightbox} alt="Sticker" className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
                        </div>
                    )}

                    {/* COL 3: HISTORY */}
                    <div className="space-y-6">
                        <TicketHistory
                            tickets={customer.tickets || []}
                            customerId={customer.username}
                            onTicketCreate={() => setIsComplaintOpen(true)}
                            onTicketUpdate={() => {
                                // G-11 FIX: Added auth headers — was unauthenticated, always returned 401.
                                fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() })
                                    .then(r => r.json())
                                    .then(d => setCustomer(d));
                            }}
                        />
                        <CustomerHistory username={customer.username} />
                    </div>

                </div>
            </div>
        </ErrorBoundary>
    );
}
