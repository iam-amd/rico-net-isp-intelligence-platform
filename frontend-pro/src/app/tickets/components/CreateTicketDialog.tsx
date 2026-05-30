import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Search, MapPin } from "lucide-react";
import { CustomerLite, useTickets } from "../hooks/useTickets";
import { toast } from "sonner";

interface CreateTicketDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreate: (data: any) => Promise<boolean>;
    onUpdate?: (id: number, data: any) => Promise<boolean>;
    editingTicket?: any | null;
}

const ISSUE_CATEGORIES = {
    "Internet High": ["No Link (LOS)", "Red Light", "Intermittent", "Slow Speed"],
    "Hardware": ["Router Damaged", "Adapter Issue", "Cable Cut"],
    "Billing": ["Payment Failed", "Plan Change", "Refund Request"],
    "Other": ["General Inquiry", "Relocation"]
};
const QUICK_TAGS = ["Confirmed Reboot", "Cable Damage Visible", "Customer Irritated", "Previous Ticket Unresolved", "Router Reset"];

export function CreateTicketDialog({ open, onOpenChange, onCreate, onUpdate, editingTicket }: CreateTicketDialogProps) {
    const { searchCustomers } = useTickets();
    const [step, setStep] = useState<"search" | "form">("search");
    const [customerSearch, setCustomerSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [searchResults, setSearchResults] = useState<CustomerLite[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Debounce search input
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(customerSearch);
        }, 300);
        return () => clearTimeout(handler);
    }, [customerSearch]);

    // Perform search when debounced value changes
    useEffect(() => {
        let isMounted = true;
        const doSearch = async () => {
            if (step !== "search" || debouncedSearch.length < 2) {
                if (isMounted) setSearchResults([]);
                return;
            }
            const results = await searchCustomers(debouncedSearch);
            if (isMounted) setSearchResults(results);
        };
        doSearch();
        return () => { isMounted = false; };
    }, [debouncedSearch, searchCustomers, step]);

    const [ticketForm, setTicketForm] = useState({
        category: "Internet High",
        sub_issue: "No Link (LOS)",
        priority: "Normal" as "Critical" | "High" | "Normal" | "Low",
        description: "",
        tags: [] as string[]
    });

    useEffect(() => {
        if (!open) {
            // Reset state when closed
            setStep("search");
            setCustomerSearch("");
            setSearchResults([]);
            setSelectedCustomer(null);
            setTicketForm({ category: "Internet High", sub_issue: "No Link (LOS)", priority: "Normal", description: "", tags: [] });
        } else if (editingTicket) {
            // Pre-fill if editing
            setStep("form");
            setSelectedCustomer({
                username: editingTicket.customer_id,
                first_name: editingTicket.customer_id, // Placeholder
                phone: "",
                plan_name: "",
                status: "Active"
            });
            setTicketForm({
                category: editingTicket.issue_type || "Internet High",
                sub_issue: editingTicket.sub_issue || "No Link (LOS)",
                priority: editingTicket.priority,
                description: editingTicket.description,
                tags: editingTicket.tags ? editingTicket.tags.split(",") : []
            });
        }
    }, [open, editingTicket]);

    // handleSearch is now just updating state, effect handles the API call
    const handleSearch = (query: string) => {
        setCustomerSearch(query);
    };

    const handleSubmit = async () => {
        if (!selectedCustomer) return;
        setIsSaving(true);

        const payload = {
            customer_id: selectedCustomer.username,
            issue_type: ticketForm.category,
            sub_issue: ticketForm.sub_issue,
            priority: ticketForm.priority,
            description: ticketForm.description,
            tags: ticketForm.tags.join(",")
        };

        let success = false;
        if (editingTicket && onUpdate) {
            success = await onUpdate(editingTicket.id, payload);
        } else {
            success = await onCreate(payload);
        }

        if (success) {
            onOpenChange(false);
        }
        setIsSaving(false);
    };

    const toggleTag = (tag: string) => {
        setTicketForm(prev => prev.tags.includes(tag) ? { ...prev, tags: prev.tags.filter(t => t !== tag) } : { ...prev, tags: [...prev.tags, tag] });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md rounded-2xl p-0 overflow-hidden bg-gray-50">
                <DialogHeader className="px-6 pt-6 pb-2 bg-white border-b border-gray-100">
                    <DialogTitle className="text-lg font-bold">{step === "search" ? "Lookup Customer" : (editingTicket ? "Edit Ticket" : "New Complaint")}</DialogTitle>
                </DialogHeader>

                {step === "search" ? (
                    <div className="bg-white pb-4 min-h-[300px]">
                        <div className="px-6 py-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Search Name, Mobile, Username..."
                                    value={customerSearch}
                                    onChange={(e) => handleSearch(e.target.value)}
                                    autoFocus
                                    className="h-12 pl-10 text-lg bg-gray-50 border-gray-200 rounded-xl"
                                />
                            </div>
                        </div>
                        <ScrollArea className="h-[300px]">
                            {searchResults.length === 0 && customerSearch.length > 2 && (
                                <div className="px-6 py-4 text-center text-gray-400">No customers found.</div>
                            )}
                            {searchResults.map((cust) => (
                                <div key={cust.username} className="px-6 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 group" onClick={() => { setSelectedCustomer(cust); setStep("form"); }}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <div className="font-bold text-gray-900 group-hover:text-blue-700">{cust.first_name}</div>
                                            <div className="text-xs text-gray-500 font-mono">@{cust.username} • {cust.phone}</div>
                                        </div>
                                        <Badge variant={cust.status === 'Active' ? 'default' : 'destructive'} className="text-[10px] h-5">
                                            {cust.status}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </ScrollArea>
                    </div>
                ) : (
                    <div className="p-6 bg-white min-h-[400px] overflow-y-auto max-h-[80vh]">
                        {/* CUSTOMER INFO */}
                        <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 mb-6 flex justify-between items-start">
                            <div>
                                <h3 className="font-bold text-gray-900 text-lg">@{selectedCustomer?.username}</h3>
                                <p className="text-sm text-gray-600">{selectedCustomer?.first_name}</p>
                                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><MapPin className="h-3 w-3" /> {selectedCustomer?.address}</p>
                            </div>
                            {!editingTicket && <Button variant="ghost" size="sm" className="text-xs text-blue-600 hover:text-blue-700 h-6" onClick={() => setStep("search")}>Change</Button>}
                        </div>

                        {/* FORM FIELDS */}
                        <div className="space-y-6">
                            {/* TYPE OF ISSUE */}
                            <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Type of Issue</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.keys(ISSUE_CATEGORIES).map(cat => (
                                        <div key={cat} onClick={() => setTicketForm(p => ({ ...p, category: cat, sub_issue: ISSUE_CATEGORIES[cat as keyof typeof ISSUE_CATEGORIES][0] }))}
                                            className={`p-3 rounded-lg border text-center text-xs font-bold cursor-pointer transition-all ${ticketForm.category === cat ? 'bg-gray-900 text-white border-gray-900 shadow-md' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                                            {cat}
                                        </div>
                                    ))}
                                </div>
                                {ticketForm.category && (
                                    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-dashed border-gray-100">
                                        {ISSUE_CATEGORIES[ticketForm.category as keyof typeof ISSUE_CATEGORIES].map(sub => (
                                            <Badge key={sub} variant="secondary"
                                                onClick={() => setTicketForm(p => ({ ...p, sub_issue: sub }))}
                                                className={`cursor-pointer px-3 py-1.5 ${ticketForm.sub_issue === sub ? 'bg-blue-100 text-blue-700 border-blue-200 border' : 'bg-gray-50 text-gray-600 hover:border-gray-100'}`}>
                                                {sub}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* URGENCY */}
                            <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Urgency</Label>
                                <div className="flex bg-gray-100 p-1 rounded-xl">
                                    {(["Low", "Normal", "High", "Critical"] as const).map(level => (
                                        <button key={level} onClick={() => setTicketForm(p => ({ ...p, priority: level }))}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${ticketForm.priority === level ? 'bg-white shadow text-black' : 'text-gray-500 hover:text-gray-700'}`}>
                                            {level}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* DETAILS */}
                            <div className="space-y-3">
                                <Label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Details</Label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {QUICK_TAGS.map(tag => (
                                        <Badge key={tag} variant="outline" onClick={() => toggleTag(tag)}
                                            className={`cursor-pointer transition-colors ${ticketForm.tags.includes(tag) ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                                <textarea
                                    className="w-full min-h-[80px] p-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    placeholder="Add specific details..."
                                    value={ticketForm.description}
                                    onChange={(e) => setTicketForm(p => ({ ...p, description: e.target.value }))}
                                />
                            </div>
                        </div>

                        <Button onClick={handleSubmit} disabled={isSaving} className="w-full h-14 bg-gray-900 text-white hover:bg-black rounded-xl text-base font-bold shadow-lg mt-6">
                            {isSaving ? "Saving..." : (editingTicket ? "Update Ticket" : "Confirm Ticket")}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
