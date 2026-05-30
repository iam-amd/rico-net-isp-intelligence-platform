import React from 'react';
import { FlatList, StyleSheet, View, Text, RefreshControl, ActivityIndicator } from 'react-native';
import TicketCard from '../../components/TicketCard';
import GradientHeader from '../../components/GradientHeader';
import { TicketStatus } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTicketList } from '../../hooks/useTicketList';

const STATUS_FILTER: TicketStatus[] = ['Resolved', 'Closed'];

export default function HistoryScreen() {
    const { tickets, loading, refreshing, onRefresh } = useTicketList({ statusFilter: STATUS_FILTER });
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    if (loading) {
        return (
            <View style={[styles.centerContainer, { backgroundColor: C.background }]}>
                <ActivityIndicator size="large" color={C.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: C.background }]}>
            <GradientHeader title="Completed" count={tickets.length} />
            <FlatList
                data={tickets}
                keyExtractor={item => item.id.toString()}
                renderItem={({ item }) => <TicketCard ticket={item} />}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
                }
                ListEmptyComponent={() => (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="archive-outline" size={56} color={C.text.light} />
                        <Text style={[styles.emptyTitle, { color: C.text.primary }]}>No History Yet</Text>
                        <Text style={[styles.emptySubtitle, { color: C.text.secondary }]}>
                            Completed jobs will appear here once you resolve your first ticket.
                        </Text>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listContent: { padding: SPACING.md, paddingTop: SPACING.sm },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
    emptyTitle: { fontSize: 20, fontWeight: '800', marginTop: SPACING.md },
    emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: SPACING.sm, paddingHorizontal: 40 },
});
