import React, { useState } from 'react';
import { FlatList, StyleSheet, View, Text, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import TicketCard from '../../components/TicketCard';
import SmartDispatchCard from '../../components/SmartDispatchCard';
import GradientHeader from '../../components/GradientHeader';
import { TicketStatus } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useTicketList } from '../../hooks/useTicketList';
import { useSmartDispatch } from '../../hooks/useSmartDispatch';
import ModernAppShell from '../../components/modern/AppShell';

const STATUS_FILTER: TicketStatus[] = ['Assigned', 'Open'];

export default function PendingScreen() {
  const [smartMode, setSmartMode] = useState(true);
  const { isDarkMode, isModernUI } = useSettings();
  const C = isDarkMode ? DARK_COLORS : COLORS;

  // Classic ticket list (always loaded for fallback)
  const classic = useTicketList({ statusFilter: STATUS_FILTER, pollingInterval: 30000 });

  // Smart dispatch queue
  const smart = useSmartDispatch();

  // Use smart mode if enabled and working, otherwise fall back
  const usesSmart = smartMode && smart.isSmartMode;
  const loading = usesSmart ? smart.loading : classic.loading;
  const refreshing = usesSmart ? smart.refreshing : classic.refreshing;
  const onRefresh = usesSmart ? smart.onRefresh : classic.onRefresh;
  const itemCount = usesSmart ? smart.items.length : classic.tickets.length;

  // Modern UI — render full industrial app shell (custom header + nav + 5 tabs)
  if (isModernUI) {
    return <ModernAppShell />;
  }

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: C.background }]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <GradientHeader title="Pending Jobs" count={itemCount} />

      {/* Mode Toggle */}
      <View style={[styles.toggleRow, { backgroundColor: C.card, borderBottomColor: C.border }]}>
        <TouchableOpacity
          style={[styles.toggleBtn, smartMode && styles.toggleActive]}
          onPress={() => setSmartMode(true)}
        >
          <Ionicons name="analytics" size={14} color={smartMode ? COLORS.primary : C.text.light} />
          <Text style={[styles.toggleText, smartMode && styles.toggleTextActive]}>
            Smart Queue
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, !smartMode && styles.toggleActive]}
          onPress={() => setSmartMode(false)}
        >
          <Ionicons name="list" size={14} color={!smartMode ? COLORS.primary : C.text.light} />
          <Text style={[styles.toggleText, !smartMode && styles.toggleTextActive]}>
            Classic
          </Text>
        </TouchableOpacity>
        {smartMode && !smart.isSmartMode && (
          <View style={styles.fallbackBadge}>
            <Text style={styles.fallbackText}>Fallback</Text>
          </View>
        )}
      </View>

      {usesSmart ? (
        <FlatList
          data={smart.items}
          keyExtractor={item => item.ticket_id.toString()}
          renderItem={({ item }) => <SmartDispatchCard item={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
          }
          ListEmptyComponent={() => (
            <EmptyState isDarkMode={isDarkMode} />
          )}
        />
      ) : (
        <FlatList
          data={classic.tickets}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item }) => <TicketCard ticket={item} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
          }
          ListEmptyComponent={() => (
            <EmptyState isDarkMode={isDarkMode} />
          )}
        />
      )}
    </View>
  );
}

function EmptyState({ isDarkMode }: { isDarkMode: boolean }) {
  const C = isDarkMode ? DARK_COLORS : COLORS;
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="checkmark-circle-outline" size={56} color={C.text.light} />
      <Text style={[styles.emptyTitle, { color: C.text.primary }]}>All Clear!</Text>
      <Text style={[styles.emptySubtitle, { color: C.text.secondary }]}>
        No pending jobs right now. Pull down to refresh.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: SPACING.md, paddingTop: SPACING.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    gap: 8,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    gap: 4,
    backgroundColor: 'transparent',
  },
  toggleActive: {
    backgroundColor: COLORS.primary + '12',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text.light,
  },
  toggleTextActive: {
    color: COLORS.primary,
  },
  fallbackBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    marginLeft: 'auto',
  },
  fallbackText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 20, fontWeight: '800', marginTop: SPACING.md },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginTop: SPACING.sm, paddingHorizontal: 40 },
});
