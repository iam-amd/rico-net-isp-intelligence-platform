import api from './api';
import { Customer, CustomerListResponse, Ticket, TicketListResponse, ApiError } from '../types';

// ------------------------------------------------------------------
// CUSTOMER SERVICE — Data access layer for customer operations
// ------------------------------------------------------------------

export const CustomerService = {
    /**
     * Search customers by username, name, or phone.
     * Backend uses `q` query parameter (not `search`).
     * Endpoint: GET /customers/?q=<query>
     */
    search: async (query: string, limit: number = 20): Promise<Customer[]> => {
        try {
            const response = await api.get<CustomerListResponse>('/customers/', {
                params: { q: query, limit },
            });
            return response.data.items || [];
        } catch (error) {
            console.warn('[CustomerService] Search failed:', error);
            return [];
        }
    },

    /**
     * Get a single customer by username.
     * Backend primary key is `username` (string), NOT a numeric id.
     * Endpoint: GET /customers/{username}
     */
    getByUsername: async (username: string): Promise<Customer> => {
        const response = await api.get<Customer>(`/customers/${username}`);
        return response.data;
    },

    /**
     * Get tickets for a specific customer.
     * Uses the tickets list endpoint with customer_id filter.
     * Endpoint: GET /tickets/?customer_id=<username>&status=All
     *
     * Note: customer_id in the tickets table is the customer's username (string).
     */
    getTickets: async (customerUsername: string): Promise<Ticket[]> => {
        try {
            const response = await api.get<TicketListResponse>('/tickets/', {
                params: {
                    customer_id: customerUsername,
                    status: 'All',
                    limit: 100,
                },
            });
            return response.data.items || [];
        } catch (error) {
            console.warn('[CustomerService] Tickets fetch failed:', error);
            return [];
        }
    },

    /**
     * Get the customer lookup list (lightweight, for autocomplete).
     * Endpoint: GET /customers/lookup
     * Returns: [{username, display}]
     */
    getLookup: async (): Promise<{ username: string; display: string }[]> => {
        try {
            const response = await api.get('/customers/lookup');
            return response.data || [];
        } catch (error) {
            console.warn('[CustomerService] Lookup fetch failed:', error);
            return [];
        }
    },

    /**
     * Update a customer's profile.
     * Endpoint: PUT /customers/{username}
     */
    update: async (username: string, data: Record<string, any>): Promise<Customer> => {
        const response = await api.put<Customer>(`/customers/${username}`, data);
        return response.data;
    },

    /**
     * Save GPS location for a customer (field tech on-site capture).
     * Endpoint: PATCH /customers/{username}/location
     */
    saveLocation: async (username: string, lat: number, lng: number): Promise<void> => {
        await api.patch(`/customers/${username}/location`, {
            lat,
            lng,
            source: 'field_tech',
        });
    },
};
