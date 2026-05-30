"use client";

import React from "react";
import { API_URL } from "@/config";
import { useNavigation } from "@refinedev/core";
import { useForm } from "react-hook-form";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save, Loader2, MapPin, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { getAuthHeaders, handle401 } from "@/lib/auth-utils";
import { ErrorBoundary } from "@/components/error-boundary";

interface CustomerFormValues {
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    railwire_address: string;
    plan_name: string;
    pole_id: string;
    splitter_id: string;
    wifi_password: string;
    geo_lat: string;
    geo_long: string;
}

export default function CustomerEdit({ params }: { params: Promise<{ id: string }> }) {
    const { id } = React.use(params);
    const { list, show } = useNavigation();
    const [isLoading, setIsLoading] = React.useState(true);
    const [isSaving, setIsSaving] = React.useState(false);
    const [locationCaptured, setLocationCaptured] = React.useState(false);

    const { register, handleSubmit, setValue, formState: { errors } } = useForm<CustomerFormValues>();

    // 1. Fetch Data
    React.useEffect(() => {
        if (!id) return;

        fetch(`${API_URL}/customers/${id}`, { headers: getAuthHeaders() })
            .then(res => {
                if (handle401(res)) return Promise.reject(new Error("Unauthorized"));
                if (!res.ok) throw new Error("Failed to fetch");
                return res.json();
            })
            .then(data => {
                if (data) {
                    // Populate Form
                    setValue("first_name", data.first_name);
                    setValue("last_name", data.last_name || "");
                    setValue("phone", data.phone);
                    setValue("email", data.email || "");
                    setValue("railwire_address", data.railwire_address || "");
                    setValue("plan_name", data.plan_name);
                    setValue("pole_id", data.pole_id || "");
                    setValue("splitter_id", data.splitter_id || "");
                    setValue("wifi_password", data.wifi_password || "");
                    setValue("geo_lat", data.geo_lat?.toString() || "");
                    setValue("geo_long", data.geo_long?.toString() || "");
                    setIsLoading(false);
                }
            })
            .catch(err => {
                if (err.message !== "Unauthorized") {
                    console.error(err);
                    toast.error("Failed to load customer data");
                }
                setIsLoading(false);
            });
    }, [id, setValue]);

    // 2. Submit Logic
    const onSubmit = async (data: CustomerFormValues) => {
        setIsSaving(true);
        try {
            // Convert types if needed (e.g. lat/long to float)
            const payload = {
                ...data,
                geo_lat: data.geo_lat ? parseFloat(data.geo_lat) : null,
                geo_long: data.geo_long ? parseFloat(data.geo_long) : null,
            };

            const res = await fetch(`${API_URL}/customers/${id}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            if (handle401(res)) return;
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Update failed");
            }

            toast.success("Customer updated successfully");
            // Redirect back to show page
            show("customers", id);
        } catch (error: any) {
            console.error("Save Error:", error);
            toast.error(error.message || "Failed to save changes");
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>;

    return (
        <ErrorBoundary fallbackTitle="Customer edit form failed to load">
        <div className="p-6 md:p-8 max-w-[1200px] mx-auto font-sans">

            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" size="icon" onClick={() => show("customers", id)}>
                    <ArrowLeft className="h-5 w-5 text-gray-500" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Edit Customer</h1>
                    <p className="text-gray-500 text-sm font-mono mt-1">@{id}</p>
                </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* IDENTITY & CONTACT */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="text-base text-gray-700">Identity & Contact</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>First Name *</Label>
                                <Input {...register("first_name", { required: "First name is required" })} />
                                {errors.first_name && <span className="text-xs text-red-500">{errors.first_name.message}</span>}
                            </div>
                            <div className="space-y-2">
                                <Label>Last Name</Label>
                                <Input {...register("last_name")} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Mobile Number *</Label>
                                <Input {...register("phone", { required: "Phone number is required" })} />
                                {errors.phone && <span className="text-xs text-red-500">{errors.phone.message}</span>}
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input {...register("email")} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Address</Label>
                            <Textarea {...register("railwire_address")} rows={3} />
                        </div>
                    </CardContent>
                </Card>

                {/* NETWORK & TECHNICAL */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base text-gray-700">Network Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Plan Name</Label>
                                <Input {...register("plan_name")} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Pole ID</Label>
                                    <Input {...register("pole_id")} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Splitter Port</Label>
                                    <Input {...register("splitter_id")} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Wi-Fi Password</Label>
                                <Input {...register("wifi_password")} />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base text-gray-700">GPS Location</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Latitude</Label>
                                    <Input {...register("geo_lat")} placeholder="12.820" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Longitude</Label>
                                    <Input {...register("geo_long")} placeholder="80.040" />
                                </div>
                            </div>
                            <Button type="button" variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                                navigator.geolocation.getCurrentPosition((pos) => {
                                    setValue("geo_lat", pos.coords.latitude.toFixed(6));
                                    setValue("geo_long", pos.coords.longitude.toFixed(6));
                                    setLocationCaptured(true);
                                    setTimeout(() => setLocationCaptured(false), 3000);
                                }, () => toast.error("Location access denied"));
                            }}>
                                {locationCaptured
                                    ? <><CheckCircle2 className="mr-2 h-3 w-3 text-green-500" /> Location captured</>
                                    : <><MapPin className="mr-2 h-3 w-3" /> Use My Current Location</>
                                }
                            </Button>
                            <p className="text-xs text-gray-400 leading-relaxed">
                                <span className="font-medium text-gray-500">WhatsApp method:</span> Ask customer to share live location → open in Google Maps → copy coordinates from URL bar and paste above.
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* ACTION BAR */}
                <div className="lg:col-span-3">
                    <Separator className="my-4" />
                    <div className="flex justify-end gap-3">
                        <Button type="button" variant="outline" onClick={() => show("customers", id)}>Cancel</Button>
                        <Button type="submit" disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </div>
                </div>

            </form>
        </div>
        </ErrorBoundary>
    );
}
