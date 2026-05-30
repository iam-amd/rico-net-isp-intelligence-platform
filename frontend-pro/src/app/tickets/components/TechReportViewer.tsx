import React, { useState } from "react";
import { API_URL } from "@/config";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"; // Assuming standard shadcn dialog
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, ZoomIn, FileText, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TechReportViewerProps {
    notes?: string;
    media?: { id: number; file_path: string; file_type: string }[];
    materials?: string; // JSON string
    compact?: boolean; // For card view (smaller text/margins)
}

export function TechReportViewer({ notes, media, materials, compact = false }: TechReportViewerProps) {
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    // --- 1. PARSING LOGIC ---
    // We want to extract [Key: Value] or (Key: Value) or Just Key: Value lines
    const parseNotes = (text: string) => {
        if (!text) return { grid: [], narrative: "" };

        const gridDisplay: { key: string; value: string; type: 'info' | 'warning' | 'system' }[] = [];
        let narrativeText = text;

        // Regex for [Key: Value]
        const bracketRegex = /\[(.*?):(.*?)\]/g;
        let match;
        while ((match = bracketRegex.exec(text)) !== null) {
            const key = match[1].trim();
            const value = match[2].trim();
            gridDisplay.push({ key, value, type: key.toUpperCase() === 'SYSTEM' ? 'system' : 'info' });
            narrativeText = narrativeText.replace(match[0], ""); // Remove from narrative
        }

        // Regex for (Key: Value)
        const parenRegex = /\((.*?):(?:\s*)(.*?)\)/g;
        while ((match = parenRegex.exec(text)) !== null) {
            const key = match[1].trim();
            const value = match[2].trim();
            gridDisplay.push({ key, value, type: 'warning' }); // arbitrary type for visuals
            narrativeText = narrativeText.replace(match[0], "");
        }

        // Regex for [Key]: Value (System logs often look like this)
        const systemRegex = /\[(.*?)\]:\s*(.*)/g;
        // Reset narrative to original for this pass or handle carefully? 
        // Actually the previous replaces remove them.
        // Let's run this on the remaining narrativeText
        while ((match = systemRegex.exec(narrativeText)) !== null) {
            const key = match[1].trim();
            const value = match[2].trim();
            gridDisplay.push({ key, value, type: 'system' });
            narrativeText = narrativeText.replace(match[0], "");
        }

        return { grid: gridDisplay, narrative: narrativeText.trim() };
    };

    const { grid, narrative } = parseNotes(notes || "");

    // --- 2. LIGHTBOX LOGIC ---
    const openLightbox = (index: number) => {
        setCurrentImageIndex(index);
        setLightboxOpen(true);
    };

    const nextImage = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!media) return;
        setCurrentImageIndex((prev) => (prev + 1) % media.length);
    };

    const prevImage = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!media) return;
        setCurrentImageIndex((prev) => (prev - 1 + media.length) % media.length);
    };

    // Helper to get URL
    const getUrl = (path: string) => path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;

    return (
        <div className="space-y-4 font-sans">

            {/* A. PARSED GRID DATA (Full Width Stylized) */}
            {grid.length > 0 && (
                <div className="space-y-4">
                    {grid.map((item, idx) => (
                        <div key={idx} className={cn(
                            "rounded-xl border overflow-hidden",
                            item.type === 'system' ? "border-gray-200" :
                                item.type === 'warning' ? "border-yellow-200" : "border-blue-200"
                        )}>
                            {/* colored label strip */}
                            <div className={cn("px-4 py-2 border-b",
                                item.type === 'system' ? "bg-gray-100 border-gray-200" :
                                    item.type === 'warning' ? "bg-yellow-50/50 border-yellow-100" : "bg-blue-50/50 border-blue-100"
                            )}>
                                <span className={cn("text-[10px] font-bold uppercase tracking-widest",
                                    item.type === 'system' ? "text-gray-500" :
                                        item.type === 'warning' ? "text-yellow-700" : "text-blue-600"
                                )}>
                                    {item.key}
                                </span>
                            </div>

                            {/* content area */}
                            <div className={cn("p-4 bg-white",
                                item.type === 'system' ? "" :
                                    item.type === 'warning' ? "bg-yellow-50/10" : "bg-blue-50/10"
                            )}>
                                <span className="text-sm font-bold text-gray-900 block">{item.value || "—"}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* B. NARRATIVE TEXT (If any left) */}
            {narrative && (
                <div className="bg-gray-50/80 rounded-xl p-4 border border-gray-100 ml-1">
                    <p className="text-sm text-gray-700 leading-relaxed font-medium whitespace-pre-wrap">{narrative}</p>
                </div>
            )}

            {/* C. MATERIALS (Parsed from JSON) */}
            {materials && (
                <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                    <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <ZoomIn className="h-3 w-3" /> Materials
                    </h5>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(JSON.parse(materials)).map(([item, qty]) => (
                            <div key={item} className="flex items-center gap-2 bg-gray-50 px-2.5 py-1.5 rounded-md border border-gray-100">
                                <span className="text-xs font-semibold text-gray-700">{item}</span>
                                <Badge variant="secondary" className="h-5 px-1.5 bg-white border border-gray-200 text-gray-900 shadow-sm">{String(qty)}</Badge>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* D. PHOTO GALLERY */}
            {media && media.filter(m => !m.file_type.includes('audio')).length > 0 && (
                <div className="space-y-2">
                    <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                        <ImageIcon className="h-3 w-3" /> Evidence Photos ({media.filter(m => !m.file_type.includes('audio')).length})
                    </h5>
                    <div className="flex gap-3 overflow-x-auto pb-4 pt-1 px-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                        {media.filter(m => !m.file_type.includes('audio')).map((m, idx) => (
                            <div
                                key={m.id}
                                onClick={(e) => { e.stopPropagation(); openLightbox(idx); }}
                                className="relative group h-24 w-24 rounded-xl overflow-hidden border-2 border-white shadow-sm flex-shrink-0 cursor-pointer hover:shadow-md hover:scale-105 transition-all duration-300"
                            >
                                <img
                                    src={getUrl(m.file_path)}
                                    alt="Evidence"
                                    className="h-full w-full object-cover transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <ZoomIn className="text-white h-6 w-6 drop-shadow-md" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* E. VOICE NOTES */}
            {media && media.filter(m => m.file_type.includes('audio')).length > 0 && (
                <div className="space-y-2">
                    <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <FileText className="h-3 w-3" /> Voice Assessment ({media.filter(m => m.file_type.includes('audio')).length})
                    </h5>
                    <div className="grid grid-cols-1 gap-2">
                        {media.filter(m => m.file_type.includes('audio')).map((m) => (
                            <div key={m.id} className="bg-gray-50 rounded-lg p-2 border border-gray-100 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                                <audio controls className="w-full h-8 outline-none">
                                    <source src={getUrl(m.file_path)} type={m.file_type} />
                                    Your browser does not support the audio element.
                                </audio>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* E. LIGHTBOX MODAL */}
            <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
                <DialogContent showCloseButton={false} className="max-w-[90vw] h-[90vh] p-0 bg-black/95 border-none flex flex-col items-center justify-center outline-none !close-button-white text-white">
                    <DialogTitle className="sr-only">Evidence Photo</DialogTitle>
                    <DialogDescription className="sr-only">Full screen view of the selected evidence photo</DialogDescription>

                    {/* Close Button (Override or custom) */}
                    <Button variant="ghost" className="absolute top-4 right-4 text-white hover:bg-white/20 z-50 rounded-full h-10 w-10 p-0" onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}>
                        <X className="h-6 w-6" />
                    </Button>

                    {/* Navigation */}
                    {media && media.length > 1 && (
                        <>
                            <Button variant="ghost" className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 rounded-full h-12 w-12 p-0 z-50" onClick={prevImage}>
                                <ChevronLeft className="h-8 w-8" />
                            </Button>
                            <Button variant="ghost" className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 rounded-full h-12 w-12 p-0 z-50" onClick={nextImage}>
                                <ChevronRight className="h-8 w-8" />
                            </Button>
                        </>
                    )}

                    {/* Main Image */}
                    {media && media[currentImageIndex] && (
                        <div className="w-full h-full flex items-center justify-center p-8 relative">
                            <img
                                src={getUrl(media[currentImageIndex].file_path)}
                                alt="Full View"
                                className="max-h-full max-w-full object-contain animate-in zoom-in-50 duration-300 rounded-md shadow-2xl"
                            />
                            <div className="absolute bottom-6 left-0 right-0 text-center">
                                <span className="bg-black/50 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm">
                                    {currentImageIndex + 1} / {media.length}
                                </span>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
