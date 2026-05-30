"use client";

import React, { useState } from "react";
import { useApiUrl } from "@refinedev/core";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

export function CreateTechnicianDialog({
    onCreated,
}: {
    onCreated: () => void;
}) {
    const apiUrl = useApiUrl();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [form, setForm] = useState({
        username: "",
        password: "",
        full_name: "",
        role: "Field Tech",
        phone: "",
        email: "",
        specialization: "General",
        area_assigned: "",
        employment_type: "Full-Time",
        emergency_contact: "",
        notes: "",
    });

    const updateField = (field: string, value: string) =>
        setForm((f) => ({ ...f, [field]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const body: Record<string, string | null> = { ...form };
            // Remove empty strings
            Object.keys(body).forEach((k) => {
                if (body[k] === "") body[k] = null;
            });
            // username and password are required
            body.username = form.username;
            body.password = form.password;
            body.full_name = form.full_name;

            if (!body.username || !body.password || !body.full_name) {
                setError("Username, password, and full name are required.");
                setLoading(false);
                return;
            }

            const res = await fetch(`${apiUrl}/technicians/`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.detail || "Failed to create technician.");
                setLoading(false);
                return;
            }

            setOpen(false);
            setForm({
                username: "",
                password: "",
                full_name: "",
                role: "Field Tech",
                phone: "",
                email: "",
                specialization: "General",
                area_assigned: "",
                employment_type: "Full-Time",
                emergency_contact: "",
                notes: "",
            });
            onCreated();
        } catch {
            setError("Network error. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200 gap-2">
                    <Plus className="h-4 w-4" />
                    New Technician
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">
                        Create New Technician
                    </DialogTitle>
                    <DialogDescription>
                        Add a new technician to the team. All fields marked with * are
                        required.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-6 mt-2">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    {/* Identity */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                            Identity
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="username">Username *</Label>
                                <Input
                                    id="username"
                                    value={form.username}
                                    onChange={(e) => updateField("username", e.target.value)}
                                    placeholder="e.g. john_tech"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password *</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => updateField("password", e.target.value)}
                                    placeholder="Secure password"
                                    required
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="full_name">Full Name *</Label>
                            <Input
                                id="full_name"
                                value={form.full_name}
                                onChange={(e) => updateField("full_name", e.target.value)}
                                placeholder="e.g. John Smith"
                                required
                            />
                        </div>
                    </div>

                    {/* Contact */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                            Contact
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone</Label>
                                <Input
                                    id="phone"
                                    value={form.phone}
                                    onChange={(e) => updateField("phone", e.target.value)}
                                    placeholder="10+ digit number"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => updateField("email", e.target.value)}
                                    placeholder="tech@riconet.com"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="emergency_contact">Emergency Contact</Label>
                            <Input
                                id="emergency_contact"
                                value={form.emergency_contact}
                                onChange={(e) =>
                                    updateField("emergency_contact", e.target.value)
                                }
                                placeholder="10+ digit number"
                            />
                        </div>
                    </div>

                    {/* Professional */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                            Professional
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Role</Label>
                                <Select
                                    value={form.role}
                                    onValueChange={(v) => updateField("role", v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Field Tech">Field Tech</SelectItem>
                                        <SelectItem value="Senior Tech">Senior Tech</SelectItem>
                                        <SelectItem value="Supervisor">Supervisor</SelectItem>
                                        <SelectItem value="Admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Specialization</Label>
                                <Select
                                    value={form.specialization}
                                    onValueChange={(v) => updateField("specialization", v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
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
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="area_assigned">Area / Zone</Label>
                                <Input
                                    id="area_assigned"
                                    value={form.area_assigned}
                                    onChange={(e) => updateField("area_assigned", e.target.value)}
                                    placeholder="e.g. North Zone"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Employment Type</Label>
                                <Select
                                    value={form.employment_type}
                                    onValueChange={(v) => updateField("employment_type", v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Full-Time">Full-Time</SelectItem>
                                        <SelectItem value="Part-Time">Part-Time</SelectItem>
                                        <SelectItem value="Contract">Contract</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="notes">Internal Notes</Label>
                        <Textarea
                            id="notes"
                            value={form.notes}
                            onChange={(e) => updateField("notes", e.target.value)}
                            placeholder="Admin-only notes..."
                            rows={3}
                        />
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            {loading ? "Creating..." : "Create Technician"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
