/**
 * Room Collection Form — /pg/room?roomId=xxx&buildingId=xxx
 * Collect: username link, ONT serial/MAC/model, photos, tech notes.
 * All saved to PGContext.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert, Image, KeyboardAvoidingView, Modal,
    ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View, ActivityIndicator, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { usePG, PGRoom, RoomStatus, ConnectionType, ScanRecord } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { CustomerService } from '../../services/customerService';
import { useSettings } from '../../context/SettingsContext';
import ModernPGRoom from '../../components/modern/PGRoom';
import { CONFIG } from '../../constants/config';
import { stickerScanResultService, type StickerScanResult } from '../../services/stickerScanResultService';

const resolveUri = (uri: string) =>
    uri.startsWith('/') ? `${CONFIG.API_BASE_URL}${uri}` : uri;

const isLocalUri = (uri: string) =>
    uri.startsWith('file://') || uri.startsWith('content://');

const BG = '#0D1B2A';
const CARD = '#1A2535';
const BORDER = '#2A3A4A';
const ORANGE = '#FF6B00';
const TEXT = '#E2E8F0';
const SUB = '#64748B';
const INPUT_BG = '#0F2133';
const GREEN = '#10B981';
const RED = '#EF4444';

const STATUS_OPTIONS: { key: RoomStatus; label: string; color: string }[] = [
    { key: 'pending', label: 'Pending',  color: '#64748B' },
    { key: 'done',    label: 'Done',     color: '#10B981' },
    { key: 'vacant',  label: 'Vacant',   color: '#3B82F6' },
    { key: 'flagged', label: 'Flagged',  color: '#F59E0B' },
    { key: 'shared',  label: 'Shared',   color: '#8B5CF6' },
];

export default function RoomScreen() {
    const { roomId, buildingId } = useLocalSearchParams<{ roomId: string; buildingId: string }>();
    const router = useRouter();
    const { isModernUI } = useSettings();
    const { state, updateRoom, deleteRoom, getBuildingFloors } = usePG();

    if (isModernUI) return <ModernPGRoom roomId={roomId!} buildingId={buildingId!} />;

    const room     = state.rooms.find(r => r.id === roomId);
    const building = state.buildings.find(b => b.id === buildingId);
    const floor    = room ? state.floors.find(f => f.id === room.floorId) : null;

    // Editable fields (derived from room)
    const [status, setStatus]               = useState<RoomStatus>(room?.status ?? 'pending');
    const [username, setUsername]           = useState(room?.username ?? '');
    const [ontSerial, setOntSerial]         = useState(room?.ontSerial ?? '');
    const [macAddress, setMacAddress]       = useState(room?.macAddress ?? '');
    const [ontModel, setOntModel]           = useState(room?.ontModel ?? '');
    const [wifiSsid, setWifiSsid]           = useState(room?.wifiSsid ?? '');
    const [wifiSsid5g, setWifiSsid5g]       = useState(room?.wifiSsid5g ?? '');
    const [wifiPassword, setWifiPassword]   = useState(room?.wifiPassword ?? '');
    const [scanHistory, setScanHistory]     = useState<ScanRecord[]>(room?.scanHistory ?? []);
    const [techNote, setTechNote]           = useState(room?.techNote ?? '');
    const [photos, setPhotos]               = useState<string[]>(room?.photos ?? []);

    const [previewUri, setPreviewUri]       = useState<string | null>(null);
    const [ocrScanning, setOcrScanning]     = useState(false);
    const [showScanHistory, setShowScanHistory] = useState(false);

    const [showUserSearch, setShowUserSearch] = useState(false);
    const [userQuery, setUserQuery]           = useState('');
    const [userResults, setUserResults]       = useState<any[]>([]);
    const [searching, setSearching]           = useState(false);
    const [saving, setSaving]                 = useState(false);

    useEffect(() => {
        if (!room) return;
        setStatus(room.status);
        setUsername(room.username ?? '');
        setOntSerial(room.ontSerial ?? '');
        setMacAddress(room.macAddress ?? '');
        setOntModel(room.ontModel ?? '');
        setWifiSsid(room.wifiSsid ?? '');
        setWifiSsid5g(room.wifiSsid5g ?? '');
        setWifiPassword(room.wifiPassword ?? '');
        setScanHistory(room.scanHistory ?? []);
        setTechNote(room.techNote ?? '');
        setPhotos(room.photos ?? []);
    }, [room?.id]);

    const applyStickerScanResult = (scan: StickerScanResult) => {
        const serial = scan.gponSn || scan.serialNumber || '';
        const mac = scan.macAddress || '';
        const extractedModel = scan.model || '';
        const photo = scan.photoUrl || scan.photoUri;
        setOntSerial(serial);
        setMacAddress(mac);
        setOntModel(extractedModel);
        if (photo) {
            setPhotos(prev => prev.includes(photo) ? prev : [...prev, photo]);
        }
        setScanHistory(prev => [...prev, {
            ts: scan.capturedAt,
            mac: mac || undefined,
            serial: serial || undefined,
            model: extractedModel || undefined,
            rawText: scan.rawText || undefined,
            source: scan.source === 'barcode_only' ? 'barcode' : 'ocr',
        }]);
        haptic.success();
    };

    useFocusEffect(
        useCallback(() => {
            (async () => {
                if (roomId) {
                    const stickerScan = await stickerScanResultService.consumePGRoomResult(roomId, 'ont');
                    if (stickerScan) {
                        applyStickerScanResult(stickerScan);
                        return;
                    }
                }
                // New smart routing: GPON serial or MAC from barcode scanner
                const serialResult = await AsyncStorage.getItem('pg_serial_result');
                if (serialResult) {
                    setOntSerial(serialResult);
                    await AsyncStorage.removeItem('pg_serial_result');
                    await AsyncStorage.removeItem('pg_scan_result');
                    setScanHistory(prev => [...prev, { ts: new Date().toISOString(), serial: serialResult, source: 'barcode' }]);
                    haptic.success();
                    return;
                }
                const macResult = await AsyncStorage.getItem('pg_mac_result');
                if (macResult) {
                    setMacAddress(macResult);
                    await AsyncStorage.removeItem('pg_mac_result');
                    await AsyncStorage.removeItem('pg_scan_result');
                    setScanHistory(prev => [...prev, { ts: new Date().toISOString(), mac: macResult, source: 'barcode' }]);
                    haptic.success();
                    return;
                }
                // Legacy key fallback
                const legacy = await AsyncStorage.getItem('pg_scan_result');
                if (legacy) {
                    setMacAddress(legacy);
                    await AsyncStorage.removeItem('pg_scan_result');
                    haptic.success();
                }
            })();
        }, [])
    );

    if (!room || !building) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: SUB }}>Room not found.</Text>
            </View>
        );
    }

    const floorLabel = floor
        ? (floor.floorNumber === 0 ? 'Ground Floor' : `Floor ${floor.floorNumber}`)
        : '';

    const searchUsers = async (q: string) => {
        if (!q.trim() || q.trim().length < 2) { setUserResults([]); return; }
        setSearching(true);
        try {
            const items = await CustomerService.search(q.trim(), 20);
            setUserResults(items);
        } catch {
            setUserResults([]);
        } finally {
            setSearching(false);
        }
    };

    const addPhoto = async () => {
        Alert.alert('Add Photo', 'Choose source', [
            {
                text: 'Camera',
                onPress: async () => {
                    await ImagePicker.requestCameraPermissionsAsync();
                    const result = await ImagePicker.launchCameraAsync({
                        mediaTypes: ['images'], quality: 0.7,
                    });
                    if (!result.canceled && result.assets[0]) {
                        setPhotos(prev => [...prev, result.assets[0].uri]);
                    }
                },
            },
            {
                text: 'Gallery',
                onPress: async () => {
                    await ImagePicker.requestMediaLibraryPermissionsAsync();
                    const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true,
                    });
                    if (!result.canceled) {
                        setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)]);
                    }
                },
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    const scanONT = () => {
        router.push({
            pathname: '/scan-onu',
            params: {
                customerUsername: '__pg__',
                customerName: `Room ${room.roomNumber}`,
                mode: 'pg_room',
                roomId: room.id,
                stickerType: 'ont',
            },
        } as any);
    };

    const handleSave = () => {
        setSaving(true);
        try {
            // Preserve router_group / linked_room connection type if already set
            const isGrouped = room.connectionType === 'router_group' || room.connectionType === 'linked_room';
            const newConnectionType: ConnectionType = isGrouped
                ? room.connectionType
                : username.trim() ? 'individual' : 'none';

            updateRoom({
                ...room,
                status,
                username: username.trim() || undefined,
                ontSerial: ontSerial.trim() || undefined,
                macAddress: macAddress.trim() || undefined,
                ontModel: ontModel.trim() || undefined,
                wifiSsid: wifiSsid.trim() || undefined,
                wifiSsid5g: wifiSsid5g.trim() || undefined,
                wifiPassword: wifiPassword.trim() || undefined,
                scanHistory: scanHistory.length > 0 ? scanHistory : undefined,
                techNote: techNote.trim() || undefined,
                photos,
                collectedAt: status === 'done' || status === 'shared' ? new Date().toISOString() : room.collectedAt,
                connectionType: newConnectionType,
                synced: false,
            });
            haptic.success();
            router.back();
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        Alert.alert('Delete Room', `Delete Room ${room.roomNumber}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { haptic.light(); deleteRoom(room.id); router.back(); } },
        ]);
    };

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: BG }}
            behavior="padding"
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => { haptic.light(); router.back(); }}>
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>
                        {floorLabel} — ROOM {room.roomNumber}
                    </Text>
                    <Text style={styles.headerSub}>{building.name}</Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                    <Ionicons name="trash-outline" size={16} color={RED} />
                </TouchableOpacity>
            </View>

            {/* Status Banner */}
            <View style={[styles.statusBanner, { backgroundColor: STATUS_OPTIONS.find(s => s.key === status)?.color + '22' }]}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_OPTIONS.find(s => s.key === status)?.color }]} />
                <Text style={[styles.statusBannerText, { color: STATUS_OPTIONS.find(s => s.key === status)?.color }]}>
                    {status.toUpperCase()} COLLECTION
                </Text>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 16 }}
                keyboardShouldPersistTaps="handled"
            >
                {/* Status Picker */}
                <View>
                    <Text style={styles.sectionLabel}>ROOM STATUS</Text>
                    <View style={styles.statusRow}>
                        {STATUS_OPTIONS.map(s => (
                            <TouchableOpacity
                                key={s.key}
                                style={[
                                    styles.statusBtn,
                                    { borderColor: s.color + '55' },
                                    status === s.key && { backgroundColor: s.color + '22', borderColor: s.color },
                                ]}
                                onPress={() => { haptic.light(); setStatus(s.key); }}
                            >
                                <Text style={[styles.statusBtnText, { color: status === s.key ? s.color : SUB }]}>
                                    {s.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Username Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>USERNAME</Text>
                    {username ? (
                        <View style={styles.linkedUser}>
                            <View style={styles.linkedUserLeft}>
                                <Ionicons name="person-circle" size={24} color={GREEN} />
                                <View>
                                    <Text style={styles.linkedUserName}>{username}</Text>
                                    <Text style={styles.linkedUserSub}>Linked subscriber</Text>
                                </View>
                            </View>
                            <TouchableOpacity onPress={() => setUsername('')}>
                                <Ionicons name="close-circle" size={20} color={RED} />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.notLinked}>
                            <View style={styles.notLinkedLeft}>
                                <Ionicons name="person-outline" size={20} color={SUB} />
                                <Text style={styles.notLinkedText}>NOT LINKED</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.searchLinkBtn}
                                onPress={() => { setUserQuery(''); setUserResults([]); setShowUserSearch(true); }}
                            >
                                <Ionicons name="search" size={14} color={ORANGE} />
                                <Text style={styles.searchLinkBtnText}>SEARCH & LINK USERNAME</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                {/* ONT Device Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>ONT DEVICE</Text>
                    <View style={styles.ontGrid}>
                        <OntField label="SERIAL / GPON SN" value={ontSerial} onChangeText={setOntSerial} placeholder="e.g. GPON00D236B2" />
                        <OntField label="MAC ADDRESS (EPON)" value={macAddress} onChangeText={setMacAddress} placeholder="xx:xx:xx:xx:xx:xx" />
                        <OntField label="ONT MODEL" value={ontModel} onChangeText={setOntModel} placeholder="e.g. HG323DAC" />
                    </View>

                    {/* Scan buttons */}
                    <View style={{ gap: 8, marginTop: 8 }}>
                        <TouchableOpacity
                            style={[styles.scanBtn, { backgroundColor: ORANGE + '22', borderColor: ORANGE + '80' }]}
                            onPress={scanONT}
                            disabled={ocrScanning}
                        >
                            {ocrScanning ? (
                                <ActivityIndicator size="small" color={ORANGE} />
                            ) : (
                                <Ionicons name="camera-outline" size={16} color={ORANGE} />
                            )}
                            <Text style={styles.scanBtnText}>
                                {ocrScanning ? 'READING STICKER...' : 'SCAN STICKER'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* Scan history */}
                    {scanHistory.length > 0 && (
                        <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}
                            onPress={() => setShowScanHistory(!showScanHistory)}
                        >
                            <Ionicons name="time-outline" size={13} color={SUB} />
                            <Text style={{ color: SUB, fontSize: 11, fontWeight: '600' }}>
                                {scanHistory.length} scan{scanHistory.length > 1 ? 's' : ''} recorded
                            </Text>
                            <Ionicons name={showScanHistory ? 'chevron-up' : 'chevron-down'} size={12} color={SUB} />
                        </TouchableOpacity>
                    )}
                    {showScanHistory && (
                        <View style={{ backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER, padding: 10, gap: 6, marginTop: 4 }}>
                            {[...scanHistory].reverse().map((s, i) => (
                                <View key={i} style={{ gap: 2 }}>
                                    <Text style={{ color: SUB, fontSize: 10, fontWeight: '700' }}>
                                        {new Date(s.ts).toLocaleString()} · {s.source.toUpperCase()}
                                    </Text>
                                    {s.serial && <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'monospace' }}>SN: {s.serial}</Text>}
                                    {s.mac    && <Text style={{ color: TEXT, fontSize: 11, fontFamily: 'monospace' }}>MAC: {s.mac}</Text>}
                                    {s.model  && <Text style={{ color: SUB, fontSize: 11 }}>Model: {s.model}</Text>}
                                </View>
                            ))}
                        </View>
                    )}
                </View>

                {/* WiFi Credentials Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>WIFI CREDENTIALS (optional manual)</Text>
                    <View style={styles.ontGrid}>
                        <OntField label="WIFI SSID (2.4G)" value={wifiSsid} onChangeText={setWifiSsid} placeholder="e.g. RoomWifi_2.4G" />
                        <OntField label="WIFI SSID (5G)"   value={wifiSsid5g} onChangeText={setWifiSsid5g} placeholder="e.g. RoomWifi_5G" />
                        <OntField label="WIFI PASSWORD"    value={wifiPassword} onChangeText={setWifiPassword} placeholder="WiFi password" />
                    </View>
                </View>

                {/* GPS Status */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>BUILDING GPS</Text>
                    <View style={styles.gpsStatus}>
                        <Ionicons
                            name={building.gpsLat != null ? 'location' : 'location-outline'}
                            size={18}
                            color={building.gpsLat != null ? GREEN : SUB}
                        />
                        <Text style={[styles.gpsStatusText, { color: building.gpsLat != null ? GREEN : SUB }]}>
                            {building.gpsLat != null
                                ? `ON FILE ✓  (${building.gpsLat?.toFixed(4)}, ${building.gpsLng?.toFixed(4)})`
                                : 'Not captured — edit building to add GPS'}
                        </Text>
                    </View>
                </View>

                {/* Photos */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>PHOTOS</Text>
                    <View style={styles.photoGrid}>
                        {photos.map((uri, i) => (
                            <View key={i} style={styles.photoThumb}>
                                {isLocalUri(uri) ? (
                                    <View style={[styles.photoImg, styles.photoBroken]}>
                                        <Ionicons name="image-outline" size={18} color="#475569" />
                                        <Text style={styles.photoBrokenText}>SYNC{'\n'}PENDING</Text>
                                    </View>
                                ) : (
                                    <TouchableOpacity onPress={() => setPreviewUri(resolveUri(uri))} activeOpacity={0.85}>
                                        <Image source={{ uri: resolveUri(uri) }} style={styles.photoImg} />
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={styles.photoRemove}
                                    onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                                >
                                    <Ionicons name="close-circle" size={18} color={RED} />
                                </TouchableOpacity>
                            </View>
                        ))}
                        <TouchableOpacity style={styles.photoAdd} onPress={addPhoto}>
                            <Ionicons name="camera-outline" size={24} color={SUB} />
                            <Text style={styles.photoAddText}>Add Photo</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Technician Notes */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>TECHNICIAN FIELD NOTES</Text>
                    <TextInput
                        style={styles.notesInput}
                        value={techNote}
                        onChangeText={setTechNote}
                        placeholder="Observations, issues, follow-up required…"
                        placeholderTextColor={SUB}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                    />
                </View>
            </ScrollView>

            {/* Save Footer */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    <Ionicons name={status === 'done' || status === 'shared' ? 'checkmark-circle' : 'save'} size={18} color="#fff" />
                    <Text style={styles.saveBtnText}>
                        {status === 'done' || status === 'shared' ? 'SAVE & MARK COMPLETE' : 'SAVE COLLECTION'}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Photo Preview Modal */}
            <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
                <TouchableOpacity style={styles.previewBackdrop} onPress={() => setPreviewUri(null)} activeOpacity={1}>
                    {previewUri && (
                        <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
                    )}
                    <View style={styles.previewClose}>
                        <Ionicons name="close-circle" size={36} color="#fff" />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Username Search Modal */}
            <Modal visible={showUserSearch} transparent animationType="slide" onRequestClose={() => setShowUserSearch(false)}>
                <KeyboardAvoidingView
                    style={styles.searchModalBackdrop}
                    behavior="padding"
                >
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowUserSearch(false)} />
                    <View style={styles.searchModal}>
                        <View style={styles.searchModalHandle} />
                        <Text style={styles.searchModalTitle}>LINK USERNAME</Text>
                        <View style={styles.searchModalBox}>
                            <Ionicons name="search" size={16} color={SUB} />
                            <TextInput
                                style={styles.searchModalInput}
                                value={userQuery}
                                onChangeText={q => { setUserQuery(q); searchUsers(q); }}
                                placeholder="Type username, name, or phone…"
                                placeholderTextColor={SUB}
                                autoFocus
                                autoCorrect={false}
                                autoCapitalize="none"
                            />
                            {searching && <ActivityIndicator size="small" color={ORANGE} />}
                        </View>
                        <FlatList
                            data={userResults}
                            keyExtractor={u => u.username}
                            style={{ maxHeight: 300 }}
                            ListEmptyComponent={
                                !searching && userQuery.length >= 2 ? (
                                    <Text style={styles.searchEmpty}>No customers found</Text>
                                ) : null
                            }
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.searchResult}
                                    onPress={() => {
                                        haptic.light();
                                        setUsername(item.username);
                                        setShowUserSearch(false);
                                    }}
                                >
                                    <View style={styles.searchResultLeft}>
                                        <Ionicons name="person-circle-outline" size={20} color={ORANGE} />
                                        <View>
                                            <Text style={styles.searchResultName}>
                                                {[item.first_name, item.last_name].filter(Boolean).join(' ') || item.username}
                                            </Text>
                                            <Text style={styles.searchResultSub}>{item.username} · {item.phone || '—'}</Text>
                                        </View>
                                    </View>
                                    <Ionicons name="link" size={16} color={GREEN} />
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </KeyboardAvoidingView>
    );
}

function OntField({ label, value, onChangeText, placeholder }: {
    label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
}) {
    return (
        <View style={{ gap: 4 }}>
            <Text style={styles.ontFieldLabel}>{label}</Text>
            <TextInput
                style={styles.ontInput}
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
    headerTitle: { color: TEXT, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
    headerSub:   { color: SUB, fontSize: 11, marginTop: 1 },
    deleteBtn: {
        width: 36, height: 36, borderRadius: 8, backgroundColor: RED + '15',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: RED + '30',
    },
    statusBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 16, paddingVertical: 10,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusBannerText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
    sectionLabel: { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
    section: { gap: 8 },
    statusRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    statusBtn: {
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
        borderWidth: 1, borderColor: BORDER,
    },
    statusBtnText: { fontSize: 12, fontWeight: '700' },
    linkedUser: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: GREEN + '15', borderRadius: 8, borderWidth: 1, borderColor: GREEN + '40',
        paddingHorizontal: 12, paddingVertical: 10,
    },
    linkedUserLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    linkedUserName: { color: TEXT, fontSize: 14, fontWeight: '700' },
    linkedUserSub:  { color: GREEN, fontSize: 11 },
    notLinked: {
        backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        paddingHorizontal: 12, paddingVertical: 10, gap: 10,
    },
    notLinkedLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    notLinkedText: { color: SUB, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    searchLinkBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: ORANGE + '18', borderRadius: 8, borderWidth: 1, borderColor: ORANGE + '55',
        paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start',
    },
    searchLinkBtnText: { color: ORANGE, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    ontGrid: { gap: 10 },
    ontFieldLabel: { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
    ontInput: {
        backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        color: TEXT, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13,
    },
    scanBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
        backgroundColor: ORANGE + '15', borderRadius: 8, borderWidth: 1, borderColor: ORANGE + '55',
        paddingHorizontal: 14, paddingVertical: 10,
    },
    scanBtnText: { color: ORANGE, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    gpsStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    gpsStatusText: { fontSize: 13, fontWeight: '600', flex: 1 },
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photoThumb: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden', position: 'relative' },
    photoImg: { width: 80, height: 80 },
    photoBroken: {
        alignItems: 'center', justifyContent: 'center', gap: 2,
        backgroundColor: '#1e293b', borderRadius: 4,
    },
    photoBrokenText: {
        color: '#475569', fontSize: 8, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3,
    },
    photoRemove: { position: 'absolute', top: 2, right: 2 },
    previewBackdrop: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
        alignItems: 'center', justifyContent: 'center',
    },
    previewImage: { width: '100%', height: '80%' },
    previewClose: { position: 'absolute', top: 50, right: 20 },
    photoAdd: {
        width: 80, height: 80, borderRadius: 8, borderWidth: 1.5, borderColor: BORDER,
        borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4,
    },
    photoAddText: { color: SUB, fontSize: 10 },
    notesInput: {
        backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        color: TEXT, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
        minHeight: 100, textAlignVertical: 'top',
    },
    footer: {
        padding: 16, paddingBottom: 28,
        borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG,
    },
    saveBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        backgroundColor: ORANGE, borderRadius: 10, paddingVertical: 14,
    },
    saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
    searchModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    searchModal: {
        backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 20, paddingBottom: 36, gap: 12, maxHeight: '75%',
    },
    searchModalHandle: {
        width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER,
        alignSelf: 'center', marginBottom: 4,
    },
    searchModalTitle: { color: TEXT, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
    searchModalBox: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        paddingHorizontal: 12, paddingVertical: 10,
    },
    searchModalInput: { flex: 1, color: TEXT, fontSize: 14, padding: 0 },
    searchEmpty: { color: SUB, textAlign: 'center', paddingVertical: 20 },
    searchResult: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 12, paddingHorizontal: 4,
        borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    searchResultLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    searchResultName: { color: TEXT, fontSize: 14, fontWeight: '600' },
    searchResultSub:  { color: SUB, fontSize: 11, marginTop: 1 },
});
