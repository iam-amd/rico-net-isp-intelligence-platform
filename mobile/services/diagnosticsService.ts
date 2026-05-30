import api from './api';
import { DiagnosticsResponse, ApiError } from '../types';

// ------------------------------------------------------------------
// DIAGNOSTICS SERVICE — Pre-ticket automated checks
// ------------------------------------------------------------------

export const DiagnosticsService = {
    /**
     * Run diagnostics for a customer before ticket creation.
     * Checks: unpaid bills, outages, duplicate tickets, expired plans, etc.
     *
     * Endpoint: GET /diagnostics/{customer_username}
     */
    runDiagnostics: async (customerUsername: string): Promise<DiagnosticsResponse> => {
        const response = await api.get<DiagnosticsResponse>(`/diagnostics/${customerUsername}`);
        return response.data;
    },

    /**
     * Run diagnostics AND update the customer's connection status based on results.
     *
     * After diagnostics, we inspect the alerts for connectivity-related issues:
     * - If there is an "active_outage" alert, the customer is likely offline.
     * - If the account status is "Inactive" or "Suspended", mark as offline.
     * - Otherwise, assume online/unknown.
     *
     * Uses PATCH /customers/{username}/connection-status to update the
     * customer's connection status, then falls back to PUT /customers/{username}
     * to store the diagnostic summary in notes.
     *
     * Returns the diagnostics response plus the inferred connection status.
     */
    runDiagnosticsWithStatusUpdate: async (
        customerUsername: string
    ): Promise<DiagnosticsResponse & { connectionStatus: 'online' | 'offline' | 'unknown' }> => {
        const diagnostics = await DiagnosticsService.runDiagnostics(customerUsername);

        // Determine connection status from alerts
        const connectionStatus = DiagnosticsService.inferConnectionStatus(diagnostics);

        // Update customer connection status via dedicated endpoint
        if (connectionStatus !== 'unknown') {
            try {
                await api.patch(`/customers/${customerUsername}/connection-status`, {
                    status: connectionStatus,
                });
                // Also store diagnostic summary in notes if offline
                if (connectionStatus === 'offline') {
                    const timestamp = new Date().toISOString();
                    await api.put(`/customers/${customerUsername}`, {
                        notes: `[DIAGNOSTICS ${timestamp}]: ${diagnostics.summary}`,
                    });
                }
                console.log(`[Diagnostics] Updated customer ${customerUsername} — status: ${connectionStatus}`);
            } catch (error) {
                // Non-fatal — diagnostics result is still valid even if the update fails
                const message = error instanceof ApiError ? error.message : String(error);
                console.warn(`[Diagnostics] Failed to update customer status for ${customerUsername}:`, message);
            }
        }

        return { ...diagnostics, connectionStatus };
    },

    /**
     * Infer customer connection status from diagnostic alerts.
     *
     * - "active_outage" alert -> offline (known network outage at their node)
     * - "account_status" alert with severity=critical -> offline (account suspended/inactive)
     * - No connectivity alerts -> online (or at least unknown, but likely fine)
     */
    inferConnectionStatus: (diagnostics: DiagnosticsResponse): 'online' | 'offline' | 'unknown' => {
        const hasOutage = diagnostics.alerts.some(
            (alert) => alert.alert_type === 'active_outage'
        );
        if (hasOutage) return 'offline';

        const hasAccountIssue = diagnostics.alerts.some(
            (alert) =>
                alert.alert_type === 'account_status' && alert.severity === 'critical'
        );
        if (hasAccountIssue) return 'offline';

        // If there are no connectivity-related alerts, assume online
        if (diagnostics.alerts.length === 0) return 'online';

        // Has alerts but none are connectivity-related — status is unknown
        return 'unknown';
    },
};
