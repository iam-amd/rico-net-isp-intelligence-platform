import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import api from './api';
import { QueuedOperation, QueueStatus } from '../types';

// ------------------------------------------------------------------
// OFFLINE WRITE QUEUE — Phase 1A
// Persists failed write operations to AsyncStorage and replays them
// in FIFO order when connectivity is restored.
// ------------------------------------------------------------------

const QUEUE_KEY = 'offline_write_queue';
const MAX_RETRIES = 3;

/**
 * Generate a unique ID for each queued operation.
 */
function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load all queued operations from AsyncStorage.
 */
async function loadQueue(): Promise<QueuedOperation[]> {
    try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (error) {
        console.warn('[OfflineQueue] Failed to load queue:', error);
        return [];
    }
}

/**
 * Save the queue back to AsyncStorage.
 */
async function saveQueue(queue: QueuedOperation[]): Promise<void> {
    try {
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (error) {
        console.warn('[OfflineQueue] Failed to save queue:', error);
    }
}

let _isProcessing = false;

export const offlineQueue = {
    /**
     * Enqueue a write operation for later processing.
     * Returns the created QueuedOperation.
     */
    enqueue: async (
        op: Omit<QueuedOperation, 'id' | 'retryCount' | 'createdAt'>
    ): Promise<QueuedOperation> => {
        const entry: QueuedOperation = {
            ...op,
            id: generateId(),
            retryCount: 0,
            createdAt: new Date().toISOString(),
        };

        const queue = await loadQueue();
        queue.push(entry);
        await saveQueue(queue);

        console.log(`[OfflineQueue] Enqueued ${entry.type} for ticket ${entry.ticketId} (id: ${entry.id})`);
        return entry;
    },

    /**
     * Process all pending items in FIFO order.
     * Uses exponential backoff on failure: 1s, 2s, 4s (max 8s).
     * Items that exceed MAX_RETRIES are marked as failed but kept in queue.
     *
     * Returns { processed, failed } counts.
     */
    processQueue: async (): Promise<{ processed: number; failed: number }> => {
        if (_isProcessing) {
            console.log('[OfflineQueue] Already processing, skipping');
            return { processed: 0, failed: 0 };
        }

        _isProcessing = true;
        let processed = 0;
        let failed = 0;

        try {
            const queue = await loadQueue();

            if (queue.length === 0) {
                return { processed: 0, failed: 0 };
            }

            console.log(`[OfflineQueue] Processing ${queue.length} queued operations`);

            const remaining: QueuedOperation[] = [];

            for (const item of queue) {
                // Skip items that have already exceeded max retries
                if (item.retryCount >= MAX_RETRIES) {
                    remaining.push(item);
                    failed++;
                    continue;
                }

                try {
                    if (item.type === 'uploadMedia' && item.mediaUpload) {
                        // Replay a media upload by rebuilding FormData from the
                        // source URI. FormData can't survive JSON.stringify, so
                        // the original uploadMedia call queued the URI metadata
                        // instead of the FormData itself.
                        const formData = new FormData();
                        if (Platform.OS === 'web') {
                            // On web the URI is typically a blob:/data: URL.
                            // If the page reloaded between enqueue and replay
                            // the blob may be revoked → res.ok will be false.
                            const res = await fetch(item.mediaUpload.uri);
                            if (!res.ok) {
                                console.warn(
                                    `[OfflineQueue] Media URI no longer fetchable, dropping ${item.id}`
                                );
                                continue;
                            }
                            const blob = await res.blob();
                            formData.append('file', blob, item.mediaUpload.fileName);
                        } else {
                            // @ts-ignore – React Native FormData accepts {uri,type,name}
                            formData.append('file', {
                                uri: Platform.OS === 'ios'
                                    ? item.mediaUpload.uri.replace('file://', '')
                                    : item.mediaUpload.uri,
                                type: item.mediaUpload.fileType,
                                name: item.mediaUpload.fileName,
                            });
                        }
                        await api.post(item.endpoint, formData, {
                            headers: { 'Content-Type': 'multipart/form-data' },
                            timeout: 30000,
                        });
                    } else if (item.method === 'PUT') {
                        await api.put(item.endpoint, item.payload);
                    } else if (item.method === 'POST') {
                        await api.post(item.endpoint, item.payload);
                    } else if (item.method === 'DELETE') {
                        await api.delete(item.endpoint);
                    }

                    console.log(`[OfflineQueue] Successfully processed: ${item.type} (${item.id})`);
                    processed++;
                    // Item is NOT added to remaining — it's been processed
                } catch (error) {
                    item.retryCount++;
                    item.lastAttempt = new Date().toISOString();
                    item.error = error instanceof Error ? error.message : 'Unknown error';
                    failed++;

                    if (item.retryCount >= MAX_RETRIES) {
                        console.warn(`[OfflineQueue] Max retries exceeded for ${item.type} (${item.id})`);
                    }

                    remaining.push(item);

                    // Exponential backoff before next item: 1s, 2s, 4s (capped at 8s)
                    const delay = Math.min(1000 * Math.pow(2, item.retryCount - 1), 8000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            await saveQueue(remaining);
        } finally {
            _isProcessing = false;
        }

        return { processed, failed };
    },

    /**
     * Get the current status of the queue.
     */
    getQueueStatus: async (): Promise<QueueStatus> => {
        const queue = await loadQueue();
        const failedCount = queue.filter(item => item.retryCount >= MAX_RETRIES).length;
        const pendingCount = queue.filter(item => item.retryCount < MAX_RETRIES).length;

        return {
            pending: pendingCount,
            failed: failedCount,
            isProcessing: _isProcessing,
        };
    },

    /**
     * Get all queued items (for display in UI).
     */
    getQueuedItems: async (): Promise<QueuedOperation[]> => {
        return loadQueue();
    },

    /**
     * Remove items that have exceeded MAX_RETRIES.
     */
    clearFailed: async (): Promise<number> => {
        const queue = await loadQueue();
        const before = queue.length;
        const remaining = queue.filter(item => item.retryCount < MAX_RETRIES);
        await saveQueue(remaining);
        const cleared = before - remaining.length;
        if (cleared > 0) {
            console.log(`[OfflineQueue] Cleared ${cleared} failed items`);
        }
        return cleared;
    },
};
