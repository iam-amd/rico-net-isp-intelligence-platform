"use client";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBannerProps {
    title?: string;
    message: string;
    onRetry?: () => void;
}

/**
 * Inline error banner for pages that need to surface a fetch failure to the
 * user without crashing the whole tree (which is what ErrorBoundary catches).
 * Use for "the API said no / network is down" cases — not for runtime exceptions.
 */
export function ErrorBanner({ title = "Something went wrong", message, onRetry }: ErrorBannerProps) {
    return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 my-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <div className="font-semibold text-red-900">{title}</div>
                <div className="text-sm text-red-700 mt-0.5 break-words">{message}</div>
            </div>
            {onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry} className="border-red-300 text-red-700 hover:bg-red-100">
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
                </Button>
            )}
        </div>
    );
}
