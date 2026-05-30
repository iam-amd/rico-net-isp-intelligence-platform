/**
 * PG Data Context — offline-first AsyncStorage store with backend sync.
 * All mutations hit local state immediately (optimistic).
 * On network availability, unsync'd records are pushed to the backend.
 */
import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PGService from '../services/pgService';

const STORAGE_KEY = '@rico_pg_data';
const SYNC_DEBOUNCE_MS = 5000; // wait 5s after last change before syncing

// ─── Types ──────────────────────────────────────────────────────────────────

export type RoomStatus = 'pending' | 'done' | 'vacant' | 'flagged' | 'shared';
export type ConnectionType = 'individual' | 'router_group' | 'linked_room' | 'none';
export type DeviceSetup = 'single_ont' | 'onu_router';
export type PGType = 'Ladies' | 'Gents' | 'Mixed';

export interface PGBuilding {
    id: string;
    name: string;
    type: PGType;
    address: string;
    ownerName: string;
    ownerMobile: string;
    ownerAltMobile?: string;
    changeReason?: string;
    gpsLat?: number;
    gpsLng?: number;
    photoUri?: string;
    createdAt: string;
    synced: boolean;
}

export interface PGFloor {
    id: string;
    buildingId: string;
    floorNumber: number;
    createdAt: string;
}

export interface ScanRecord {
    ts: string;
    mac?: string;
    serial?: string;
    model?: string;
    wifiSsid?: string;
    wifiSsid5g?: string;
    rawText?: string;
    device?: 'ont' | 'router';
    source: 'ocr' | 'barcode' | 'manual';
}

export interface PGRoom {
    id: string;
    floorId: string;
    buildingId: string;
    roomNumber: string;
    status: RoomStatus;
    connectionType: ConnectionType;
    deviceSetup?: DeviceSetup;
    username?: string;
    ontSerial?: string;
    macAddress?: string;
    ontModel?: string;
    ontStickerPhotoUrl?: string;
    ontStickerData?: Record<string, any>;
    routerStickerPhotoUrl?: string;
    routerMacAddress?: string;
    routerSerial?: string;
    routerModel?: string;
    routerStickerData?: Record<string, any>;
    wifiSsid?: string;
    wifiSsid5g?: string;
    wifiPassword?: string;
    scanHistory?: ScanRecord[];
    routerGroupId?: string;
    photos: string[];
    techNote?: string;
    collectedAt?: string;
    changeReason?: string;
    synced: boolean;
}

export interface RouterGroup {
    id: string;
    floorId: string;
    buildingId: string;
    groupName: string;
    ontSerial?: string;
    macAddress?: string;
    username?: string;
    photoUri?: string;
    roomIds: string[];
    createdAt: string;
    synced: boolean;
}

export interface PGState {
    buildings: PGBuilding[];
    floors: PGFloor[];
    rooms: PGRoom[];
    routerGroups: RouterGroup[];
    loaded: boolean;
    syncing: boolean;
    lastSyncedAt?: string;
    syncError?: string;
}

type Action =
    | { type: 'LOAD'; payload: Omit<PGState, 'loaded' | 'syncing'> }
    | { type: 'MERGE_FROM_SERVER'; buildings: PGBuilding[]; floors: PGFloor[]; rooms: PGRoom[]; groups: RouterGroup[] }
    | { type: 'REPLACE_BUILDING_DATA'; buildingId: string; building: PGBuilding; floors: PGFloor[]; rooms: PGRoom[]; groups: RouterGroup[] }
    | { type: 'ADD_BUILDING'; payload: PGBuilding }
    | { type: 'UPDATE_BUILDING'; payload: PGBuilding }
    | { type: 'DELETE_BUILDING'; id: string }
    | { type: 'ADD_FLOOR'; payload: PGFloor }
    | { type: 'DELETE_FLOOR'; id: string }
    | { type: 'ADD_ROOM'; payload: PGRoom }
    | { type: 'UPDATE_ROOM'; payload: PGRoom }
    | { type: 'DELETE_ROOM'; id: string }
    | { type: 'ADD_ROUTER_GROUP'; payload: RouterGroup }
    | { type: 'UPDATE_ROUTER_GROUP'; payload: RouterGroup }
    | { type: 'DELETE_ROUTER_GROUP'; id: string }
    | { type: 'MARK_SYNCED'; buildingIds: string[] }
    | { type: 'SET_SYNCING'; syncing: boolean }
    | { type: 'SET_SYNC_ERROR'; error: string | undefined }
    | { type: 'SET_SYNC_SUCCESS'; at: string }
    | { type: 'CLEAR_SYNC_ERROR' };

const initial: PGState = {
    buildings: [], floors: [], rooms: [], routerGroups: [],
    loaded: false, syncing: false,
};

function reducer(state: PGState, action: Action): PGState {
    switch (action.type) {
        case 'LOAD':
            return { ...state, ...action.payload, loaded: true };
        case 'MERGE_FROM_SERVER': {
            const localBuildingIds = new Set(state.buildings.map(b => b.id));
            const localFloorIds    = new Set(state.floors.map(f => f.id));
            const localRoomIds     = new Set(state.rooms.map(r => r.id));
            const localGroupIds    = new Set(state.routerGroups.map(g => g.id));
            return {
                ...state,
                buildings:    [...state.buildings,    ...action.buildings.filter(b => !localBuildingIds.has(b.id))],
                floors:       [...state.floors,       ...action.floors.filter(f => !localFloorIds.has(f.id))],
                rooms:        [...state.rooms,        ...action.rooms.filter(r => !localRoomIds.has(r.id))],
                routerGroups: [...state.routerGroups, ...action.groups.filter(g => !localGroupIds.has(g.id))],
            };
        }
        case 'REPLACE_BUILDING_DATA':
            return {
                ...state,
                buildings: state.buildings.map(b =>
                    b.id === action.buildingId ? action.building : b
                ),
                floors: [
                    ...state.floors.filter(f => f.buildingId !== action.buildingId),
                    ...action.floors,
                ],
                rooms: [
                    ...state.rooms.filter(r => r.buildingId !== action.buildingId),
                    ...action.rooms,
                ],
                routerGroups: [
                    ...state.routerGroups.filter(g => g.buildingId !== action.buildingId),
                    ...action.groups,
                ],
            };
        case 'ADD_BUILDING':
            return { ...state, buildings: [...state.buildings, action.payload] };
        case 'UPDATE_BUILDING':
            return { ...state, buildings: state.buildings.map(b => b.id === action.payload.id ? action.payload : b) };
        case 'DELETE_BUILDING':
            return {
                ...state,
                buildings: state.buildings.filter(b => b.id !== action.id),
                floors: state.floors.filter(f => f.buildingId !== action.id),
                rooms: state.rooms.filter(r => r.buildingId !== action.id),
                routerGroups: state.routerGroups.filter(g => g.buildingId !== action.id),
            };
        case 'ADD_FLOOR':
            return { ...state, floors: [...state.floors, action.payload] };
        case 'DELETE_FLOOR':
            return {
                ...state,
                floors: state.floors.filter(f => f.id !== action.id),
                rooms: state.rooms.filter(r => r.floorId !== action.id),
            };
        case 'ADD_ROOM':
            return { ...state, rooms: [...state.rooms, action.payload] };
        case 'UPDATE_ROOM':
            return { ...state, rooms: state.rooms.map(r => r.id === action.payload.id ? action.payload : r) };
        case 'DELETE_ROOM':
            return { ...state, rooms: state.rooms.filter(r => r.id !== action.id) };
        case 'ADD_ROUTER_GROUP':
            return { ...state, routerGroups: [...state.routerGroups, action.payload] };
        case 'UPDATE_ROUTER_GROUP':
            return { ...state, routerGroups: state.routerGroups.map(g => g.id === action.payload.id ? action.payload : g) };
        case 'DELETE_ROUTER_GROUP':
            return {
                ...state,
                routerGroups: state.routerGroups.filter(g => g.id !== action.id),
                rooms: state.rooms.map(r =>
                    r.routerGroupId === action.id
                        ? { ...r, routerGroupId: undefined, connectionType: 'none' as ConnectionType }
                        : r
                ),
            };
        case 'MARK_SYNCED':
            return {
                ...state,
                buildings: state.buildings.map(b =>
                    action.buildingIds.includes(b.id) ? { ...b, synced: true } : b
                ),
            };
        case 'SET_SYNCING':
            return { ...state, syncing: action.syncing };
        case 'SET_SYNC_ERROR':
            return { ...state, syncError: action.error, syncing: false };
        case 'SET_SYNC_SUCCESS':
            return { ...state, lastSyncedAt: action.at, syncError: undefined, syncing: false };
        case 'CLEAR_SYNC_ERROR':
            return { ...state, syncError: undefined };
        default:
            return state;
    }
}

// ─── ID generator ────────────────────────────────────────────────────────────

export function genId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Context value interface ──────────────────────────────────────────────────

interface PGContextValue {
    state: PGState;
    addBuilding: (b: Omit<PGBuilding, 'id' | 'createdAt' | 'synced'>) => PGBuilding;
    updateBuilding: (b: PGBuilding) => void;
    deleteBuilding: (id: string) => void;
    addFloor: (buildingId: string, floorNumber: number) => PGFloor;
    deleteFloor: (id: string) => void;
    addRoom: (r: Omit<PGRoom, 'id' | 'synced' | 'photos' | 'status' | 'connectionType'>) => PGRoom;
    updateRoom: (r: PGRoom) => void;
    deleteRoom: (id: string) => void;
    addRouterGroup: (g: Omit<RouterGroup, 'id' | 'createdAt' | 'synced' | 'roomIds'>) => RouterGroup;
    updateRouterGroup: (g: RouterGroup) => void;
    deleteRouterGroup: (id: string) => void;
    syncNow: () => Promise<void>;
    clearSyncError: () => void;
    refreshBuildingFromServer: (buildingId: string) => Promise<void>;
    getBuildingStats: (buildingId: string) => { total: number; done: number; pending: number; vacant: number; flagged: number; floors: number };
    getFloorRooms: (floorId: string) => PGRoom[];
    getFloorGroups: (floorId: string) => RouterGroup[];
    getBuildingFloors: (buildingId: string) => PGFloor[];
}

const PGCtx = createContext<PGContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function PGProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initial);
    const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Load from AsyncStorage on mount ──────────────────────────────────────
    useEffect(() => {
        AsyncStorage.getItem(STORAGE_KEY)
            .then(raw => {
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        dispatch({
                            type: 'LOAD',
                            payload: {
                                buildings: parsed.buildings ?? [],
                                floors: parsed.floors ?? [],
                                rooms: parsed.rooms ?? [],
                                routerGroups: parsed.routerGroups ?? [],
                                lastSyncedAt: parsed.lastSyncedAt,
                                syncError: undefined,
                            },
                        });
                    } catch {
                        dispatch({ type: 'LOAD', payload: { buildings: [], floors: [], rooms: [], routerGroups: [] } });
                    }
                } else {
                    dispatch({ type: 'LOAD', payload: { buildings: [], floors: [], rooms: [], routerGroups: [] } });
                }
            })
            .catch(() => {
                dispatch({ type: 'LOAD', payload: { buildings: [], floors: [], rooms: [], routerGroups: [] } });
            });
    }, []);

    // ── Sync on startup if there are unsynced items or pending local photos ──────
    useEffect(() => {
        if (!state.loaded) return;
        const hasUnsynced = state.buildings.some(b => b.synced === false);
        const hasPendingPhotos = state.rooms.some(r =>
            (r.photos ?? []).some(p => p.startsWith('file://') || p.startsWith('content://'))
        );
        if (hasUnsynced || hasPendingPhotos) {
            performSync().catch(() => {});
        }
    }, [state.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Pull buildings from server that aren't in local state ─────────────────
    useEffect(() => {
        if (!state.loaded) return;
        PGService.listBuildings().then(async (serverList: any[]) => {
            const localIds = new Set(state.buildings.map(b => b.id));
            const missingIds = serverList.filter((b: any) => !localIds.has(b.id)).map((b: any) => b.id);
            if (missingIds.length === 0) return;

            const details = await Promise.all(
                missingIds.map((id: string) => PGService.getBuilding(id).catch(() => null))
            );

            const newBuildings: PGBuilding[] = [];
            const newFloors: PGFloor[]       = [];
            const newRooms: PGRoom[]         = [];
            const newGroups: RouterGroup[]   = [];

            for (const detail of details) {
                if (!detail) continue;
                newBuildings.push({
                    id: detail.id, name: detail.name, type: detail.pg_type as PGType,
                    address: detail.address ?? '', ownerName: detail.owner_name ?? '',
                    ownerMobile: detail.owner_mobile ?? '', ownerAltMobile: detail.owner_alt_mobile,
                    gpsLat: detail.gps_lat, gpsLng: detail.gps_lng, photoUri: detail.photo_url,
                    createdAt: detail.created_at, synced: true,
                });
                for (const floor of detail.floors ?? []) {
                    newFloors.push({
                        id: floor.id, buildingId: floor.building_id,
                        floorNumber: floor.floor_number,
                        createdAt: floor.created_at ?? new Date().toISOString(),
                    });
                    for (const room of floor.rooms ?? []) {
                        newRooms.push({
                            id: room.id, floorId: room.floor_id, buildingId: room.building_id,
                            roomNumber: room.room_number, status: room.status as RoomStatus,
                            connectionType: (room.connection_type ?? 'none') as ConnectionType,
                            deviceSetup: (room.device_setup ?? undefined) as DeviceSetup | undefined,
                            username: room.username ?? undefined,
                            ontSerial: room.ont_serial ?? undefined,
                            macAddress: room.mac_address ?? undefined,
                            ontModel: room.ont_model ?? undefined,
                            ontStickerPhotoUrl: room.ont_sticker_photo_url ?? undefined,
                            ontStickerData: room.ont_sticker_data ?? undefined,
                            routerStickerPhotoUrl: room.router_sticker_photo_url ?? undefined,
                            routerMacAddress: room.router_mac_address ?? undefined,
                            routerSerial: room.router_serial ?? undefined,
                            routerModel: room.router_model ?? undefined,
                            routerStickerData: room.router_sticker_data ?? undefined,
                            wifiSsid: room.wifi_ssid ?? undefined,
                            wifiSsid5g: room.wifi_ssid_5g ?? undefined,
                            wifiPassword: room.wifi_password ?? undefined,
                            scanHistory: room.scan_history ?? undefined,
                            routerGroupId: room.router_group_id ?? undefined,
                            photos: room.photo_urls ?? [],
                            techNote: room.tech_note ?? undefined,
                            collectedAt: room.collected_at ?? undefined,
                            synced: true,
                        });
                    }
                    for (const grp of floor.router_groups ?? []) {
                        newGroups.push({
                            id: grp.id, floorId: grp.floor_id ?? floor.id, buildingId: grp.building_id ?? detail.id,
                            groupName: grp.group_name, ontSerial: grp.ont_serial ?? undefined,
                            macAddress: grp.mac_address ?? undefined, username: grp.username ?? undefined,
                            photoUri: grp.photo_url ?? undefined,
                            roomIds: [], createdAt: grp.created_at ?? new Date().toISOString(), synced: true,
                        });
                    }
                }
            }
            // Compute roomIds for each group
            for (const grp of newGroups) {
                grp.roomIds = newRooms.filter(r => r.routerGroupId === grp.id).map(r => r.id);
            }
            dispatch({ type: 'MERGE_FROM_SERVER', buildings: newBuildings, floors: newFloors, rooms: newRooms, groups: newGroups });
        }).catch(err => console.warn('[PGContext] server pull error:', err?.message));
    }, [state.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Persist to AsyncStorage on every state change ─────────────────────────
    useEffect(() => {
        if (!state.loaded) return;
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
            buildings: state.buildings,
            floors: state.floors,
            rooms: state.rooms,
            routerGroups: state.routerGroups,
            lastSyncedAt: state.lastSyncedAt,
        })).catch(err => console.warn('[PGContext] persist error:', err));
    }, [state]);

    // ── Debounced sync scheduler ──────────────────────────────────────────────
    const scheduleSyncDebounced = useCallback(() => {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
            performSync().catch(() => {});
        }, SYNC_DEBOUNCE_MS);
    }, []);

    // ── Core sync function ────────────────────────────────────────────────────
    const performSync = useCallback(async () => {
        // Get latest state via ref — avoid stale closure
        dispatch({ type: 'SET_SYNCING', syncing: true });
        try {
            // Read the latest persisted state from storage for a consistent snapshot
            const raw = await AsyncStorage.getItem(STORAGE_KEY);
            if (!raw) { dispatch({ type: 'SET_SYNCING', syncing: false }); return; }
            const snap = JSON.parse(raw);

            const result = await PGService.bulkSync(
                snap.buildings ?? [],
                snap.floors ?? [],
                snap.rooms ?? [],
                snap.routerGroups ?? [],
            );

            if (result.errors.length > 0) {
                console.warn('[PGSync] partial errors:', result.errors);
                dispatch({ type: 'SET_SYNC_ERROR', error: `${result.errors.length} item(s) failed to sync` });
            } else {
                const syncedAt = new Date().toISOString();
                dispatch({ type: 'SET_SYNC_SUCCESS', at: syncedAt });
                // Mark all buildings as synced in local state
                dispatch({ type: 'MARK_SYNCED', buildingIds: (snap.buildings ?? []).map((b: any) => b.id) });
                // Replace local building photo URIs with server URLs in state
                for (const building of result.updatedBuildings ?? []) {
                    dispatch({ type: 'UPDATE_BUILDING', payload: building });
                }
                // Replace local photo URIs with server URLs in state
                for (const room of result.updatedRooms ?? []) {
                    dispatch({ type: 'UPDATE_ROOM', payload: room });
                }
            }
        } catch (err: any) {
            const msg = err?.response?.data?.detail ?? err?.message ?? 'Sync failed';
            console.warn('[PGSync] error:', msg);
            dispatch({ type: 'SET_SYNC_ERROR', error: msg });
        }
    }, []);

    const syncNow = useCallback(async () => {
        await performSync();
    }, [performSync]);

    const clearSyncError = useCallback(() => {
        dispatch({ type: 'CLEAR_SYNC_ERROR' });
    }, []);

    const refreshBuildingFromServer = useCallback(async (buildingId: string) => {
        const detail = await PGService.getBuilding(buildingId);
        const newFloors: PGFloor[] = [];
        const newRooms: PGRoom[]   = [];
        const newGroups: RouterGroup[] = [];

        for (const floor of detail.floors ?? []) {
            newFloors.push({
                id: floor.id, buildingId: floor.building_id,
                floorNumber: floor.floor_number,
                createdAt: floor.created_at ?? new Date().toISOString(),
            });
            for (const room of floor.rooms ?? []) {
                newRooms.push({
                    id: room.id, floorId: room.floor_id, buildingId: room.building_id,
                    roomNumber: room.room_number, status: room.status as RoomStatus,
                    connectionType: (room.connection_type ?? 'none') as ConnectionType,
                    deviceSetup: (room.device_setup ?? undefined) as DeviceSetup | undefined,
                    username: room.username ?? undefined,
                    ontSerial: room.ont_serial ?? undefined,
                    macAddress: room.mac_address ?? undefined,
                    ontModel: room.ont_model ?? undefined,
                    ontStickerPhotoUrl: room.ont_sticker_photo_url ?? undefined,
                    ontStickerData: room.ont_sticker_data ?? undefined,
                    routerStickerPhotoUrl: room.router_sticker_photo_url ?? undefined,
                    routerMacAddress: room.router_mac_address ?? undefined,
                    routerSerial: room.router_serial ?? undefined,
                    routerModel: room.router_model ?? undefined,
                    routerStickerData: room.router_sticker_data ?? undefined,
                    wifiSsid: room.wifi_ssid ?? undefined,
                    wifiSsid5g: room.wifi_ssid_5g ?? undefined,
                    wifiPassword: room.wifi_password ?? undefined,
                    scanHistory: room.scan_history ?? undefined,
                    routerGroupId: room.router_group_id ?? undefined,
                    photos: room.photo_urls ?? [],
                    techNote: room.tech_note ?? undefined,
                    collectedAt: room.collected_at ?? undefined,
                    synced: true,
                });
            }
            for (const grp of floor.router_groups ?? []) {
                newGroups.push({
                    id: grp.id, floorId: grp.floor_id ?? floor.id, buildingId: grp.building_id ?? detail.id,
                    groupName: grp.group_name, ontSerial: grp.ont_serial ?? undefined,
                    macAddress: grp.mac_address ?? undefined, username: grp.username ?? undefined,
                    photoUri: grp.photo_url ?? undefined,
                    roomIds: [], createdAt: grp.created_at ?? new Date().toISOString(), synced: true,
                });
            }
        }
        for (const grp of newGroups) {
            grp.roomIds = newRooms.filter(r => r.routerGroupId === grp.id).map(r => r.id);
        }

        const building: PGBuilding = {
            id: detail.id, name: detail.name, type: detail.pg_type as PGType,
            address: detail.address ?? '', ownerName: detail.owner_name ?? '',
            ownerMobile: detail.owner_mobile ?? '', ownerAltMobile: detail.owner_alt_mobile,
            gpsLat: detail.gps_lat, gpsLng: detail.gps_lng, photoUri: detail.photo_url,
            createdAt: detail.created_at, synced: true,
        };
        dispatch({ type: 'REPLACE_BUILDING_DATA', buildingId, building, floors: newFloors, rooms: newRooms, groups: newGroups });
    }, []);

    // ── Mutations — optimistic dispatch + immediate API call ─────────────────

    const addBuilding = useCallback((b: Omit<PGBuilding, 'id' | 'createdAt' | 'synced'>): PGBuilding => {
        const building: PGBuilding = { ...b, id: genId(), createdAt: new Date().toISOString(), synced: false };
        dispatch({ type: 'ADD_BUILDING', payload: building });
        scheduleSyncDebounced();
        return building;
    }, [scheduleSyncDebounced]);

    const updateBuilding = useCallback((b: PGBuilding) => {
        dispatch({ type: 'UPDATE_BUILDING', payload: { ...b, synced: false } });
        // Immediate API call for edits — don't rely solely on bulk sync
        PGService.updateBuilding(b).then(() => {
            dispatch({ type: 'UPDATE_BUILDING', payload: { ...b, synced: true } });
        }).catch(() => {
            scheduleSyncDebounced(); // Fall back to bulk sync on failure
        });
    }, [scheduleSyncDebounced]);

    const deleteBuilding = useCallback((id: string) => {
        dispatch({ type: 'DELETE_BUILDING', id });
        PGService.deleteBuilding(id).catch(err =>
            console.warn('[PGContext] deleteBuilding backend error:', err?.message)
        );
    }, []);

    const addFloor = useCallback((buildingId: string, floorNumber: number): PGFloor => {
        const floor: PGFloor = { id: genId(), buildingId, floorNumber, createdAt: new Date().toISOString() };
        dispatch({ type: 'ADD_FLOOR', payload: floor });
        scheduleSyncDebounced();
        return floor;
    }, [scheduleSyncDebounced]);

    const deleteFloor = useCallback((id: string) => {
        dispatch({ type: 'DELETE_FLOOR', id });
        PGService.deleteFloor(id).catch(err =>
            console.warn('[PGContext] deleteFloor backend error:', err?.message)
        );
    }, []);

    const addRoom = useCallback((r: Omit<PGRoom, 'id' | 'synced' | 'photos' | 'status' | 'connectionType'>): PGRoom => {
        const room: PGRoom = { ...r, id: genId(), status: 'pending', connectionType: 'none', photos: [], synced: false };
        dispatch({ type: 'ADD_ROOM', payload: room });
        scheduleSyncDebounced();
        return room;
    }, [scheduleSyncDebounced]);

    const updateRoom = useCallback((r: PGRoom) => {
        dispatch({ type: 'UPDATE_ROOM', payload: { ...r, synced: false } });
        PGService.upsertRoom(r).then(() => {
            dispatch({ type: 'UPDATE_ROOM', payload: { ...r, synced: true } });
        }).catch(() => {
            scheduleSyncDebounced();
        });
    }, [scheduleSyncDebounced]);

    const deleteRoom = useCallback((id: string) => {
        dispatch({ type: 'DELETE_ROOM', id });
        PGService.deleteRoom(id).catch(err =>
            console.warn('[PGContext] deleteRoom backend error:', err?.message)
        );
    }, []);

    const addRouterGroup = useCallback((g: Omit<RouterGroup, 'id' | 'createdAt' | 'synced' | 'roomIds'>): RouterGroup => {
        const group: RouterGroup = { ...g, id: genId(), roomIds: [], createdAt: new Date().toISOString(), synced: false };
        dispatch({ type: 'ADD_ROUTER_GROUP', payload: group });
        scheduleSyncDebounced();
        return group;
    }, [scheduleSyncDebounced]);

    const updateRouterGroup = useCallback((g: RouterGroup) => {
        dispatch({ type: 'UPDATE_ROUTER_GROUP', payload: { ...g, synced: false } });
        PGService.upsertRouterGroup(g).catch(() => scheduleSyncDebounced());
    }, [scheduleSyncDebounced]);

    const deleteRouterGroup = useCallback((id: string) => {
        dispatch({ type: 'DELETE_ROUTER_GROUP', id });
        PGService.deleteRouterGroup(id).catch(err =>
            console.warn('[PGContext] deleteRouterGroup backend error:', err?.message)
        );
    }, []);

    // ── Derived queries ───────────────────────────────────────────────────────

    const getBuildingStats = useCallback((buildingId: string) => {
        const floors = state.floors.filter(f => f.buildingId === buildingId);
        const rooms = state.rooms.filter(r => r.buildingId === buildingId);
        return {
            total: rooms.length,
            done: rooms.filter(r => r.status === 'done' || r.status === 'shared').length,
            pending: rooms.filter(r => r.status === 'pending').length,
            vacant: rooms.filter(r => r.status === 'vacant').length,
            flagged: rooms.filter(r => r.status === 'flagged').length,
            floors: floors.length,
        };
    }, [state.rooms, state.floors]);

    const getFloorRooms = useCallback(
        (floorId: string) => state.rooms.filter(r => r.floorId === floorId),
        [state.rooms],
    );

    const getFloorGroups = useCallback(
        (floorId: string) => state.routerGroups.filter(g => g.floorId === floorId),
        [state.routerGroups],
    );

    const getBuildingFloors = useCallback(
        (buildingId: string) =>
            state.floors
                .filter(f => f.buildingId === buildingId)
                .sort((a, b) => a.floorNumber - b.floorNumber),
        [state.floors],
    );

    return (
        <PGCtx.Provider value={{
            state,
            addBuilding, updateBuilding, deleteBuilding,
            addFloor, deleteFloor,
            addRoom, updateRoom, deleteRoom,
            addRouterGroup, updateRouterGroup, deleteRouterGroup,
            syncNow, clearSyncError, refreshBuildingFromServer,
            getBuildingStats, getFloorRooms, getFloorGroups, getBuildingFloors,
        }}>
            {children}
        </PGCtx.Provider>
    );
}

export function usePG() {
    const ctx = useContext(PGCtx);
    if (!ctx) throw new Error('usePG must be used within PGProvider');
    return ctx;
}
