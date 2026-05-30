import { Platform } from 'react-native';
import api from './api';
import {
    CollectionAssignment,
    CollectionAssignmentListResponse,
    CollectionSubmission,
    CollectionSubmissionResponse,
} from '../types';

export const CollectionService = {
    /**
     * Fetch the current collector's assigned customers.
     */
    async getMyAssignments(statusFilter?: string): Promise<CollectionAssignmentListResponse> {
        const params = statusFilter ? { status: statusFilter } : undefined;
        const { data } = await api.get<CollectionAssignmentListResponse>(
            '/collection/my-assignments',
            { params },
        );
        return data;
    },

    /**
     * Submit the collected data for a given assignment.
     * Atomic: writes binding + customer + log on the backend.
     */
    async submit(
        assignmentId: number,
        body: CollectionSubmission,
    ): Promise<CollectionSubmissionResponse> {
        const { data } = await api.post<CollectionSubmissionResponse>(
            `/collection/assignments/${assignmentId}/submit`,
            body,
        );
        return data;
    },

    /**
     * Mark an assignment as skipped (no-home, no-access, etc.).
     */
    async skip(
        assignmentId: number,
        reason: string,
        notes?: string,
    ): Promise<{ status: string; message: string }> {
        const { data } = await api.post(
            `/collection/assignments/${assignmentId}/skip`,
            { reason, notes },
        );
        return data;
    },

    /**
     * Upload an install photo for an assignment (multipart).
     */
    async uploadPhoto(
        assignmentId: number,
        fileUri: string,
    ): Promise<{ status: string; url: string }> {
        const form = new FormData();
        if (Platform.OS === 'web') {
            const response = await fetch(fileUri);
            const blob = await response.blob();
            form.append('file', blob, `install_${assignmentId}.jpg`);
        } else {
            // @ts-ignore — RN FormData
            form.append('file', {
                uri: fileUri,
                name: `install_${assignmentId}.jpg`,
                type: 'image/jpeg',
            });
        }
        const { data } = await api.post(
            `/collection/assignments/${assignmentId}/photo`,
            form,
            {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000,
            },
        );
        return data;
    },
};

// ---------------------------------------------------------------------------
// Street-walking survey flow (search-first, any-tech)
// ---------------------------------------------------------------------------

export interface SurveyCustomerRow {
    username: string;
    item_type?: 'customer' | 'pg_building';
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    railwire_address?: string | null;
    rico_address?: string | null;
    survey_status: 'pending' | 'done' | 'partial' | 'skipped' | 'needs_review' | 'surveyed';
    skip_reason?: string | null;
    collector_id?: number | null;
    collector_name?: string | null;
    completed_at?: string | null;
    gps_lat?: number | null;
    gps_lng?: number | null;
    gps_confirmed: boolean;
    has_binding: boolean;
    last_surveyed_at?: string | null;
    mac_address?: string | null;
    customer_mac_address?: string | null;
    onu_identifier?: string | null;
    onu_type?: string | null;
    binding_confidence?: string | null;
    binding_source?: string | null;
    review_warnings?: string[];
    review_detail?: string | null;
    ont_serial_number?: string | null;
    ont_model?: string | null;
    device_setup?: SurveyDeviceSetup | null;
    sticker_photo_url?: string | null;
    router_sticker_photo_url?: string | null;
    router_mac_address?: string | null;
    router_model?: string | null;
    router_serial?: string | null;
    wifi_ssid?: string | null;
    wifi_ssid_5g?: string | null;
    wifi_password?: string | null;
    distance_m?: number | null;
    pg_id?: number | null;
    pg_name?: string | null;
    building_id?: string | null;
    building_name?: string | null;
    building_type?: string | null;
    floor_count?: number | null;
    room_count?: number | null;
    customer_count?: number | null;
}

export interface SurveySearchResponse {
    items: SurveyCustomerRow[];
    total: number;
    summary?: {
        done: number;
        partial: number;
        skipped: number;
        needs_review: number;
        pending: number;
        bound: number;
        unlinked: number;
    };
}

export type SkipReason = 'not_home' | 'refused' | 'locked' | 'wrong_address' | 'other';
export type SurveySort = 'auto' | 'distance' | 'recent' | 'name' | 'pending';
export type OcrIdentityMatchType = 'serial' | 'mac' | 'mac_4a_fix' | null;
export type SurveyDeviceSetup = 'single_ont' | 'onu_router';

export interface StickerOcrResponse {
    mac_address: string | null;
    mac_confidence?: 'high' | 'medium' | 'low' | null;
    mac_in_database?: boolean;
    gpon_sn: string | null;
    onu_identifier: string | null;
    ont_model: string | null;
    ont_serial_number: string | null;
    serial_candidates?: string[];
    mac_candidates?: string[];
    sticker_fields?: Record<string, any>;
    wifi_ssid: string | null;
    wifi_ssid_5g?: string | null;
    wifi_password: string | null;
    device_type: 'epon_ont' | 'gpon_ont' | 'router' | 'unknown';
    raw_text: string;
    confidence: 'high' | 'medium' | 'low';
    onu_status?: string | null;
    identity_in_database?: boolean;
    identity_status?: string | null;
    identity_olt_host?: string | null;
    identity_pon_port?: string | null;
    identity_onu_index?: number | null;
    identity_match_type?: OcrIdentityMatchType;
    identity_match_value?: string | null;
    error?: string;
}

export const SurveyService = {
    async search(params: {
        q?: string;
        status?: string;
        notBound?: boolean;
        onlyWithGps?: boolean;
        nearLat?: number | null;
        nearLng?: number | null;
        radiusM?: number | null;
        sort?: SurveySort;
        limit?: number;
        offset?: number;
    }): Promise<SurveySearchResponse> {
        const { data } = await api.get<SurveySearchResponse>('/collection/survey/search', {
            params: {
                q: params.q,
                status: params.status,
                not_bound: params.notBound || undefined,
                only_with_gps: params.onlyWithGps,
                near_lat: params.nearLat ?? undefined,
                near_lng: params.nearLng ?? undefined,
                radius_m: params.radiusM ?? undefined,
                sort: params.sort ?? 'auto',
                limit: params.limit ?? 50,
                offset: params.offset ?? 0,
            },
        });
        return data;
    },

    async submitByCustomer(
        username: string,
        body: {
            gps_lat?: number;
            gps_lng?: number;
            gps_accuracy_m?: number | null;
            onu_identifier?: string;
            ont_serial_number?: string;
            ont_mac_address?: string;
            ont_model?: string;
            device_setup?: SurveyDeviceSetup;
            sticker_photo_url?: string;
            ont_sticker_data?: Record<string, any>;
            router_sticker_photo_url?: string;
            router_mac_address?: string;
            router_model?: string;
            router_serial?: string;
            router_sticker_data?: Record<string, any>;
            wifi_ssid?: string;
            wifi_password?: string;
            alt_phones?: string[];
            notes?: string;
        },
    ): Promise<CollectionSubmissionResponse> {
        const { data } = await api.post<CollectionSubmissionResponse>(
            `/collection/survey/customers/${encodeURIComponent(username)}/submit`,
            body,
        );
        return data;
    },

    async ocrSticker(uri: string): Promise<StickerOcrResponse> {
        const form = new FormData();
        const filename = uri.split('/').pop() || 'sticker.jpg';
        form.append('file', { uri, name: filename, type: 'image/jpeg' } as any);
        const { data } = await api.post('/collection/survey/ocr-sticker', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000, // OCR can take ~15s on first run
        });
        return data;
    },

    async uploadStickerPhoto(
        username: string,
        uri: string,
    ): Promise<{ status: string; url: string }> {
        const form = new FormData();
        const filename = uri.split('/').pop() || 'sticker.jpg';
        form.append('file', {
            uri,
            name: filename,
            type: 'image/jpeg',
        } as any);
        const { data } = await api.post(
            `/collection/survey/customers/${encodeURIComponent(username)}/sticker-photo`,
            form,
            { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        return data;
    },

    async uploadRouterStickerPhoto(
        username: string,
        uri: string,
    ): Promise<{ status: string; url: string }> {
        const form = new FormData();
        const filename = uri.split('/').pop() || 'router_sticker.jpg';
        form.append('file', {
            uri,
            name: filename,
            type: 'image/jpeg',
        } as any);
        const { data } = await api.post(
            `/collection/survey/customers/${encodeURIComponent(username)}/router-sticker-photo`,
            form,
            { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        return data;
    },

    async skipByCustomer(
        username: string,
        reason: SkipReason,
        notes?: string,
    ): Promise<{ status: string; message: string }> {
        const { data } = await api.post(
            `/collection/survey/customers/${encodeURIComponent(username)}/skip`,
            { reason, notes },
        );
        return data;
    },

    /**
     * Fetch all customers with confirmed GPS — for the map tab.
     * Backend: GET /collection/survey/map
     */
    async getMapCustomers(limit = 3000): Promise<SurveySearchResponse> {
        const { data } = await api.get<SurveySearchResponse>('/collection/survey/map', {
            params: { limit },
        });
        return data;
    },
};

export default CollectionService;
