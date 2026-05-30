/**
 * pgService.ts — API client for PG backend endpoints.
 * All methods are fire-and-forget safe: they throw on error,
 * caller decides whether to surface or swallow.
 */
import api from './api';
import { PGBuilding, PGFloor, PGRoom, RouterGroup } from '../context/PGContext';

// ── Backend payload shapes (snake_case to match FastAPI) ──────────────────────

interface BackendBuilding {
    id: string; name: string; pg_type: string;
    address?: string; owner_name?: string; owner_mobile?: string;
    owner_alt_mobile?: string; gps_lat?: number; gps_lng?: number;
    photo_url?: string;
    total_floors: number; total_rooms: number; done_rooms: number; pending_rooms: number;
    created_at: string; updated_at?: string; created_by?: string;
}

interface SyncPayload {
    buildings: any[];
    floors: any[];
    rooms: any[];
    router_groups: any[];
}

interface SyncResponse {
    upserted_buildings: number;
    upserted_floors: number;
    upserted_rooms: number;
    upserted_groups: number;
    errors: string[];
    updatedBuildings?: PGBuilding[];
    updatedRooms: PGRoom[];  // rooms whose local photos were replaced with server URLs
}

// ── Converters (mobile camelCase ↔ backend snake_case) ───────────────────────

function buildingToPayload(b: PGBuilding): object {
    return {
        id: b.id,
        name: b.name,
        pg_type: b.type,
        address: b.address?.trim() || undefined,
        owner_name: b.ownerName?.trim() || undefined,
        owner_mobile: b.ownerMobile?.trim() || undefined,
        owner_alt_mobile: b.ownerAltMobile?.trim() || undefined,
        gps_lat: b.gpsLat,
        gps_lng: b.gpsLng,
        change_reason: b.changeReason,
        // Only send server-side URLs — skip local file:// or content:// URIs
        photo_url: b.photoUri && !b.photoUri.startsWith('file://') && !b.photoUri.startsWith('content://') ? b.photoUri : undefined,
    };
}

function floorToPayload(f: PGFloor): object {
    return {
        id: f.id,
        building_id: f.buildingId,
        floor_number: f.floorNumber,
    };
}

function roomToPayload(r: PGRoom): object {
    return {
        id: r.id,
        floor_id: r.floorId,
        building_id: r.buildingId,
        router_group_id: r.routerGroupId ?? null,
        room_number: r.roomNumber,
        status: r.status,
        connection_type: r.connectionType,
        device_setup: r.deviceSetup ?? null,
        username: r.username ?? null,
        ont_serial: r.ontSerial ?? null,
        mac_address: r.macAddress ?? null,
        ont_model: r.ontModel ?? null,
        ont_sticker_photo_url: r.ontStickerPhotoUrl ?? null,
        ont_sticker_data: r.ontStickerData ?? null,
        router_sticker_photo_url: r.routerStickerPhotoUrl ?? null,
        router_mac_address: r.routerMacAddress ?? null,
        router_serial: r.routerSerial ?? null,
        router_model: r.routerModel ?? null,
        router_sticker_data: r.routerStickerData ?? null,
        wifi_ssid: r.wifiSsid ?? null,
        wifi_ssid_5g: r.wifiSsid5g ?? null,
        wifi_password: r.wifiPassword ?? null,
        scan_history: r.scanHistory ?? null,
        tech_note: r.techNote ?? null,
        photo_urls: r.photos ?? [],
        collected_at: r.collectedAt ?? null,
        change_reason: r.changeReason,
    };
}

function absoluteUploadUrl(path?: string): string | undefined {
    if (!path) return undefined;
    const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
    return path.startsWith('http') ? path : `${base}${path}`;
}

function groupToPayload(g: RouterGroup): object {
    return {
        id: g.id,
        floor_id: g.floorId,
        building_id: g.buildingId,
        group_name: g.groupName,
        ont_serial: g.ontSerial ?? null,
        mac_address: g.macAddress ?? null,
        username: g.username ?? null,
        photo_url: g.photoUri ?? null,
    };
}

// ── API calls ─────────────────────────────────────────────────────────────────

const PGService = {
    /** Fetch all buildings (for display in admin/sync verification) */
    async listBuildings(search?: string): Promise<BackendBuilding[]> {
        const params = search ? { search } : {};
        const res = await api.get('/pg/buildings', { params });
        return res.data;
    },

    /** Fetch one building with full floor/room detail */
    async getBuilding(id: string) {
        const res = await api.get(`/pg/buildings/${id}`);
        return res.data;
    },

    /** Create a new building on the server */
    async createBuilding(b: PGBuilding) {
        const res = await api.post('/pg/buildings', buildingToPayload(b));
        return res.data;
    },

    /** Update building on the server */
    async updateBuilding(b: PGBuilding) {
        const res = await api.put(`/pg/buildings/${b.id}`, buildingToPayload(b));
        if (b.photoUri?.startsWith('file://') || b.photoUri?.startsWith('content://')) {
            return PGService.uploadBuildingPhoto(b.id, b.photoUri);
        }
        return res.data;
    },

    /** Upload/replace a PG building identification photo. */
    async uploadBuildingPhoto(buildingId: string, localUri: string): Promise<string> {
        const formData = new FormData();
        const filename = localUri.split('/').pop() ?? 'building.jpg';
        const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        const mimeMap: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
        const mime = mimeMap[ext] ?? 'image/jpeg';
        formData.append('file', { uri: localUri, name: filename, type: mime } as any);
        const res = await api.post(`/pg/buildings/${buildingId}/photo`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        });
        return absoluteUploadUrl(res.data.photo_url)!;
    },

    /** Upload a single local photo to the server. Returns the server-hosted URL. */
    async uploadRoomPhoto(roomId: string, localUri: string): Promise<string> {
        const formData = new FormData();
        const filename = localUri.split('/').pop() ?? 'photo.jpg';
        const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        const mimeMap: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
        const mime = mimeMap[ext] ?? 'image/jpeg';
        formData.append('file', { uri: localUri, name: filename, type: mime } as any);
        const res = await api.post(`/pg/rooms/${roomId}/photos`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        });
        // Backend returns relative path (/uploads/pg/...). Prefix with API base so
        // the URL works in both AsyncStorage display and DB sync.
        const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
        const relativePath: string = res.data.url;
        return relativePath.startsWith('http') ? relativePath : `${base}${relativePath}`;
    },

    /** Save a PG room sticker photo and OCR it. Photo is retained even if OCR extracts nothing. */
    async scanRoomSticker(roomId: string, localUri: string, stickerType: 'ont' | 'router' = 'ont'): Promise<any> {
        const formData = new FormData();
        const filename = localUri.split('/').pop() ?? 'sticker.jpg';
        const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
        const mimeMap: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
        const mime = mimeMap[ext] ?? 'image/jpeg';
        formData.append('file', { uri: localUri, name: filename, type: mime } as any);
        const res = await api.post(`/pg/rooms/${roomId}/ocr-sticker-photo`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            params: { sticker_type: stickerType },
            timeout: 45000,
        });
        return {
            ...res.data,
            photo_url: absoluteUploadUrl(res.data.photo_url),
        };
    },

    async checkRoomConflicts(roomId: string, params: {
        username?: string;
        mac_address?: string;
        ont_serial?: string;
    }) {
        const res = await api.get(`/pg/rooms/${roomId}/conflicts`, { params });
        return res.data;
    },

    async resolveRoomConflicts(roomId: string, body: {
        username?: string;
        mac_address?: string;
        ont_serial?: string;
        reason: string;
    }) {
        const res = await api.post(`/pg/rooms/${roomId}/resolve-conflicts`, body);
        return res.data;
    },

    /** Bulk sync — push everything the mobile has to the server. Idempotent.
     *  Automatically uploads any local file:// / content:// room photos before syncing,
     *  then replaces them with server URLs. Returns updated rooms for state hydration. */
    async bulkSync(
        buildings: PGBuilding[],
        floors: PGFloor[],
        rooms: PGRoom[],
        groups: RouterGroup[],
    ): Promise<SyncResponse> {
        const updatedBuildings: PGBuilding[] = [];
        // Upload local photos first, collect rooms that changed
        const updatedRooms: PGRoom[] = [];
        const syncRooms = await Promise.all(rooms.map(async (room) => {
            const localUris = (room.photos ?? []).filter(
                p => p.startsWith('file://') || p.startsWith('content://')
            );
            if (localUris.length === 0) return room;

            const photoMap = new Map<string, string>();
            for (const uri of localUris) {
                try {
                    const serverUrl = await PGService.uploadRoomPhoto(room.id, uri);
                    photoMap.set(uri, serverUrl);
                } catch {
                    // Keep local URI if upload fails — will retry next sync
                }
            }
            if (photoMap.size === 0) return room;

            const replaceUploaded = (value?: string) => value ? (photoMap.get(value) ?? value) : value;
            const updated = {
                ...room,
                photos: room.photos.map(p => photoMap.get(p) ?? p),
                ontStickerPhotoUrl: replaceUploaded(room.ontStickerPhotoUrl),
                routerStickerPhotoUrl: replaceUploaded(room.routerStickerPhotoUrl),
            };
            updatedRooms.push(updated);
            return updated;
        }));

        const payload: SyncPayload = {
            buildings: buildings.map(buildingToPayload),
            floors: floors.map(floorToPayload),
            rooms: syncRooms.map(roomToPayload),
            router_groups: groups.map(groupToPayload),
        };
        const res = await api.post('/pg/sync', payload, { timeout: 60000 });

        for (const building of buildings) {
            const uri = building.photoUri;
            if (!uri || (!uri.startsWith('file://') && !uri.startsWith('content://'))) continue;
            try {
                const serverUrl = await PGService.uploadBuildingPhoto(building.id, uri);
                updatedBuildings.push({ ...building, photoUri: serverUrl, synced: true });
            } catch {
                // Keep local URI if upload fails. The next sync will retry.
            }
        }

        return { ...res.data, updatedBuildings, updatedRooms };
    },

    /** Mark individual room synced (called after local edit on reconnect) */
    async upsertRoom(r: PGRoom) {
        const res = await api.post('/pg/rooms', roomToPayload(r));
        return res.data;
    },

    /** Mark individual router group synced */
    async upsertRouterGroup(g: RouterGroup) {
        const res = await api.post('/pg/router-groups', groupToPayload(g));
        return res.data;
    },

    async deleteBuilding(id: string) {
        await api.delete(`/pg/buildings/${id}`);
    },

    async deleteFloor(id: string) {
        await api.delete(`/pg/floors/${id}`);
    },

    async deleteRoom(id: string) {
        await api.delete(`/pg/rooms/${id}`);
    },

    async deleteRouterGroup(id: string) {
        await api.delete(`/pg/router-groups/${id}`);
    },
};

export default PGService;
