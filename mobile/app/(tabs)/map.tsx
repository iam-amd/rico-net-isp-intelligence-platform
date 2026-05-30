import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import AppMap from '../../components/AppMap';
import { useTicketList } from '../../hooks/useTicketList';
import { SurveyService, SurveyCustomerRow } from '../../services/collectionService';
import { TicketStatus } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';

const ALL_ACTIVE_STATUSES: TicketStatus[] = ['Open', 'Assigned', 'Ongoing'];

type MapMode = 'tickets' | 'customers';

export default function MapScreen() {
    const { tickets, loading: ticketsLoading } = useTicketList({ statusFilter: ALL_ACTIVE_STATUSES });
    const [mapMode, setMapMode] = useState<MapMode>('customers');
    const [gpsCustomers, setGpsCustomers] = useState<SurveyCustomerRow[]>([]);
    const [customersLoading, setCustomersLoading] = useState(true);
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    useEffect(() => {
        SurveyService.getMapCustomers(3000)
            .then(res => setGpsCustomers(res.items))
            .catch(() => setGpsCustomers([]))
            .finally(() => setCustomersLoading(false));
    }, []);

    const loading = mapMode === 'tickets' ? ticketsLoading : customersLoading;

    if (loading) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <ActivityIndicator size="large" color={C.primary} />
            </View>
        );
    }

    const geoTicketCount = tickets.filter(t => t.customer?.geo_lat).length;
    const gpsCustomerCount = gpsCustomers.length;

    return (
        <View style={styles.container}>
            {/* Mode toggle */}
            <View style={[styles.modeBar, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                <TouchableOpacity
                    style={[styles.modeBtn, mapMode === 'customers' && { backgroundColor: C.primary + '18' }]}
                    onPress={() => setMapMode('customers')}
                >
                    <Ionicons name="people" size={14} color={mapMode === 'customers' ? C.primary : C.text.secondary} />
                    <Text style={[styles.modeBtnText, { color: mapMode === 'customers' ? C.primary : C.text.secondary }]}>
                        All Customers ({gpsCustomerCount})
                    </Text>
                </TouchableOpacity>
                <View style={[styles.modeDivider, { backgroundColor: C.border }]} />
                <TouchableOpacity
                    style={[styles.modeBtn, mapMode === 'tickets' && { backgroundColor: C.primary + '18' }]}
                    onPress={() => setMapMode('tickets')}
                >
                    <Ionicons name="ticket" size={14} color={mapMode === 'tickets' ? C.primary : C.text.secondary} />
                    <Text style={[styles.modeBtnText, { color: mapMode === 'tickets' ? C.primary : C.text.secondary }]}>
                        Active Tickets ({geoTicketCount})
                    </Text>
                </TouchableOpacity>
            </View>

            <AppMap
                tickets={mapMode === 'tickets' ? tickets : []}
                gpsCustomers={mapMode === 'customers' ? gpsCustomers : undefined}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    modeBar: {
        flexDirection: 'row',
        borderBottomWidth: 1,
    },
    modeBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
    },
    modeBtnText: {
        fontSize: 12,
        fontWeight: '600',
    },
    modeDivider: {
        width: 1,
    },
});
