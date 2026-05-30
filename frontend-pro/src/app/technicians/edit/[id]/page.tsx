"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApiUrl } from "@refinedev/core";
import { getAuthHeaders } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import { ArrowLeft, Save, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/error-boundary";

function TechnicianEditForm() {
    const params = useParams();
    const router = useRouter();
    const techId = params?.id;
    const apiUrl = useApiUrl();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [form, setForm] = useState({
        full_name: "",
        role: "",
        phone: "",
        email: "",
        specialization: "",
        area_assigned: "",
        employment_type: "",
        emergency_contact: "",
        address: "",
        notes: "",
        password: "",
    });

    useEffect(() => {
        if (!techId) return;
        const fetchTech = async () => {
            setLoading(true);
            try {
                const res = await fetch(`${apiUrl}/technicians/${techId}`, {
                    headers: getAuthHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    setForm({
                        full_name: data.full_name || "",
                        role: data.role || "Field Tech",
                        phone: data.phone || "",
                        email: data.email || "",
                        specialization: data.specialization || "General",
                        area_assigned: data.area_assigned || "",
                        employment_type: data.employment_type || "Full-Time",
                        emergency_contact: data.emergency_contact || "",
                        address: data.address || "",
                        notes: data.notes || "",
                        password: "",
                    });
                }
            } catch {
                toast.error("Failed to load technician data");
            }
            setLoading(false);
        };
        fetchTech();
    }, [apiUrl, techId]);

    const updateField = (field: string, value: string) =>
        setForm((f) => ({ ...f, [field]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess("");
        setSaving(true);

        try {
            const body: any = { ...form };
            // Convert empty strings to null, except password (exclude if empty)
            Object.keys(body).forEach((k) => {
                if (body[k] === "" && k !== "password") body[k] = null;
            });
            // Remove password if empty (no reset intended)
            if (!body.password) delete body.password;

            const res = await fetch(`${apiUrl}/technicians/${techId}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.detail || "Failed to update.");
                setSaving(false);
                return;
            }

            toast.success("Profile updated successfully!");
            setSuccess("Profile updated successfully!");
            setTimeout(() => router.push(`/technicians/show/${techId}`), 1000);
        } catch {
            toast.error("Network error. Please try again.");
            setError("Network error. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen bg-[#F4F5F7]">
                <MainSidebar />
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-pulse text-gray-400">Loading...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-[#F4F5F7] font-sans text-gray-900 overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">
                <div className="p-6 md:p-8 max-w-[900px] mx-auto space-y-6 min-h-screen">
                    {/* Back Button */}
                    <Link href={`/technicians/show/${techId}`}>
                        <Button variant="ghost" className="gap-2 text-gray-500 hover:text-gray-700 -ml-3">
                            <ArrowLeft className="h-4 w-4" />
                            Back to Profile
                        </Button>
                    </Link>

                    <h1 className="text-2xl font-bold text-gray-900">Edit Technician</h1>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                                <AlertTriangle className="h-4 w-4" /> {error}
                            </div>
                        )}
                        {success && (
                            <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm border border-green-100">
                                ✅ {success}
                            </div>
                        )}

                        {/* Identity */}
                        <Card className="border-none shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700">Identity</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="full_name">Full Name</Label>
                                    <Input
                                        id="full_name"
                                        value={form.full_name}
                                        onChange={(e) => updateField("full_name", e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Role</Label>
                                        <Select value={form.role} onValueChange={(v) => updateField("role", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Field Tech">Field Tech</SelectItem>
                                                <SelectItem value="Senior Tech">Senior Tech</SelectItem>
                                                <SelectItem value="Supervisor">Supervisor</SelectItem>
                                                <SelectItem value="Admin">Admin</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Employment Type</Label>
                                        <Select value={form.employment_type} onValueChange={(v) => updateField("employment_type", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Full-Time">Full-Time</SelectItem>
                                                <SelectItem value="Part-Time">Part-Time</SelectItem>
                                                <SelectItem value="Contract">Contract</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Professional */}
                        <Card className="border-none shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700">Professional</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Specialization</Label>
                                        <Select value={form.specialization} onValueChange={(v) => updateField("specialization", v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="General">General</SelectItem>
                                                <SelectItem value="Fiber">Fiber</SelectItem>
                                                <SelectItem value="Router">Router</SelectItem>
                                                <SelectItem value="Splicing">Splicing</SelectItem>
                                                <SelectItem value="Cable">Cable</SelectItem>
                                                <SelectItem value="Network">Network</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="area_assigned">Area / Zone</Label>
                                        <Input
                                            id="area_assigned"
                                            value={form.area_assigned}
                                            onChange={(e) => updateField("area_assigned", e.target.value)}
                                            placeholder="e.g. North Zone"
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Contact */}
                        <Card className="border-none shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700">Contact</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="phone">Phone</Label>
                                        <Input
                                            id="phone"
                                            value={form.phone}
                                            onChange={(e) => updateField("phone", e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="email">Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            value={form.email}
                                            onChange={(e) => updateField("email", e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="emergency_contact">Emergency Contact</Label>
                                        <Input
                                            id="emergency_contact"
                                            value={form.emergency_contact}
                                            onChange={(e) => updateField("emergency_contact", e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="address">Address</Label>
                                        <Input
                                            id="address"
                                            value={form.address}
                                            onChange={(e) => updateField("address", e.target.value)}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Notes */}
                        <Card className="border-none shadow-sm">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700">Notes</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    value={form.notes}
                                    onChange={(e) => updateField("notes", e.target.value)}
                                    placeholder="Internal admin notes..."
                                    rows={4}
                                />
                            </CardContent>
                        </Card>

                        {/* Password Reset */}
                        <Card className="border-none shadow-sm border-l-4 border-l-amber-400">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base font-semibold text-gray-700">Reset Password</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-gray-400 mb-3">Leave blank to keep the current password.</p>
                                <Input
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => updateField("password", e.target.value)}
                                    placeholder="New password (leave blank to keep current)"
                                />
                            </CardContent>
                        </Card>

                        {/* Submit */}
                        <div className="flex justify-end gap-3 pb-8">
                            <Link href={`/technicians/show/${techId}`}>
                                <Button type="button" variant="outline">Cancel</Button>
                            </Link>
                            <Button
                                type="submit"
                                disabled={saving}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                            >
                                <Save className="h-4 w-4" />
                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function TechnicianEditPage() {
    return (
        <ErrorBoundary fallbackTitle="Technician edit form failed to load">
            <TechnicianEditForm />
        </ErrorBoundary>
    );
}
