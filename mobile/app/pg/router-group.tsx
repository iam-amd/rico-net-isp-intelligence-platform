/**
 * Router Group Detail — /pg/router-group?groupId=xxx&buildingId=xxx
 * Edit group name, serial, MAC, shared username.
 * Link/unlink rooms. Delete group.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert, Image, KeyboardAvoidingView, Modal, Platform,
    ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View, ActivityIndicator, FlatList,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { usePG, RouterGroup, PGRoom } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { useSettings } from '../../context/SettingsContext';
import ModernPGRouterGroup from '../../components/modern/PGRouterGroup';
import { stickerScanResultService } from '../../services/stickerScanResultService';

const BG = '#0D1B2A';
const CARD = '#1A2535';
const CARD2 = '#1F2D3D';
const BORDER = '#2A3A4A';
const BLUE = '#3B82F6';
const ORANGE = '#FF6B00';
const TEXT = '#E2E8F0';
const SUB = '#64748B';
const INPUT_BG = '#0F2133';
const RED = '#EF4444';
const GREEN = '#10B981';

export default function RouterGroupScreen() {
    const { groupId, buildingId } = useLocalSearchParams<{ groupId: string; buildingId: string }>();
    const router = useRouter();
    const { isModernUI } = useSettings();
    const { state, updateRouterGroup, deleteRouterGroup, updateRoom } = usePG();

    if (isModernUI) return <ModernPGRouterGroup groupId={groupId!} buildingId={buildingId!} />;

    const group    = state.routerGroups.find(g => g.id === groupId);
    const building = state.buildings.find(b => b.id === buildingId);
    const floorRooms = group
        ? state.rooms.filter(r => r.floorId === group.floorId)
        : [];
    const linkedRooms = floorRooms.filter(r => group?.roomIds.includes(r.id));
    const unlinkableRooms = floorRooms.filter(r => !group?.roomIds.includes(r.id));

    const [groupName, setGroupName]   = useState(group?.groupName ?? '');
    const [serial, setSerial]         = useState(group?.ontSerial ?? '');
    const [mac, setMac]               = useState(group?.macAddress ?? '');
    const [sharedUser, setSharedUser] = useState(group?.username ?? '');
    const [photoUri, setPhotoUri]     = useState(group?.photoUri ?? '');
    const [saving, setSaving]         = useState(false);
    const [showLinkRoom, setShowLinkRoom] = useState(false);

    useEffect(() => {
        if (!group) return;
        setGroupName(group.groupName);
        setSerial(group.ontSerial ?? '');
        setMac(group.macAddress ?? '');
        setSharedUser(group.username ?? '');
        setPhotoUri(group.photoUri ?? '');
    }, [group?.id]);

    useFocusEffect(
        useCallback(() => {
            (async () => {
                if (!groupId) return;
                const scan = await stickerScanResultService.consumePGGroupResult(groupId);
                if (!scan) return;
                setSerial(scan.gponSn || scan.serialNumber || '');
                setMac(scan.macAddress || '');
                if (scan.photoUrl || scan.photoUri) setPhotoUri(scan.photoUrl || scan.photoUri || '');
                haptic.success();
            })();
        }, [groupId]),
    );

    if (!group || !building) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: SUB }}>Router group not found.</Text>
            </View>
        );
    }

    const handleSave = () => {
        if (!groupName.trim()) { Alert.alert('Required', 'Group name cannot be empty.'); return; }
        setSaving(true);
        try {
            updateRouterGroup({
                ...group,
                groupName: groupName.trim(),
                ontSerial: serial.trim() || undefined,
                macAddress: mac.trim() || undefined,
                username: sharedUser.trim() || undefined,
                photoUri: photoUri || undefined,
                synced: false,
            });
            haptic.success();
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteGroup = () => {
        Alert.alert(
            'Delete Router Group',
            `Delete "${group.groupName}"? Linked rooms will revert to individual (pending).`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        haptic.light();
                        deleteRouterGroup(group.id);
                        router.back();
                    },
                },
            ],
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

    const pickPhoto = async () => {
        Alert.alert('Router Photo', 'Choose source', [
            {
                text: 'Camera',
                onPress: async () => {
                    await ImagePicker.requestCameraPermissionsAsync();
                    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
                    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
                },
            },
            {
                text: 'Gallery',
                onPress: async () => {
                    await ImagePicker.requestMediaLibraryPermissionsAsync();
                    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
                    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
                },
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: BG }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => { haptic.light(); router.back(); }}>
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <View style={styles.headerIcon}>
                    <Ionicons name="wifi" size={18} color={BLUE} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>{group.groupName}</Text>
                    <Text style={styles.headerSub}>{building.name} · Router Group</Text>
                </View>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 16 }}
                keyboardShouldPersistTaps="handled"
            >
                {/* Group Name */}
                <View>
                    <Text style={styles.fieldLabel}>GROUP NAME</Text>
                    <View style={styles.inlineEdit}>
                        <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={groupName}
                            onChangeText={setGroupName}
                            placeholder="e.g. Router 1, East Wing Router"
                            placeholderTextColor={SUB}
                        />
                        <TouchableOpacity
                            style={[styles.saveInlineBtn, saving && { opacity: 0.7 }]}
                            onPress={handleSave}
                            disabled={saving}
                        >
                            {saving
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Text style={styles.saveInlineBtnText}>SAVE</Text>
                            }
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Device Info */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>ONT / ROUTER DEVICE</Text>
                    <View style={styles.card}>
                        <DeviceField label="SERIAL NUMBER" value={serial} onChangeText={setSerial} placeholder="Not scanned" />
                        <View style={styles.divider} />
                        <DeviceField label="MAC ADDRESS" value={mac} onChangeText={setMac} placeholder="Not scanned" />
                        <View style={styles.divider} />
                        <DeviceField label="SHARED USERNAME" value={sharedUser} onChangeText={setSharedUser} placeholder="Railwire username" />
                    </View>
                    <TouchableOpacity style={styles.scanBtn} onPress={scanONT}>
                        <Ionicons name="scan-outline" size={15} color={BLUE} />
                        <Text style={styles.scanBtnText}>SCAN ONT STICKER</Text>
                    </TouchableOpacity>
                </View>

                {/* Photo */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>PHOTOS</Text>
                    {photoUri ? (
                        <View style={styles.photoWrap}>
                            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                            <View style={styles.photoActions}>
                                <TouchableOpacity style={styles.photoActionBtn} onPress={pickPhoto}>
                                    <Ionicons name="refresh" size={15} color={TEXT} />
                                    <Text style={styles.photoActionText}>REPLACE</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.photoActionBtn, { borderColor: RED + '55' }]}
                                    onPress={() => setPhotoUri('')}
                                >
                                    <Ionicons name="trash-outline" size={15} color={RED} />
                                    <Text style={[styles.photoActionText, { color: RED }]}>REMOVE</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <TouchableOpacity style={styles.photoEmpty} onPress={pickPhoto}>
                            <Ionicons name="camera-outline" size={28} color={SUB} />
                            <Text style={styles.photoEmptyText}>Tap to capture router photo</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Linked Rooms */}
                <View style={styles.section}>
                    <View style={styles.sectionTitleRow}>
                        <Text style={styles.sectionTitle}>LINKED ROOMS ({linkedRooms.length})</Text>
                        <TouchableOpacity
                            style={styles.linkRoomBtn}
                            onPress={() => setShowLinkRoom(true)}
                        >
                            <Ionicons name="add" size={14} color={BLUE} />
                            <Text style={styles.linkRoomBtnText}>LINK ROOM</Text>
                        </TouchableOpacity>
                    </View>
                    {linkedRooms.length === 0 ? (
                        <Text style={styles.noRooms}>No rooms linked yet.</Text>
                    ) : (
                        <View style={styles.roomChips}>
                            {linkedRooms.map(room => (
                                <View key={room.id} style={styles.roomChip}>
                                    <Text style={styles.roomChipText}>Room {room.roomNumber}</Text>
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

                {/* Actions */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>ACTIONS</Text>
                    <View style={styles.actionsCard}>
                        <TouchableOpacity style={styles.actionRow} onPress={handleSave}>
                            <Ionicons name="create-outline" size={18} color={TEXT} />
                            <Text style={styles.actionText}>Save Changes</Text>
                            <Ionicons name="chevron-forward" size={16} color={SUB} />
                        </TouchableOpacity>
                        <View style={styles.divider} />
                        <TouchableOpacity style={styles.actionRow} onPress={scanONT}>
                            <Ionicons name="scan" size={18} color={BLUE} />
                            <Text style={[styles.actionText, { color: BLUE }]}>Replace Device (Rescan)</Text>
                            <Ionicons name="chevron-forward" size={16} color={SUB} />
                        </TouchableOpacity>
                        <View style={styles.divider} />
                        <TouchableOpacity style={styles.actionRow} onPress={handleDeleteGroup}>
                            <Ionicons name="trash" size={18} color={RED} />
                            <Text style={[styles.actionText, { color: RED }]}>Delete Group</Text>
                            <Ionicons name="chevron-forward" size={16} color={SUB} />
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            {/* Save Footer */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <><Ionicons name="save" size={18} color="#fff" /><Text style={styles.saveBtnText}>SAVE GROUP</Text></>
                    }
                </TouchableOpacity>
            </View>

            {/* Link Room Modal */}
            <Modal visible={showLinkRoom} transparent animationType="slide" onRequestClose={() => setShowLinkRoom(false)}>
                <View style={styles.linkModalBackdrop}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowLinkRoom(false)} />
                    <View style={styles.linkModal}>
                        <View style={styles.linkModalHandle} />
                        <Text style={styles.linkModalTitle}>LINK A ROOM</Text>
                        <Text style={styles.linkModalSub}>Select a room from this floor to add to the group</Text>
                        {unlinkableRooms.length === 0 ? (
                            <Text style={styles.noRooms}>All rooms on this floor are already linked.</Text>
                        ) : (
                            <FlatList
                                data={unlinkableRooms}
                                keyExtractor={r => r.id}
                                style={{ maxHeight: 300 }}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.linkRoomItem}
                                        onPress={() => linkRoom(item.id)}
                                    >
                                        <Text style={styles.linkRoomItemText}>Room {item.roomNumber}</Text>
                                        {item.username && (
                                            <Text style={styles.linkRoomItemSub}>{item.username}</Text>
                                        )}
                                        <Ionicons name="add-circle" size={20} color={GREEN} />
                                    </TouchableOpacity>
                                )}
                            />
                        )}
                        <TouchableOpacity style={styles.linkModalClose} onPress={() => setShowLinkRoom(false)}>
                            <Text style={{ color: SUB, fontWeight: '600' }}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}

function DeviceField({ label, value, onChangeText, placeholder }: {
    label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
}) {
    return (
        <View style={styles.deviceField}>
            <Text style={styles.deviceFieldLabel}>{label}</Text>
            <TextInput
                style={styles.deviceFieldInput}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={SUB}
                autoCapitalize="none"
                autoCorrect={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
        gap: 10, borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 8, backgroundColor: CARD,
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER,
    },
    headerIcon: {
        width: 36, height: 36, borderRadius: 8, backgroundColor: BLUE + '22',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BLUE + '40',
    },
    headerTitle: { color: TEXT, fontSize: 16, fontWeight: '800' },
    headerSub:   { color: SUB, fontSize: 11, marginTop: 1 },
    fieldLabel:  { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
    inlineEdit:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
    input: {
        backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        color: TEXT, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    },
    saveInlineBtn: {
        backgroundColor: ORANGE, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12,
    },
    saveInlineBtnText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
    section:       { gap: 8 },
    sectionTitle:  { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    card: {
        backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    },
    deviceField:      { paddingHorizontal: 14, paddingVertical: 12 },
    deviceFieldLabel: { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
    deviceFieldInput: { color: TEXT, fontSize: 14, padding: 0 },
    divider: { height: 1, backgroundColor: BORDER },
    scanBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: BLUE + '15', borderRadius: 8, borderWidth: 1, borderColor: BLUE + '55',
        paddingHorizontal: 14, paddingVertical: 10,
    },
    scanBtnText: { color: BLUE, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    photoWrap: { gap: 10 },
    photoPreview: { width: '100%', height: 180, borderRadius: 10, backgroundColor: CARD2 },
    photoActions: { flexDirection: 'row', gap: 10 },
    photoActionBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD2,
    },
    photoActionText: { color: TEXT, fontSize: 11, fontWeight: '700' },
    photoEmpty: {
        alignItems: 'center', paddingVertical: 28, backgroundColor: CARD, borderRadius: 10,
        borderWidth: 1.5, borderColor: BORDER, borderStyle: 'dashed', gap: 6,
    },
    photoEmptyText: { color: SUB, fontSize: 12 },
    linkRoomBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: BLUE + '18', borderRadius: 6, borderWidth: 1, borderColor: BLUE + '55',
        paddingHorizontal: 10, paddingVertical: 5,
    },
    linkRoomBtnText: { color: BLUE, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    noRooms:     { color: SUB, fontSize: 13, paddingVertical: 8 },
    roomChips:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roomChip: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: BLUE + '22', borderRadius: 8, borderWidth: 1, borderColor: BLUE + '55',
        paddingHorizontal: 10, paddingVertical: 6,
    },
    roomChipText: { color: BLUE, fontSize: 12, fontWeight: '700' },
    actionsCard: {
        backgroundColor: CARD, borderRadius: 10, borderWidth: 1, borderColor: BORDER, overflow: 'hidden',
    },
    actionRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 14, paddingVertical: 14,
    },
    actionText: { flex: 1, color: TEXT, fontSize: 14, fontWeight: '500' },
    footer: {
        padding: 16, paddingBottom: 28,
        borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG,
    },
    saveBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        backgroundColor: BLUE, borderRadius: 10, paddingVertical: 14,
    },
    saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
    linkModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    linkModal: {
        backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 20, paddingBottom: 36, gap: 8, maxHeight: '55%',
    },
    linkModalHandle: {
        width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER,
        alignSelf: 'center', marginBottom: 8,
    },
    linkModalTitle: { color: TEXT, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
    linkModalSub:   { color: SUB, fontSize: 12 },
    linkRoomItem: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    linkRoomItemText: { flex: 1, color: TEXT, fontSize: 14, fontWeight: '600' },
    linkRoomItemSub:  { color: SUB, fontSize: 11 },
    linkModalClose: {
        alignItems: 'center', paddingVertical: 12, borderRadius: 8,
        borderWidth: 1, borderColor: BORDER, marginTop: 8,
    },
});
