import React, { useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePG, PGRoom, RouterGroup, PGFloor, RoomStatus } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import EditPGModal from './EditPGModal';

const BG      = '#0F1523';
const CARD    = '#16203D';
const CARD2   = '#1f2947';
const BORDER  = '#0F172A';
const BORDER_L = '#1e293b';
const ORANGE  = '#FF5A00';
const SALMON  = '#fc895c';
const TEXT    = '#ffffff';
const SUB     = '#94a3b8';
const MUTED   = '#64748b';
const SUCCESS = '#22c55e';
const AMBER   = '#f59e0b';

const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1 as const,
    shadowRadius: 0,
    elevation: 6,
};

const ROOM_COLORS: Record<RoomStatus, string> = {
    done:    SUCCESS,
    pending: '#ffffff',
    vacant:  '#3b82f6',
    flagged: AMBER,
    shared:  SUCCESS,
};

export interface PGBuildingProps { buildingId: string; }

export default function PGBuildingScreen({ buildingId }: PGBuildingProps) {
    const router = useRouter();
    const { state, addFloor, deleteFloor, addRoom, addRouterGroup, deleteBuilding, getBuildingStats, refreshBuildingFromServer } = usePG();

    const building = state.buildings.find(b => b.id === buildingId);
    const floors   = state.floors.filter(f => f.buildingId === buildingId).sort((a, b) => a.floorNumber - b.floorNumber);
    const stats    = building ? getBuildingStats(buildingId) : null;

    const [refreshing, setRefreshing]         = useState(false);
    const [showAddFloor, setShowAddFloor]     = useState(false);
    const [floorNumInput, setFloorNumInput]   = useState('');
    const [showAddRoom, setShowAddRoom]       = useState<string | null>(null);
    const [roomNumInput, setRoomNumInput]     = useState('');
    const [showAddGroup, setShowAddGroup]     = useState<string | null>(null);
    const [groupNameInput, setGroupNameInput] = useState('');
    const [showEdit, setShowEdit]             = useState(false);

    if (!building) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: MUTED }}>BUILDING NOT FOUND</Text>
            </View>
        );
    }

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await refreshBuildingFromServer(buildingId);
            haptic.success();
        } catch {
            Alert.alert('REFRESH_FAILED', 'Could not fetch latest data from server. Check your connection.');
        } finally {
            setRefreshing(false);
        }
    };

    const handleDeleteBuilding = () => {
        Alert.alert(
            'DELETE BUILDING',
            `Delete "${building.name}" and ALL its floors, rooms and router groups? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'DELETE',
                    style: 'destructive',
                    onPress: () => {
                        haptic.light();
                        deleteBuilding(building.id);
                        router.back();
                    },
                },
            ],
        );
    };

    const handleAddFloor = () => {
        const num = parseInt(floorNumInput.trim(), 10);
        if (isNaN(num) || num < 0 || num > 99) { Alert.alert('INVALID', 'Enter a floor number 0–99.'); return; }
        if (floors.some(f => f.floorNumber === num)) { Alert.alert('DUPLICATE', `Floor ${num} already exists.`); return; }
        addFloor(building.id, num);
        haptic.success();
        setShowAddFloor(false);
        setFloorNumInput('');
    };

    const handleAddRoom = (floorId: string) => {
        const num = roomNumInput.trim();
        if (!num) { Alert.alert('REQUIRED', 'Enter a room number.'); return; }
        if (state.rooms.filter(r => r.floorId === floorId).some(r => r.roomNumber === num)) {
            Alert.alert('DUPLICATE', `Room ${num} already exists on this floor.`); return;
        }
        addRoom({ floorId, buildingId: building.id, roomNumber: num });
        haptic.success();
        setShowAddRoom(null);
        setRoomNumInput('');
    };

    const handleAddGroup = (floorId: string) => {
        const name = groupNameInput.trim() || `Router ${state.routerGroups.filter(g => g.floorId === floorId).length + 1}`;
        addRouterGroup({ floorId, buildingId: building.id, groupName: name });
        haptic.success();
        setShowAddGroup(null);
        setGroupNameInput('');
    };

    return (
        <View style={styles.container}>
            {/* Top header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => { haptic.light(); router.back(); }}>
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>FIELD_OPS_V1</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={styles.personBtn} onPress={handleRefresh} disabled={refreshing}>
                        {refreshing
                            ? <ActivityIndicator size="small" color={ORANGE} />
                            : <Ionicons name="refresh-outline" size={18} color={ORANGE} />
                        }
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.personBtn} onPress={() => setShowEdit(true)}>
                        <Ionicons name="pencil-outline" size={18} color={ORANGE} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteBuilding}>
                        <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Salmon context header */}
            <View style={styles.contextHeader}>
                <View style={styles.contextRow}>
                    <Text style={styles.ctxBuilding}>{building.name.toUpperCase()}</Text>
                </View>
                <View style={styles.contextInfoRow}>
                    <Ionicons name="person-outline" size={14} color="#5a2a00" />
                    <Text style={styles.ctxInfo}>OWNER: {(building.ownerName || 'PENDING ADMIN UPDATE').toUpperCase()}</Text>
                </View>
                {stats && (
                    <View style={[styles.ctxStatBox, SHADOW]}>
                        <Text style={styles.ctxStatText}>
                            {String(stats.floors).padStart(2, '0')} FLOORS // {String(stats.total).padStart(2, '0')} ROOMS
                        </Text>
                    </View>
                )}
            </View>

            {/* Grid label + legend */}
            <View style={styles.gridLabelRow}>
                <Text style={styles.gridLabel}>ROOM STATUS GRID</Text>
                <View style={styles.legend}>
                    <View style={[styles.legendDot, { backgroundColor: SUCCESS }]} />
                    <Text style={styles.legendText}>COMPLETED</Text>
                    <View style={[styles.legendDot, { backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER_L }]} />
                    <Text style={styles.legendText}>PENDING</Text>
                </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
                {floors.length === 0 && (
                    <View style={styles.emptyFloors}>
                        <Ionicons name="layers-outline" size={40} color={BORDER_L} />
                        <Text style={{ color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
                            NO FLOORS — ADD A FLOOR BELOW
                        </Text>
                    </View>
                )}

                {floors.map(floor => (
                    <FloorSection
                        key={floor.id}
                        floor={floor}
                        rooms={state.rooms.filter(r => r.floorId === floor.id)}
                        groups={state.routerGroups.filter(g => g.floorId === floor.id)}
                        onOpenRoom={id => router.push({ pathname: '/pg/room', params: { roomId: id, buildingId: building.id } } as any)}
                        onOpenGroup={id => router.push({ pathname: '/pg/router-group', params: { groupId: id, buildingId: building.id } } as any)}
                        onAddRoom={() => { setRoomNumInput(''); setShowAddRoom(floor.id); }}
                        onAddGroup={() => { setGroupNameInput(''); setShowAddGroup(floor.id); }}
                        onDeleteFloor={() => Alert.alert('DELETE FLOOR', `Delete Floor ${floor.floorNumber} and all its rooms?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'DELETE', style: 'destructive', onPress: () => { haptic.light(); deleteFloor(floor.id); } },
                        ])}
                    />
                ))}

                {/* Add Floor dashed button at bottom */}
                <TouchableOpacity
                    style={styles.addFloorBtn}
                    onPress={() => { haptic.light(); setFloorNumInput(`${floors.length}`); setShowAddFloor(true); }}
                >
                    <Ionicons name="add-circle-outline" size={20} color={ORANGE} />
                    <Text style={styles.addFloorBtnText}>ADD NEW FLOOR</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Add Floor Modal */}
            <IndustrialModal visible={showAddFloor} title="ADD NEW FLOOR" onClose={() => setShowAddFloor(false)} onConfirm={handleAddFloor} confirmLabel="CONFIRM">
                <Text style={styles.modalLabel}>FLOOR NUMBER</Text>
                <TextInput style={styles.modalInput} value={floorNumInput} onChangeText={setFloorNumInput} placeholder="e.g. 1, 2, 3 (0 = Ground)" placeholderTextColor={MUTED} keyboardType="number-pad" autoFocus />
            </IndustrialModal>

            {/* Add Room Modal */}
            <IndustrialModal visible={!!showAddRoom} title="ADD NEW ROOM" onClose={() => setShowAddRoom(null)} onConfirm={() => showAddRoom && handleAddRoom(showAddRoom)} confirmLabel="ADD ROOM">
                <Text style={styles.modalLabel}>ROOM NUMBER</Text>
                <TextInput style={styles.modalInput} value={roomNumInput} onChangeText={setRoomNumInput} placeholder="e.g. 101, 202, G1" placeholderTextColor={MUTED} autoCapitalize="characters" autoFocus />
            </IndustrialModal>

            {/* Add Router Group Modal */}
            <IndustrialModal visible={!!showAddGroup} title="ADD ROUTER GROUP" onClose={() => setShowAddGroup(null)} onConfirm={() => showAddGroup && handleAddGroup(showAddGroup)} confirmLabel="CREATE GROUP">
                <Text style={styles.modalLabel}>GROUP NAME (OPTIONAL)</Text>
                <TextInput style={styles.modalInput} value={groupNameInput} onChangeText={setGroupNameInput} placeholder="e.g. Router 1, East Wing" placeholderTextColor={MUTED} autoFocus />
            </IndustrialModal>

            {/* Edit PG Modal */}
            <EditPGModal visible={showEdit} building={building} onClose={() => setShowEdit(false)} />
        </View>
    );
}

// ── Floor Section ─────────────────────────────────────────────────────────────
function FloorSection({
    floor, rooms, groups, onOpenRoom, onOpenGroup, onAddRoom, onAddGroup, onDeleteFloor,
}: {
    floor: PGFloor; rooms: PGRoom[]; groups: RouterGroup[];
    onOpenRoom: (id: string) => void; onOpenGroup: (id: string) => void;
    onAddRoom: () => void; onAddGroup: () => void; onDeleteFloor: () => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const floorLabel = floor.floorNumber === 0 ? 'GROUND_FLOOR' : `FLOOR_${String(floor.floorNumber).padStart(2, '0')}`;
    const standaloneRooms = rooms.filter(r => !r.routerGroupId);

    return (
        <View style={floorStyles.section}>
            {/* Floor Header */}
            <View style={floorStyles.header}>
                <TouchableOpacity style={floorStyles.chevron} onPress={() => { haptic.light(); setExpanded(e => !e); }}>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={ORANGE} />
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => { haptic.light(); setExpanded(e => !e); }}>
                    <Text style={floorStyles.label}>{floorLabel}</Text>
                </TouchableOpacity>
                {/* Add Room button */}
                <TouchableOpacity style={floorStyles.hdrBtn} onPress={onAddRoom}>
                    <Ionicons name="add" size={14} color="#000" />
                    <Ionicons name="bed-outline" size={14} color="#000" />
                </TouchableOpacity>
                {/* Add Router Group button */}
                <TouchableOpacity style={floorStyles.hdrBtn} onPress={onAddGroup}>
                    <Ionicons name="add" size={14} color="#000" />
                    <Ionicons name="wifi-outline" size={14} color="#000" />
                </TouchableOpacity>
                {/* Room count */}
                <Text style={floorStyles.roomCount}>{rooms.length} ROOMS</Text>
                <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 12, right: 8 }} onPress={onDeleteFloor}>
                    <Ionicons name="trash-outline" size={13} color={MUTED} />
                </TouchableOpacity>
            </View>

            {/* Expanded content */}
            {expanded ? (
                <View style={floorStyles.body}>
                    {/* Router groups */}
                    {groups.map(group => {
                        const groupRooms = rooms.filter(r => r.routerGroupId === group.id);
                        return (
                            <RouterGroupBox
                                key={group.id}
                                group={group}
                                groupRooms={groupRooms}
                                onOpen={() => { haptic.light(); onOpenGroup(group.id); }}
                            />
                        );
                    })}
                    {/* Standalone rooms */}
                    {standaloneRooms.length > 0 && (
                        <View style={floorStyles.standaloneGrid}>
                            {standaloneRooms.map(room => (
                                <RoomCard key={room.id} room={room} onPress={() => { haptic.light(); onOpenRoom(room.id); }} />
                            ))}
                        </View>
                    )}
                    {rooms.length === 0 && groups.length === 0 && (
                        <View style={floorStyles.emptyFloor}>
                            <Text style={floorStyles.emptyFloorText}>NO ROOMS — USE BUTTONS ABOVE</Text>
                        </View>
                    )}
                </View>
            ) : (
                /* Collapsed chips */
                <View style={floorStyles.chipRow}>
                    {groups.map(group => {
                        const gRooms = rooms.filter(r => r.routerGroupId === group.id);
                        const nums = gRooms.map(r => r.roomNumber).sort();
                        const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : (nums[0] ?? group.groupName);
                        const allDone = gRooms.length > 0 && gRooms.every(r => r.status === 'done' || r.status === 'shared');
                        return (
                            <TouchableOpacity key={group.id} style={[floorStyles.chip, { backgroundColor: allDone ? SUCCESS : CARD2, borderColor: allDone ? '#16a34a' : BORDER_L }]} onPress={() => onOpenGroup(group.id)}>
                                <Text style={[floorStyles.chipNum, { color: allDone ? '#000' : TEXT }]}>{label}</Text>
                                <Text style={[floorStyles.chipSub, { color: allDone ? '#166534' : MUTED }]}>{group.groupName.replace('Router ', 'GRP_')}</Text>
                            </TouchableOpacity>
                        );
                    })}
                    {standaloneRooms.map(room => (
                        <TouchableOpacity key={room.id} style={[floorStyles.chip, { backgroundColor: ROOM_COLORS[room.status], borderColor: room.status === 'pending' ? '#d1d5db' : '#16a34a' }]} onPress={() => onOpenRoom(room.id)}>
                            <Text style={[floorStyles.chipNum, { color: room.status === 'pending' ? '#111827' : '#000' }]}>{room.roomNumber}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
        </View>
    );
}

// ── Router Group Box ──────────────────────────────────────────────────────────
function RouterGroupBox({ group, groupRooms, onOpen }: { group: RouterGroup; groupRooms: PGRoom[]; onOpen: () => void }) {
    const userSuffix = group.username ? `.${group.username.split('.').pop()}` : '';
    return (
        <TouchableOpacity style={floorStyles.groupBox} onPress={onOpen} activeOpacity={0.88}>
            {/* Group header */}
            <View style={floorStyles.groupHeader}>
                <View style={floorStyles.groupTitleRow}>
                    <Ionicons name="wifi-outline" size={16} color={ORANGE} />
                    <Text style={floorStyles.groupName}>{group.groupName.toUpperCase()}</Text>
                </View>
                <Ionicons name="ellipsis-vertical" size={16} color={MUTED} />
            </View>
            {/* Group meta */}
            {(group.ontSerial || group.username) && (
                <Text style={floorStyles.groupMeta}>
                    {group.ontSerial ? `SN: ${group.ontSerial}` : ''}
                    {group.ontSerial && group.username ? '  |  ' : ''}
                    {group.username ? `USER: ${group.username}` : ''}
                </Text>
            )}
            {/* Room chips inside group */}
            {groupRooms.length > 0 ? (
                <View style={floorStyles.groupRoomRow}>
                    {groupRooms.map(room => (
                        <View key={room.id} style={[floorStyles.groupRoomChip, { backgroundColor: ROOM_COLORS[room.status] }]}>
                            <Text style={floorStyles.groupRoomNum}>{room.roomNumber}</Text>
                            {userSuffix ? <Text style={floorStyles.groupRoomSuffix}>{userSuffix}</Text> : null}
                        </View>
                    ))}
                </View>
            ) : (
                <Text style={floorStyles.groupNoRooms}>No rooms linked — tap to manage</Text>
            )}
        </TouchableOpacity>
    );
}

// ── Room Card (standalone) ────────────────────────────────────────────────────
function RoomCard({ room, onPress }: { room: PGRoom; onPress: () => void }) {
    const isDone = room.status === 'done' || room.status === 'shared';
    return (
        <TouchableOpacity style={[floorStyles.roomCard, isDone && floorStyles.roomCardDone]} onPress={onPress} activeOpacity={0.85}>
            <TouchableOpacity style={floorStyles.roomMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={onPress}>
                <Ionicons name="ellipsis-horizontal" size={16} color={isDone ? '#16a34a' : '#9ca3af'} />
            </TouchableOpacity>
            <Text style={[floorStyles.roomNum, { color: isDone ? '#000' : '#111827' }]}>{room.roomNumber}</Text>
            <Text style={[floorStyles.roomStatus, { color: isDone ? '#166534' : '#6b7280' }]}>
                {room.status.toUpperCase()}
            </Text>
        </TouchableOpacity>
    );
}

// ── Industrial Bottom Sheet Modal ─────────────────────────────────────────────
function IndustrialModal({ visible, title, onClose, onConfirm, confirmLabel, children }: {
    visible: boolean; title: string;
    onClose: () => void; onConfirm: () => void;
    confirmLabel: string; children: React.ReactNode;
}) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView style={modalStyles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
                <View style={modalStyles.sheet}>
                    <View style={modalStyles.handle} />
                    <Text style={modalStyles.title}>{title}</Text>
                    <View style={{ gap: 12, marginTop: 8 }}>{children}</View>
                    <View style={modalStyles.actions}>
                        <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}><Text style={modalStyles.cancelText}>CANCEL</Text></TouchableOpacity>
                        <TouchableOpacity style={modalStyles.confirmBtn} onPress={onConfirm}><Text style={modalStyles.confirmText}>{confirmLabel}</Text></TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: 60, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: BORDER_L, backgroundColor: '#0a0f1a',
    },
    backBtn: { width: 40, height: 40, borderWidth: 2, borderColor: BORDER_L, alignItems: 'center', justifyContent: 'center', ...SHADOW },
    headerTitle: { color: ORANGE, fontSize: 15, fontWeight: '900', letterSpacing: 2 },
    personBtn: { width: 40, height: 40, borderWidth: 2, borderColor: BORDER_L, alignItems: 'center', justifyContent: 'center' },
    deleteBtn: { width: 40, height: 40, borderWidth: 2, borderColor: '#ef444430', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ef444410' },
    contextHeader: { backgroundColor: SALMON, borderBottomWidth: 2, borderBottomColor: BORDER, padding: 16, gap: 4 },
    contextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    ctxBuilding: { color: '#1a0a00', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
    contextInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    ctxInfo: { color: '#5a2a00', fontSize: 11, fontWeight: '700' },
    ctxStatBox: {
        alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 2, borderColor: BORDER,
        paddingHorizontal: 12, paddingVertical: 6, marginTop: 10,
    },
    ctxStatText: { color: ORANGE, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
    gridLabelRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: BORDER_L,
    },
    gridLabel: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 12, height: 12 },
    legendText: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    emptyFloors: { alignItems: 'center', paddingVertical: 40, gap: 12 },
    addFloorBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        margin: 16, borderWidth: 2, borderColor: ORANGE, borderStyle: 'dashed',
        paddingVertical: 14, backgroundColor: 'transparent',
    },
    addFloorBtnText: { color: ORANGE, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
    modalLabel: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
    modalInput: {
        backgroundColor: BG, borderWidth: 2, borderColor: BORDER_L,
        color: TEXT, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontWeight: '700',
    },
});

const floorStyles = StyleSheet.create({
    section: { marginHorizontal: 12, marginTop: 12, borderWidth: 2, borderColor: BORDER_L },
    header: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: CARD, borderBottomWidth: 2, borderBottomColor: BORDER_L,
        paddingLeft: 4, paddingRight: 8, paddingVertical: 6,
    },
    chevron: { padding: 4 },
    label: { color: ORANGE, fontSize: 12, fontWeight: '900', letterSpacing: 1.5, flex: 1 },
    hdrBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        backgroundColor: ORANGE, borderWidth: 2, borderColor: BORDER,
        paddingHorizontal: 8, paddingVertical: 5, marginLeft: 4,
    },
    roomCount: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginHorizontal: 6 },
    body: { backgroundColor: BG, padding: 10, gap: 10 },

    // Router group box
    groupBox: {
        borderWidth: 2, borderColor: BORDER_L, backgroundColor: CARD2,
        padding: 10, gap: 6,
    },
    groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    groupName: { color: TEXT, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    groupMeta: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    groupRoomRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    groupRoomChip: {
        paddingHorizontal: 12, paddingVertical: 8, minWidth: 56,
        alignItems: 'center', borderWidth: 2, borderColor: '#16a34a',
    },
    groupRoomNum: { color: '#000', fontSize: 16, fontWeight: '900' },
    groupRoomSuffix: { color: '#166534', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
    groupNoRooms: { color: MUTED, fontSize: 11, fontStyle: 'italic', paddingTop: 4 },

    // Standalone rooms grid
    standaloneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roomCard: {
        width: 100, backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#d1d5db',
        padding: 10, alignItems: 'center', minHeight: 90,
        shadowColor: '#000', shadowOffset: { width: 3, height: 3 }, shadowOpacity: 0.2, shadowRadius: 0,
    },
    roomCardDone: { backgroundColor: SUCCESS, borderColor: '#16a34a' },
    roomMenu: { alignSelf: 'flex-start', marginBottom: 4 },
    roomNum: { fontSize: 26, fontWeight: '900', color: '#111827', letterSpacing: -0.5 },
    roomStatus: { fontSize: 9, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },

    // Collapsed chips
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 10, backgroundColor: BG },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 2, alignItems: 'center', minWidth: 52 },
    chipNum: { fontSize: 13, fontWeight: '900' },
    chipSub: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 },
    emptyFloor: { padding: 16, alignItems: 'center' },
    emptyFloorText: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
});

const modalStyles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: CARD, borderTopWidth: 2, borderTopColor: BORDER_L,
        padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: 8,
    },
    handle: { width: 36, height: 4, backgroundColor: MUTED, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
    title: { color: ORANGE, fontSize: 14, fontWeight: '900', letterSpacing: 2 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
    cancelBtn: { flex: 1, borderWidth: 2, borderColor: BORDER_L, paddingVertical: 12, alignItems: 'center' },
    cancelText: { color: MUTED, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    confirmBtn: { flex: 2, backgroundColor: ORANGE, borderWidth: 2, borderColor: BORDER, paddingVertical: 12, alignItems: 'center' },
    confirmText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
});
