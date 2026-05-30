import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppMap from '../../AppMap';
import { useTicketList } from '../../../hooks/useTicketList';
import { SurveyService, SurveyCustomerRow } from '../../../services/collectionService';
import { TicketStatus } from '../../../types';

type MapMode = 'tickets' | 'customers';
const ALL_ACTIVE: TicketStatus[] = ['Open', 'Assigned', 'Ongoing'];

const BG     = '#fff8f6';
const BDR    = '#271812';
const ORANGE = '#ff5a00';
const TEXT   = '#271812';
const MUTED  = '#5b4137';
const CREAM  = '#fadcd2';

export default function MapTab() {
    const { tickets, loading: ticketsLoading } = useTicketList({ statusFilter: ALL_ACTIVE });
    const [mapMode, setMapMode] = useState<MapMode>('customers');
    const [gpsCustomers, setGpsCustomers] = useState<SurveyCustomerRow[]>([]);
    const [customersLoading, setCustomersLoading] = useState(true);

    useEffect(() => {
        SurveyService.getMapCustomers(3000)
            .then(res => setGpsCustomers(res.items))
            .catch(() => setGpsCustomers([]))
            .finally(() => setCustomersLoading(false));
    }, []);

    const loading = mapMode === 'tickets' ? ticketsLoading : customersLoading;

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={ORANGE} />
            </View>
        );
    }

    const geoTicketCount = tickets.filter(t => t.customer?.geo_lat).length;
    const gpsCustomerCount = gpsCustomers.length;

    return (
        <View style={styles.root}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerLabel}>LIVE_TELEMETRY_FEED_ACTIVE</Text>
                <Text style={styles.headerTitle}>MAP VIEW</Text>
            </View>

            {/* Mode toggle */}
            <View style={styles.modeBar}>
                <TouchableOpacity
                    style={[styles.modeBtn, mapMode === 'customers' && styles.modeBtnActive]}
                    onPress={() => setMapMode('customers')}
                >
                    <Ionicons name="people-outline" size={14} color={mapMode === 'customers' ? '#000' : TEXT} />
                    <Text style={[styles.modeBtnText, mapMode === 'customers' && styles.modeBtnTextActive]}>
                        CUSTOMERS ({gpsCustomerCount})
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.modeBtn, styles.modeBtnBorderL, mapMode === 'tickets' && styles.modeBtnActive]}
                    onPress={() => setMapMode('tickets')}
                >
                    <Ionicons name="alert-circle-outline" size={14} color={mapMode === 'tickets' ? '#000' : TEXT} />
                    <Text style={[styles.modeBtnText, mapMode === 'tickets' && styles.modeBtnTextActive]}>
                        TICKETS ({geoTicketCount})
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.mapWrapper}>
                <AppMap
                    tickets={mapMode === 'tickets' ? tickets : []}
                    gpsCustomers={mapMode === 'customers' ? gpsCustomers : []}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        backgroundColor: CREAM, borderBottomWidth: 2, borderBottomColor: BDR,
        paddingHorizontal: 16, paddingVertical: 12,
    },
    headerLabel: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
    headerTitle: { color: TEXT, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', letterSpacing: -0.3 },
    modeBar: {
        flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: BDR, backgroundColor: '#18181b',
    },
    modeBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 10, gap: 6,
    },
    modeBtnBorderL: { borderLeftWidth: 1, borderLeftColor: '#3f3f46' },
    modeBtnActive: { backgroundColor: ORANGE },
    modeBtnText: { color: '#a1a1aa', fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    modeBtnTextActive: { color: '#000000' },
    mapWrapper: { flex: 1 },
});
