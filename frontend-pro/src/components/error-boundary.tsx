"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallbackTitle?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("[ErrorBoundary] Caught rendering error:", error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
                    <div className="bg-red-50 p-4 rounded-full mb-4">
                        <AlertTriangle className="h-10 w-10 text-red-500" />
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">
                        {this.props.fallbackTitle || "Something went wrong"}
                    </h2>
                    <p className="text-sm text-gray-500 mb-6 max-w-md">
                        An unexpected error occurred while rendering this page. Please try again or contact support if the issue persists.
                    </p>
                    {this.state.error && (
                        <p className="text-xs text-red-400 font-mono mb-4 max-w-lg break-all">
                            {this.state.error.message}
                        </p>
                    )}
                    <Button onClick={this.handleReset} className="bg-blue-600 hover:bg-blue-700 text-white">
                        Try Again
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}
