import api, { apiWithRetry } from './api';
import { Ticket, UpdateTicketPayload, InventoryItem, TicketMedia, TicketComment, TicketAuditLog, ApiError, isValidTransition, TicketStatus, TicketCompletePayload, TicketCompleteResponse } from '../types';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { offlineQueue } from './offlineQueue';

// ------------------------------------------------------------------
// TICKET SERVICE — Production-grade data access layer
// Network-first with offline cache fallback
// ------------------------------------------------------------------

const CACHE_KEYS = {
    TICKETS: 'tickets_cache',
    LAST_SYNC: 'tickets_last_sync',
};

export const TicketService = {
    /**
     * Fetch all tickets with optional status filter.
     * Strategy: Network First → Cache Fallback.
     * Always fetches ALL tickets to keep offline cache complete, then filters locally.
     */
    getAllTickets: async (status?: string, assignedTech?: string): Promise<Ticket[]> => {
        try {
            const params: any = { status: 'All' };
            if (assignedTech) params.assigned_tech = assignedTech;
            const response = await apiWithRetry(() =>
                api.get('/tickets/', { params })
            );
            const data: Ticket[] = response.data.items || [];

            // Update offline cache
            await AsyncStorage.setItem(CACHE_KEYS.TICKETS, JSON.stringify(data));
            await AsyncStorage.setItem(CACHE_KEYS.LAST_SYNC, new Date().toISOString());

            // Filter locally if needed
            if (status && status !== 'All') {
                return data.filter((t) => t.status === status);
            }
            return data;
        } catch (error) {
            console.warn('[TicketService] Network request failed, falling back to cache');
            const cached = await AsyncStorage.getItem(CACHE_KEYS.TICKETS);
            if (cached) {
                const tickets: Ticket[] = JSON.parse(cached);
                if (status && status !== 'All') {
                    return tickets.filter((t) => t.status === status);
                }
                return tickets;
            }
            // No cache available either
            throw error instanceof ApiError
                ? error
                : new ApiError('Failed to load tickets. No cached data available.', 0, undefined, true);
        }
    },

    /**
     * Fetch Inventory Items.
     */
    getInventory: async (): Promise<InventoryItem[]> => {
        try {
            const response = await api.get('/inventory/');
            return response.data.items || [];
        } catch (error) {
            console.warn('[TicketService] Inventory fetch failed', error);
            return []; // Non-critical — return empty
        }
    },

    /**
     * Get single ticket details.
     * Fallback to cached list if individual fetch fails.
     */
    getTicketById: async (id: number | string): Promise<Ticket> => {
        try {
            const response = await apiWithRetry(() => api.get(`/tickets/${id}`));
            return response.data;
        } catch (error) {
            console.warn(`[TicketService] Failed to fetch ticket ${id}, checking cache`);
            const cached = await AsyncStorage.getItem(CACHE_KEYS.TICKETS);
            if (cached) {
                const tickets: Ticket[] = JSON.parse(cached);
                const found = tickets.find(t => t.id.toString() === id.toString());
                if (found) return found;
            }
            throw error instanceof ApiError
                ? error
                : new ApiError('Failed to load ticket details.', 0);
        }
    },

    /**
     * Update a ticket (status, notes, materials, etc.)
     * Validates state machine transitions before sending to server.
     */
    updateTicket: async (id: number | string, payload: UpdateTicketPayload, currentStatus?: TicketStatus): Promise<Ticket> => {
        // Client-side state machine validation
        if (payload.status && currentStatus) {
            if (!isValidTransition(currentStatus, payload.status)) {
                throw new ApiError(
                    `Invalid status transition: ${currentStatus} → ${payload.status}`,
                    400
                );
            }
        }

        try {
            const response = await api.put(`/tickets/${id}`, payload);
            return response.data;
        } catch (error) {
            if (error instanceof ApiError && error.isNetworkError) {
                await offlineQueue.enqueue({
                    type: 'updateTicket',
                    endpoint: `/tickets/${id}`,
                    method: 'PUT',
                    payload,
                    ticketId: id,
                });
                // Return optimistic response
                return { id: Number(id), ...payload } as Ticket;
            }
            throw error instanceof ApiError
                ? error
                : new ApiError('Failed to update ticket.', 0);
        }
    },

    /**
     * Upload media (photos/audio) to a ticket.
     */
    uploadMedia: async (
        id: number | string,
        uri: string,
        fileType: string = 'image/jpeg',
        fileName: string = 'upload.jpg'
    ): Promise<TicketMedia> => {
        try {
            const formData = new FormData();

            if (Platform.OS === 'web') {
                const res = await fetch(uri);
                const blob = await res.blob();
                // @ts-ignore – FormData append with blob
                formData.append('file', blob, fileName);
            } else {
                // @ts-ignore – React Native FormData syntax
                formData.append('file', {
                    uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
                    type: fileType,
                    name: fileName,
                });
            }

            const response = await api.post(`/tickets/${id}/media`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 30000, // 30s for uploads
            });
            return response.data;
        } catch (error) {
            // Network/timeout failure → queue for replay so the photo isn't
            // lost when the tech is on poor signal. We re-throw a clear error
            // so the UI can show "queued, will retry when online" feedback.
            const axiosErr = error as any;
            const isNetworkFailure =
                !axiosErr?.response ||                  // no HTTP response = network/timeout
                axiosErr?.code === 'ECONNABORTED' ||    // axios timeout
                axiosErr?.message === 'Network Error';  // RN offline

            if (isNetworkFailure) {
                try {
                    await offlineQueue.enqueue({
                        type: 'uploadMedia',
                        endpoint: `/tickets/${id}/media`,
                        method: 'POST',
                        mediaUpload: { uri, fileType, fileName },
                        ticketId: id,
                    });
                    throw new ApiError(
                        'Upload queued — will retry automatically when online.',
                        0,
                    );
                } catch (qErr) {
                    if (qErr instanceof ApiError) throw qErr;
                    // queue itself failed — fall through and surface original error
                }
            }
            throw error instanceof ApiError
                ? error
                : new ApiError('Failed to upload media.', 0);
        }
    },

    /**
     * Delete media by ID.
     */
    deleteMedia: async (mediaId: number): Promise<void> => {
        try {
            await api.delete(`/tickets/media/${mediaId}`);
        } catch (error) {
            throw error instanceof ApiError
                ? error
                : new ApiError('Failed to delete media.', 0);
        }
    },

    /**
     * Complete a ticket with resolution details and enrichment data.
     * Enqueues offline if network is unavailable.
     */
    completeTicket: async (id: number | string, payload: TicketCompletePayload): Promise<TicketCompleteResponse> => {
        try {
            const response = await api.post(`/tickets/${id}/complete`, payload);
            return response.data;
        } catch (error) {
            if (error instanceof ApiError && error.isNetworkError) {
                await offlineQueue.enqueue({
                    type: 'completeTicket',
                    endpoint: `/tickets/${id}/complete`,
                    method: 'POST',
                    payload,
                    ticketId: id,
                });
                return {
                    ticket: { id: Number(id), status: 'Resolved' } as Ticket,
                    enrichment_applied: false,
                    enriched_fields: [],
                };
            }
            throw error instanceof ApiError ? error : new ApiError('Failed to complete ticket.', 0);
        }
    },

    /**
     * Add a comment to a ticket.
     * Backend sets `author` from the authenticated user's username automatically.
     * Backend expects `is_internal` as int (0 or 1), not boolean.
     * Endpoint: POST /tickets/{id}/comments
     * Enqueues offline if network is unavailable.
     */
    addComment: async (ticketId: number | string, content: string, isInternal: boolean = false): Promise<TicketComment> => {
        // Backend TicketCommentCreate expects is_internal as int (0/1)
        const payload = { content, is_internal: isInternal ? 1 : 0 };

        try {
            const response = await api.post(`/tickets/${ticketId}/comments`, payload);
            return response.data;
        } catch (error) {
            if (error instanceof ApiError && error.isNetworkError) {
                await offlineQueue.enqueue({
                    type: 'addComment',
                    endpoint: `/tickets/${ticketId}/comments`,
                    method: 'POST',
                    payload,
                    ticketId,
                });
                return {
                    id: -Date.now(),
                    author: 'You (pending sync)',
                    content,
                    is_internal: isInternal ? 1 : 0,
                    created_at: new Date().toISOString(),
                };
            }
            throw error instanceof ApiError ? error : new ApiError('Failed to add comment.', 0);
        }
    },

    /**
     * Fetch comments for a ticket.
     * Endpoint: GET /tickets/{id}/comments
     * Returns: TicketComment[] (backend returns list, not paginated)
     */
    getComments: async (ticketId: number | string): Promise<TicketComment[]> => {
        try {
            const response = await api.get<TicketComment[]>(`/tickets/${ticketId}/comments`);
            return response.data || [];
        } catch (error) {
            console.warn('[TicketService] Failed to fetch comments:', error);
            return [];
        }
    },

    /**
     * Fetch audit log for a ticket.
     * Endpoint: GET /tickets/{id}/audit
     * Returns: TicketAuditLog[] (backend returns list, not paginated)
     */
    getAuditLog: async (ticketId: number | string): Promise<TicketAuditLog[]> => {
        try {
            const response = await api.get<TicketAuditLog[]>(`/tickets/${ticketId}/audit`);
            return response.data || [];
        } catch (error) {
            console.warn('[TicketService] Failed to fetch audit log:', error);
            return [];
        }
    },
};
