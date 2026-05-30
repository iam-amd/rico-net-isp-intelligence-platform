import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, FlatList,
    RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TicketCard from '../../TicketCard';
import { TicketStatus } from '../../../types';
import { useTicketList } from '../../../hooks/useTicketList';

type SubTab = 'pending' | 'ongoing' | 'completed';

const BG     = '#fff8f6';
const BDR    = '#271812';
const ORANGE = '#ff5a00';
const TEXT   = '#271812';
const MUTED  = '#5b4137';
const CREAM  = '#fadcd2';

const SUB_TABS: { key: SubTab; label: string; filter: TicketStatus[] }[] = [
    { key: 'pending',   label: 'PENDING',   filter: ['Assigned', 'Open'] },
    { key: 'ongoing',   label: 'ONGOING',   filter: ['Ongoing'] },
    { key: 'completed', label: 'COMPLETED', filter: ['Resolved', 'Closed'] },
];

function TicketSubList({ statusFilter }: { statusFilter: TicketStatus[] }) {
    const { tickets, loading, refreshing, onRefresh } = useTicketList({
        statusFilter,
        pollingInterval: 30000,
    });

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={ORANGE} />
            </View>
        );
    }

    return (
        <FlatList
            data={tickets}
            keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => <TicketCard ticket={item} />}
            contentContainerStyle={styles.listPad}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} />
            }
            ListEmptyComponent={
                <View style={styles.emptyBox}>
                    <Ionicons name="checkmark-circle-outline" size={48} color={MUTED} />
                    <Text style={styles.emptyTitle}>NO TICKETS</Text>
                    <Text style={styles.emptySub}>Nothing here right now</Text>
                </View>
            }
        />
    );
}

export default function ComplaintsTab() {
    const [active, setActive] = useState<SubTab>('pending');
    const current = SUB_TABS.find(t => t.key === active)!;

    return (
        <View style={styles.root}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerLabel}>SYSTEM_STATUS: ONLINE</Text>
                <Text style={styles.headerTitle}>COMPLAINTS</Text>
            </View>

            {/* Sub-tab bar */}
            <View style={styles.subTabBar}>
                {SUB_TABS.map((tab, i) => (
                    <TouchableOpacity
                        key={tab.key}
                        style={[
                            styles.subTab,
                            i > 0 && styles.subTabBorderL,
                            active === tab.key && styles.subTabActive,
                        ]}
                        onPress={() => setActive(tab.key)}
                    >
                        <Text style={[
                            styles.subTabText,
                            active === tab.key && styles.subTabTextActive,
                        ]}>
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* List */}
            <View style={styles.listWrapper}>
                <TicketSubList statusFilter={current.filter} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    header: {
        backgroundColor: CREAM, borderBottomWidth: 2, borderBottomColor: BDR,
        paddingHorizontal: 16, paddingVertical: 12,
    },
    headerLabel: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
    headerTitle: { color: TEXT, fontSize: 24, fontWeight: '900', textTransform: 'uppercase', letterSpacing: -0.3 },
    subTabBar: {
        flexDirection: 'row', backgroundColor: BDR, borderBottomWidth: 0,
    },
    subTab: {
        flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    },
    subTabBorderL: { borderLeftWidth: 1, borderLeftColor: '#3f3f46' },
    subTabActive: { backgroundColor: ORANGE },
    subTabText: { color: '#a1a1aa', fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    subTabTextActive: { color: '#000000' },
    listWrapper: { flex: 1, backgroundColor: BG },
    listPad: { padding: 12, paddingTop: 8 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
    emptyBox: { alignItems: 'center', paddingTop: 80, gap: 10 },
    emptyTitle: { color: TEXT, fontSize: 16, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
    emptySub: { color: MUTED, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
});
