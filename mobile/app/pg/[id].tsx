/**
 * PG Building Detail — /pg/[id]
 * Shows floor sections with router groups and individual rooms.
 * Add floor, add room, add router group — all from this screen.
 */
import React, { useState } from 'react';
import {
    Alert, FlatList, KeyboardAvoidingView, Modal, Platform,
    ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePG, PGRoom, RouterGroup, PGFloor, RoomStatus, ConnectionType } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { useSettings } from '../../context/SettingsContext';
import ModernPGBuilding from '../../components/modern/PGBuilding';

const BG = '#0D1B2A';
const CARD = '#1A2535';
const CARD2 = '#1F2D3D';
const BORDER = '#2A3A4A';
const ORANGE = '#FF6B00';
const TEXT = '#E2E8F0';
const SUB = '#64748B';
const INPUT_BG = '#0F2133';

const STATUS_COLORS: Record<RoomStatus, string> = {
    pending:  '#64748B',
    done:     '#10B981',
    vacant:   '#3B82F6',
    flagged:  '#F59E0B',
    shared:   '#8B5CF6',
};
const STATUS_BG: Record<RoomStatus, string> = {
    pending:  '#64748B22',
    done:     '#10B98122',
    vacant:   '#3B82F622',
    flagged:  '#F59E0B22',
    shared:   '#8B5CF622',
};

export default function BuildingDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { isModernUI } = useSettings();
    const { state, addFloor, deleteFloor, addRoom, addRouterGroup, deleteBuilding, getBuildingStats } = usePG();

    if (isModernUI) return <ModernPGBuilding buildingId={id!} />;

    const building = state.buildings.find(b => b.id === id);
    const floors   = state.floors.filter(f => f.buildingId === id).sort((a, b) => a.floorNumber - b.floorNumber);
    const stats    = building ? getBuildingStats(id!) : null;

    const [showAddFloor, setShowAddFloor]     = useState(false);
    const [floorNumInput, setFloorNumInput]   = useState('');
    const [showAddRoom, setShowAddRoom]       = useState<string | null>(null); // floorId
    const [roomNumInput, setRoomNumInput]     = useState('');
    const [showAddGroup, setShowAddGroup]     = useState<string | null>(null); // floorId
    const [groupNameInput, setGroupNameInput] = useState('');

    if (!building) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: SUB }}>Building not found.</Text>
            </View>
        );
    }

    const handleDeleteBuilding = () => {
        Alert.alert(
            'Delete Building',
            `Delete "${building.name}" and all its floors, rooms, and router groups? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        deleteBuilding(building.id);
                        haptic.light();
                        router.back();
                    },
                },
            ],
        );
    };

    const handleAddFloor = () => {
        const num = parseInt(floorNumInput.trim(), 10);
        if (isNaN(num) || num < 0 || num > 99) {
            Alert.alert('Invalid', 'Enter a floor number between 0 and 99.');
            return;
        }
        if (floors.some(f => f.floorNumber === num)) {
            Alert.alert('Duplicate', `Floor ${num} already exists.`);
            return;
        }
        addFloor(building.id, num);
        haptic.success();
        setShowAddFloor(false);
        setFloorNumInput('');
    };

    const handleAddRoom = (floorId: string) => {
        const num = roomNumInput.trim();
        if (!num) { Alert.alert('Required', 'Enter a room number.'); return; }
        const existingRooms = state.rooms.filter(r => r.floorId === floorId);
        if (existingRooms.some(r => r.roomNumber === num)) {
            Alert.alert('Duplicate', `Room ${num} already exists on this floor.`);
            return;
        }
        const floor = floors.find(f => f.id === floorId)!;
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
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => { haptic.light(); router.back(); }}>
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.buildingName} numberOfLines={1}>{building.name}</Text>
                    <Text style={styles.buildingOwner}>{building.ownerName} · {building.ownerMobile}</Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteBuilding}>
                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
            </View>

            {/* Stats banner */}
            {stats && (
                <View style={styles.statsBanner}>
                    <View style={styles.statsBannerItem}>
                        <Text style={styles.statsBannerNum}>{stats.floors}</Text>
                        <Text style={styles.statsBannerLabel}>FLOORS</Text>
                    </View>
                    <View style={styles.statsBannerDivider} />
                    <View style={styles.statsBannerItem}>
                        <Text style={styles.statsBannerNum}>{stats.total}</Text>
                        <Text style={styles.statsBannerLabel}>ROOMS</Text>
                    </View>
                    <View style={styles.statsBannerDivider} />
                    <View style={styles.statsBannerItem}>
                        <Text style={[styles.statsBannerNum, { color: '#10B981' }]}>{stats.done}</Text>
                        <Text style={styles.statsBannerLabel}>DONE</Text>
                    </View>
                    <View style={styles.statsBannerDivider} />
                    <View style={styles.statsBannerItem}>
                        <Text style={[styles.statsBannerNum, { color: ORANGE }]}>{stats.pending}</Text>
                        <Text style={styles.statsBannerLabel}>PENDING</Text>
                    </View>
                    {stats.flagged > 0 && (
                        <>
                            <View style={styles.statsBannerDivider} />
                            <View style={styles.statsBannerItem}>
                                <Text style={[styles.statsBannerNum, { color: '#F59E0B' }]}>{stats.flagged}</Text>
                                <Text style={styles.statsBannerLabel}>FLAGGED</Text>
                            </View>
                        </>
                    )}
                </View>
            )}

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            >
                {floors.length === 0 && (
                    <View style={styles.emptyFloors}>
                        <Ionicons name="layers-outline" size={44} color={BORDER} />
                        <Text style={{ color: SUB, fontSize: 14, textAlign: 'center' }}>
                            No floors added yet.{'\n'}Tap ADD FLOOR to get started.
                        </Text>
                    </View>
                )}

                {floors.map(floor => (
                    <FloorSection
                        key={floor.id}
                        floor={floor}
                        rooms={state.rooms.filter(r => r.floorId === floor.id)}
                        groups={state.routerGroups.filter(g => g.floorId === floor.id)}
                        buildingId={building.id}
                        onOpenRoom={roomId => router.push({ pathname: '/pg/room', params: { roomId, buildingId: building.id } } as any)}
                        onOpenGroup={groupId => router.push({ pathname: '/pg/router-group', params: { groupId, buildingId: building.id } } as any)}
                        onAddRoom={() => { setRoomNumInput(''); setShowAddRoom(floor.id); }}
                        onAddGroup={() => { setGroupNameInput(''); setShowAddGroup(floor.id); }}
                        onDeleteFloor={() => {
                            Alert.alert('Delete Floor', `Delete Floor ${floor.floorNumber} and all its rooms?`, [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: () => { haptic.light(); deleteFloor(floor.id); } },
                            ]);
                        }}
                    />
                ))}

                {/* Add Floor Button */}
                <TouchableOpacity
                    style={styles.addFloorBtn}
                    onPress={() => { haptic.light(); setFloorNumInput(`${floors.length}`); setShowAddFloor(true); }}
                >
                    <Ionicons name="add-circle" size={20} color={ORANGE} />
                    <Text style={styles.addFloorBtnText}>ADD FLOOR</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Add Floor Modal */}
            <SimpleModal
                visible={showAddFloor}
                title="ADD NEW FLOOR"
                onClose={() => setShowAddFloor(false)}
                onConfirm={handleAddFloor}
                confirmLabel="CONFIRM ADDITION"
            >
                <Text style={styles.modalFieldLabel}>FLOOR NUMBER</Text>
                <TextInput
                    style={styles.modalInput}
                    value={floorNumInput}
                    onChangeText={setFloorNumInput}
                    placeholder="e.g. 1, 2, 3 (0 = Ground)"
                    placeholderTextColor={SUB}
                    keyboardType="number-pad"
                    autoFocus
                />
            </SimpleModal>

            {/* Add Room Modal */}
            <SimpleModal
                visible={!!showAddRoom}
                title="ADD NEW ROOM"
                onClose={() => setShowAddRoom(null)}
                onConfirm={() => showAddRoom && handleAddRoom(showAddRoom)}
                confirmLabel="ADD ROOM"
            >
                <Text style={styles.modalFieldLabel}>ROOM NUMBER</Text>
                <TextInput
                    style={styles.modalInput}
                    value={roomNumInput}
                    onChangeText={setRoomNumInput}
                    placeholder="e.g. 101, 202, G1"
                    placeholderTextColor={SUB}
                    autoCapitalize="characters"
                    autoFocus
                />
            </SimpleModal>

            {/* Add Router Group Modal */}
            <SimpleModal
                visible={!!showAddGroup}
                title="ADD ROUTER GROUP"
                onClose={() => setShowAddGroup(null)}
                onConfirm={() => showAddGroup && handleAddGroup(showAddGroup)}
                confirmLabel="CREATE GROUP"
            >
                <Text style={styles.modalFieldLabel}>GROUP NAME (optional)</Text>
                <TextInput
                    style={styles.modalInput}
                    value={groupNameInput}
                    onChangeText={setGroupNameInput}
                    placeholder="e.g. Router 1, East Wing Router"
                    placeholderTextColor={SUB}
                    autoFocus
                />
            </SimpleModal>
        </View>
    );
}

// ---------------------------------------------------------------------------
// Floor Section
// ---------------------------------------------------------------------------

function FloorSection({
    floor, rooms, groups, buildingId,
    onOpenRoom, onOpenGroup, onAddRoom, onAddGroup, onDeleteFloor,
}: {
    floor: PGFloor;
    rooms: PGRoom[];
    groups: RouterGroup[];
    buildingId: string;
    onOpenRoom: (id: string) => void;
    onOpenGroup: (id: string) => void;
    onAddRoom: () => void;
    onAddGroup: () => void;
    onDeleteFloor: () => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const floorLabel = floor.floorNumber === 0 ? 'GROUND FLOOR' : `FLOOR_${String(floor.floorNumber).padStart(2, '0')}`;

    return (
        <View style={styles.floorSection}>
            {/* Floor header */}
            <TouchableOpacity
                style={styles.floorHeader}
                onPress={() => { haptic.light(); setExpanded(!expanded); }}
                activeOpacity={0.8}
            >
                <View style={styles.floorHeaderLeft}>
                    <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color={ORANGE} />
                    <Text style={styles.floorLabel}>{floorLabel}</Text>
                    <View style={styles.floorRoomCount}>
                        <Text style={styles.floorRoomCountText}>
                            {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
                        </Text>
                    </View>
                </View>
                <TouchableOpacity onPress={onDeleteFloor} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={15} color="#64748B" />
                </TouchableOpacity>
            </TouchableOpacity>

            {expanded && (
                <View style={styles.floorBody}>
                    {/* Router Groups */}
                    {groups.map(group => (
                        <TouchableOpacity
                            key={group.id}
                            style={styles.groupCard}
                            onPress={() => { haptic.light(); onOpenGroup(group.id); }}
                            activeOpacity={0.8}
                        >
                            <View style={styles.groupCardLeft}>
                                <View style={styles.groupIcon}>
                                    <Ionicons name="wifi" size={14} color="#3B82F6" />
                                </View>
                                <View>
                                    <Text style={styles.groupName}>{group.groupName}</Text>
                                    <Text style={styles.groupMeta}>
                                        {group.roomIds.length} {group.roomIds.length === 1 ? 'room' : 'rooms'} linked
                                        {group.macAddress ? ` · ${group.macAddress}` : ''}
                                    </Text>
                                </View>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={BORDER} />
                        </TouchableOpacity>
                    ))}

                    {/* Room grid */}
                    <View style={styles.roomGrid}>
                        {rooms.map(room => (
                            <RoomCell key={room.id} room={room} onPress={() => { haptic.light(); onOpenRoom(room.id); }} />
                        ))}
                    </View>

                    {/* Floor actions */}
                    <View style={styles.floorActions}>
                        <TouchableOpacity style={styles.floorActionBtn} onPress={onAddRoom}>
                            <Ionicons name="add" size={14} color={ORANGE} />
                            <Text style={[styles.floorActionText, { color: ORANGE }]}>ADD ROOM</Text>
                        </TouchableOpacity>
                        <View style={styles.floorActionDivider} />
                        <TouchableOpacity style={styles.floorActionBtn} onPress={onAddGroup}>
                            <Ionicons name="wifi" size={14} color="#3B82F6" />
                            <Text style={[styles.floorActionText, { color: '#3B82F6' }]}>ADD ROUTER GROUP</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
}

function RoomCell({ room, onPress }: { room: PGRoom; onPress: () => void }) {
    const color = STATUS_COLORS[room.status];
    const bg    = STATUS_BG[room.status];
    const isGrouped = room.connectionType === 'router_group' || room.connectionType === 'linked_room';

    return (
        <TouchableOpacity style={[styles.roomCell, { borderColor: color, backgroundColor: bg }]} onPress={onPress} activeOpacity={0.8}>
            <Text style={[styles.roomNum, { color }]}>{room.roomNumber}</Text>
            {isGrouped && <Ionicons name="wifi" size={9} color={color} />}
            {room.username && <Ionicons name="person" size={9} color={color} />}
        </TouchableOpacity>
    );
}

// ---------------------------------------------------------------------------
// Simple Modal
// ---------------------------------------------------------------------------

function SimpleModal({
    visible, title, onClose, onConfirm, confirmLabel, children,
}: {
    visible: boolean;
    title: string;
    onClose: () => void;
    onConfirm: () => void;
    confirmLabel: string;
    children: React.ReactNode;
}) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={styles.modalBackdrop}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
                <View style={styles.modalSheet}>
                    <View style={styles.modalHandle} />
                    <Text style={styles.modalTitle}>{title}</Text>
                    <View style={{ gap: 12, marginTop: 8 }}>{children}</View>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.modalCancelBtn} onPress={onClose}>
                            <Text style={styles.modalCancelText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.modalConfirmBtn} onPress={onConfirm}>
                            <Text style={styles.modalConfirmText}>{confirmLabel}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container:   { flex: 1, backgroundColor: BG },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
        gap: 10, borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 8, backgroundColor: CARD,
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER,
    },
    buildingName:  { color: TEXT, fontSize: 17, fontWeight: '800' },
    buildingOwner: { color: SUB, fontSize: 12, marginTop: 1 },
    deleteBtn: {
        width: 36, height: 36, borderRadius: 8, backgroundColor: '#EF444415',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EF444430',
    },
    statsBanner: {
        flexDirection: 'row', backgroundColor: CARD,
        paddingVertical: 12, paddingHorizontal: 8,
        borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    statsBannerItem: { flex: 1, alignItems: 'center', gap: 2 },
    statsBannerNum:  { color: TEXT, fontSize: 20, fontWeight: '800' },
    statsBannerLabel: { color: SUB, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
    statsBannerDivider: { width: 1, backgroundColor: BORDER, marginVertical: 4 },
    emptyFloors: { alignItems: 'center', paddingVertical: 60, gap: 12 },
    floorSection: {
        backgroundColor: CARD, borderRadius: 12,
        borderWidth: 1, borderColor: BORDER, marginBottom: 12, overflow: 'hidden',
    },
    floorHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 14, paddingVertical: 12,
        backgroundColor: CARD2,
    },
    floorHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    floorLabel: { color: TEXT, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
    floorRoomCount: {
        backgroundColor: ORANGE + '22', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2,
    },
    floorRoomCountText: { color: ORANGE, fontSize: 11, fontWeight: '700' },
    floorBody: { padding: 12, gap: 10 },
    groupCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: '#1D3A5A', borderRadius: 8, borderWidth: 1, borderColor: '#3B82F640',
        paddingHorizontal: 12, paddingVertical: 10,
    },
    groupCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    groupIcon: {
        width: 30, height: 30, borderRadius: 6, backgroundColor: '#3B82F622',
        alignItems: 'center', justifyContent: 'center',
    },
    groupName: { color: TEXT, fontSize: 13, fontWeight: '700' },
    groupMeta: { color: '#3B82F6', fontSize: 11, marginTop: 1 },
    roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roomCell: {
        width: 64, height: 56, borderRadius: 8, borderWidth: 1.5,
        alignItems: 'center', justifyContent: 'center', gap: 2,
    },
    roomNum: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
    floorActions: {
        flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4,
    },
    floorActionBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10,
    },
    floorActionText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    floorActionDivider: { width: 1, backgroundColor: BORDER },
    addFloorBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, paddingVertical: 14, borderRadius: 10,
        borderWidth: 1.5, borderColor: ORANGE + '55', borderStyle: 'dashed',
        backgroundColor: ORANGE + '08', marginTop: 4,
    },
    addFloorBtnText: { color: ORANGE, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: {
        backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 20, paddingBottom: 36, gap: 4,
    },
    modalHandle: {
        width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER,
        alignSelf: 'center', marginBottom: 12,
    },
    modalTitle: { color: TEXT, fontSize: 16, fontWeight: '800', letterSpacing: 1 },
    modalFieldLabel: { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
    modalInput: {
        backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        color: TEXT, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16,
    },
    modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
    modalCancelBtn: {
        flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 8,
        borderWidth: 1, borderColor: BORDER,
    },
    modalCancelText: { color: SUB, fontWeight: '700' },
    modalConfirmBtn: {
        flex: 2, alignItems: 'center', paddingVertical: 12, borderRadius: 8,
        backgroundColor: ORANGE,
    },
    modalConfirmText: { color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
});
