"use client";

import React from "react";
import {
    AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel?: string;
    variant?: "danger" | "warning" | "default";
    loading?: boolean;
    onConfirm: () => void;
}

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    variant = "default",
    loading = false,
    onConfirm,
}: ConfirmDialogProps) {
    const btnClass =
        variant === "danger"
            ? "bg-red-600 hover:bg-red-700 text-white"
            : variant === "warning"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        {variant !== "default" && (
                            <AlertTriangle
                                className={`h-5 w-5 ${variant === "danger" ? "text-red-500" : "text-amber-500"
                                    }`}
                            />
                        )}
                        {title}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-gray-500 mt-2">
                        {description}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 mt-4">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        className={btnClass}
                        onClick={onConfirm}
                        disabled={loading}
                    >
                        {loading ? "Processing..." : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
