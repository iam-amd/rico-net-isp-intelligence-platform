"use client";

import React, { useState, useEffect } from "react";
import { API_URL } from "@/config";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { MessageSquare, Clock, Calendar, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/auth-utils";

interface CustomerTicketSheetProps {
    ticket: any | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUpdate: () => void; // Trigger refresh on parent
}

export function CustomerTicketSheet({ ticket, open, onOpenChange, onUpdate }: CustomerTicketSheetProps) {
    const [note, setNote] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (ticket) {
            setNote(ticket.internal_notes || "");
        }
    }, [ticket]);

    if (!ticket) return null;

    const handleSaveNote = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${API_URL}/tickets/${ticket.id}`, {
                method: "PUT",
                headers: getAuthHeaders(),
                body: JSON.stringify({ internal_notes: note })
            });

            if (!res.ok) throw new Error("Failed");

            toast.success("Note saved");
            onUpdate();
        } catch (e) {
            console.error(e);
            toast.error("Failed to save note");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:max-w-[500px] w-full pt-10 px-0 flex flex-col bg-gray-50/50">
                <div className="px-6 pb-4 border-b border-gray-100 bg-white">
                    <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline" className={`px-2 py-0.5 uppercase text-[10px] tracking-wider ${ticket.priority === 'High' ? 'text-red-600 bg-red-50 border-red-100' : 'text-gray-600 bg-gray-50'}`}>
                            {ticket.priority || "Normal"} Priority
                        </Badge>
                        <span className="text-xs text-gray-400 font-mono">#{ticket.id}</span>
                    </div>
                    <SheetTitle className="text-xl font-bold text-gray-900">
                        {ticket.issue_type}
                    </SheetTitle>
                    <SheetDescription className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        Created {new Date(ticket.created_at).toLocaleString()}
                    </SheetDescription>
                </div>

                <ScrollArea className="flex-1 px-6 py-6">
                    <div className="space-y-6">

                        {/* Status Section */}
                        <Card className="p-4 border-gray-100 shadow-sm bg-white">
                            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Current Status</h4>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className={`h-2.5 w-2.5 rounded-full ${ticket.status === 'Open' ? 'bg-red-500' : ticket.status === 'Resolved' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
                                    <span className="font-medium text-gray-900">{ticket.status}</span>
                                </div>
                                {ticket.assigned_tech && (
                                    <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                                        Assigned to {ticket.assigned_tech}
                                    </Badge>
                                )}
                            </div>
                        </Card>

                        {/* Description */}
                        <div>
                            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Description</h4>
                            <p className="text-sm text-gray-700 leading-relaxed bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                {ticket.description || "No description provided."}
                            </p>
                        </div>

                        {/* Internal Notes */}
                        <div>
                            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <MessageSquare className="h-3 w-3" />
                                Internal Notes
                            </h4>
                            <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm space-y-2">
                                <Input
                                    placeholder="Add a note..."
                                    className="text-sm border-gray-200"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                />
                                <div className="flex justify-end">
                                    <Button size="sm" variant="ghost" onClick={handleSaveNote} disabled={isLoading}>
                                        {isLoading ? "Saving..." : "Save Note"}
                                    </Button>
                                </div>
                            </div>
                        </div>

                    </div>
                </ScrollArea>

                <SheetFooter className="p-6 border-t border-gray-100 bg-white">
                    <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>Close</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
