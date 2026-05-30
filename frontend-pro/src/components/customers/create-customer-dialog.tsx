"use client";

import React from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreate, useNotification } from "@refinedev/core";

const customerSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    first_name: z.string().min(2, "First Name is required"),
    phone: z.string().regex(/^\d+$/, "Phone must be numeric").min(10, "Phone too short"),
    plan_name: z.string().default("Basic"),
    // Optional fields
    email: z.string().email().optional().or(z.literal("")),
    notes: z.string().optional(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

export function CreateCustomerDialog({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = React.useState(false);
    // @ts-ignore
    const { mutate: create, isLoading } = useCreate();
    const { open: openNotification } = useNotification();

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<CustomerFormValues>({
        resolver: zodResolver(customerSchema) as any,
    });

    const onSubmit = (data: CustomerFormValues) => {
        create(
            {
                resource: "customers",
                values: data,
            },
            {
                onSuccess: () => {
                    setOpen(false);
                    reset();
                    openNotification?.({
                        type: "success",
                        message: "Success",
                        description: "Customer created successfully",
                    });
                },
                onError: (error) => {
                    openNotification?.({
                        type: "error",
                        message: "Error",
                        description: "Failed to create customer",
                    });
                }
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create New Customer</DialogTitle>
                    <DialogDescription>
                        Add a new customer to the system. Click save when you&apos;re done.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="username" className="text-right">
                            Username
                        </Label>
                        <div className="col-span-3">
                            <Input
                                id="username"
                                {...register("username")}
                                placeholder="john.doe"
                            />
                            {errors.username && <span className="text-xs text-red-500">{errors.username.message}</span>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="first_name" className="text-right">
                            Name
                        </Label>
                        <div className="col-span-3">
                            <Input
                                id="first_name"
                                {...register("first_name")}
                                placeholder="John Doe"
                            />
                            {errors.first_name && <span className="text-xs text-red-500">{errors.first_name.message}</span>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">
                            Phone
                        </Label>
                        <div className="col-span-3">
                            <Input
                                id="phone"
                                {...register("phone")}
                                placeholder="9876543210"
                            />
                            {errors.phone && <span className="text-xs text-red-500">{errors.phone.message}</span>}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">
                            Email
                        </Label>
                        <Input
                            id="email"
                            {...register("email")}
                            placeholder="john@example.com"
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="plan" className="text-right">
                            Plan
                        </Label>
                        <Input
                            id="plan"
                            {...register("plan_name")}
                            defaultValue="Basic"
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="notes" className="text-right">
                            Notes
                        </Label>
                        <Input
                            id="notes"
                            {...register("notes")}
                            placeholder="Initial remarks"
                            className="col-span-3"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading ? "Creating..." : "Create Customer"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog >
    );
}
