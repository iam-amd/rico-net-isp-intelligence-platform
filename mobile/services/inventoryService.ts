import api from './api';
import { InventoryItem, InventoryListResponse, ApiError } from '../types';

// ------------------------------------------------------------------
// INVENTORY SERVICE — Equipment/inventory data access
// ------------------------------------------------------------------

export const InventoryService = {
    /**
     * Fetch all inventory items.
     * Endpoint: GET /inventory/
     * Backend returns: { items: InventoryItem[], total: number }
     */
    getAll: async (skip: number = 0, limit: number = 100): Promise<InventoryItem[]> => {
        try {
            const response = await api.get<InventoryListResponse>('/inventory/', {
                params: { skip, limit },
            });
            return response.data.items || [];
        } catch (error) {
            console.warn('[InventoryService] Fetch failed:', error);
            return [];
        }
    },

    /**
     * Get a single inventory item by ID.
     * Endpoint: GET /inventory/{id}
     */
    getById: async (id: number): Promise<InventoryItem> => {
        const response = await api.get<InventoryItem>(`/inventory/${id}`);
        return response.data;
    },

    /**
     * Filter items by category (client-side filter from full list).
     */
    getByCategory: async (category: string): Promise<InventoryItem[]> => {
        const all = await InventoryService.getAll();
        return all.filter(item => item.category === category);
    },

    /**
     * Extract unique category names from a list of items.
     */
    getCategories: (items: InventoryItem[]): string[] => {
        return [...new Set(items.map(item => item.category))].sort();
    },
};
