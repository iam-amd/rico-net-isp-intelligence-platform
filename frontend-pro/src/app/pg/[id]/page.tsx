"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { API_URL } from "@/config";
import { getAuthHeaders } from "@/lib/auth-utils";
import { MainSidebar } from "@/components/layout/MainSidebar";
import {
    ArrowLeft, Building2, MapPin, User, Phone, Wifi, WifiOff,
    ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock,
    Cpu, RefreshCw, Hash, ExternalLink, AlertTriangle,
    Activity, Zap, Thermometer, Radio, X, Shield,
    Pencil, Trash2, Save, ChevronRight, Camera, Image as ImageIcon,
    ZoomIn, ZoomOut, ChevronLeft, ScanLine, Link2, Link2Off, History, Undo2,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
type RoomStatus = "pending" | "done" | "vacant" | "flagged" | "shared";
const ROOM_STATUSES: RoomStatus[] = ["pending", "done", "vacant", "flagged", "shared"];

interface ONUInfo {
    status: string; rx_power_dbm: number | null; tx_power_dbm: number | null;
    temperature_c: number | null; dying_gasp: boolean;
    signal_label: "excellent" | "good" | "weak" | "critical" | "unknown";
    polled_at: string; stale: boolean;
}

interface CustomerInfo {
    username: string; first_name: string | null; last_name: string | null;
    phone: string | null; plan_name: string | null; expiry_date: string | null;
    status: string | null; balance: number | null; mac_address: string | null;
    olt_host: string | null; pon_port: string | null;
    geo_lat: number | null; geo_lng: number | null;
    rico_address: string | null; railwire_address: string | null;
    has_survey: boolean;
}

interface RoomONUMatch {
    status: string; rx_power_dbm: number | null;
    signal_label: "excellent" | "good" | "weak" | "critical" | "unknown";
    polled_at: string;
    match_type: "mac" | "serial";
    matched_value: string;
}

interface ScanRecord {
    ts: string; mac?: string; serial?: string; model?: string;
    wifiSsid?: string; wifiSsid5g?: string; device?: string; source: string;
}

interface Room {
    id: string; room_number: string; status: RoomStatus;
    connection_type: string; device_setup?: "single_ont" | "onu_router"; username?: string;
    ont_serial?: string; mac_address?: string; ont_model?: string;
    ont_sticker_photo_url?: string; ont_sticker_data?: Record<string, unknown>; router_sticker_photo_url?: string;
    router_mac_address?: string; router_serial?: string; router_model?: string;
    router_sticker_data?: Record<string, unknown>;
    wifi_ssid?: string; wifi_ssid_5g?: string; wifi_password?: string;
    scan_history?: ScanRecord[];
    tech_note?: string; photo_urls?: string[]; collected_at?: string;
    router_group_id?: string;
    customer?: CustomerInfo | null;
    onu?: ONUInfo | null;
    room_onu?: RoomONUMatch | null;
    conflict?: string | null;
}

interface RouterGroup {
    id: string; group_name: string; ont_serial?: string;
    mac_address?: string; username?: string;
}

interface Floor {
    id: string; floor_number: number;
    rooms: Room[]; router_groups: RouterGroup[];
}

interface BuildingDashboard {
    id: string; name: string; pg_type: string;
    address?: string; owner_name?: string; owner_mobile?: string;
    owner_alt_mobile?: string; gps_lat?: number; gps_lng?: number;
    photo_url?: string; created_by?: string; created_at: string;
    total_floors: number; total_rooms: number; done_rooms: number; pending_rooms: number;
    online_count: number; offline_count: number; unlinked_count: number;
    floors: Floor[];
}

interface RoomConflict {
    conflict_type: string;
    message: string;
    room_id?: string;
    building_name?: string;
    floor_number?: number;
    room_number?: string;
}

interface PGChangeEvent {
    id: number;
    action: string;
    reason?: string | null;
    changed_by?: string | null;
    before_data?: Record<string, any> | null;
    after_data?: Record<string, any> | null;
    created_at: string;
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<RoomStatus, { label: string; bg: string; text: string; dot: string; border: string }> = {
    done:    { label: "Done",    bg: "bg-green-900/30",  text: "text-green-400",  dot: "bg-green-400",  border: "border-green-700/40" },
    shared:  { label: "Shared",  bg: "bg-blue-900/30",   text: "text-blue-400",   dot: "bg-blue-400",   border: "border-blue-700/40" },
    pending: { label: "Pending", bg: "bg-amber-900/20",  text: "text-amber-400",  dot: "bg-amber-400",  border: "border-amber-700/30" },
    vacant:  { label: "Vacant",  bg: "bg-slate-800/30",  text: "text-slate-400",  dot: "bg-slate-400",  border: "border-slate-700/30" },
    flagged: { label: "Flagged", bg: "bg-red-900/30",    text: "text-red-400",    dot: "bg-red-400",    border: "border-red-700/40" },
};

const SIGNAL_CONFIG: Record<string, { color: string; bg: string }> = {
    excellent: { color: "text-green-400",  bg: "bg-green-900/30" },
    good:      { color: "text-blue-400",   bg: "bg-blue-900/30" },
    weak:      { color: "text-amber-400",  bg: "bg-amber-900/30" },
    critical:  { color: "text-red-400",    bg: "bg-red-900/30" },
    unknown:   { color: "text-slate-400",  bg: "bg-slate-800/30" },
};

const resolveUploadUrl = (url?: string | null) =>
    url ? (url.startsWith("/") ? `${API_URL}${url}` : url) : "";

// ── Inline photo lightbox ──────────────────────────────────────────────────────
function LightboxModal({ photos, startIndex, onClose }: {
    photos: string[]; startIndex: number; onClose: () => void;
}) {
    const [idx, setIdx] = useState(startIndex);
    const [zoom, setZoom] = useState(1);

    const prev = () => { setIdx(i => (i - 1 + photos.length) % photos.length); setZoom(1); };
    const next = () => { setIdx(i => (i + 1) % photos.length); setZoom(1); };

    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowLeft") prev();
            if (e.key === "ArrowRight") next();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={onClose} />

            {/* Controls bar */}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                <span className="text-slate-400 text-xs font-bold">
                    {idx + 1} / {photos.length}
                </span>
                <button onClick={() => setZoom(z => Math.min(z + 0.5, 4))}
                    className="text-white bg-white/10 hover:bg-white/20 p-1.5 rounded" title="Zoom in">
                    <ZoomIn size={16} />
                </button>
                <button onClick={() => setZoom(z => Math.max(z - 0.5, 1))}
                    className="text-white bg-white/10 hover:bg-white/20 p-1.5 rounded" title="Zoom out">
                    <ZoomOut size={16} />
                </button>
                <button onClick={onClose}
                    className="text-white bg-white/10 hover:bg-white/20 p-1.5 rounded" title="Close (Esc)">
                    <X size={16} />
                </button>
            </div>

            {/* Prev / Next */}
            {photos.length > 1 && (
                <>
                    <button onClick={prev}
                        className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white bg-white/10 hover:bg-white/25 p-2 rounded-full">
                        <ChevronLeft size={24} />
                    </button>
                    <button onClick={next}
                        className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white bg-white/10 hover:bg-white/25 p-2 rounded-full">
                        <ChevronRight size={24} />
                    </button>
                </>
            )}

            {/* Image */}
            <div className="relative z-10 max-w-[90vw] max-h-[90vh] overflow-auto"
                style={{ cursor: zoom > 1 ? "grab" : "default" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={photos[idx]}
                    alt={`Photo ${idx + 1}`}
                    style={{ transform: `scale(${zoom})`, transformOrigin: "top left",
                             maxWidth: zoom === 1 ? "90vw" : undefined,
                             maxHeight: zoom === 1 ? "90vh" : undefined,
                             objectFit: "contain", display: "block" }}
                    draggable={false}
                />
            </div>

            {/* Thumbnail strip */}
            {photos.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                    {photos.map((url, i) => (
                        <button key={i} onClick={() => { setIdx(i); setZoom(1); }}
                            className={`w-12 h-10 overflow-hidden border-2 transition-colors ${i === idx ? "border-orange-400" : "border-white/20 hover:border-white/50"}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Room detail panel (slide-out) ─────────────────────────────────────────────
function RoomDetailPanel({ room, onClose, onDeleteRoom, onChanged }: {
    room: Room; onClose: () => void;
    onDeleteRoom?: (roomId: string, roomNumber: string) => void;
    onChanged?: () => void | Promise<unknown>;
}) {
    const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

    const [showWifiPwd, setShowWifiPwd] = useState(false);
    const [showScanHistory, setShowScanHistory] = useState(false);
    const [editing, setEditing] = useState(false);
    const [statusDraft, setStatusDraft] = useState<RoomStatus>(room.status);
    const [deviceSetupDraft, setDeviceSetupDraft] = useState<"single_ont" | "onu_router">(room.device_setup ?? (room.router_mac_address || room.router_serial || room.router_model ? "onu_router" : "single_ont"));
    const [usernameDraft, setUsernameDraft] = useState(room.username ?? "");
    const [serialDraft, setSerialDraft] = useState(room.ont_serial ?? "");
    const [macDraft, setMacDraft] = useState(room.mac_address ?? "");
    const [modelDraft, setModelDraft] = useState(room.ont_model ?? "");
    const [routerMacDraft, setRouterMacDraft] = useState(room.router_mac_address ?? "");
    const [routerSerialDraft, setRouterSerialDraft] = useState(room.router_serial ?? "");
    const [routerModelDraft, setRouterModelDraft] = useState(room.router_model ?? "");
    const [ontStickerDraft, setOntStickerDraft] = useState(room.ont_sticker_photo_url ?? "");
    const [ontStickerDataDraft, setOntStickerDataDraft] = useState<Record<string, unknown> | undefined>(room.ont_sticker_data);
    const [routerStickerDraft, setRouterStickerDraft] = useState(room.router_sticker_photo_url ?? "");
    const [routerStickerDataDraft, setRouterStickerDataDraft] = useState<Record<string, unknown> | undefined>(room.router_sticker_data);
    const [noteDraft, setNoteDraft] = useState(room.tech_note ?? "");
    const [reasonDraft, setReasonDraft] = useState("");
    const [savingRoom, setSavingRoom] = useState(false);
    const [conflicts, setConflicts] = useState<RoomConflict[]>([]);
    const [historyItems, setHistoryItems] = useState<PGChangeEvent[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [ocrPhotoIndex, setOcrPhotoIndex] = useState<number | null>(null);

    const cfg = STATUS_CONFIG[room.status] ?? STATUS_CONFIG.pending;
    const c = room.customer;
    const onu = room.onu;
    const roomOnu = room.room_onu;

    const rawPhotos = room.photo_urls ?? [];
    const resolvedPhotos = rawPhotos.map(resolveUploadUrl);

    const expiryDate = c?.expiry_date ? new Date(c.expiry_date) : null;
    const daysLeft = expiryDate ? Math.ceil((expiryDate.getTime() - Date.now()) / 86400000) : null;
    const expiryColor = daysLeft == null ? "text-slate-400" : daysLeft <= 0 ? "text-red-400" : daysLeft <= 7 ? "text-amber-400" : "text-green-400";

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await fetch(`${API_URL}/pg/rooms/${room.id}/history`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            setHistoryItems(await res.json());
        } catch (e: any) {
            toast.error("Could not load room history: " + (e.message ?? "error"));
        } finally {
            setHistoryLoading(false);
        }
    }, [room.id]);

    useEffect(() => {
        setEditing(false);
        setStatusDraft(room.status);
        setDeviceSetupDraft(room.device_setup ?? (room.router_mac_address || room.router_serial || room.router_model ? "onu_router" : "single_ont"));
        setUsernameDraft(room.username ?? "");
        setSerialDraft(room.ont_serial ?? "");
        setMacDraft(room.mac_address ?? "");
        setModelDraft(room.ont_model ?? "");
        setRouterMacDraft(room.router_mac_address ?? "");
        setRouterSerialDraft(room.router_serial ?? "");
        setRouterModelDraft(room.router_model ?? "");
        setOntStickerDraft(room.ont_sticker_photo_url ?? "");
        setOntStickerDataDraft(room.ont_sticker_data);
        setRouterStickerDraft(room.router_sticker_photo_url ?? "");
        setRouterStickerDataDraft(room.router_sticker_data);
        setNoteDraft(room.tech_note ?? "");
        setReasonDraft("");
        setConflicts([]);
        loadHistory();
    }, [
        room.id,
        room.status,
        room.device_setup,
        room.username,
        room.ont_serial,
        room.mac_address,
        room.ont_model,
        room.router_mac_address,
        room.router_serial,
        room.router_model,
        room.ont_sticker_photo_url,
        room.ont_sticker_data,
        room.router_sticker_photo_url,
        room.router_sticker_data,
        room.tech_note,
        loadHistory,
    ]);

    const buildRoomUpdateBody = (reason: string) => {
        const username = usernameDraft.trim();
        const serial = serialDraft.trim();
        const mac = macDraft.trim();
        const connectionType =
            room.connection_type === "router_group" || room.connection_type === "linked_room"
                ? room.connection_type
                : username
                  ? "individual"
                  : "none";

        return {
            room_number: room.room_number,
            status: statusDraft,
            connection_type: connectionType,
            device_setup: deviceSetupDraft,
            username: username || null,
            ont_serial: serial || null,
            mac_address: mac || null,
            ont_model: modelDraft.trim() || null,
            ont_sticker_photo_url: ontStickerDraft.trim() || null,
            ont_sticker_data: ontStickerDataDraft ?? room.ont_sticker_data ?? null,
            router_sticker_photo_url: routerStickerDraft.trim() || null,
            router_mac_address: routerMacDraft.trim() || null,
            router_serial: routerSerialDraft.trim() || null,
            router_model: routerModelDraft.trim() || null,
            router_sticker_data: routerStickerDataDraft ?? room.router_sticker_data ?? null,
            wifi_ssid: room.wifi_ssid ?? null,
            wifi_ssid_5g: room.wifi_ssid_5g ?? null,
            wifi_password: room.wifi_password ?? null,
            scan_history: room.scan_history ?? null,
            tech_note: noteDraft.trim() || null,
            photo_urls: room.photo_urls ?? null,
            collected_at: statusDraft === "done" || statusDraft === "shared"
                ? (room.collected_at ?? new Date().toISOString())
                : room.collected_at ?? null,
            router_group_id: room.router_group_id ?? null,
            change_reason: reason,
        };
    };

    const checkRoomConflicts = async (): Promise<RoomConflict[]> => {
        const params = new URLSearchParams();
        if (usernameDraft.trim()) params.set("username", usernameDraft.trim());
        if (macDraft.trim()) params.set("mac_address", macDraft.trim());
        if (serialDraft.trim()) params.set("ont_serial", serialDraft.trim());
        const res = await fetch(`${API_URL}/pg/rooms/${room.id}/conflicts?${params.toString()}`, {
            headers: getAuthHeaders(),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
        const data = await res.json();
        const found: RoomConflict[] = data.conflicts ?? [];
        setConflicts(found);
        return found;
    };

    const saveRoomUpdate = async () => {
        const reason = reasonDraft.trim();
        if (reason.length < 3) {
            toast.error("Enter why this PG room is being changed");
            return;
        }
        setSavingRoom(true);
        try {
            const foundConflicts = await checkRoomConflicts();
            if (foundConflicts.length > 0) {
                const text = foundConflicts.map(cn => cn.message).join("\n");
                const roomLinkConflicts = foundConflicts.filter(cn => cn.conflict_type?.startsWith("room_"));
                const proceed = confirm(
                    roomLinkConflicts.length > 0
                        ? `${text}\n\nMove this link here and unlink the old room(s)?`
                        : `${text}\n\nSave anyway after manual verification?`,
                );
                if (!proceed) return;
                if (roomLinkConflicts.length > 0) {
                    const moveRes = await fetch(`${API_URL}/pg/rooms/${room.id}/resolve-conflicts`, {
                        method: "POST",
                        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                        body: JSON.stringify({
                            username: usernameDraft.trim() || null,
                            mac_address: macDraft.trim() || null,
                            ont_serial: serialDraft.trim() || null,
                            reason,
                        }),
                    });
                    if (!moveRes.ok) throw new Error((await moveRes.json().catch(() => ({}))).detail ?? `HTTP ${moveRes.status}`);
                }
            }

            const res = await fetch(`${API_URL}/pg/rooms/${room.id}`, {
                method: "PUT",
                headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify(buildRoomUpdateBody(reason)),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success("Room updated");
            setEditing(false);
            setReasonDraft("");
            await onChanged?.();
            await loadHistory();
        } catch (e: any) {
            toast.error("Room update failed: " + (e.message ?? "error"));
        } finally {
            setSavingRoom(false);
        }
    };

    const runOcrOnExistingPhoto = async (photoUrl: string, index: number, stickerType: "ont" | "router" = "ont") => {
        setOcrPhotoIndex(index);
        try {
            const res = await fetch(`${API_URL}/pg/rooms/${room.id}/ocr-existing-photo`, {
                method: "POST",
                headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({ photo_url: photoUrl, sticker_type: stickerType }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            const data = await res.json();
            if (stickerType === "router") {
                if (data.mac_address) setRouterMacDraft(data.mac_address);
                if (data.ont_serial_number || data.gpon_sn) setRouterSerialDraft(data.ont_serial_number || data.gpon_sn);
                if (data.ont_model) setRouterModelDraft(data.ont_model);
                setRouterStickerDraft(data.photo_url || photoUrl);
                setRouterStickerDataDraft(data);
                setDeviceSetupDraft("onu_router");
            } else {
                if (data.gpon_sn || data.ont_serial_number) setSerialDraft(data.gpon_sn || data.ont_serial_number);
                if (data.mac_address) setMacDraft(data.mac_address);
                if (data.ont_model) setModelDraft(data.ont_model);
                setOntStickerDraft(data.photo_url || photoUrl);
                setOntStickerDataDraft(data);
            }
            setEditing(true);
            setReasonDraft(prev => prev || `Admin OCR ${stickerType} correction from room photo ${index + 1}`);
            const found = [(data.gpon_sn || data.ont_serial_number) && `SN ${data.gpon_sn || data.ont_serial_number}`, data.mac_address && `MAC ${data.mac_address}`, data.ont_model && `Model ${data.ont_model}`].filter(Boolean);
            toast.success(found.length ? `OCR found: ${found.join(", ")}` : "OCR completed, no clear fields found");
        } catch (e: any) {
            toast.error("OCR failed: " + (e.message ?? "error"));
        } finally {
            setOcrPhotoIndex(null);
        }
    };

    const revertToHistory = async (event: PGChangeEvent) => {
        const reason = prompt("Reason for reverting this room?");
        if (!reason || reason.trim().length < 3) return;
        try {
            const res = await fetch(
                `${API_URL}/pg/rooms/${room.id}/history/${event.id}/revert?reason=${encodeURIComponent(reason.trim())}`,
                { method: "POST", headers: getAuthHeaders() },
            );
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success("Room reverted");
            await onChanged?.();
            await loadHistory();
        } catch (e: any) {
            toast.error("Revert failed: " + (e.message ?? "error"));
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div className="flex-1 bg-black/60" onClick={onClose} />
            {/* Panel */}
            <div className="w-full max-w-md bg-[#0f1523] border-l-2 border-[#1e293b] overflow-y-auto flex flex-col"
                style={{ boxShadow: "-4px 0 0 #0f172a" }}>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b-2 border-[#1e293b] bg-[#0a0f1a]">
                    <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                        <div>
                            <p className="text-orange-400 font-black tracking-widest text-sm uppercase">
                                ROOM {room.room_number}
                            </p>
                            <p className={`text-xs font-bold ${cfg.text}`}>{cfg.label}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setEditing(v => !v)}
                            className="text-orange-400/70 hover:text-orange-300 transition-colors"
                            title="Edit room mapping">
                            <Pencil size={16} />
                        </button>
                        {onDeleteRoom && (
                            <button
                                onClick={() => onDeleteRoom(room.id, room.room_number)}
                                className="text-red-500/50 hover:text-red-400 transition-colors"
                                title="Delete room">
                                <Trash2 size={16} />
                            </button>
                        )}
                        <button onClick={onClose} className="text-slate-500 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-5 flex flex-col gap-5 flex-1">
                    {/* Conflict warning */}
                    {room.conflict && (
                        <div className="flex items-start gap-3 bg-amber-900/30 border-2 border-amber-700/50 p-3">
                            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-amber-300 font-bold text-xs">USERNAME CONFLICT</p>
                                <p className="text-amber-400/80 text-xs mt-0.5">
                                    This customer is also linked in <span className="font-bold text-amber-300">{room.conflict}</span>.
                                    Consider removing the link from the other building or the mobile app.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Admin correction form */}
                    {editing && (
                        <section className="bg-[#16203d] border-2 border-orange-500/30 p-4">
                            <div className="flex items-center justify-between mb-4">
                                <SectionLabel icon={Pencil} label="ADMIN CORRECTION" />
                                <button
                                    onClick={() => {
                                        setEditing(false);
                                        setConflicts([]);
                                    }}
                                    className="text-slate-500 hover:text-white text-xs font-bold uppercase"
                                    disabled={savingRoom}
                                >
                                    Cancel
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                    <label className="text-slate-500 text-[10px] font-black tracking-widest uppercase block mb-2">STATUS</label>
                                    <select
                                        value={statusDraft}
                                        onChange={e => setStatusDraft(e.target.value as RoomStatus)}
                                        className="w-full bg-[#0d1627] border-2 border-[#1e293b] text-white text-sm font-semibold px-3 py-2.5 outline-none focus:border-orange-500/60"
                                    >
                                        {ROOM_STATUSES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                                    </select>
                                </div>
                                <Field label="USERNAME" value={usernameDraft} onChange={setUsernameDraft} placeholder="Customer username" />
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <Field label="GPON SERIAL" value={serialDraft} onChange={v => setSerialDraft(v.toUpperCase())} placeholder="NLNK12345678" />
                                <Field label="EPON MAC" value={macDraft} onChange={v => setMacDraft(v.toUpperCase())} placeholder="8CC7C330AC57" />
                            </div>
                            <Field label="ONT MODEL" value={modelDraft} onChange={setModelDraft} placeholder="Netlink / VSOL model" />
                            <div className="grid grid-cols-2 gap-3 mt-3">
                                <Field label="ROUTER MAC" value={routerMacDraft} onChange={v => setRouterMacDraft(v.toUpperCase())} placeholder="C0-06-C3-95-40-A8" />
                                <Field label="ROUTER SERIAL" value={routerSerialDraft} onChange={v => setRouterSerialDraft(v.toUpperCase())} placeholder="TP-Link serial" />
                            </div>
                            <div className="mt-3">
                                <Field label="ROUTER MODEL" value={routerModelDraft} onChange={setRouterModelDraft} placeholder="Archer C24" />
                            </div>
                            <div className="mt-3">
                                <Field label="TECH NOTE" value={noteDraft} onChange={setNoteDraft} multiline placeholder="Manual review notes" />
                            </div>
                            <div className="mt-3">
                                <Field label="CHANGE REASON *" value={reasonDraft} onChange={setReasonDraft} multiline placeholder="Example: sticker image manually reviewed by admin; customer shifted from 101 to 102" />
                            </div>
                            {conflicts.length > 0 && (
                                <div className="mt-3 bg-amber-900/20 border border-amber-700/50 p-3">
                                    <p className="text-amber-300 text-[10px] font-black tracking-widest uppercase mb-2">Conflict found before save</p>
                                    {conflicts.map((cn, i) => (
                                        <p key={i} className="text-amber-200/80 text-xs">{cn.message}</p>
                                    ))}
                                </div>
                            )}
                            <button
                                onClick={saveRoomUpdate}
                                disabled={savingRoom}
                                className="mt-4 w-full bg-orange-500 text-black py-3 text-xs font-black tracking-widest uppercase flex items-center justify-center gap-2 disabled:opacity-60"
                                style={{ boxShadow: "3px 3px 0 #0f172a" }}
                            >
                                <Save size={13} /> {savingRoom ? "SAVING..." : "SAVE ROOM UPDATE"}
                            </button>
                        </section>
                    )}

                    {/* ONU live status */}
                    {onu ? (
                        <section>
                            <SectionLabel icon={Radio} label="ONU LIVE STATUS" />
                            <div className="bg-[#16203d] border-2 border-[#1e293b] p-4 mt-2">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        {onu.status === "Online"
                                            ? <Wifi size={16} className="text-green-400" />
                                            : <WifiOff size={16} className="text-red-400" />
                                        }
                                        <span className={`font-black text-sm ${onu.status === "Online" ? "text-green-400" : "text-red-400"}`}>
                                            {onu.status.toUpperCase()}
                                        </span>
                                        {onu.dying_gasp && (
                                            <span className="bg-red-900/50 border border-red-700 text-red-300 text-[10px] font-bold px-2 py-0.5">
                                                DYING GASP
                                            </span>
                                        )}
                                        {onu.stale && (
                                            <span className="text-slate-500 text-[10px] font-bold">STALE</span>
                                        )}
                                    </div>
                                    <span className="text-slate-600 text-[10px]">
                                        {new Date(onu.polled_at).toLocaleTimeString()}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {onu.rx_power_dbm != null && (
                                        <StatChip
                                            icon={Activity} label="Rx Power"
                                            value={`${onu.rx_power_dbm.toFixed(1)} dBm`}
                                            colorClass={SIGNAL_CONFIG[onu.signal_label].color}
                                        />
                                    )}
                                    {onu.tx_power_dbm != null && (
                                        <StatChip icon={Zap} label="Tx Power" value={`${onu.tx_power_dbm.toFixed(1)} dBm`} colorClass="text-slate-300" />
                                    )}
                                    {onu.temperature_c != null && (
                                        <StatChip
                                            icon={Thermometer} label="Temp"
                                            value={`${onu.temperature_c.toFixed(0)}°C`}
                                            colorClass={onu.temperature_c > 60 ? "text-red-400" : "text-slate-300"}
                                        />
                                    )}
                                </div>
                            </div>
                        </section>
                    ) : room.username ? (
                        <div className="flex items-center gap-2 text-slate-600 text-xs font-semibold">
                            <WifiOff size={14} />
                            <span>No ONU data — MAC address not linked for this customer</span>
                        </div>
                    ) : null}

                    {/* Customer profile */}
                    {c ? (
                        <section>
                            <SectionLabel icon={User} label="CUSTOMER PROFILE" />
                            <div className="bg-[#16203d] border-2 border-[#1e293b] p-4 mt-2 flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-white font-bold text-base">
                                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.username}
                                        </p>
                                        <p className="text-slate-500 text-xs font-mono">{c.username}</p>
                                    </div>
                                    <Link href={`/customers/show/${c.username}`} target="_blank"
                                        className="flex items-center gap-1 text-orange-400 text-xs font-bold hover:text-orange-300">
                                        FULL PROFILE <ExternalLink size={12} />
                                    </Link>
                                </div>

                                {c.phone && (
                                    <div className="flex items-center gap-2">
                                        <Phone size={12} className="text-slate-500" />
                                        <span className="text-slate-300 text-sm">{c.phone}</span>
                                    </div>
                                )}

                                {/* Plan & billing */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-[#0f172a] border border-[#1e293b] p-2.5">
                                        <p className="text-slate-500 text-[9px] font-bold tracking-widest uppercase mb-1">PLAN</p>
                                        <p className="text-white text-xs font-semibold">{c.plan_name ?? "—"}</p>
                                    </div>
                                    <div className="bg-[#0f172a] border border-[#1e293b] p-2.5">
                                        <p className="text-slate-500 text-[9px] font-bold tracking-widest uppercase mb-1">STATUS</p>
                                        <p className={`text-xs font-bold uppercase ${c.status === "Active" ? "text-green-400" : "text-red-400"}`}>
                                            {c.status ?? "—"}
                                        </p>
                                    </div>
                                    <div className="bg-[#0f172a] border border-[#1e293b] p-2.5">
                                        <p className="text-slate-500 text-[9px] font-bold tracking-widest uppercase mb-1">EXPIRY</p>
                                        <p className={`text-xs font-bold ${expiryColor}`}>
                                            {expiryDate ? expiryDate.toLocaleDateString() : "—"}
                                            {daysLeft != null && ` (${daysLeft}d)`}
                                        </p>
                                    </div>
                                    <div className="bg-[#0f172a] border border-[#1e293b] p-2.5">
                                        <p className="text-slate-500 text-[9px] font-bold tracking-widest uppercase mb-1">BALANCE</p>
                                        <p className="text-white text-xs font-semibold">₹{c.balance ?? 0}</p>
                                    </div>
                                </div>

                                {/* Address */}
                                {(c.rico_address || c.railwire_address) && (
                                    <div className="flex items-start gap-2">
                                        <MapPin size={12} className="text-slate-500 flex-shrink-0 mt-0.5" />
                                        <p className="text-slate-400 text-xs leading-snug">
                                            {c.rico_address || c.railwire_address}
                                        </p>
                                    </div>
                                )}

                                {/* Survey indicator */}
                                <div className="flex items-center gap-2">
                                    {c.has_survey
                                        ? <><CheckCircle2 size={12} className="text-green-400" /><span className="text-green-400 text-xs font-semibold">GPS survey done</span></>
                                        : <><AlertCircle size={12} className="text-slate-600" /><span className="text-slate-600 text-xs">No GPS survey</span></>
                                    }
                                </div>

                                {/* MAC */}
                                {c.mac_address && (
                                    <div className="flex items-center gap-2">
                                        <Cpu size={12} className="text-slate-500" />
                                        <span className="text-slate-400 text-xs font-mono">{c.mac_address}</span>
                                        {c.olt_host && <span className="text-slate-600 text-[10px]">@ {c.olt_host}</span>}
                                    </div>
                                )}
                            </div>
                        </section>
                    ) : room.username ? (
                        <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/30 px-3 py-2.5">
                            <AlertCircle size={14} className="text-amber-400" />
                            <div>
                                <p className="text-amber-300 font-bold text-xs">CUSTOMER NOT FOUND</p>
                                <p className="text-amber-400/70 text-xs">Username <span className="font-mono font-bold">{room.username}</span> not in database</p>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6 text-slate-700">
                            <User size={36} strokeWidth={1} className="mx-auto mb-3" />
                            <p className="text-xs font-bold tracking-widest uppercase">No customer linked</p>
                            <p className="text-[10px] mt-1">Assign username from the mobile app</p>
                        </div>
                    )}

                    {/* Sticker data + OLT match */}
                    {(room.ont_serial || room.mac_address || room.ont_model || room.router_mac_address || room.router_serial || room.router_model || room.wifi_ssid || room.wifi_password) && (
                        <section>
                            <SectionLabel icon={ScanLine} label="STICKER DATA" />
                            <div className="bg-[#16203d] border-2 border-[#1e293b] mt-2 overflow-hidden">

                                {/* OLT match banner — uses room's own device data (not customer link) */}
                                <div className={`flex items-center gap-2 px-4 py-2 border-b border-[#1e293b] ${
                                    roomOnu ? "bg-green-900/30" : (room.mac_address || room.ont_serial) ? "bg-amber-900/20" : "bg-slate-900/30"
                                }`}>
                                    {roomOnu ? (
                                        <>
                                            <Link2 size={12} className="text-green-400" />
                                            <span className="text-green-400 text-[10px] font-black tracking-wider">
                                                OLT MATCHED — {roomOnu.match_type === "serial" ? "GPON SERIAL" : "EPON MAC"} found in OLT database
                                            </span>
                                            <span className={`ml-auto text-[10px] font-bold ${SIGNAL_CONFIG[roomOnu.signal_label].color}`}>
                                                {roomOnu.status} {roomOnu.rx_power_dbm != null ? `· ${roomOnu.rx_power_dbm.toFixed(1)} dBm` : ""}
                                            </span>
                                        </>
                                    ) : (room.mac_address || room.ont_serial) ? (
                                        <>
                                            <Link2Off size={12} className="text-amber-400" />
                                            <span className="text-amber-400 text-[10px] font-bold tracking-wider">
                                                Device recorded — not yet matched in OLT data
                                            </span>
                                        </>
                                    ) : null}
                                </div>

                                <div className="p-4 flex flex-col gap-2">
                                    {[
                                        { label: "SERIAL", value: room.ont_serial,  mono: true,  hint: "GPON identifier" },
                                        { label: "MAC",    value: room.mac_address, mono: true,  hint: "EPON identifier" },
                                        { label: "MODEL",  value: room.ont_model,   mono: false, hint: null },
                                        { label: "R-MAC", value: room.router_mac_address, mono: true, hint: "router evidence" },
                                        { label: "R-SN", value: room.router_serial, mono: true, hint: "router evidence" },
                                        { label: "R-MODEL", value: room.router_model, mono: false, hint: null },
                                    ].filter(f => f.value).map(f => (
                                        <div key={f.label} className="flex items-center gap-3">
                                            <span className="text-slate-600 text-[9px] font-black tracking-widest w-14 shrink-0">{f.label}</span>
                                            <span className={`text-xs ${f.mono ? "font-mono text-orange-300" : "font-semibold text-slate-300"}`}>
                                                {f.value}
                                            </span>
                                            {f.hint && <span className="text-slate-700 text-[9px]">({f.hint})</span>}
                                        </div>
                                    ))}
                                </div>

                                {/* WiFi credentials */}
                                {(room.wifi_ssid || room.wifi_ssid_5g || room.wifi_password) && (
                                    <div className="border-t border-[#1e293b] p-4 flex flex-col gap-2">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Wifi size={11} className="text-blue-400" />
                                            <span className="text-blue-400 text-[9px] font-black tracking-widest">WIFI CREDENTIALS</span>
                                            {room.wifi_password && (
                                                <button
                                                    onClick={() => setShowWifiPwd(v => !v)}
                                                    className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 underline"
                                                >
                                                    {showWifiPwd ? "Hide" : "Show"} password
                                                </button>
                                            )}
                                        </div>
                                        {room.wifi_ssid && (
                                            <div className="flex items-center gap-3">
                                                <span className="text-slate-600 text-[9px] font-black tracking-widest w-14 shrink-0">2.4G</span>
                                                <span className="text-xs font-mono text-blue-300">{room.wifi_ssid}</span>
                                            </div>
                                        )}
                                        {room.wifi_ssid_5g && (
                                            <div className="flex items-center gap-3">
                                                <span className="text-slate-600 text-[9px] font-black tracking-widest w-14 shrink-0">5G</span>
                                                <span className="text-xs font-mono text-blue-300">{room.wifi_ssid_5g}</span>
                                            </div>
                                        )}
                                        {room.wifi_password && (
                                            <div className="flex items-center gap-3">
                                                <span className="text-slate-600 text-[9px] font-black tracking-widest w-14 shrink-0">KEY</span>
                                                <span className="text-xs font-mono text-slate-300">
                                                    {showWifiPwd ? room.wifi_password : "••••••••"}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Scan history */}
                                {(room.scan_history?.length ?? 0) > 0 && (
                                    <div className="border-t border-[#1e293b]">
                                        <button
                                            onClick={() => setShowScanHistory(v => !v)}
                                            className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-400 text-[10px] font-semibold w-full"
                                        >
                                            <span>SCAN HISTORY ({room.scan_history!.length})</span>
                                            <span className="ml-auto">{showScanHistory ? "▲" : "▼"}</span>
                                        </button>
                                        {showScanHistory && (
                                            <div className="px-4 pb-3 flex flex-col gap-2">
                                                {[...room.scan_history!].reverse().map((s, i) => (
                                                    <div key={i} className="text-[10px] text-slate-500 border-l-2 border-[#1e293b] pl-3">
                                                        <span className="text-slate-600 font-bold">{new Date(s.ts).toLocaleString()}</span>
                                                        <span className="ml-2 uppercase text-[9px] bg-[#0f172a] px-1">{s.source}</span>
                                                        {s.serial && <span className="block font-mono text-orange-400">SN: {s.serial}</span>}
                                                        {s.mac    && <span className="block font-mono text-orange-400">MAC: {s.mac}</span>}
                                                        {s.model  && <span className="block">Model: {s.model}</span>}
                                                        {s.wifiSsid && <span className="block">WiFi: {s.wifiSsid}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Tech note */}
                    {room.tech_note && (
                        <section>
                            <SectionLabel icon={Shield} label="TECH NOTE" />
                            <p className="text-slate-400 text-xs italic mt-2 leading-relaxed bg-[#16203d] border-2 border-[#1e293b] p-3">
                                {room.tech_note}
                            </p>
                        </section>
                    )}

                    {/* Photos — click to open inline lightbox */}
                    {resolvedPhotos.length > 0 && (
                        <section>
                            <SectionLabel icon={Camera} label={`PHOTOS (${resolvedPhotos.length})`} />
                            <div className="mt-2 grid grid-cols-3 gap-2">
                                {resolvedPhotos.map((photoUrl, i) => (
                                    <div key={i} className="min-w-0">
                                        <button onClick={() => setLightboxIdx(i)}
                                            className="group relative h-20 w-full bg-[#16203d] border-2 border-[#1e293b] overflow-hidden
                                                       hover:border-orange-500/60 transition-colors">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={photoUrl}
                                                alt={`Room photo ${i + 1}`}
                                                className="w-full h-full object-cover group-hover:opacity-75 transition-opacity"
                                                onError={(e) => {
                                                    const t = e.target as HTMLImageElement;
                                                    t.style.display = "none";
                                                    const fb = t.nextElementSibling as HTMLElement | null;
                                                    if (fb) fb.style.display = "flex";
                                                }}
                                            />
                                            <div className="hidden absolute inset-0 flex-col items-center justify-center gap-1 text-slate-600">
                                                <ImageIcon size={18} strokeWidth={1} />
                                                <span className="text-[9px] font-bold tracking-widest">PHOTO {i + 1}</span>
                                            </div>
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <ZoomIn size={16} className="text-white drop-shadow-lg" />
                                            </div>
                                        </button>
                                        <div className="mt-1 grid grid-cols-2 gap-1">
                                            <button
                                                onClick={() => runOcrOnExistingPhoto(rawPhotos[i], i, "ont")}
                                                disabled={ocrPhotoIndex !== null}
                                                className="bg-orange-500/10 border border-orange-500/30 text-orange-300 py-1 text-[9px] font-black tracking-widest uppercase hover:bg-orange-500/20 disabled:opacity-50"
                                            >
                                                {ocrPhotoIndex === i ? "OCR..." : "ONT OCR"}
                                            </button>
                                            <button
                                                onClick={() => runOcrOnExistingPhoto(rawPhotos[i], i, "router")}
                                                disabled={ocrPhotoIndex !== null}
                                                className="bg-teal-500/10 border border-teal-500/30 text-teal-300 py-1 text-[9px] font-black tracking-widest uppercase hover:bg-teal-500/20 disabled:opacity-50"
                                            >
                                                {ocrPhotoIndex === i ? "OCR..." : "ROUTER OCR"}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Change history + revert */}
                    <section>
                        <div className="flex items-center justify-between">
                            <SectionLabel icon={History} label="CHANGE HISTORY" />
                            <button
                                onClick={loadHistory}
                                className="text-slate-600 hover:text-slate-300"
                                title="Refresh room history"
                                disabled={historyLoading}
                            >
                                <RefreshCw size={12} className={historyLoading ? "animate-spin" : ""} />
                            </button>
                        </div>
                        <div className="mt-2 bg-[#16203d] border-2 border-[#1e293b] divide-y divide-[#1e293b]">
                            {historyLoading && (
                                <div className="p-3 text-slate-600 text-xs font-bold tracking-widest">LOADING HISTORY...</div>
                            )}
                            {!historyLoading && historyItems.length === 0 && (
                                <div className="p-3 text-slate-600 text-xs font-bold tracking-widest">NO HISTORY RECORDED</div>
                            )}
                            {!historyLoading && historyItems.slice(0, 8).map(event => (
                                <div key={event.id} className="p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-slate-200 text-xs font-black uppercase tracking-widest">{event.action}</p>
                                            {event.reason && <p className="text-slate-400 text-xs mt-1 leading-snug">{event.reason}</p>}
                                            <p className="text-slate-600 text-[10px] mt-1">
                                                {new Date(event.created_at).toLocaleString()}
                                                {event.changed_by ? ` by ${event.changed_by}` : ""}
                                            </p>
                                        </div>
                                        {event.before_data && (
                                            <button
                                                onClick={() => revertToHistory(event)}
                                                className="shrink-0 flex items-center gap-1 border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2 py-1 text-[9px] font-black tracking-widest uppercase hover:bg-amber-500/20"
                                            >
                                                <Undo2 size={10} /> Revert
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Collection timestamp */}
                    {room.collected_at && (
                        <div className="flex items-center gap-2 border-t border-[#1e293b] pt-4 mt-1">
                            <Clock size={11} className="text-slate-600" />
                            <span className="text-slate-600 text-[10px] font-semibold">
                                Collected: {new Date(room.collected_at).toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* Photo lightbox */}
            {lightboxIdx !== null && (
                <LightboxModal
                    photos={resolvedPhotos}
                    startIndex={lightboxIdx}
                    onClose={() => setLightboxIdx(null)}
                />
            )}
        </div>
    );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <Icon size={12} className="text-orange-500" />
            <span className="text-orange-500 text-[10px] font-black tracking-widest uppercase">{label}</span>
        </div>
    );
}

function StatChip({ icon: Icon, label, value, colorClass }: {
    icon: React.ElementType; label: string; value: string; colorClass: string;
}) {
    return (
        <div className="bg-[#0f172a] border border-[#1e293b] p-2">
            <div className="flex items-center gap-1 mb-1">
                <Icon size={10} className="text-slate-600" />
                <span className="text-slate-600 text-[9px] font-bold tracking-widest uppercase">{label}</span>
            </div>
            <span className={`text-xs font-bold ${colorClass}`}>{value}</span>
        </div>
    );
}

// ── Room card ─────────────────────────────────────────────────────────────────
function RoomCard({ room, onClick }: { room: Room; onClick: () => void }) {
    const cfg = STATUS_CONFIG[room.status] ?? STATUS_CONFIG.pending;
    const onu = room.onu;
    const isOnline = onu?.status === "Online";
    const isOffline = onu && onu.status !== "Online";

    return (
        <button onClick={onClick}
            className={`w-full text-left border-2 ${cfg.border} ${cfg.bg} p-3 hover:border-orange-500/50 transition-colors relative`}
            style={{ boxShadow: "2px 2px 0 #0f172a" }}>

            {/* Conflict badge */}
            {room.conflict && (
                <div className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full" title="Username conflict" />
            )}

            {/* Header row */}
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-orange-400 font-black text-sm tracking-wide">
                    {room.room_number}
                </span>
                {/* ONU indicator */}
                {isOnline && <Wifi size={12} className="text-green-400" />}
                {isOffline && <WifiOff size={12} className="text-red-400" />}
                {!onu && room.username && <Cpu size={11} className="text-slate-600" />}
            </div>

            {/* Status */}
            <span className={`text-[10px] font-black tracking-widest uppercase ${cfg.text}`}>
                {cfg.label}
            </span>

            {/* Username */}
            {room.customer ? (
                <p className="text-slate-300 text-[11px] font-semibold mt-1 truncate">
                    {[room.customer.first_name, room.customer.last_name].filter(Boolean).join(" ") || room.customer.username}
                </p>
            ) : room.username ? (
                <p className="text-slate-500 text-[10px] font-mono mt-1 truncate">{room.username}</p>
            ) : (
                <p className="text-slate-700 text-[10px] mt-1 italic">unlinked</p>
            )}

            {/* Signal badge */}
            {onu?.rx_power_dbm != null && (
                <div className={`mt-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 ${SIGNAL_CONFIG[onu.signal_label].bg}`}>
                    <Activity size={8} className={SIGNAL_CONFIG[onu.signal_label].color} />
                    <span className={`text-[9px] font-bold ${SIGNAL_CONFIG[onu.signal_label].color}`}>
                        {onu.rx_power_dbm.toFixed(1)} dBm
                    </span>
                </div>
            )}
        </button>
    );
}

// ── Router group box ──────────────────────────────────────────────────────────
function RouterGroupBox({ group, rooms, onRoomClick, onDeleteRouterGroup }: {
    group: RouterGroup; rooms: Room[]; onRoomClick: (r: Room) => void;
    onDeleteRouterGroup?: (groupId: string, groupName: string) => void;
}) {
    const anyOnline  = rooms.some(r => r.onu?.status === "Online");
    const anyOffline = rooms.some(r => r.onu && r.onu.status !== "Online");

    return (
        <div className="border-2 border-blue-500/30 bg-[#1a2540] p-3 mb-3"
            style={{ boxShadow: "3px 3px 0 #0f172a" }}>
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#1e293b]">
                <Wifi size={13} className="text-blue-400" />
                <span className="text-blue-300 font-black text-xs tracking-widest uppercase flex-1">{group.group_name}</span>
                {anyOnline  && <span className="text-[10px] font-bold text-green-400">● ONLINE</span>}
                {anyOffline && !anyOnline && <span className="text-[10px] font-bold text-red-400">● OFFLINE</span>}
                {onDeleteRouterGroup && (
                    <button
                        onClick={() => onDeleteRouterGroup(group.id, group.group_name)}
                        title="Delete router group"
                        className="text-red-500/40 hover:text-red-400 transition-colors ml-1">
                        <Trash2 size={12} />
                    </button>
                )}
            </div>

            {group.username && (
                <div className="flex items-center gap-1.5 mb-2">
                    <User size={10} className="text-slate-500" />
                    <span className="text-slate-300 text-xs font-semibold">{group.username}</span>
                    {group.mac_address && (
                        <><Cpu size={10} className="text-slate-600 ml-1" />
                        <span className="text-slate-500 text-[10px] font-mono">{group.mac_address}</span></>
                    )}
                </div>
            )}

            {/* Room chips */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {rooms.map(r => <RoomCard key={r.id} room={r} onClick={() => onRoomClick(r)} />)}
            </div>
        </div>
    );
}

// ── Floor section ─────────────────────────────────────────────────────────────
function FloorSection({ floor, onRoomClick, onDeleteFloor, deletingFloorId, onDeleteRouterGroup }: {
    floor: Floor; onRoomClick: (r: Room) => void;
    onDeleteFloor?: (floorId: string, floorLabel: string) => void;
    deletingFloorId?: string | null;
    onDeleteRouterGroup?: (groupId: string, groupName: string) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const label = floor.floor_number === 0 ? "GROUND FLOOR" : `FLOOR ${floor.floor_number}`;
    const done = floor.rooms.filter(r => r.status === "done" || r.status === "shared").length;
    const total = floor.rooms.length;
    const onlineCount = floor.rooms.filter(r => r.onu?.status === "Online").length;
    const offlineCount = floor.rooms.filter(r => r.onu && r.onu.status !== "Online").length;
    const isDeleting = deletingFloorId === floor.id;

    const groupedRoomIds = new Set(
        floor.rooms.filter(r => r.router_group_id).map(r => r.id)
    );
    const standaloneRooms = floor.rooms.filter(r => !groupedRoomIds.has(r.id));

    return (
        <div className="mb-4 border-2 border-[#1e293b]" style={{ boxShadow: "3px 3px 0 #0f172a" }}>
            <div className="flex items-center bg-[#0d1627] border-b-2 border-[#1e293b]">
                <button onClick={() => setExpanded(e => !e)}
                    className="flex items-center gap-3 px-4 py-3 flex-1 text-left">
                    {expanded
                        ? <ChevronUp size={15} className="text-orange-400" />
                        : <ChevronDown size={15} className="text-orange-400" />
                    }
                    <span className="text-orange-400 font-black tracking-widest text-sm uppercase flex-1">{label}</span>
                    <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500 font-semibold">{done}/{total} done</span>
                        {onlineCount > 0  && <span className="text-green-400 font-bold">● {onlineCount} online</span>}
                        {offlineCount > 0 && <span className="text-red-400 font-bold">● {offlineCount} offline</span>}
                    </div>
                </button>
                {onDeleteFloor && (
                    <button
                        onClick={() => onDeleteFloor(floor.id, label)}
                        disabled={isDeleting}
                        title={`Delete ${label}`}
                        className="px-3 py-3 text-red-500/50 hover:text-red-400 hover:bg-red-900/20 disabled:opacity-40 transition-colors border-l border-[#1e293b]">
                        <Trash2 size={13} />
                    </button>
                )}
            </div>

            {expanded && (
                <div className="p-4 bg-[#0f1523]">
                    {/* Router groups */}
                    {floor.router_groups.map(g => {
                        const groupRooms = floor.rooms.filter(r => r.router_group_id === g.id);
                        return (
                            <RouterGroupBox key={g.id} group={g} rooms={groupRooms} onRoomClick={onRoomClick} onDeleteRouterGroup={onDeleteRouterGroup} />
                        );
                    })}

                    {/* Standalone rooms */}
                    {standaloneRooms.length > 0 && (
                        <>
                            {floor.router_groups.length > 0 && (
                                <p className="text-slate-700 text-[10px] font-bold tracking-widest uppercase mb-2">INDIVIDUAL ROOMS</p>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                                {standaloneRooms.map(r => (
                                    <RoomCard key={r.id} room={r} onClick={() => onRoomClick(r)} />
                                ))}
                            </div>
                        </>
                    )}

                    {floor.rooms.length === 0 && (
                        <p className="text-slate-700 text-xs text-center py-4 font-bold tracking-widest">NO ROOMS ON THIS FLOOR</p>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Edit Building Modal ───────────────────────────────────────────────────────
const PG_TYPES = ["Ladies", "Gents", "Mixed"] as const;

function EditBuildingModal({ building, onClose, onSaved }: {
    building: BuildingDashboard;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [name, setName]                   = useState(building.name);
    const [pgType, setPgType]               = useState(building.pg_type);
    const [ownerName, setOwnerName]         = useState(building.owner_name ?? "");
    const [ownerMobile, setOwnerMobile]     = useState(building.owner_mobile ?? "");
    const [ownerAltMobile, setOwnerAltMobile] = useState(building.owner_alt_mobile ?? "");
    const [address, setAddress]             = useState(building.address ?? "");
    const [saving, setSaving]               = useState(false);

    const handleSave = async () => {
        if (!name.trim()) { toast.error("Building name is required"); return; }
        setSaving(true);
        try {
            const res = await fetch(`${API_URL}/pg/buildings/${building.id}`, {
                method: "PUT",
                headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(), pg_type: pgType,
                    owner_name: ownerName.trim() || null,
                    owner_mobile: ownerMobile.trim() || null,
                    owner_alt_mobile: ownerAltMobile.trim() || null,
                    address: address.trim() || null,
                }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success("Building updated");
            onSaved();
            onClose();
        } catch (e: any) {
            toast.error("Save failed: " + (e.message ?? "error"));
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="bg-[#0f1523] border-2 border-orange-500/40 w-full max-w-md mx-4 overflow-y-auto max-h-[90vh]"
                style={{ boxShadow: "6px 6px 0 #0f172a" }}>
                <div className="flex items-center justify-between px-5 py-4 border-b-2 border-[#1e293b] bg-[#0a0f1a]">
                    <div className="flex items-center gap-2">
                        <Pencil size={14} className="text-orange-400" />
                        <span className="text-orange-400 font-black tracking-widest text-sm uppercase">Edit Building</span>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18} /></button>
                </div>
                <div className="p-5 flex flex-col gap-4">
                    <Field label="BUILDING NAME *" value={name} onChange={setName} />
                    <div>
                        <label className="text-slate-500 text-[10px] font-black tracking-widest uppercase block mb-2">TYPE *</label>
                        <div className="flex gap-2">
                            {PG_TYPES.map(t => (
                                <button key={t} onClick={() => setPgType(t)}
                                    className={`flex-1 py-2 text-xs font-black border-2 tracking-widest uppercase ${pgType === t ? "bg-orange-500 border-orange-500 text-black" : "bg-transparent border-[#1e293b] text-slate-400 hover:border-orange-500/40"}`}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>
                    <Field label="OWNER NAME (OPTIONAL)" value={ownerName} onChange={setOwnerName} />
                    <Field label="OWNER MOBILE" value={ownerMobile} onChange={setOwnerMobile} type="tel" placeholder="Primary phone number" />
                    <Field label="ALT MOBILE" value={ownerAltMobile} onChange={setOwnerAltMobile} type="tel" placeholder="Secondary phone (optional)" />
                    <Field label="ADDRESS" value={address} onChange={setAddress} multiline placeholder="Street, area, landmark" />
                </div>
                <div className="flex gap-3 px-5 pb-5">
                    <button onClick={onClose} disabled={saving}
                        className="flex-1 border-2 border-[#1e293b] text-slate-400 py-2.5 text-xs font-bold tracking-widest uppercase hover:border-slate-600">
                        CANCEL
                    </button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 bg-orange-500 text-black py-2.5 text-xs font-black tracking-widest uppercase flex items-center justify-center gap-2 disabled:opacity-60"
                        style={{ boxShadow: "3px 3px 0 #0f172a" }}>
                        <Save size={13} /> {saving ? "SAVING..." : "SAVE CHANGES"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, value, onChange, type, placeholder, multiline }: {
    label: string; value: string; onChange: (v: string) => void;
    type?: string; placeholder?: string; multiline?: boolean;
}) {
    const cls = "w-full bg-[#0d1627] border-2 border-[#1e293b] text-white text-sm font-semibold px-3 py-2.5 outline-none focus:border-orange-500/60 placeholder:text-slate-700";
    return (
        <div>
            <label className="text-slate-500 text-[10px] font-black tracking-widest uppercase block mb-2">{label}</label>
            {multiline
                ? <textarea className={cls + " resize-none"} rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
                : <input className={cls} type={type ?? "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
            }
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PGBuildingDashboardPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const [building, setBuilding] = useState<BuildingDashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
    const [showEditBuilding, setShowEditBuilding] = useState(false);
    const [deletingBuilding, setDeletingBuilding] = useState(false);
    const [deletingFloorId, setDeletingFloorId] = useState<string | null>(null);

    const fetchBuilding = useCallback(async () => {
        setLoading(true); setError(null);
        const targetUrl = `${API_URL}/pg/buildings/${id}/dashboard`;
        try {
            const res = await fetch(targetUrl, { headers: getAuthHeaders() });
            if (res.status === 401) { window.location.href = "/login"; return null; }
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            const data: BuildingDashboard = await res.json();
            setBuilding(data);
            setSelectedRoom(current => {
                if (!current) return current;
                return data.floors.flatMap(f => f.rooms).find(r => r.id === current.id) ?? null;
            });
            return data;
        } catch (e: any) {
            const msg = (e?.message === "Failed to fetch" || e instanceof TypeError)
                ? `Cannot reach backend at ${targetUrl} — is the server running?`
                : (e?.message ?? "Failed to load building");
            setError(msg);
            toast.error(msg.includes("Cannot reach") ? "Backend server unreachable" : "Could not load building");
            return null;
        } finally { setLoading(false); }
    }, [id]);

    useEffect(() => { fetchBuilding(); }, [fetchBuilding]);

    const handleDeleteBuilding = async () => {
        if (!confirm(`Delete "${building?.name}" and ALL its floors, rooms and groups? This cannot be undone.`)) return;
        setDeletingBuilding(true);
        try {
            const res = await fetch(`${API_URL}/pg/buildings/${id}`, { method: "DELETE", headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success("Building deleted");
            router.push("/pg");
        } catch (e: any) {
            toast.error("Delete failed: " + (e.message ?? "error"));
            setDeletingBuilding(false);
        }
    };

    const handleDeleteFloor = async (floorId: string, floorLabel: string) => {
        if (!confirm(`Delete ${floorLabel} and all its rooms?`)) return;
        setDeletingFloorId(floorId);
        try {
            const res = await fetch(`${API_URL}/pg/floors/${floorId}`, { method: "DELETE", headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success(`${floorLabel} deleted`);
            fetchBuilding();
        } catch (e: any) {
            toast.error("Delete failed: " + (e.message ?? "error"));
        } finally { setDeletingFloorId(null); }
    };

    const handleDeleteRouterGroup = async (groupId: string, groupName: string) => {
        if (!confirm(`Delete router group "${groupName}"? Linked rooms will revert to individual.`)) return;
        try {
            const res = await fetch(`${API_URL}/pg/router-groups/${groupId}`, { method: "DELETE", headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success(`Router group "${groupName}" deleted`);
            fetchBuilding();
        } catch (e: any) {
            toast.error("Delete failed: " + (e.message ?? "error"));
        }
    };

    const handleDeleteRoom = async (roomId: string, roomNumber: string) => {
        if (!confirm(`Delete Room ${roomNumber}?`)) return;
        try {
            const res = await fetch(`${API_URL}/pg/rooms/${roomId}`, { method: "DELETE", headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `HTTP ${res.status}`);
            toast.success(`Room ${roomNumber} deleted`);
            setSelectedRoom(null);
            fetchBuilding();
        } catch (e: any) {
            toast.error("Delete failed: " + (e.message ?? "error"));
        }
    };

    const allRooms = building?.floors.flatMap(f => f.rooms) ?? [];
    const statusCounts = ["pending", "done", "vacant", "flagged", "shared"].map(s => ({
        s: s as RoomStatus,
        count: allRooms.filter(r => r.status === s).length,
    })).filter(x => x.count > 0);

    return (
        <div className="flex h-screen bg-[#0f1523] overflow-hidden">
            <MainSidebar />
            <div className="flex-1 overflow-y-auto">

                {/* Top nav */}
                <div className="flex items-center justify-between px-6 py-4 border-b-2 border-[#1e293b] bg-[#0a0f1a] sticky top-0 z-10">
                    <button onClick={() => router.push("/pg")}
                        className="flex items-center gap-2 text-orange-400 font-black text-xs tracking-widest hover:text-orange-300">
                        <ArrowLeft size={16} /> PG PROPERTIES
                    </button>
                    <span className="text-orange-500 font-black tracking-widest text-sm">FIELD_OPS_V1</span>
                    <div className="flex items-center gap-2">
                        {building && (
                            <>
                                <button onClick={() => setShowEditBuilding(true)}
                                    className="flex items-center gap-1.5 bg-orange-500/15 border border-orange-500/40 text-orange-400 px-3 py-1.5 text-xs font-bold tracking-widest uppercase hover:bg-orange-500/25">
                                    <Pencil size={12} /> EDIT
                                </button>
                                <button onClick={handleDeleteBuilding} disabled={deletingBuilding}
                                    className="flex items-center gap-1.5 bg-red-900/20 border border-red-700/40 text-red-400 px-3 py-1.5 text-xs font-bold tracking-widest uppercase hover:bg-red-900/40 disabled:opacity-50">
                                    <Trash2 size={12} /> {deletingBuilding ? "..." : "DELETE"}
                                </button>
                            </>
                        )}
                        <button onClick={fetchBuilding} className="text-slate-500 hover:text-slate-300 ml-1" title="Refresh">
                            <RefreshCw size={16} />
                        </button>
                    </div>
                </div>

                {loading && (
                    <div className="flex items-center justify-center py-32 text-slate-500 text-sm font-bold tracking-widest animate-pulse">
                        LOADING BUILDING DATA...
                    </div>
                )}

                {error && (
                    <div className="m-6 flex items-center gap-3 bg-red-900/30 border-2 border-red-700 text-red-300 px-4 py-3">
                        <AlertCircle size={16} />
                        <span className="font-semibold text-sm">{error}</span>
                        <button onClick={fetchBuilding} className="ml-auto text-xs underline">Retry</button>
                    </div>
                )}

                {building && (
                    <div className="p-6 max-w-[1400px] mx-auto">

                        {/* Salmon context strip */}
                        <div className="flex items-center justify-between bg-[#fc895c] px-5 py-2.5 mb-6">
                            <span className="text-[#1a0a00] text-xs font-black tracking-wide uppercase">
                                {building.name} · {building.pg_type}
                            </span>
                            <span className="text-[#5a2a00] text-xs font-black tracking-wider">
                                {building.total_floors} FLOOR{building.total_floors !== 1 ? "S" : ""}{" / "}{building.total_rooms} ROOMS
                            </span>
                        </div>

                        {/* Building hero */}
                        <div className="flex flex-col md:flex-row gap-6 mb-6">
                            {/* Photo */}
                            <div className="w-full md:w-64 h-44 bg-[#0d1627] border-2 border-[#1e293b] flex-shrink-0 overflow-hidden"
                                style={{ boxShadow: "4px 4px 0 #0f172a" }}>
                                {building.photo_url
                                    ? <img src={resolveUploadUrl(building.photo_url)} alt={building.name} className="w-full h-full object-cover" />
                                    : <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-700">
                                        <Building2 size={40} strokeWidth={1} />
                                        <span className="text-[10px] font-bold tracking-widest">NO PHOTO</span>
                                    </div>
                                }
                            </div>

                            {/* Info + summary stats */}
                            <div className="flex-1">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                                    <InfoTile icon={User} label="OWNER" value={building.owner_name || "Pending"} />
                                    <InfoTile icon={Phone} label="MOBILE" value={building.owner_mobile ?? "—"} />
                                    <InfoTile icon={MapPin} label="ADDRESS" value={building.address ?? "—"} />
                                </div>

                                {/* Network + progress KPIs */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <KpiTile value={building.online_count}   label="ONLINE"    color="text-green-400" />
                                    <KpiTile value={building.offline_count}  label="OFFLINE"   color="text-red-400" />
                                    <KpiTile value={building.unlinked_count} label="UNLINKED"  color="text-slate-400" />
                                    <KpiTile
                                        value={`${building.total_rooms === 0 ? 0 : Math.round((building.done_rooms / building.total_rooms) * 100)}%`}
                                        label="COLLECTED"
                                        color={building.done_rooms === building.total_rooms ? "text-green-400" : "text-amber-400"}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Status summary */}
                        <div className="flex flex-wrap gap-2 mb-6">
                            {statusCounts.map(({ s, count }) => {
                                const cfg = STATUS_CONFIG[s];
                                return (
                                    <div key={s} className={`flex items-center gap-1.5 px-3 py-1 border ${cfg.border} ${cfg.bg}`}>
                                        <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                                        <span className={`text-[10px] font-black tracking-widest ${cfg.text}`}>
                                            {s.toUpperCase()} · {count}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Floor plan */}
                        <h2 className="text-orange-400 font-black tracking-widest text-sm uppercase mb-4 flex items-center gap-2">
                            <Hash size={14} /> FLOOR PLAN — Click any room to see full details
                        </h2>

                        {building.floors.length === 0 ? (
                            <div className="text-slate-700 text-sm font-semibold text-center py-16 border-2 border-dashed border-[#1e293b]">
                                No floors added yet — add floors and rooms from the mobile app
                            </div>
                        ) : (
                            building.floors.map(floor => (
                                <FloorSection
                                    key={floor.id}
                                    floor={floor}
                                    onRoomClick={setSelectedRoom}
                                    onDeleteFloor={handleDeleteFloor}
                                    deletingFloorId={deletingFloorId}
                                    onDeleteRouterGroup={handleDeleteRouterGroup}
                                />
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Room detail slide-out panel */}
            {selectedRoom && (
                <RoomDetailPanel
                    room={selectedRoom}
                    onClose={() => setSelectedRoom(null)}
                    onDeleteRoom={handleDeleteRoom}
                    onChanged={fetchBuilding}
                />
            )}

            {/* Edit building modal */}
            {showEditBuilding && building && (
                <EditBuildingModal
                    building={building}
                    onClose={() => setShowEditBuilding(false)}
                    onSaved={fetchBuilding}
                />
            )}
        </div>
    );
}

// ── Tiny reusables ────────────────────────────────────────────────────────────
function InfoTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
    return (
        <div className="bg-[#16203d] border-2 border-[#1e293b] p-3" style={{ boxShadow: "2px 2px 0 #0f172a" }}>
            <div className="flex items-center gap-1.5 mb-1">
                <Icon size={11} className="text-slate-500" />
                <span className="text-slate-500 text-[9px] font-black tracking-widest uppercase">{label}</span>
            </div>
            <p className="text-white text-sm font-semibold leading-snug">{value}</p>
        </div>
    );
}

function KpiTile({ value, label, color }: { value: number | string; label: string; color: string }) {
    return (
        <div className="bg-[#16203d] border-2 border-[#1e293b] p-3" style={{ boxShadow: "2px 2px 0 #0f172a" }}>
            <p className={`text-xl font-black ${color}`}>{value}</p>
            <p className="text-slate-600 text-[9px] font-bold tracking-widest mt-0.5 uppercase">{label}</p>
        </div>
    );
}
