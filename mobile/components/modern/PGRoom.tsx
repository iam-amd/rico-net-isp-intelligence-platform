import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    KeyboardAvoidingView,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { usePG, RoomStatus, ConnectionType, DeviceSetup, ScanRecord } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { CustomerService } from '../../services/customerService';
import { CONFIG } from '../../constants/config';
import PGService from '../../services/pgService';
import { stickerScanResultService, type StickerScanResult } from '../../services/stickerScanResultService';

// ── Resolve URIs: backend relative path OR absolute URI
// Local file:// URIs work only in the same session — after restart they're inaccessible.
// resolveUri handles /uploads/... paths from the backend.
const resolveUri = (uri: string) =>
    uri.startsWith('/') ? `${CONFIG.API_BASE_URL}${uri}` : uri;

const isLocalUri = (uri: string) =>
    uri.startsWith('file://') || uri.startsWith('content://');

// ── Design Tokens ─────────────────────────────────────────────────────────────
const BG       = '#0F1523';
const CARD     = '#16203D';
const SECTION  = '#0F172A';
const BORDER   = '#0F172A';
const BORDER_L = '#1e293b';
const ORANGE   = '#FF5A00';
const SALMON   = '#fc895c';
const TEXT     = '#ffffff';
const SUB      = '#94a3b8';
const MUTED    = '#64748b';
const SUCCESS  = '#00E676';
const AMBER    = '#f59e0b';
const RED      = '#ef4444';
const TEAL     = '#06b6d4';

const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1 as const,
    shadowRadius: 0,
    elevation: 6,
};

export interface PGRoomProps {
    roomId: string;
    buildingId: string;
}

export default function PGRoom({ roomId, buildingId }: PGRoomProps) {
    const router = useRouter();
    const { state, updateRoom, deleteRoom, refreshBuildingFromServer } = usePG();

    const room     = state.rooms.find(r => r.id === roomId);
    const building = state.buildings.find(b => b.id === buildingId);
    const floor    = room ? state.floors.find(f => f.id === room.floorId) : null;

    const [editMode, setEditMode]       = useState(() => !room || room.status === 'pending');
    const [status, setStatus]           = useState<RoomStatus>(room?.status ?? 'pending');
    const [deviceSetup, setDeviceSetup] = useState<DeviceSetup>(room?.deviceSetup ?? (room?.routerMacAddress || room?.routerSerial || room?.routerModel ? 'onu_router' : 'single_ont'));
    const [username, setUsername]       = useState(room?.username ?? '');
    const [ontSerial, setOntSerial]     = useState(room?.ontSerial ?? '');
    const [macAddress, setMacAddress]   = useState(room?.macAddress ?? '');
    const [ontModel, setOntModel]       = useState(room?.ontModel ?? '');
    const [ontStickerPhotoUrl, setOntStickerPhotoUrl] = useState(room?.ontStickerPhotoUrl ?? '');
    const [ontStickerData, setOntStickerData] = useState<Record<string, any> | undefined>(room?.ontStickerData);
    const [routerStickerPhotoUrl, setRouterStickerPhotoUrl] = useState(room?.routerStickerPhotoUrl ?? '');
    const [routerMacAddress, setRouterMacAddress] = useState(room?.routerMacAddress ?? '');
    const [routerSerial, setRouterSerial] = useState(room?.routerSerial ?? '');
    const [routerModel, setRouterModel] = useState(room?.routerModel ?? '');
    const [routerStickerData, setRouterStickerData] = useState<Record<string, any> | undefined>(room?.routerStickerData);
    const [wifiSsid, setWifiSsid]       = useState(room?.wifiSsid ?? '');
    const [wifiSsid5g, setWifiSsid5g]   = useState(room?.wifiSsid5g ?? '');
    const [wifiPassword, setWifiPassword] = useState(room?.wifiPassword ?? '');
    const [techNote, setTechNote]       = useState(room?.techNote ?? '');
    const [photos, setPhotos]           = useState<string[]>(room?.photos ?? []);
    const [scanHistory, setScanHistory] = useState<ScanRecord[]>(room?.scanHistory ?? []);
    const [saving, setSaving]           = useState(false);
    const [ocrScanning, setOcrScanning] = useState<'ont' | 'router' | null>(null);
    const [showScanHistory, setShowScanHistory] = useState(false);
    const [showWifiPwd, setShowWifiPwd] = useState(false);
    const [identityMatch, setIdentityMatch] = useState<any | null>(null);
    const [linkConflicts, setLinkConflicts] = useState<any[]>([]);
    const [pendingSave, setPendingSave] = useState<{ room: any; mode: 'normal' | 'move'; conflictText?: string } | null>(null);
    const [showReasonModal, setShowReasonModal] = useState(false);
    const [reasonText, setReasonText] = useState('');

    const [previewUri, setPreviewUri]   = useState<string | null>(null);

    const [showUserSearch, setShowUserSearch] = useState(false);
    const [userQuery, setUserQuery]     = useState('');
    const [userResults, setUserResults] = useState<any[]>([]);
    const [searching, setSearching]     = useState(false);

    useEffect(() => {
        if (!room) return;
        setStatus(room.status);
        setEditMode(!room || room.status === 'pending');
        setDeviceSetup(room.deviceSetup ?? (room.routerMacAddress || room.routerSerial || room.routerModel ? 'onu_router' : 'single_ont'));
        setUsername(room.username ?? '');
        setOntSerial(room.ontSerial ?? '');
        setMacAddress(room.macAddress ?? '');
        setOntModel(room.ontModel ?? '');
        setOntStickerPhotoUrl(room.ontStickerPhotoUrl ?? '');
        setOntStickerData(room.ontStickerData);
        setRouterStickerPhotoUrl(room.routerStickerPhotoUrl ?? '');
        setRouterMacAddress(room.routerMacAddress ?? '');
        setRouterSerial(room.routerSerial ?? '');
        setRouterModel(room.routerModel ?? '');
        setRouterStickerData(room.routerStickerData);
        setWifiSsid(room.wifiSsid ?? '');
        setWifiSsid5g(room.wifiSsid5g ?? '');
        setWifiPassword(room.wifiPassword ?? '');
        setTechNote(room.techNote ?? '');
        setPhotos(room.photos ?? []);
        setScanHistory(room.scanHistory ?? []);
    }, [room?.id]);

    // Read back scan results from barcode scanner (smart GPON/EPON routing)
    useFocusEffect(
        useCallback(() => {
            (async () => {
                if (room?.id) {
                    const [ontScan, routerScan] = await Promise.all([
                        stickerScanResultService.consumePGRoomResult(room.id, 'ont'),
                        stickerScanResultService.consumePGRoomResult(room.id, 'router'),
                    ]);
                    if (ontScan) applyStickerScanResult(ontScan, 'ont');
                    if (routerScan) applyStickerScanResult(routerScan, 'router');
                    if (ontScan || routerScan) return;
                }
                const [serial, mac] = await Promise.all([
                    AsyncStorage.getItem('pg_serial_result'),
                    AsyncStorage.getItem('pg_mac_result'),
                ]);
                if (serial) {
                    setOntSerial(serial.toUpperCase());
                    const record: ScanRecord = {
                        ts: new Date().toISOString(),
                        serial: serial.toUpperCase(),
                        source: 'barcode',
                    };
                    setScanHistory(prev => [record, ...prev]);
                    await AsyncStorage.removeItem('pg_serial_result');
                    haptic.success();
                }
                if (mac) {
                    setMacAddress(mac);
                    const record: ScanRecord = {
                        ts: new Date().toISOString(),
                        mac,
                        source: 'barcode',
                    };
                    setScanHistory(prev => [record, ...prev]);
                    await AsyncStorage.removeItem('pg_mac_result');
                    haptic.success();
                }
            })();
        }, [])
    );

    if (!room || !building) {
        return (
            <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: MUTED, fontWeight: '700', letterSpacing: 1 }}>ROOM NOT FOUND</Text>
            </View>
        );
    }

    const floorLabel = floor
        ? (floor.floorNumber === 0 ? 'GROUND' : `FLOOR ${floor.floorNumber}`)
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
        Alert.alert('ADD PHOTO', 'Choose source', [
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

    const isGponSerial = (val: string) =>
        /^[A-Za-z]{4}[0-9A-Fa-f]{8}$/.test(val.replace(/[^A-Za-z0-9]/g, ''));

    const buildStickerDataFromScan = (scan: StickerScanResult, scanStickerType: 'ont' | 'router') => ({
        stickerType: scanStickerType,
        photoUrl: scan.photoUrl ?? scan.photoUri ?? undefined,
        capturedAt: scan.capturedAt,
        confidence: scan.confidence,
        deviceType: scan.deviceType,
        macAddress: scan.macAddress,
        gponSn: scan.gponSn,
        serialNumber: scan.serialNumber,
        model: scan.model,
        serialCandidates: scan.serialCandidates ?? [],
        macCandidates: scan.macCandidates ?? [],
        stickerFields: scan.stickerFields ?? {},
        rawText: scan.rawText ?? '',
        identityInDatabase: !!scan.identityInDatabase,
        identityMatchType: scan.identityMatchType,
        identityMatchValue: scan.identityMatchValue,
        identityOltHost: scan.identityOltHost,
        identityPonPort: scan.identityPonPort,
        identityOnuIndex: scan.identityOnuIndex,
    });

    const applyStickerScanResult = (scan: StickerScanResult, scanStickerType: 'ont' | 'router') => {
        const serial = scan.gponSn || scan.serialNumber || '';
        const mac = scan.macAddress || '';
        const extractedModel = scan.model || '';
        const photo = scan.photoUrl || scan.photoUri;
        const stickerData = buildStickerDataFromScan(scan, scanStickerType);

        if (photo) {
            setPhotos(prev => prev.includes(photo) ? prev : [...prev, photo]);
        }

        if (scanStickerType === 'router') {
            if (photo) setRouterStickerPhotoUrl(photo);
            setRouterStickerData(stickerData);
            setRouterMacAddress(mac);
            setRouterSerial(serial);
            setRouterModel(extractedModel);
        } else {
            if (photo) setOntStickerPhotoUrl(photo);
            setOntStickerData(stickerData);
            setOntSerial(serial);
            setMacAddress(mac);
            setOntModel(extractedModel);
        }

        setIdentityMatch(scan.identityInDatabase ? {
            identity_in_database: true,
            identity_status: scan.identityStatus,
            identity_match_type: scan.identityMatchType,
            identity_match_value: scan.identityMatchValue,
            identity_olt_host: scan.identityOltHost,
            identity_pon_port: scan.identityPonPort,
            identity_onu_index: scan.identityOnuIndex,
        } : null);

        setScanHistory(prev => [{
            ts: scan.capturedAt,
            mac: mac || undefined,
            serial: serial || undefined,
            model: extractedModel || undefined,
            rawText: scan.rawText || undefined,
            device: scanStickerType,
            source: scan.source === 'barcode_only' ? 'barcode' : 'ocr',
        }, ...prev]);
        haptic.success();
    };

    const scanDeviceStickerWithOCR = async (stickerType: 'ont' | 'router') => {
        router.push({
            pathname: '/scan-onu',
            params: {
                customerUsername: '__pg__',
                customerName: `Room ${room.roomNumber}`,
                mode: 'pg_room',
                roomId: room.id,
                stickerType,
            },
        } as any);
    };

    const normalized = (v?: string) => (v ?? '').trim();

    const buildTargetRoom = (changeReason?: string) => {
        const isGrouped = room.connectionType === 'router_group' || room.connectionType === 'linked_room';
        const newConnectionType: ConnectionType = isGrouped
            ? room.connectionType
            : username.trim() ? 'individual' : 'none';

        return {
            ...room,
            status,
            deviceSetup,
            username: username.trim() || undefined,
            ontSerial: ontSerial.trim() || undefined,
            macAddress: macAddress.trim() || undefined,
            ontModel: ontModel.trim() || undefined,
            ontStickerPhotoUrl: ontStickerPhotoUrl.trim() || undefined,
            ontStickerData,
            routerStickerPhotoUrl: routerStickerPhotoUrl.trim() || undefined,
            routerMacAddress: routerMacAddress.trim() || undefined,
            routerSerial: routerSerial.trim() || undefined,
            routerModel: routerModel.trim() || undefined,
            routerStickerData,
            wifiSsid: wifiSsid.trim() || undefined,
            wifiSsid5g: wifiSsid5g.trim() || undefined,
            wifiPassword: wifiPassword.trim() || undefined,
            techNote: techNote.trim() || undefined,
            scanHistory: scanHistory.length > 0 ? scanHistory : undefined,
            photos,
            collectedAt: (status === 'done' || status === 'shared')
                ? new Date().toISOString()
                : room.collectedAt,
            connectionType: newConnectionType,
            changeReason,
            synced: false,
        };
    };

    const hasKeyChange = () => (
        normalized(room.username) !== normalized(username) ||
        normalized(room.ontSerial) !== normalized(ontSerial) ||
        normalized(room.macAddress) !== normalized(macAddress) ||
        normalized(room.ontModel) !== normalized(ontModel) ||
        room.deviceSetup !== deviceSetup ||
        normalized(room.routerMacAddress) !== normalized(routerMacAddress) ||
        normalized(room.routerSerial) !== normalized(routerSerial) ||
        normalized(room.routerModel) !== normalized(routerModel) ||
        room.status !== status
    );

    const commitSave = async (targetRoom: ReturnType<typeof buildTargetRoom>, reason?: string, mode: 'normal' | 'move' = 'normal') => {
        const finalRoom = { ...targetRoom, changeReason: reason };
        if (mode === 'move') {
            await PGService.resolveRoomConflicts(room.id, {
                username: finalRoom.username,
                mac_address: finalRoom.macAddress,
                ont_serial: finalRoom.ontSerial,
                reason: reason || 'Moved PG room link after conflict confirmation',
            });
            await PGService.upsertRoom(finalRoom);
            await refreshBuildingFromServer(buildingId);
        } else {
            updateRoom(finalRoom);
        }
        haptic.success();
        setEditMode(false);
        if (status === 'pending') router.back();
    };

    const openReasonModal = (targetRoom: ReturnType<typeof buildTargetRoom>, mode: 'normal' | 'move', conflictText?: string) => {
        setPendingSave({ room: targetRoom, mode, conflictText });
        setReasonText('');
        setShowReasonModal(true);
    };

    const handleSave = async () => {
        const targetRoom = buildTargetRoom();
        setSaving(true);
        try {
            const conflictResult = await PGService.checkRoomConflicts(room.id, {
                username: targetRoom.username,
                mac_address: targetRoom.macAddress,
                ont_serial: targetRoom.ontSerial,
            }).catch(() => null);

            if (conflictResult?.live_onu) {
                setIdentityMatch({
                    identity_in_database: true,
                    identity_status: conflictResult.live_onu.status,
                    identity_match_type: conflictResult.live_onu.match_type,
                    identity_match_value: conflictResult.live_onu.matched_value,
                    identity_olt_host: conflictResult.live_onu.olt_host,
                    identity_pon_port: conflictResult.live_onu.pon_port,
                });
            }

            const conflicts = conflictResult?.conflicts ?? [];
            setLinkConflicts(conflicts);
            if (conflicts.length > 0) {
                const conflictText = conflicts.map((c: any) => c.message).join('\n');
                Alert.alert(
                    'LINK CONFLICT',
                    `${conflictText}\n\nUse "Move Here" only when you confirmed this room is the correct current location.`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        {
                            text: 'Move Here',
                            style: 'destructive',
                            onPress: () => openReasonModal(targetRoom, 'move', conflictText),
                        },
                    ]
                );
                return;
            }

            if (hasKeyChange() && (room.collectedAt || room.username || room.ontSerial || room.macAddress)) {
                openReasonModal(targetRoom, 'normal');
                return;
            }

            await commitSave(targetRoom, 'Initial PG room survey save');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        Alert.alert('DELETE ROOM', `Delete Room ${room.roomNumber}?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'DELETE',
                style: 'destructive',
                onPress: () => { haptic.light(); deleteRoom(room.id); router.back(); },
            },
        ]);
    };

    const handleReasonConfirm = async () => {
        const reason = reasonText.trim();
        if (!pendingSave) return;
        if (reason.length < 3) {
            Alert.alert('REASON REQUIRED', 'Enter why this room data is being changed.');
            return;
        }
        setSaving(true);
        try {
            await commitSave(pendingSave.room, reason, pendingSave.mode);
            setShowReasonModal(false);
            setPendingSave(null);
            setReasonText('');
        } catch (err: any) {
            Alert.alert('SAVE FAILED', err?.response?.data?.detail || err?.message || 'Could not save room update.');
        } finally {
            setSaving(false);
        }
    };

    const isDone = status === 'done' || status === 'shared';

    // ── Read-only summary view (when editMode is false and room is collected) ──
    const renderReadView = () => (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll}>
            {/* ONT Device summary */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="hardware-chip-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>{deviceSetup === 'onu_router' ? 'ONU DEVICE' : 'ONT DEVICE'}</Text>
                    {(ontSerial || macAddress) && (
                        <View style={[styles.matchBadge, { backgroundColor: '#16a34a22' }]}>
                            <Ionicons name="checkmark-circle" size={12} color={SUCCESS} />
                            <Text style={[styles.matchText, { color: SUCCESS }]}>RECORDED</Text>
                        </View>
                    )}
                </View>
                <View style={styles.sectionBody}>
                    <ReadRow label="SERIAL (GPON)" value={ontSerial} mono />
                    <ReadRow label="MAC (EPON)" value={macAddress} mono />
                    <ReadRow label="MODEL" value={ontModel} />
                </View>
            </View>

            {(routerMacAddress || routerSerial || routerModel) && (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="wifi-outline" size={14} color={TEAL} />
                        <Text style={[styles.sectionTitle, { color: TEAL }]}>ROUTER DEVICE</Text>
                    </View>
                    <View style={styles.sectionBody}>
                        <ReadRow label="ROUTER MAC" value={routerMacAddress} mono />
                        <ReadRow label="ROUTER SN" value={routerSerial} mono />
                        <ReadRow label="ROUTER MODEL" value={routerModel} />
                    </View>
                </View>
            )}

            {/* WiFi */}
            {(wifiSsid || wifiSsid5g || wifiPassword) && (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="wifi-outline" size={14} color={TEAL} />
                        <Text style={[styles.sectionTitle, { color: TEAL }]}>WIFI CREDENTIALS</Text>
                    </View>
                    <View style={styles.sectionBody}>
                        <ReadRow label="SSID 2.4G" value={wifiSsid} />
                        <ReadRow label="SSID 5G" value={wifiSsid5g} />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={{ flex: 1 }}>
                                <ReadRow label="WIFI KEY" value={showWifiPwd ? wifiPassword : wifiPassword?.replace(/./g, '•')} mono />
                            </View>
                            {wifiPassword ? (
                                <TouchableOpacity onPress={() => setShowWifiPwd(v => !v)}>
                                    <Ionicons name={showWifiPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={MUTED} />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    </View>
                </View>
            )}

            {/* Username */}
            {username && (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="person-outline" size={14} color={ORANGE} />
                        <Text style={styles.sectionTitle}>LINKED ACCOUNT</Text>
                    </View>
                    <View style={styles.sectionBody}>
                        <ReadRow label="USERNAME" value={username} mono />
                    </View>
                </View>
            )}

            {/* Photos */}
            {photos.length > 0 && (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="camera-outline" size={14} color={ORANGE} />
                        <Text style={styles.sectionTitle}>PHOTOS</Text>
                        <Text style={styles.sectionCount}>{photos.length} CAPTURED</Text>
                    </View>
                    <View style={[styles.sectionBody, { paddingBottom: 8 }]}>
                        <View style={styles.photoGrid}>
                            {photos.map((uri, i) => (
                                <TouchableOpacity
                                    key={i}
                                    style={styles.photoThumb}
                                    onPress={() => !isLocalUri(uri) && setPreviewUri(resolveUri(uri))}
                                    activeOpacity={0.85}
                                >
                                    {isLocalUri(uri) ? (
                                        <View style={[styles.photoImg, styles.photoBroken]}>
                                            <Ionicons name="image-outline" size={20} color={MUTED} />
                                            <Text style={styles.photoBrokenText}>SYNC{'\n'}PENDING</Text>
                                        </View>
                                    ) : (
                                        <Image
                                            source={{ uri: resolveUri(uri) }}
                                            style={styles.photoImg}
                                            onError={() => {}}
                                        />
                                    )}
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                </View>
            )}

            {/* Scan history */}
            {scanHistory.length > 0 && (
                <View style={styles.section}>
                    <TouchableOpacity
                        style={styles.sectionHeader}
                        onPress={() => setShowScanHistory(v => !v)}
                    >
                        <Ionicons name="time-outline" size={14} color={ORANGE} />
                        <Text style={styles.sectionTitle}>SCAN HISTORY</Text>
                        <Text style={styles.sectionCount}>{scanHistory.length} RECORDS</Text>
                        <Ionicons name={showScanHistory ? 'chevron-up' : 'chevron-down'} size={14} color={MUTED} />
                    </TouchableOpacity>
                    {showScanHistory && (
                        <View style={styles.sectionBody}>
                            {scanHistory.map((rec, i) => (
                                <View key={i} style={histStyles.row}>
                                    <View style={histStyles.dot} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={histStyles.ts}>{new Date(rec.ts).toLocaleString()}</Text>
                                        {rec.serial && <Text style={histStyles.val}>SN: {rec.serial}</Text>}
                                        {rec.mac && <Text style={histStyles.val}>MAC: {rec.mac}</Text>}
                                        {rec.model && <Text style={histStyles.val}>Model: {rec.model}</Text>}
                                        <Text style={histStyles.src}>{rec.source.toUpperCase()}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            )}

            {techNote ? (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="document-text-outline" size={14} color={ORANGE} />
                        <Text style={styles.sectionTitle}>FIELD NOTES</Text>
                    </View>
                    <View style={styles.sectionBody}>
                        <Text style={{ color: SUB, fontSize: 13, lineHeight: 20 }}>{techNote}</Text>
                    </View>
                </View>
            ) : null}
        </ScrollView>
    );

    // ── Edit form view ──────────────────────────────────────────────────────────
    const renderEditView = () => (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
        >
            {/* MODULE 1 — USERNAME */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="person-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>USERNAME</Text>
                </View>
                <View style={styles.sectionBody}>
                    <View style={styles.insetBox}>
                        {username
                            ? <Text style={styles.insetValue}>{username}</Text>
                            : <Text style={styles.insetEmpty}>— NOT LINKED —</Text>
                        }
                    </View>
                    <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => { setUserQuery(''); setUserResults([]); setShowUserSearch(true); }}
                    >
                        <Ionicons name="search-outline" size={14} color={TEXT} />
                        <Text style={styles.actionBtnText}>SEARCH & LINK USERNAME</Text>
                    </TouchableOpacity>
                    {linkConflicts.length > 0 && (
                        <View style={[styles.matchBadge, { borderColor: RED, backgroundColor: '#2a0d0d' }]}>
                            <Ionicons name="warning-outline" size={12} color={RED} />
                            <Text style={[styles.matchText, { color: RED }]}>
                                {linkConflicts.length} LINK CONFLICT(S) DETECTED
                            </Text>
                        </View>
                    )}
                </View>
            </View>

            {/* MODULE 2 - DEVICE SETUP */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="git-branch-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>DEVICE SETUP</Text>
                </View>
                <View style={styles.sectionBody}>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                            style={[
                                styles.actionBtn,
                                { flex: 1 },
                                deviceSetup === 'single_ont' && { backgroundColor: '#0d2e1a', borderColor: SUCCESS },
                            ]}
                            onPress={() => setDeviceSetup('single_ont')}
                        >
                            <Ionicons name="hardware-chip-outline" size={14} color={deviceSetup === 'single_ont' ? SUCCESS : TEXT} />
                            <Text style={[styles.actionBtnText, deviceSetup === 'single_ont' && { color: SUCCESS }]}>SINGLE ONT</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.actionBtn,
                                { flex: 1 },
                                deviceSetup === 'onu_router' && { backgroundColor: '#082f2c', borderColor: TEAL },
                            ]}
                            onPress={() => setDeviceSetup('onu_router')}
                        >
                            <Ionicons name="git-network-outline" size={14} color={deviceSetup === 'onu_router' ? TEAL : TEXT} />
                            <Text style={[styles.actionBtnText, deviceSetup === 'onu_router' && { color: TEAL }]}>ONU + ROUTER</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={{ color: MUTED, fontSize: 11, lineHeight: 16 }}>
                        {deviceSetup === 'single_ont'
                            ? 'One fiber WiFi ONT in this room. Scan the ONT sticker only.'
                            : 'Separate optical ONU plus WiFi router. Scan both stickers separately.'}
                    </Text>
                </View>
            </View>

            {/* MODULE 3 - OPTICAL DEVICE */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="hardware-chip-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>{deviceSetup === 'onu_router' ? 'ONU DEVICE' : 'ONT DEVICE'}</Text>
                </View>
                <View style={styles.sectionBody}>
                    <View style={styles.ontTable}>
                        <OntRow label="SERIAL" value={ontSerial} onChangeText={setOntSerial}
                            hint={isGponSerial(ontSerial) ? '● GPON' : ontSerial ? '● EPON?' : ''} />
                        <OntRow label="MAC" value={macAddress} onChangeText={setMacAddress} />
                        <OntRow label="MODEL" value={ontModel} onChangeText={setOntModel} last />
                    </View>

                    {/* OCR Scan */}
                    <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#0d2e1a', borderColor: '#16a34a' }]}
                        onPress={() => scanDeviceStickerWithOCR('ont')}
                        disabled={!!ocrScanning}
                    >
                        {ocrScanning === 'ont' ? (
                            <ActivityIndicator size="small" color={SUCCESS} />
                        ) : (
                            <Ionicons name="scan-outline" size={14} color={SUCCESS} />
                        )}
                        <Text style={[styles.actionBtnText, { color: SUCCESS }]}>
                            {ocrScanning === 'ont' ? 'SCANNING...' : `SCAN ${deviceSetup === 'onu_router' ? 'ONU' : 'ONT'} STICKER`}
                        </Text>
                    </TouchableOpacity>

                    {(ontSerial || macAddress) && (
                        <View style={styles.matchBadge}>
                            <Ionicons
                                name={isGponSerial(ontSerial) ? 'cellular-outline' : 'link-outline'}
                                size={12} color={TEAL}
                            />
                            <Text style={[styles.matchText, { color: TEAL }]}>
                                {isGponSerial(ontSerial)
                                    ? `GPON SERIAL: ${ontSerial}`
                                    : macAddress ? `EPON MAC: ${macAddress}` : ''}
                            </Text>
                        </View>
                    )}
                    {identityMatch && (
                        <View style={[styles.matchBadge, { borderColor: SUCCESS, backgroundColor: '#0d2e1a' }]}>
                            <Ionicons name="checkmark-circle-outline" size={12} color={SUCCESS} />
                            <Text style={[styles.matchText, { color: SUCCESS }]}>
                                OLT MATCH: {identityMatch.identity_status ?? 'FOUND'} // {identityMatch.identity_match_type?.toUpperCase()}
                            </Text>
                        </View>
                    )}
                    {ontStickerData?.rawText ? (
                        <View style={styles.matchBadge}>
                            <Ionicons name="document-text-outline" size={12} color={MUTED} />
                            <Text style={styles.matchText}>
                                STICKER OCR STORED: {(ontStickerData.confidence ?? 'unknown').toUpperCase()}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </View>

            {/* MODULE 4 - ROUTER DEVICE */}
            {(deviceSetup === 'onu_router' || routerMacAddress || routerSerial || routerModel) && (
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="wifi-outline" size={14} color={TEAL} />
                    <Text style={[styles.sectionTitle, { color: TEAL }]}>ROUTER DEVICE</Text>
                    <Text style={styles.sectionCount}>OPTIONAL</Text>
                </View>
                <View style={styles.sectionBody}>
                    <View style={styles.ontTable}>
                        <OntRow label="ROUTER MAC" value={routerMacAddress} onChangeText={setRouterMacAddress} />
                        <OntRow label="ROUTER SN" value={routerSerial} onChangeText={setRouterSerial} />
                        <OntRow label="ROUTER MODEL" value={routerModel} onChangeText={setRouterModel} last />
                    </View>

                    <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#082f2c', borderColor: '#14b8a6' }]}
                        onPress={() => scanDeviceStickerWithOCR('router')}
                        disabled={!!ocrScanning}
                    >
                        {ocrScanning === 'router' ? (
                            <ActivityIndicator size="small" color={TEAL} />
                        ) : (
                            <Ionicons name="scan-outline" size={14} color={TEAL} />
                        )}
                        <Text style={[styles.actionBtnText, { color: TEAL }]}>
                            {ocrScanning === 'router' ? 'SCANNING...' : 'SCAN ROUTER STICKER'}
                        </Text>
                    </TouchableOpacity>

                    {(routerMacAddress || routerSerial || routerModel) && (
                        <View style={styles.matchBadge}>
                            <Ionicons name="information-circle-outline" size={12} color={TEAL} />
                            <Text style={[styles.matchText, { color: TEAL }]}>
                                ROUTER DATA STORED AS CUSTOMER EVIDENCE, NOT USED FOR ONT MAPPING
                            </Text>
                        </View>
                    )}
                    {routerStickerData?.rawText ? (
                        <View style={styles.matchBadge}>
                            <Ionicons name="document-text-outline" size={12} color={MUTED} />
                            <Text style={styles.matchText}>
                                ROUTER OCR STORED: {(routerStickerData.confidence ?? 'unknown').toUpperCase()}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </View>
            )}

            {/* MODULE 5 - WIFI CREDENTIALS */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="wifi-outline" size={14} color={TEAL} />
                    <Text style={[styles.sectionTitle, { color: TEAL }]}>WIFI CREDENTIALS</Text>
                    <Text style={styles.sectionCount}>FROM STICKER</Text>
                </View>
                <View style={styles.sectionBody}>
                    <View style={styles.ontTable}>
                        <OntRow label="SSID 2.4G" value={wifiSsid} onChangeText={setWifiSsid} />
                        <OntRow label="SSID 5G" value={wifiSsid5g} onChangeText={setWifiSsid5g} />
                        <OntRow label="KEY" value={wifiPassword} onChangeText={setWifiPassword} last secure />
                    </View>
                </View>
            </View>

            {/* MODULE 4 — LOCATION */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="location-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>LOCATION</Text>
                </View>
                <View style={styles.sectionBody}>
                    {building.gpsLat != null ? (
                        <View style={styles.locationRow}>
                            <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.locationLabel}>BUILDING GPS ON FILE</Text>
                                <Text style={styles.locationCoords}>
                                    {building.gpsLat.toFixed(5)} N, {building.gpsLng?.toFixed(5)} E
                                </Text>
                            </View>
                        </View>
                    ) : (
                        <View style={styles.locationRow}>
                            <Ionicons name="alert-circle-outline" size={18} color={AMBER} />
                            <Text style={[styles.locationLabel, { color: AMBER }]}>
                                NO GPS — EDIT BUILDING TO CAPTURE
                            </Text>
                        </View>
                    )}
                </View>
            </View>

            {/* MODULE 5 — PHOTOS */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="camera-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>PHOTOS</Text>
                    <Text style={styles.sectionCount}>{photos.length} CAPTURED</Text>
                </View>
                <View style={styles.sectionBody}>
                    {photos.length > 0 && (
                        <View style={styles.photoGrid}>
                            {photos.map((uri, i) => (
                                <View key={i} style={styles.photoThumb}>
                                    {isLocalUri(uri) ? (
                                        <View style={[styles.photoImg, styles.photoBroken]}>
                                            <Ionicons name="image-outline" size={20} color={MUTED} />
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
                                        <Ionicons name="close-circle" size={20} color={RED} />
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    )}
                    <TouchableOpacity style={styles.actionBtn} onPress={addPhoto}>
                        <Ionicons name="camera-outline" size={14} color={TEXT} />
                        <Text style={styles.actionBtnText}>
                            {photos.length === 0 ? 'TAKE PHOTOS' : 'ADD MORE PHOTOS'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Scan History */}
            {scanHistory.length > 0 && (
                <View style={styles.section}>
                    <TouchableOpacity
                        style={styles.sectionHeader}
                        onPress={() => setShowScanHistory(v => !v)}
                    >
                        <Ionicons name="time-outline" size={14} color={ORANGE} />
                        <Text style={styles.sectionTitle}>SCAN HISTORY</Text>
                        <Text style={styles.sectionCount}>{scanHistory.length} RECORDS</Text>
                        <Ionicons name={showScanHistory ? 'chevron-up' : 'chevron-down'} size={14} color={MUTED} />
                    </TouchableOpacity>
                    {showScanHistory && (
                        <View style={styles.sectionBody}>
                            {scanHistory.map((rec, i) => (
                                <View key={i} style={histStyles.row}>
                                    <View style={histStyles.dot} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={histStyles.ts}>{new Date(rec.ts).toLocaleString()}</Text>
                                        {rec.serial && <Text style={histStyles.val}>SN: {rec.serial}</Text>}
                                        {rec.mac && <Text style={histStyles.val}>MAC: {rec.mac}</Text>}
                                        {rec.model && <Text style={histStyles.val}>Model: {rec.model}</Text>}
                                        <Text style={histStyles.src}>{rec.source.toUpperCase()}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            )}

            {/* Tech Notes */}
            <View style={styles.section}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="document-text-outline" size={14} color={ORANGE} />
                    <Text style={styles.sectionTitle}>TECHNICIAN FIELD NOTES</Text>
                </View>
                <View style={styles.sectionBody}>
                    <TextInput
                        style={styles.notesInput}
                        value={techNote}
                        onChangeText={setTechNote}
                        placeholder="Observations, issues, follow-up required..."
                        placeholderTextColor={MUTED}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                    />
                </View>
            </View>
        </ScrollView>
    );

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: BG }}
            behavior="padding"
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backBtn}
                    onPress={() => { haptic.light(); router.back(); }}
                >
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {floorLabel} — ROOM {room.roomNumber}
                </Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                    <Ionicons name="trash-outline" size={16} color={RED} />
                </TouchableOpacity>
            </View>

            {/* Context strip */}
            <View style={styles.contextStrip}>
                <Text style={styles.contextLeft}>
                    {building.name.toUpperCase()} | {floorLabel} // ROOM {room.roomNumber}
                </Text>
                <Text style={styles.contextRight}>STATUS: {status.toUpperCase()}</Text>
            </View>

            {/* Status badge + edit toggle */}
            <View style={styles.badgeRow}>
                <View style={[styles.statusBadge, { backgroundColor: isDone ? SUCCESS : AMBER }]}>
                    <Text style={styles.statusBadgeText}>
                        {isDone ? 'COLLECTION COMPLETE' : 'PENDING COLLECTION'}
                    </Text>
                </View>
                {isDone && (
                    <TouchableOpacity
                        style={[styles.editToggleBtn, editMode && { borderColor: ORANGE }]}
                        onPress={() => setEditMode(v => !v)}
                    >
                        <Ionicons name={editMode ? 'checkmark-outline' : 'pencil-outline'} size={14} color={editMode ? ORANGE : MUTED} />
                        <Text style={[styles.editToggleText, editMode && { color: ORANGE }]}>
                            {editMode ? 'VIEWING EDIT' : 'EDIT DATA'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>

            {editMode ? renderEditView() : renderReadView()}

            {/* Bottom CTA */}
            {editMode && (
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.ctaBtn, { backgroundColor: isDone ? ORANGE : SUCCESS }, saving && { opacity: 0.7 }]}
                        onPress={handleSave}
                        disabled={saving}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color="#000" />
                        ) : (
                            <>
                                <Ionicons name="save-outline" size={18} color="#000" />
                                <Text style={styles.ctaBtnText}>
                                    {isDone ? 'UPDATE & SAVE' : 'SAVE & MARK COMPLETE'}
                                </Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            )}

            {/* Change Reason Modal */}
            <Modal
                visible={showReasonModal}
                transparent
                animationType="slide"
                onRequestClose={() => !saving && setShowReasonModal(false)}
            >
                <KeyboardAvoidingView style={searchModal.backdrop} behavior="padding">
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => !saving && setShowReasonModal(false)} />
                    <View style={searchModal.sheet}>
                        <View style={searchModal.handle} />
                        <Text style={searchModal.title}>
                            {pendingSave?.mode === 'move' ? 'MOVE LINK REASON' : 'UPDATE REASON'}
                        </Text>
                        {pendingSave?.conflictText ? (
                            <Text style={reasonStyles.warning}>{pendingSave.conflictText}</Text>
                        ) : null}
                        <TextInput
                            style={reasonStyles.input}
                            value={reasonText}
                            onChangeText={setReasonText}
                            placeholder="Example: Customer shifted from 101 to 102 after field verification"
                            placeholderTextColor={MUTED}
                            multiline
                            numberOfLines={3}
                            autoFocus
                        />
                        <View style={reasonStyles.actions}>
                            <TouchableOpacity
                                style={reasonStyles.cancelBtn}
                                onPress={() => !saving && setShowReasonModal(false)}
                                disabled={saving}
                            >
                                <Text style={reasonStyles.cancelText}>CANCEL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[reasonStyles.saveBtn, saving && { opacity: 0.7 }]}
                                onPress={handleReasonConfirm}
                                disabled={saving}
                            >
                                {saving ? <ActivityIndicator size="small" color="#000" /> : null}
                                <Text style={reasonStyles.saveText}>
                                    {pendingSave?.mode === 'move' ? 'MOVE & SAVE' : 'SAVE UPDATE'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

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
            <Modal
                visible={showUserSearch}
                transparent
                animationType="slide"
                onRequestClose={() => setShowUserSearch(false)}
            >
                <KeyboardAvoidingView style={searchModal.backdrop} behavior="padding">
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowUserSearch(false)} />
                    <View style={searchModal.sheet}>
                        <View style={searchModal.handle} />
                        <Text style={searchModal.title}>LINK USERNAME</Text>
                        <View style={searchModal.inputRow}>
                            <Ionicons name="search" size={16} color={MUTED} />
                            <TextInput
                                style={searchModal.input}
                                value={userQuery}
                                onChangeText={q => { setUserQuery(q); searchUsers(q); }}
                                placeholder="TYPE USERNAME, NAME, OR PHONE..."
                                placeholderTextColor={MUTED}
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
                                    <Text style={searchModal.empty}>NO CUSTOMERS FOUND</Text>
                                ) : null
                            }
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={searchModal.result}
                                    onPress={() => {
                                        haptic.light();
                                        setUsername(item.username);
                                        PGService.checkRoomConflicts(room.id, {
                                            username: item.username,
                                            mac_address: macAddress.trim() || undefined,
                                            ont_serial: ontSerial.trim() || undefined,
                                        }).then(result => {
                                            setLinkConflicts(result?.conflicts ?? []);
                                            if (result?.live_onu) {
                                                setIdentityMatch({
                                                    identity_in_database: true,
                                                    identity_status: result.live_onu.status,
                                                    identity_match_type: result.live_onu.match_type,
                                                    identity_match_value: result.live_onu.matched_value,
                                                });
                                            }
                                        }).catch(() => {});
                                        setShowUserSearch(false);
                                    }}
                                >
                                    <Ionicons name="person-circle-outline" size={20} color={ORANGE} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={searchModal.resultName}>
                                            {[item.first_name, item.last_name].filter(Boolean).join(' ') || item.username}
                                        </Text>
                                        <Text style={searchModal.resultSub}>
                                            {item.username} · {item.phone || '—'}
                                        </Text>
                                    </View>
                                    <Ionicons name="link" size={16} color={SUCCESS} />
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </KeyboardAvoidingView>
    );
}

// ── Read-only row ─────────────────────────────────────────────────────────────
function ReadRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
    if (!value) return null;
    return (
        <View style={readRowStyles.row}>
            <Text style={readRowStyles.label}>{label}</Text>
            <Text style={[readRowStyles.value, mono && { fontFamily: 'monospace' }]}>{value}</Text>
        </View>
    );
}

// ── ONT Row (editable) ────────────────────────────────────────────────────────
function OntRow({ label, value, onChangeText, last, hint, secure }: {
    label: string; value: string; onChangeText: (v: string) => void;
    last?: boolean; hint?: string; secure?: boolean;
}) {
    return (
        <View style={[ontRowStyles.row, !last && ontRowStyles.rowBorder]}>
            <Text style={ontRowStyles.label}>{label}</Text>
            <TextInput
                style={ontRowStyles.value}
                value={value}
                onChangeText={onChangeText}
                placeholder="—"
                placeholderTextColor={MUTED}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={secure}
            />
            {hint ? <Text style={ontRowStyles.hint}>{hint}</Text> : null}
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },

    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: 64, paddingHorizontal: 16,
        borderBottomWidth: 2, borderBottomColor: BORDER_L, backgroundColor: '#0a0f1a',
    },
    backBtn: {
        width: 40, height: 40, borderWidth: 2, borderColor: BORDER_L,
        alignItems: 'center', justifyContent: 'center', ...SHADOW,
    },
    headerTitle: {
        color: TEXT, fontSize: 14, fontWeight: '900', letterSpacing: 1, flex: 1, textAlign: 'center',
    },
    deleteBtn: {
        width: 40, height: 40, borderWidth: 2, borderColor: BORDER_L,
        alignItems: 'center', justifyContent: 'center',
    },

    contextStrip: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: SALMON, borderBottomWidth: 2, borderBottomColor: BORDER,
        paddingHorizontal: 12, paddingVertical: 8,
    },
    contextLeft:  { color: '#1a0a00', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, flex: 1 },
    contextRight: { color: '#5a2a00', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },

    badgeRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 10, paddingVertical: 12,
    },
    statusBadge: {
        paddingHorizontal: 16, paddingVertical: 7,
        borderWidth: 2, borderColor: BORDER, ...SHADOW,
    },
    statusBadgeText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 2 },

    editToggleBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        borderWidth: 2, borderColor: BORDER_L, paddingHorizontal: 10, paddingVertical: 7,
    },
    editToggleText: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

    scroll: { padding: 16, paddingBottom: 100, gap: 12 },

    section: { backgroundColor: SECTION, borderWidth: 2, borderColor: BORDER_L },
    sectionHeader: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderBottomWidth: 2, borderBottomColor: BORDER_L,
        paddingHorizontal: 14, paddingVertical: 10,
    },
    sectionTitle: { color: ORANGE, fontSize: 11, fontWeight: '900', letterSpacing: 1.5, flex: 1 },
    sectionCount: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    sectionBody: { padding: 14, gap: 10 },

    matchBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 10, paddingVertical: 5,
        backgroundColor: '#0d2233', borderWidth: 1, borderColor: TEAL,
    },
    matchText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

    insetBox: {
        backgroundColor: BG, borderWidth: 2, borderColor: BORDER_L,
        padding: 12, minHeight: 44, justifyContent: 'center',
    },
    insetValue: { color: TEXT, fontSize: 14, fontWeight: '700' },
    insetEmpty: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

    actionBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: BORDER_L, borderWidth: 2, borderColor: BORDER,
        paddingVertical: 10, paddingHorizontal: 14, ...SHADOW,
    },
    actionBtnText: { color: TEXT, fontSize: 11, fontWeight: '900', letterSpacing: 1 },

    ontTable: { borderWidth: 1, borderColor: BORDER_L },

    locationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    locationLabel: { color: SUB, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    locationCoords: { color: TEXT, fontSize: 11, fontWeight: '600', marginTop: 2 },

    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    photoThumb: { width: 80, height: 80, position: 'relative' },
    photoImg:   { width: 80, height: 80 },
    photoBroken: {
        alignItems: 'center', justifyContent: 'center', gap: 3,
        backgroundColor: '#1e293b', borderWidth: 1, borderColor: BORDER_L,
    },
    photoBrokenText: { color: MUTED, fontSize: 8, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 },
    photoRemove: { position: 'absolute', top: 2, right: 2 },

    previewBackdrop: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
        alignItems: 'center', justifyContent: 'center',
    },
    previewImage: { width: '100%', height: '80%' },
    previewClose: { position: 'absolute', top: 50, right: 20 },

    notesInput: {
        backgroundColor: '#000', borderWidth: 2, borderColor: BORDER_L,
        color: TEXT, paddingHorizontal: 12, paddingVertical: 12,
        fontSize: 14, minHeight: 100, textAlignVertical: 'top',
    },

    footer: {
        padding: 16, paddingBottom: 28,
        borderTopWidth: 2, borderTopColor: BORDER_L, backgroundColor: '#0a0f1a',
    },
    ctaBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        borderWidth: 2, borderColor: BORDER, paddingVertical: 16, ...SHADOW,
    },
    ctaBtnText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 2 },
});

const readRowStyles = StyleSheet.create({
    row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER_L },
    label: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 2 },
    value: { color: TEXT, fontSize: 13, fontWeight: '600' },
});

const ontRowStyles = StyleSheet.create({
    row: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER_L },
    label: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, width: 60 },
    value: { flex: 1, color: SUB, fontSize: 13, padding: 0 },
    hint: { color: TEAL, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});

const histStyles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER_L },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE, marginTop: 5 },
    ts: { color: MUTED, fontSize: 10, marginBottom: 2 },
    val: { color: TEXT, fontSize: 12, fontFamily: 'monospace' },
    src: { color: TEAL, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 2 },
});

const reasonStyles = StyleSheet.create({
    warning: {
        color: RED,
        backgroundColor: '#2a0d0d',
        borderWidth: 1,
        borderColor: RED,
        padding: 10,
        fontSize: 11,
        fontWeight: '700',
    },
    input: {
        backgroundColor: BG,
        borderWidth: 2,
        borderColor: BORDER_L,
        color: TEXT,
        paddingHorizontal: 12,
        paddingVertical: 12,
        minHeight: 90,
        textAlignVertical: 'top',
        fontSize: 13,
        fontWeight: '600',
    },
    actions: { flexDirection: 'row', gap: 10 },
    cancelBtn: {
        flex: 1,
        borderWidth: 2,
        borderColor: BORDER_L,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
    },
    cancelText: { color: MUTED, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    saveBtn: {
        flex: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: ORANGE,
        borderWidth: 2,
        borderColor: BORDER,
        paddingVertical: 12,
    },
    saveText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
});

const searchModal = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: CARD, borderTopWidth: 2, borderTopColor: BORDER_L,
        padding: 20, paddingBottom: 36, gap: 12, maxHeight: '75%',
    },
    handle: { width: 40, height: 3, backgroundColor: BORDER_L, alignSelf: 'center', marginBottom: 4 },
    title: { color: TEXT, fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
    inputRow: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: BG, borderWidth: 2, borderColor: BORDER_L,
        paddingHorizontal: 12, paddingVertical: 10,
    },
    input: { flex: 1, color: TEXT, fontSize: 14, padding: 0, fontWeight: '600' },
    empty: {
        color: MUTED, textAlign: 'center', paddingVertical: 20,
        fontWeight: '700', letterSpacing: 0.5,
    },
    result: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 12, paddingHorizontal: 4,
        borderBottomWidth: 2, borderBottomColor: BORDER,
    },
    resultName: { color: TEXT, fontSize: 14, fontWeight: '700' },
    resultSub:  { color: MUTED, fontSize: 11, marginTop: 1 },
});
