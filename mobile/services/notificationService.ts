import api from './api';
import { Platform } from 'react-native';
import { ApiError } from '../types';

// ------------------------------------------------------------------
// NOTIFICATION SERVICE — Push token registration with backend
// ------------------------------------------------------------------

export const NotificationService = {
    /**
     * Register push token with backend.
     * Called on app startup after getting Expo push token.
     *
     * Endpoint: POST /technicians/{id}/push-token
     * Body: { push_token: string, platform: string }
     *
     * Backend stores the token on the Technician model fields:
     *   push_token, push_platform
     */
    registerToken: async (technicianId: number, pushToken: string): Promise<boolean> => {
        try {
            await api.post(`/technicians/${technicianId}/push-token`, {
                push_token: pushToken,
                platform: Platform.OS, // 'ios', 'android', or 'web'
            });
            console.log('[Notifications] Token registered with backend');
            return true;
        } catch (error) {
            const message = error instanceof ApiError
                ? `${error.statusCode}: ${error.message}`
                : String(error);
            console.warn('[Notifications] Failed to register push token:', message);

            // Non-fatal: don't throw — the app should still work without push notifications.
            // But return false so the caller knows it failed and can retry later.
            return false;
        }
    },

    /**
     * Unregister push token (on logout).
     * Clears the push_token and push_platform on the backend.
     *
     * Endpoint: DELETE /technicians/{id}/push-token
     */
    unregisterToken: async (technicianId: number): Promise<boolean> => {
        try {
            await api.delete(`/technicians/${technicianId}/push-token`);
            console.log('[Notifications] Token unregistered from backend');
            return true;
        } catch (error) {
            const message = error instanceof ApiError
                ? `${error.statusCode}: ${error.message}`
                : String(error);
            console.warn('[Notifications] Failed to unregister push token:', message);

            // Non-fatal during logout — don't block the sign-out flow.
            return false;
        }
    },
};
