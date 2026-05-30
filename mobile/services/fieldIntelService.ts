import api from './api';
import {
    TicketBriefing,
    ONULiveStatus,
    SignalPoint,
    TroubleshootingGuide,
    SmartDispatchItem,
    AreaOutageInfo,
    RebootResponse,
} from '../types';

// ------------------------------------------------------------------
// FIELD INTEL SERVICE — ONU intelligence for field technicians
// ------------------------------------------------------------------

export const FieldIntelService = {
    /**
     * Pre-visit intelligence card — single call returns everything.
     * Endpoint: GET /field-team/briefing/{customer_username}
     */
    getTicketBriefing: async (customerUsername: string): Promise<TicketBriefing> => {
        const response = await api.get<TicketBriefing>(
            `/field-team/briefing/${customerUsername}`
        );
        return response.data;
    },

    /**
     * Live ONU metrics for 30s auto-refresh.
     * Endpoint: GET /field-team/onu/{mac}/live
     */
    getONULiveStatus: async (mac: string): Promise<ONULiveStatus> => {
        const response = await api.get<ONULiveStatus>(
            `/field-team/onu/${encodeURIComponent(mac)}/live`
        );
        return response.data;
    },

    /**
     * Signal history data points for sparkline/chart.
     * Endpoint: GET /field-team/onu/{mac}/sparkline?hours=24
     */
    getSignalSparkline: async (
        mac: string,
        hours: number = 24
    ): Promise<SignalPoint[]> => {
        const response = await api.get<SignalPoint[]>(
            `/field-team/onu/${encodeURIComponent(mac)}/sparkline`,
            { params: { hours } }
        );
        return response.data;
    },

    /**
     * Check if a specific port has an active area outage.
     * Endpoint: GET /field-team/outage-check?pon_port=X&olt_host=Y
     */
    checkAreaOutage: async (
        ponPort: string,
        oltHost: string
    ): Promise<AreaOutageInfo | null> => {
        const response = await api.get<AreaOutageInfo & { outage: boolean }>(
            '/field-team/outage-check',
            { params: { pon_port: ponPort, olt_host: oltHost } }
        );
        if (!response.data.outage) return null;
        return response.data;
    },

    /**
     * Enriched dispatch queue sorted by fault severity + health score.
     * Endpoint: GET /field-team/smart-queue
     */
    getSmartDispatchQueue: async (): Promise<SmartDispatchItem[]> => {
        const response = await api.get<{ items: SmartDispatchItem[]; total: number }>(
            '/field-team/smart-queue'
        );
        return response.data.items;
    },

    /**
     * Step-by-step troubleshooting guide per fault type.
     * Endpoint: GET /field-team/troubleshooting/{fault_type}
     */
    getTroubleshootingGuide: async (
        faultType: string
    ): Promise<TroubleshootingGuide> => {
        const response = await api.get<TroubleshootingGuide>(
            `/field-team/troubleshooting/${faultType}`
        );
        return response.data;
    },

    /**
     * Remote ONU reboot — Senior Tech + Admin only.
     * Endpoint: POST /field-team/reboot/{customer_username}
     */
    rebootONU: async (customerUsername: string): Promise<RebootResponse> => {
        const response = await api.post<RebootResponse>(
            `/field-team/reboot/${customerUsername}`
        );
        return response.data;
    },

    /**
     * Link an ONU MAC address to a customer (field tech barcode scan).
     * Endpoint: POST /field-team/link-onu
     */
    linkONU: async (onuMac: string, customerUsername: string): Promise<{ status: string; message: string }> => {
        const response = await api.post('/field-team/link-onu', {
            onu_mac: onuMac,
            customer_username: customerUsername,
        });
        return response.data;
    },
};
