/**
 * PGRouterGroup.tsx — Neo-Brutalist / Industrial design system
 * Router group detail: name, ONT device, linked rooms, save/delete.
 * Full business logic identical to simple router-group.tsx.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePG } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { stickerScanResultService } from '../../services/stickerScanResultService';

// ── Design Tokens ────────────────────────────────────────────────────────────
const BG       = '#0F1523';
const CARD     = '#16203D';
const CARD2    = '#1f2947';
const BORDER   = '#0F172A';
const BORDER_L = '#1e293b';
const ORANGE   = '#FF5A00';
const TEXT     = '#ffffff';
const SUB      = '#94a3b8';
const MUTED    = '#64748b';
const SUCCESS  = '#00E676';
const RED      = '#ef4444';
const BLUE     = '#3b82f6';

const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1 as const,
    shadowRadius: 0,
    elevation: 6,
};

// ── Props ─────────────────────────────────────────────────────────────────────
export interface PGRouterGroupProps {
    groupId: string;
    buildingId: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PGRouterGroup({ groupId, buildingId }: PGRouterGroupProps) {
    const router = useRouter();
    const { state, updateRouterGroup, deleteRouterGroup, updateRoom } = usePG();

    const group    = state.routerGroups.find(g => g.id === groupId);
    const building = state.buildings.find(b => b.id === buildingId);
    const floorRooms = group
        ? state.rooms.filter(r => r.floorId === group.floorId)
        : [];
    const linkedRooms   = floorRooms.filter(r => group?.roomIds.includes(r.id));
    const linkableRooms = floorRooms.filter(r => !group?.roomIds.includes(r.id));

    const [groupName, setGroupName]   = useState(group?.groupName ?? '');
    const [serial, setSerial]         = useState(group?.ontSerial ?? '');
    const [mac, setMac]               = useState(group?.macAddress ?? '');
    const [sharedUser, setSharedUser] = useState(group?.username ?? '');
    const [saving, setSaving]         = useState(false);
    const [showLinkRoom, setShowLinkRoom] = useState(false);

    useEffect(() => {
        if (!group) return;
        setGroupName(group.groupName);
        setSerial(group.ontSerial ?? '');
        setMac(group.macAddress ?? '');
        setSharedUser(group.username ?? '');
    }, [group?.id]);

    useFocusEffect(
        useCallback(() => {
            (async () => {
                if (!groupId) return;
                const scan = await stickerScanResultService.consumePGGroupResult(groupId);
                if (!scan) return;
                setSerial(scan.gponSn || scan.serialNumber || '');
                setMac(scan.macAddress || '');
                haptic.success();
            })();
        }, [groupId]),
    );

    if (!group || !building) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: MUTED, fontWeight: '700', letterSpacing: 1 }}>GROUP NOT FOUND</Text>
            </View>
        );
    }

    const handleSave = () => {
        if (!groupName.trim()) { Alert.alert('REQUIRED', 'Group name cannot be empty.'); return; }
        setSaving(true);
        try {
            updateRouterGroup({
                ...group,
                groupName: groupName.trim(),
                ontSerial: serial.trim() || undefined,
                macAddress: mac.trim() || undefined,
                username: sharedUser.trim() || undefined,
                synced: false,
            });
            haptic.success();
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        Alert.alert(
            'DELETE ROUTER GROUP',
            `Delete "${group.groupName}"? Linked rooms will revert to individual (pending).`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'DELETE',
                    style: 'destructive',
                    onPress: () => {
                        haptic.light();
                        deleteRouterGroup(group.id);
                        router.back();
                    },
                },
            ]
        );
    };

    const unlinkRoom = (roomId: string) => {
        const room = state.rooms.find(r => r.id === roomId);
        if (!room) return;
        updateRouterGroup({ ...group, roomIds: group.roomIds.filter(id => id !== roomId), synced: false });
        updateRoom({ ...room, connectionType: 'none', routerGroupId: undefined, synced: false });
        haptic.light();
    };

    const linkRoom = (roomId: string) => {
        if (group.roomIds.includes(roomId)) return;
        const room = state.rooms.find(r => r.id === roomId);
        if (!room) return;
        updateRouterGroup({ ...group, roomIds: [...group.roomIds, roomId], synced: false });
        updateRoom({ ...room, connectionType: 'router_group', routerGroupId: group.id, synced: false });
        haptic.success();
        setShowLinkRoom(false);
    };

    const scanONT = () => {
        router.push({
            pathname: '/scan-onu',
            params: {
                customerUsername: sharedUser || '__pg_router__',
                customerName: groupName,
                mode: 'pg_router_group',
                groupId: group.id,
                stickerType: 'ont',
            },
        } as any);
    };

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: BG }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backBtn}
                    onPress={() => { haptic.light(); router.back(); }}
                >
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>FIELD_OPS_V1</Text>
                <View style={styles.wifiBox}>
                    <Ionicons name="wifi" size={16} color={BLUE} />
                </View>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
            >
                {/* Group Name section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>GROUP NAME</Text>
                    <View style={styles.inlineRow}>
                        <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={groupName}
                            onChangeText={setGroupName}
                            placeholder="e.g. Router 1, East Wing Router"
                            placeholderTextColor={MUTED}
                        />
                        <TouchableOpacity
                            style={[styles.saveInlineBtn, saving && { opacity: 0.7 }]}
                            onPress={handleSave}
                            disabled={saving}
                        >
                            {saving
                                ? <ActivityIndicator size="small" color="#000" />
                                : <Text style={styles.saveInlineBtnText}>SAVE</Text>
                            }
                        </TouchableOpacity>
                    </View>
                </View>

                {/* ONT Device section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>ONT / ROUTER DEVICE</Text>
                    <View style={styles.deviceCard}>
                        <DeviceField label="SERIAL NUMBER" value={serial} onChangeText={setSerial} placeholder="Not scanned" />
                        <View style={styles.divider} />
                        <DeviceField label="MAC ADDRESS" value={mac} onChangeText={setMac} placeholder="Not scanned" />
                        <View style={styles.divider} />
                        <DeviceField label="SHARED USERNAME" value={sharedUser} onChangeText={setSharedUser} placeholder="Railwire username" />
                    </View>
                    <TouchableOpacity style={styles.scanBtn} onPress={scanONT}>
                        <Ionicons name="scan-outline" size={14} color={BLUE} />
                        <Text style={styles.scanBtnText}>SCAN ONT STICKER</Text>
                    </TouchableOpacity>
                </View>

                {/* Linked Rooms section */}
                <View style={styles.section}>
                    <View style={styles.linkedRoomsHeader}>
                        <Text style={styles.sectionLabel}>LINKED ROOMS ({linkedRooms.length})</Text>
                        <TouchableOpacity
                            style={styles.linkRoomBtn}
                            onPress={() => setShowLinkRoom(true)}
                        >
                            <Ionicons name="add" size={14} color={BLUE} />
                            <Text style={styles.linkRoomBtnText}>LINK ROOM</Text>
                        </TouchableOpacity>
                    </View>
                    {linkedRooms.length === 0 ? (
                        <Text style={styles.noRoomsText}>NO ROOMS LINKED YET.</Text>
                    ) : (
                        <View style={styles.roomChips}>
                            {linkedRooms.map(room => (
                                <View key={room.id} style={styles.roomChip}>
                                    <Text style={styles.roomChipText}>ROOM {room.roomNumber}</Text>
                                    <TouchableOpacity
                                        onPress={() => unlinkRoom(room.id)}
                                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                    >
                                        <Ionicons name="close" size={14} color={RED} />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {/* Actions section */}
                <View style={styles.section}>
                    {/* Save Changes */}
                    <TouchableOpacity
                        style={styles.saveBtn}
                        onPress={handleSave}
                        disabled={saving}
                    >
                        {saving
                            ? <ActivityIndicator size="small" color="#000" />
                            : <Text style={styles.saveBtnText}>SAVE CHANGES</Text>
                        }
                    </TouchableOpacity>

                    {/* Delete Group */}
                    <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                        <Text style={styles.deleteBtnText}>DELETE GROUP</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            {/* Link Room Modal */}
            <Modal
                visible={showLinkRoom}
                transparent
                animationType="slide"
                onRequestClose={() => setShowLinkRoom(false)}
            >
                <View style={linkModal.backdrop}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowLinkRoom(false)} />
                    <View style={linkModal.sheet}>
                        <View style={linkModal.handle} />
                        <Text style={linkModal.title}>LINK A ROOM</Text>
                        <Text style={linkModal.sub}>
                            SELECT A ROOM FROM THIS FLOOR TO ADD TO THE GROUP
                        </Text>
                        {linkableRooms.length === 0 ? (
                            <Text style={styles.noRoomsText}>
                                ALL ROOMS ON THIS FLOOR ARE ALREADY LINKED.
                            </Text>
                        ) : (
                            <FlatList
                                data={linkableRooms}
                                keyExtractor={r => r.id}
                                style={{ maxHeight: 300 }}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={linkModal.item}
                                        onPress={() => linkRoom(item.id)}
                                    >
                                        <Text style={linkModal.itemText}>ROOM {item.roomNumber}</Text>
                                        {item.username && (
                                            <Text style={linkModal.itemSub}>{item.username}</Text>
                                        )}
                                        <Ionicons name="add-circle" size={20} color={SUCCESS} />
                                    </TouchableOpacity>
                                )}
                            />
                        )}
                        <TouchableOpacity style={linkModal.closeBtn} onPress={() => setShowLinkRoom(false)}>
                            <Text style={linkModal.closeText}>CANCEL</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}

// ── Device Field ──────────────────────────────────────────────────────────────
function DeviceField({ label, value, onChangeText, placeholder }: {
    label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
}) {
    return (
        <View style={deviceFieldStyles.row}>
            <Text style={deviceFieldStyles.label}>{label}</Text>
            <TextInput
                style={deviceFieldStyles.input}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={MUTED}
                autoCapitalize="none"
                autoCorrect={false}
            />
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 64,
        paddingHorizontal: 16,
        borderBottomWidth: 2,
        borderBottomColor: BORDER_L,
        backgroundColor: '#0a0f1a',
    },
    backBtn: {
        width: 40,
        height: 40,
        borderWidth: 2,
        borderColor: BORDER_L,
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOW,
    },
    headerTitle: {
        color: ORANGE,
        fontSize: 15,
        fontWeight: '900',
        letterSpacing: 2,
    },
    wifiBox: {
        width: 40,
        height: 40,
        borderWidth: 2,
        borderColor: BORDER_L,
        alignItems: 'center',
        justifyContent: 'center',
    },

    scroll: { padding: 16, paddingBottom: 80, gap: 16 },

    section: { gap: 10 },

    sectionLabel: {
        color: MUTED,
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 1.5,
    },

    inlineRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },

    input: {
        backgroundColor: BG,
        borderWidth: 2,
        borderColor: BORDER_L,
        color: TEXT,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        fontWeight: '600',
    },

    saveInlineBtn: {
        backgroundColor: ORANGE,
        borderWidth: 2,
        borderColor: BORDER,
        paddingHorizontal: 14,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOW,
    },
    saveInlineBtnText: {
        color: '#000',
        fontWeight: '900',
        fontSize: 12,
        letterSpacing: 1,
    },

    deviceCard: {
        backgroundColor: CARD,
        borderWidth: 2,
        borderColor: BORDER_L,
    },
    divider: { height: 2, backgroundColor: BORDER },

    scanBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: CARD,
        borderWidth: 2,
        borderColor: BLUE,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    scanBtnText: {
        color: BLUE,
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.5,
    },

    linkedRoomsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    linkRoomBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 2,
        borderColor: BLUE,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    linkRoomBtnText: {
        color: BLUE,
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    noRoomsText: {
        color: MUTED,
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.5,
        paddingVertical: 8,
    },
    roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roomChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 2,
        borderColor: BLUE,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    roomChipText: {
        color: BLUE,
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.5,
    },

    saveBtn: {
        backgroundColor: ORANGE,
        borderWidth: 2,
        borderColor: BORDER,
        paddingVertical: 14,
        alignItems: 'center',
        ...SHADOW,
    },
    saveBtnText: {
        color: '#000',
        fontSize: 14,
        fontWeight: '900',
        letterSpacing: 2,
    },
    deleteBtn: {
        backgroundColor: RED,
        borderWidth: 2,
        borderColor: BORDER,
        paddingVertical: 14,
        alignItems: 'center',
        ...SHADOW,
    },
    deleteBtnText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '900',
        letterSpacing: 2,
    },
});

const deviceFieldStyles = StyleSheet.create({
    row: {
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 4,
    },
    label: {
        color: MUTED,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 1,
    },
    input: {
        color: TEXT,
        fontSize: 14,
        fontWeight: '600',
        padding: 0,
    },
});

const linkModal = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: CARD,
        borderTopWidth: 2,
        borderTopColor: BORDER_L,
        padding: 20,
        paddingBottom: 36,
        gap: 8,
        maxHeight: '55%',
    },
    handle: {
        width: 40,
        height: 3,
        backgroundColor: BORDER_L,
        alignSelf: 'center',
        marginBottom: 8,
    },
    title: {
        color: TEXT,
        fontSize: 14,
        fontWeight: '900',
        letterSpacing: 1.5,
    },
    sub: {
        color: MUTED,
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        borderBottomWidth: 2,
        borderBottomColor: BORDER,
    },
    itemText: {
        flex: 1,
        color: TEXT,
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    itemSub: { color: MUTED, fontSize: 11 },
    closeBtn: {
        alignItems: 'center',
        paddingVertical: 12,
        borderWidth: 2,
        borderColor: BORDER_L,
        marginTop: 8,
    },
    closeText: {
        color: MUTED,
        fontWeight: '900',
        letterSpacing: 1,
        fontSize: 12,
    },
});
