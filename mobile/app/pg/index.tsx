/**
 * PG Properties List — /pg
 * Lists all PG buildings stored locally. Tap to open building detail.
 */
import React, { useState } from 'react';
import {
    FlatList, StyleSheet, Text, TextInput,
    TouchableOpacity, View, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePG, PGBuilding } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { useSettings } from '../../context/SettingsContext';
import ModernPGList from '../../components/modern/PGList';
import { ActivityIndicator } from 'react-native';

const BG = '#0D1B2A';
const CARD = '#1A2535';
const CARD2 = '#1F2D3D';
const BORDER = '#2A3A4A';
const ORANGE = '#FF6B00';
const TEXT = '#E2E8F0';
const SUB = '#64748B';

const TYPE_COLORS: Record<string, string> = {
    Ladies: '#EC4899',
    Gents:  '#3B82F6',
    Mixed:  '#8B5CF6',
};

export default function PGIndexScreen() {
    const router = useRouter();
    const { isModernUI } = useSettings();
    const { state, getBuildingStats, syncNow, clearSyncError } = usePG();

    if (isModernUI) return <ModernPGList />;
    const [query, setQuery] = useState('');

    const unsyncedCount = state.buildings.filter(b => b.synced === false).length;
    const pendingPhotoRooms = state.rooms.filter(r =>
        (r.photos ?? []).some(p => p.startsWith('file://') || p.startsWith('content://'))
    ).length;

    const filtered = state.buildings.filter(b =>
        !query.trim() ||
        b.name.toLowerCase().includes(query.toLowerCase()) ||
        b.ownerName.toLowerCase().includes(query.toLowerCase()) ||
        b.address.toLowerCase().includes(query.toLowerCase())
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => { haptic.light(); router.back(); }}>
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>PG PROPERTIES</Text>
                    <Text style={styles.headerSub}>{state.buildings.length} buildings enrolled</Text>
                </View>
                <TouchableOpacity
                    style={styles.addBtn}
                    onPress={() => { haptic.light(); router.push('/pg/new' as any); }}
                >
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.addBtnText}>ADD NEW PG</Text>
                </TouchableOpacity>
            </View>

            {/* Sync Status Bar */}
            {(state.syncing || unsyncedCount > 0 || pendingPhotoRooms > 0 || state.syncError) && (
                <View style={[styles.syncBar, state.syncError ? styles.syncBarError : state.syncing ? styles.syncBarSyncing : styles.syncBarPending]}>
                    <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                        onPress={() => { haptic.light(); syncNow(); }}
                        disabled={state.syncing}
                    >
                        {state.syncing
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Ionicons name={state.syncError ? 'warning-outline' : 'cloud-upload-outline'} size={14} color="#fff" />
                        }
                        <Text style={styles.syncBarText}>
                            {state.syncing
                                ? 'Syncing to server…'
                                : state.syncError
                                ? 'Sync failed — tap to retry'
                                : unsyncedCount > 0
                                ? `${unsyncedCount} building${unsyncedCount !== 1 ? 's' : ''} pending sync — tap to push`
                                : `${pendingPhotoRooms} room${pendingPhotoRooms !== 1 ? 's' : ''} have local photos — tap to upload`
                            }
                        </Text>
                    </TouchableOpacity>
                    {state.syncError && !state.syncing && (
                        <TouchableOpacity onPress={() => { haptic.light(); clearSyncError(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close" size={16} color="#fff" />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* Search */}
            <View style={styles.searchWrap}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={16} color={SUB} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search by name, owner, address…"
                        placeholderTextColor={SUB}
                        value={query}
                        onChangeText={setQuery}
                        autoCorrect={false}
                        autoCapitalize="none"
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')}>
                            <Ionicons name="close-circle" size={16} color={SUB} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <FlatList
                data={filtered}
                keyExtractor={b => b.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 80, gap: 12 }}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="business-outline" size={56} color={BORDER} />
                        <Text style={styles.emptyTitle}>
                            {query.trim() ? 'No buildings match your search' : 'No PG buildings enrolled yet'}
                        </Text>
                        {!query.trim() && (
                            <TouchableOpacity
                                style={styles.emptyBtn}
                                onPress={() => { haptic.light(); router.push('/pg/new' as any); }}
                            >
                                <Ionicons name="add-circle" size={16} color={ORANGE} />
                                <Text style={styles.emptyBtnText}>Enroll First PG Building</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                }
                renderItem={({ item }) => (
                    <BuildingCard
                        building={item}
                        stats={getBuildingStats(item.id)}
                        onPress={() => { haptic.light(); router.push({ pathname: '/pg/[id]', params: { id: item.id } } as any); }}
                    />
                )}
            />
        </View>
    );
}

function BuildingCard({
    building,
    stats,
    onPress,
}: {
    building: PGBuilding;
    stats: { total: number; done: number; pending: number; vacant: number; flagged: number; floors: number };
    onPress: () => void;
}) {
    const typeColor = TYPE_COLORS[building.type] || '#8B5CF6';
    const progress = stats.total > 0 ? stats.done / stats.total : 0;

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
            {/* Left accent */}
            <View style={[styles.cardAccent, { backgroundColor: typeColor }]} />

            <View style={styles.cardContent}>
                {/* Top row */}
                <View style={styles.cardHeader}>
                    <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.cardName} numberOfLines={1}>{building.name}</Text>
                        <Text style={styles.cardOwner} numberOfLines={1}>
                            <Ionicons name="person-outline" size={11} color={SUB} /> {building.ownerName}
                            {'  '}<Ionicons name="call-outline" size={11} color={SUB} /> {building.ownerMobile}
                        </Text>
                    </View>
                    <View style={[styles.typeBadge, { backgroundColor: typeColor + '22', borderColor: typeColor + '55' }]}>
                        <Text style={[styles.typeText, { color: typeColor }]}>{building.type}</Text>
                    </View>
                </View>

                {/* Address */}
                <View style={styles.addressRow}>
                    <Ionicons name="location-outline" size={12} color={SUB} />
                    <Text style={styles.addressText} numberOfLines={1}>{building.address}</Text>
                </View>

                {/* Stats row */}
                <View style={styles.statsRow}>
                    <StatChip icon="layers-outline" value={`${stats.floors}`} label="Floors" color="#64748B" />
                    <StatChip icon="grid-outline" value={`${stats.total}`} label="Rooms" color="#64748B" />
                    <StatChip icon="checkmark-circle" value={`${stats.done}`} label="Done" color="#10B981" />
                    <StatChip icon="time-outline" value={`${stats.pending}`} label="Pending" color={ORANGE} />
                    {stats.flagged > 0 && (
                        <StatChip icon="flag" value={`${stats.flagged}`} label="Flagged" color="#F59E0B" />
                    )}
                </View>

                {/* Progress bar */}
                {stats.total > 0 && (
                    <View style={styles.progressWrap}>
                        <View style={styles.progressBg}>
                            <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
                        </View>
                        <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
                    </View>
                )}
            </View>

            <Ionicons name="chevron-forward" size={18} color={BORDER} style={styles.chevron} />
        </TouchableOpacity>
    );
}

function StatChip({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
    return (
        <View style={styles.statChip}>
            <Ionicons name={icon as any} size={11} color={color} />
            <Text style={[styles.statChipValue, { color }]}>{value}</Text>
            <Text style={styles.statChipLabel}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    syncBar: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 16, paddingVertical: 8,
    },
    syncBarSyncing: { backgroundColor: '#1E40AF' },
    syncBarPending: { backgroundColor: '#92400E' },
    syncBarError:   { backgroundColor: '#7F1D1D' },
    syncBarText: { color: '#fff', fontSize: 12, fontWeight: '600', flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 52,
        paddingBottom: 12,
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    backBtn: {
        width: 36,
        height: 36,
        borderRadius: 8,
        backgroundColor: CARD,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    headerTitle: { color: TEXT, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
    headerSub:   { color: SUB, fontSize: 11, marginTop: 1 },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: ORANGE,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    addBtnText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    searchWrap: { padding: 16, paddingBottom: 8 },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: CARD,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    searchInput: { flex: 1, color: TEXT, fontSize: 14, padding: 0 },
    empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 12 },
    emptyTitle: { color: SUB, fontSize: 15, textAlign: 'center' },
    emptyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: ORANGE + '55',
        backgroundColor: ORANGE + '15',
    },
    emptyBtnText: { color: ORANGE, fontWeight: '700', fontSize: 14 },
    card: {
        flexDirection: 'row',
        backgroundColor: CARD,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: BORDER,
        overflow: 'hidden',
    },
    cardAccent: { width: 4 },
    cardContent: { flex: 1, padding: 14, gap: 6 },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    cardName: { color: TEXT, fontSize: 16, fontWeight: '700' },
    cardOwner: { color: SUB, fontSize: 12 },
    typeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        flexShrink: 0,
    },
    typeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    addressText: { color: SUB, fontSize: 12, flex: 1 },
    statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
    statChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    statChipValue: { fontSize: 12, fontWeight: '700' },
    statChipLabel: { color: SUB, fontSize: 11 },
    progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    progressBg: { flex: 1, height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
    progressFill: { height: 4, backgroundColor: '#10B981', borderRadius: 2 },
    progressText: { color: SUB, fontSize: 10, fontWeight: '600', minWidth: 28 },
    chevron: { alignSelf: 'center', marginRight: 12 },
});
