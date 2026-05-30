import api from './api';

export interface TechnicianPerformance {
    total_assigned: number;
    total_resolved: number;
    active_count: number;
    resolution_rate: number;
    avg_resolution_hours: number;
    monthly_data?: Record<string, any>[];
    priority_breakdown?: Record<string, number>;
}

export interface TechnicianProfile {
    id: number;
    username: string;
    full_name: string;
    role: string;
    phone?: string;
    email?: string;
    specialization?: string;
    area_assigned?: string;
    photo_url?: string;
}

export const TechnicianService = {
    getProfile: async (id: number): Promise<TechnicianProfile> => {
        const response = await api.get(`/technicians/${id}`);
        return response.data;
    },

    getPerformance: async (id: number): Promise<TechnicianPerformance> => {
        try {
            const response = await api.get(`/technicians/${id}/performance`);
            return response.data;
        } catch (error) {
            console.warn('[TechnicianService] Performance fetch failed');
            return {
                total_assigned: 0,
                total_resolved: 0,
                active_count: 0,
                resolution_rate: 0,
                avg_resolution_hours: 0,
            };
        }
    },

    updateProfile: async (id: number, data: Partial<TechnicianProfile>): Promise<TechnicianProfile> => {
        const response = await api.put(`/technicians/${id}`, data);
        return response.data;
    },
};
