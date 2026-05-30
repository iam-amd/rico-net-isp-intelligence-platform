import React, { useState } from 'react';
import {
    FlatList, StyleSheet, Text, TextInput, TouchableOpacity,
    View, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePG, PGBuilding } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import EditPGModal from './EditPGModal';

const BG      = '#0F1523';
const CARD    = '#16203D';
const BORDER  = '#0F172A';
const BORDER_L = '#1e293b';
const ORANGE  = '#FF5A00';
const TEXT    = '#ffffff';
const SUB     = '#94a3b8';
const MUTED   = '#64748b';

const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1 as const,
    shadowRadius: 0,
    elevation: 6,
};

export default function PGList() {
    const router = useRouter();
    const { state, getBuildingStats, syncNow, clearSyncError } = usePG();
    const [query, setQuery] = useState('');
    const [editTarget, setEditTarget] = useState<PGBuilding | null>(null);

    const unsyncedCount = state.buildings.filter(b => b.synced === false).length;
    const pendingPhotoRooms = state.rooms.filter(r =>
        (r.photos ?? []).some(p => p.startsWith('file://') || p.startsWith('content://'))
    ).length;

    const filtered = state.buildings.filter(b =>
        !query.trim() ||
        b.name.toLowerCase().includes(query.toLowerCase()) ||
        (b.ownerName ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (b.address ?? '').toLowerCase().includes(query.toLowerCase())
    );

    return (
        <SafeAreaView style={styles.safeArea} edges={['top']}>
            {/* Top Nav */}
            <View style={styles.topHeader}>
                <TouchableOpacity
                    style={styles.backBtn}
                    onPress={() => { haptic.light(); router.back(); }}
                >
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <Text style={styles.topHeaderTitle}>FIELD_OPS_V1</Text>
                <TouchableOpacity style={styles.personBtn} onPress={() => router.push('/profile')}>
                    <Ionicons name="person-circle-outline" size={22} color={ORANGE} />
                </TouchableOpacity>
            </View>

            {/* Action Header */}
            <View style={styles.actionHeader}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.actionTitle}>PG PROPERTIES</Text>
                    <Text style={styles.actionSub}>
                        SYS_LOC_REG: ACTIVE // {state.buildings.length} ASSIGNED
                    </Text>
                </View>
                <TouchableOpacity
                    style={styles.addBtn}
                    onPress={() => { haptic.light(); router.push('/pg/new' as any); }}
                >
                    <Ionicons name="add" size={16} color="#000" />
                    <Text style={styles.addBtnText}>ADD NEW PG</Text>
                </TouchableOpacity>
            </View>

            {/* Sync Status */}
            {(state.syncing || unsyncedCount > 0 || pendingPhotoRooms > 0 || state.syncError) && (
                <View style={[styles.syncBar, state.syncError ? styles.syncBarError : state.syncing ? styles.syncBarSyncing : styles.syncBarPending]}>
                    <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
                        onPress={() => { haptic.light(); syncNow(); }}
                        disabled={state.syncing}
                    >
                        {state.syncing
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Ionicons name={state.syncError ? 'warning-outline' : 'cloud-upload-outline'} size={13} color="#fff" />
                        }
                        <Text style={styles.syncBarText}>
                            {state.syncing
                                ? 'SYNCING_TO_SERVER...'
                                : state.syncError
                                ? 'SYNC_FAILED — TAP TO RETRY'
                                : unsyncedCount > 0
                                ? `${unsyncedCount} UNSYNCED — TAP TO PUSH`
                                : `${pendingPhotoRooms} ROOM(S) HAVE LOCAL PHOTOS — TAP TO UPLOAD`}
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
                    <Ionicons name="search-outline" size={16} color={MUTED} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="QUERY_ID // NAME // ZIP"
                        placeholderTextColor={MUTED}
                        value={query}
                        onChangeText={setQuery}
                        autoCorrect={false}
                        autoCapitalize="characters"
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')}>
                            <Ionicons name="close" size={16} color={MUTED} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* List */}
            <FlatList
                data={filtered}
                keyExtractor={b => b.id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Ionicons name="business-outline" size={44} color={BORDER_L} />
                        <Text style={styles.emptyText}>
                            {query.trim() ? 'NO BUILDINGS MATCH QUERY' : 'NO PG BUILDINGS ENROLLED'}
                        </Text>
                        <TouchableOpacity
                            style={styles.emptyAddBtn}
                            onPress={() => router.push('/pg/new' as any)}
                        >
                            <Text style={styles.emptyAddBtnText}>+ ADD FIRST PG</Text>
                        </TouchableOpacity>
                    </View>
                }
                renderItem={({ item }) => (
                    <BuildingCard
                        building={item}
                        stats={getBuildingStats(item.id)}
                        onPress={() => {
                            haptic.light();
                            router.push({ pathname: '/pg/[id]', params: { id: item.id } } as any);
                        }}
                        onEdit={() => {
                            haptic.light();
                            setEditTarget(item);
                        }}
                    />
                )}
            />

            {/* Edit Modal */}
            <EditPGModal
                visible={editTarget !== null}
                building={editTarget}
                onClose={() => setEditTarget(null)}
            />
        </SafeAreaView>
    );
}

function BuildingCard({
    building, stats, onPress, onEdit,
}: {
    building: PGBuilding;
    stats: { total: number; done: number; pending: number; floors: number };
    onPress: () => void;
    onEdit: () => void;
}) {
    const shortId = building.id.slice(-6).toUpperCase();

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.88}>
            {/* Photo area */}
            <View style={styles.photoArea}>
                {building.photoUri
                    ? <Image source={{ uri: building.photoUri }} style={styles.photoImg} />
                    : <View style={styles.photoPlaceholder}>
                        <Ionicons name="business-outline" size={36} color={MUTED} />
                        <Text style={styles.photoPlaceholderText}>NO PHOTO</Text>
                    </View>
                }
                {/* ID badge top-left */}
                <View style={styles.idBadge}>
                    <Text style={styles.idBadgeText}>ID: {shortId}</Text>
                </View>
                {/* Edit button top-right */}
                <TouchableOpacity style={styles.editOverlayBtn} onPress={onEdit} activeOpacity={0.8}>
                    <Ionicons name="pencil" size={16} color="#000" />
                </TouchableOpacity>
            </View>

            {/* Card body */}
            <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={1}>
                    {building.name.toUpperCase()}
                </Text>
                <View style={styles.addressRow}>
                    <Ionicons name="location-outline" size={12} color={MUTED} style={{ marginTop: 1 }} />
                    <Text style={styles.addressText} numberOfLines={2}>{building.address || 'Address pending'}</Text>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.cardFooter}>
                <TouchableOpacity style={styles.viewDetailsRow} onPress={onPress} activeOpacity={0.8}>
                    <Text style={styles.viewDetailsText}>VIEW DETAILS</Text>
                    <Ionicons name="chevron-forward" size={16} color={TEXT} />
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: BG },
    syncBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
    syncBarSyncing: { backgroundColor: '#1E3A8A' },
    syncBarPending: { backgroundColor: '#78350F' },
    syncBarError:   { backgroundColor: '#7F1D1D' },
    syncBarText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, flex: 1 },
    topHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: 60, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: BORDER_L,
    },
    backBtn: {
        width: 40, height: 40, borderWidth: 2, borderColor: BORDER_L,
        alignItems: 'center', justifyContent: 'center', ...SHADOW,
    },
    topHeaderTitle: { color: ORANGE, fontSize: 15, fontWeight: '900', letterSpacing: 2 },
    personBtn: { width: 40, height: 40, borderWidth: 2, borderColor: BORDER_L, alignItems: 'center', justifyContent: 'center' },
    actionHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: BORDER_L,
    },
    actionTitle: { color: ORANGE, fontSize: 20, fontWeight: '900', letterSpacing: 2 },
    actionSub: { color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
    addBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: ORANGE, paddingHorizontal: 12, paddingVertical: 8,
        borderWidth: 2, borderColor: BORDER, ...SHADOW,
    },
    addBtnText: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    searchWrap: { marginHorizontal: 16, marginVertical: 12 },
    searchBox: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: CARD, borderWidth: 2, borderColor: BORDER_L,
        paddingHorizontal: 12, paddingVertical: 10,
    },
    searchInput: { flex: 1, color: TEXT, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, padding: 0 },
    listContent: { paddingHorizontal: 16, paddingBottom: 80, gap: 16 },
    empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
    emptyText: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
    emptyAddBtn: {
        backgroundColor: ORANGE, paddingHorizontal: 20, paddingVertical: 10,
        borderWidth: 2, borderColor: BORDER, marginTop: 8,
    },
    emptyAddBtnText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1 },

    // Card
    card: {
        backgroundColor: CARD, borderWidth: 2, borderColor: BORDER_L,
        ...SHADOW, overflow: 'hidden',
    },
    photoArea: { width: '100%', height: 180, position: 'relative', backgroundColor: '#0d1627' },
    photoImg: { width: '100%', height: '100%', resizeMode: 'cover' },
    photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    photoPlaceholderText: { color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    idBadge: {
        position: 'absolute', top: 8, left: 8,
        backgroundColor: 'rgba(9,9,11,0.85)', borderWidth: 2, borderColor: BORDER_L,
        paddingHorizontal: 8, paddingVertical: 4,
    },
    idBadgeText: { color: SUB, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    editOverlayBtn: {
        position: 'absolute', top: 8, right: 8,
        backgroundColor: ORANGE, borderWidth: 2, borderColor: BORDER,
        width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    },
    cardBody: { padding: 14, gap: 8, borderBottomWidth: 2, borderBottomColor: BORDER_L },
    cardName: { color: ORANGE, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
    addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    addressText: { color: SUB, fontSize: 12, flex: 1 },
    cardFooter: { backgroundColor: 'rgba(0,0,0,0.3)' },
    viewDetailsRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 14, paddingVertical: 12,
    },
    viewDetailsText: { color: TEXT, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
});
