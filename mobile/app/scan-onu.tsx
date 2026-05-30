import React, { useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FieldIntelService } from '../services/fieldIntelService';
import { SurveyService, type StickerOcrResponse } from '../services/collectionService';
import PGService from '../services/pgService';
import { useSettings } from '../context/SettingsContext';
import { COLORS, DARK_COLORS } from '../constants/theme';
import {
    stickerScanResultService,
    type ScannerStickerType,
    type StickerScanResult,
} from '../services/stickerScanResultService';
import { haptic } from '../utils/haptics';

type ScanMode = 'link_customer' | 'survey' | 'pg_room' | 'pg_router_group';

const BARCODE_TYPES = [
    'qr',
    'code128',
    'code39',
    'code93',
    'ean13',
    'ean8',
    'datamatrix',
    'itf14',
    'codabar',
    'upc_a',
] as const;

function cleanValue(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function normalizeMac(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const clean = raw
        .replace(/[Oo]/g, '0')
        .replace(/[Il]/g, '1')
        .replace(/[^0-9A-Fa-f]/g, '')
        .toUpperCase();
    return /^[0-9A-F]{12}$/.test(clean) ? clean : null;
}

function normalizeSerial(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const clean = raw.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
    return clean.length >= 6 ? clean : null;
}

function isGponSerial(value: string | null | undefined): boolean {
    const clean = value?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ?? '';
    return /^[A-Z]{4}[0-9A-F]{8}$/.test(clean);
}

function fieldsFromBarcode(raw: string): {
    macAddress: string | null;
    serialNumber: string | null;
    onuIdentifier: string | null;
} {
    const mac = normalizeMac(raw);
    if (mac) {
        return { macAddress: mac, serialNumber: null, onuIdentifier: mac };
    }

    const serial = normalizeSerial(raw);
    if (serial) {
        return { macAddress: null, serialNumber: serial, onuIdentifier: serial };
    }

    return { macAddress: null, serialNumber: null, onuIdentifier: null };
}

function confidenceColor(confidence: StickerScanResult['confidence'] | undefined | null) {
    if (confidence === 'high') return '#22C55E';
    if (confidence === 'medium') return '#F59E0B';
    if (confidence === 'low') return '#EF4444';
    return '#94A3B8';
}

export default function ScanONUScreen() {
    const {
        customerUsername,
        customerName,
        mode,
        roomId,
        groupId,
        stickerType: stickerTypeParam,
    } = useLocalSearchParams<{
        customerUsername?: string;
        customerName?: string;
        mode?: ScanMode;
        roomId?: string;
        groupId?: string;
        stickerType?: ScannerStickerType;
    }>();
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    const scanMode: ScanMode = mode ?? 'link_customer';
    const stickerType: ScannerStickerType = stickerTypeParam === 'router' ? 'router' : 'ont';
    const targetName = customerName || customerUsername || (roomId ? `Room ${roomId}` : 'Sticker');

    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView | null>(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [photoUri, setPhotoUri] = useState<string | null>(null);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [barcodeValue, setBarcodeValue] = useState<string | null>(null);
    const [barcodeType, setBarcodeType] = useState<string | null>(null);
    const [macAddress, setMacAddress] = useState('');
    const [serialNumber, setSerialNumber] = useState('');
    const [onuIdentifier, setOnuIdentifier] = useState('');
    const [model, setModel] = useState('');
    const [confidence, setConfidence] = useState<StickerScanResult['confidence']>(null);
    const [macConfidence, setMacConfidence] = useState<StickerScanResult['macConfidence']>(null);
    const [deviceType, setDeviceType] = useState<StickerScanResult['deviceType']>('unknown');
    const [rawText, setRawText] = useState<string | null>(null);
    const [scanError, setScanError] = useState<string | null>(null);
    const [ocrData, setOcrData] = useState<StickerOcrResponse | any | null>(null);
    const [applying, setApplying] = useState(false);

    const scanCooldown = useRef(false);
    const autoCaptureDone = useRef(false);

    const title = stickerType === 'router'
        ? 'Scan Router Sticker'
        : scanMode === 'pg_room'
            ? 'Scan PG ONT Sticker'
            : 'Scan ONT Sticker';

    const applyOcr = (data: StickerOcrResponse | any) => {
        setOcrData(data);
        setConfidence(data.confidence ?? 'low');
        setMacConfidence(data.mac_confidence ?? null);
        setDeviceType(data.device_type ?? 'unknown');
        setRawText(data.raw_text || null);
        setScanError(data.error || null);

        const nextMac = cleanValue(data.mac_address);
        const nextSerial = cleanValue(data.gpon_sn || data.ont_serial_number);
        const nextModel = cleanValue(data.ont_model);
        const nextIdentifier = cleanValue(data.onu_identifier || data.gpon_sn || data.mac_address || data.ont_serial_number);

        if (nextMac) setMacAddress(nextMac);
        if (nextSerial) setSerialNumber(nextSerial);
        if (nextModel) setModel(nextModel);
        if (nextIdentifier) setOnuIdentifier(nextIdentifier);
    };

    const runOcr = async (uri: string) => {
        setProcessing(true);
        setScanError(null);
        try {
            const data = scanMode === 'pg_room' && roomId
                ? await PGService.scanRoomSticker(roomId, uri, stickerType)
                : await SurveyService.ocrSticker(uri);
            if (data.photo_url) {
                setPhotoUrl(data.photo_url);
            }
            applyOcr(data);
            haptic.success();
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.message || 'Sticker OCR failed';
            setConfidence('low');
            setScanError(msg);
            haptic.error();
        } finally {
            setProcessing(false);
        }
    };

    const captureStickerPhoto = async () => {
        if (capturing || processing || !cameraRef.current) return;
        setCapturing(true);
        try {
            // Wait briefly to ensure camera has stabilised before shooting
            await new Promise(r => setTimeout(r, 200));
            const photo = await cameraRef.current.takePictureAsync({
                quality: 0.92,
                exif: false,
                shutterSound: false,
            });
            if (!photo?.uri) throw new Error('No image returned from camera.');
            setPhotoUri(photo.uri);
            await runOcr(photo.uri);
        } catch (err: any) {
            // Photo capture failed — not fatal. Barcode data is already prefilled.
            // Show a non-blocking warning instead of a modal alert.
            setScanError('Photo capture failed — barcode data still saved. Tap "Apply to Fields" to continue.');
            haptic.error();
        } finally {
            setCapturing(false);
        }
    };

    const handleBarcodeScan = (result: BarcodeScanningResult) => {
        if (scanCooldown.current || processing || capturing) return;
        scanCooldown.current = true;
        setTimeout(() => { scanCooldown.current = false; }, 1200);

        const parsed = fieldsFromBarcode(result.data);
        if (!parsed.macAddress && !parsed.serialNumber) return;

        setBarcodeValue(result.data);
        setBarcodeType(result.type);
        if (parsed.macAddress) setMacAddress(parsed.macAddress);
        if (parsed.serialNumber) setSerialNumber(parsed.serialNumber);
        if (parsed.onuIdentifier) setOnuIdentifier(parsed.onuIdentifier);
        haptic.light();

        if (!autoCaptureDone.current) {
            autoCaptureDone.current = true;
            // Longer delay: let the camera stabilise after barcode detection
            setTimeout(() => {
                captureStickerPhoto();
            }, 800);
        }
    };

    const resetScan = () => {
        autoCaptureDone.current = false;
        setPhotoUri(null);
        setPhotoUrl(null);
        setBarcodeValue(null);
        setBarcodeType(null);
        setMacAddress('');
        setSerialNumber('');
        setOnuIdentifier('');
        setModel('');
        setConfidence(null);
        setMacConfidence(null);
        setDeviceType('unknown');
        setRawText(null);
        setScanError(null);
        setOcrData(null);
    };

    const buildResult = (): StickerScanResult => {
        const serial = cleanValue(serialNumber?.toUpperCase());
        const mac = normalizeMac(macAddress) || cleanValue(macAddress?.toUpperCase());
        const identifier = cleanValue(onuIdentifier?.toUpperCase()) || serial || mac;
        return {
            stickerType,
            source: photoUri ? 'camera_scan' : barcodeValue ? 'barcode_only' : 'manual',
            capturedAt: new Date().toISOString(),
            photoUri,
            photoUrl,
            barcodeValue,
            barcodeType,
            macAddress: mac,
            gponSn: isGponSerial(serial) ? serial : cleanValue(ocrData?.gpon_sn),
            serialNumber: serial,
            onuIdentifier: identifier,
            model: cleanValue(model?.toUpperCase()),
            confidence,
            macConfidence,
            deviceType,
            rawText,
            stickerFields: ocrData?.sticker_fields ?? {},
            serialCandidates: ocrData?.serial_candidates ?? [],
            macCandidates: ocrData?.mac_candidates ?? [],
            identityInDatabase: ocrData?.identity_in_database ?? ocrData?.mac_in_database ?? null,
            identityStatus: ocrData?.identity_status ?? ocrData?.onu_status ?? null,
            identityMatchType: ocrData?.identity_match_type ?? null,
            identityMatchValue: ocrData?.identity_match_value ?? null,
            identityOltHost: ocrData?.identity_olt_host ?? null,
            identityPonPort: ocrData?.identity_pon_port ?? null,
            identityOnuIndex: ocrData?.identity_onu_index ?? null,
            error: scanError,
        };
    };

    const applyResult = async () => {
        const result = buildResult();
        // Allow apply even if photo failed — barcode data (MAC/serial) is sufficient
        if (!result.macAddress && !result.serialNumber && !result.model && !result.barcodeValue) {
            Alert.alert('Nothing to Apply', 'Scan a barcode or type at least one device field.');
            return;
        }

        setApplying(true);
        try {
            if (scanMode === 'survey') {
                if (!customerUsername) throw new Error('Customer username is missing.');
                await stickerScanResultService.saveNormalSurveyResult(customerUsername, stickerType, result);
                router.back();
                return;
            }

            if (scanMode === 'pg_room') {
                if (!roomId) throw new Error('PG room id is missing.');
                await stickerScanResultService.savePGRoomResult(roomId, stickerType, result);
                router.back();
                return;
            }

            if (scanMode === 'pg_router_group') {
                if (!groupId) throw new Error('PG router group id is missing.');
                await stickerScanResultService.savePGGroupResult(groupId, result);
                router.back();
                return;
            }

            if (!customerUsername) throw new Error('Customer username is missing.');
            const linkIdentifier = result.macAddress || (result.serialNumber ? `SN:${result.serialNumber}` : null);
            if (!linkIdentifier) throw new Error('MAC or serial is required to link this ONU.');
            await FieldIntelService.linkONU(linkIdentifier, customerUsername);
            Alert.alert(
                'ONU Linked',
                `${linkIdentifier} linked to ${targetName}.`,
                [{ text: 'Done', onPress: () => router.back() }],
            );
        } catch (err: any) {
            Alert.alert('Apply Failed', err?.message || 'Could not apply scanner result.');
        } finally {
            setApplying(false);
        }
    };

    if (Platform.OS === 'web') {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <Stack.Screen options={{ title }} />
                <Ionicons name="camera-outline" size={48} color={C.text.secondary} />
                <Text style={[styles.fallbackText, { color: C.text.secondary }]}>
                    Camera scanning is available in the mobile app.
                </Text>
            </View>
        );
    }

    if (!permission) {
        return <View style={[styles.center, { backgroundColor: C.background }]}><ActivityIndicator /></View>;
    }

    if (!permission.granted) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <Stack.Screen options={{ title }} />
                <Ionicons name="camera-outline" size={48} color={C.text.secondary} />
                <Text style={[styles.permText, { color: C.text.primary }]}>Camera permission required</Text>
                <TouchableOpacity style={[styles.btn, { backgroundColor: C.primary }]} onPress={requestPermission}>
                    <Text style={styles.btnText}>Grant Permission</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const busy = capturing || processing || applying;
    const identityMatched = !!(ocrData?.identity_in_database || ocrData?.mac_in_database);

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{
                title,
                headerStyle: { backgroundColor: '#0F172A' },
                headerTintColor: '#fff',
                headerBackTitle: 'Back',
            }} />

            <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                autofocus="on"
                enableTorch={torchOn}
                responsiveOrientationWhenOrientationLocked
                onCameraReady={() => setCameraReady(true)}
                onBarcodeScanned={busy ? undefined : handleBarcodeScan}
                barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] as any }}
            />

            <View style={styles.cameraOverlay} pointerEvents="box-none">
                <View style={styles.topBar}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.titleText}>{title}</Text>
                        <Text style={styles.targetText} numberOfLines={1}>{targetName}</Text>
                    </View>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => setTorchOn(v => !v)}>
                        <Ionicons name={torchOn ? 'flash' : 'flash-outline'} size={18} color="#fff" />
                    </TouchableOpacity>
                </View>

                <View style={styles.frameArea}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                    <View style={styles.frameCenter}>
                        {busy ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Ionicons name="scan-outline" size={28} color="#fff" />
                        )}
                    </View>
                </View>
            </View>

            <ScrollView
                style={styles.sheet}
                contentContainerStyle={styles.sheetContent}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.statusRow}>
                    <View style={[styles.statusChip, { borderColor: confidenceColor(confidence) }]}>
                        <Ionicons
                            name={identityMatched ? 'checkmark-circle' : confidence === 'low' ? 'alert-circle-outline' : 'radio-outline'}
                            size={13}
                            color={identityMatched ? '#22C55E' : confidenceColor(confidence)}
                        />
                        <Text style={[styles.statusChipText, { color: identityMatched ? '#22C55E' : confidenceColor(confidence) }]}>
                            {identityMatched ? 'OLT MATCH' : confidence ? `OCR ${confidence.toUpperCase()}` : 'READY'}
                        </Text>
                    </View>
                    {barcodeValue ? (
                        <View style={styles.statusChip}>
                            <Ionicons name="barcode-outline" size={13} color="#38BDF8" />
                            <Text style={[styles.statusChipText, { color: '#38BDF8' }]}>BARCODE</Text>
                        </View>
                    ) : null}
                </View>

                {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
                ) : null}

                {scanError ? (
                    <View style={styles.errorBox}>
                        <Ionicons name="warning-outline" size={14} color="#FCA5A5" />
                        <Text style={styles.errorText}>{scanError}</Text>
                    </View>
                ) : null}

                <View style={styles.fieldGrid}>
                    <ScanField
                        label="MAC ID"
                        value={macAddress}
                        onChangeText={(v) => {
                            const normalized = normalizeMac(v);
                            setMacAddress((normalized ?? v).toUpperCase());
                            if (normalized) setOnuIdentifier(normalized);
                        }}
                        placeholder="8CC7C30E5B07"
                        mono
                    />
                    <ScanField
                        label="Serial / GPON SN"
                        value={serialNumber}
                        onChangeText={(v) => {
                            const next = v.toUpperCase();
                            setSerialNumber(next);
                            if (isGponSerial(next)) setOnuIdentifier(next);
                        }}
                        placeholder="GPON000E5B07"
                        mono
                    />
                    <ScanField
                        label="Device Model"
                        value={model}
                        onChangeText={(v) => setModel(v.toUpperCase())}
                        placeholder="HG323DAC"
                    />
                </View>

                {rawText ? (
                    <View style={styles.rawBox}>
                        <Text style={styles.rawTitle}>OCR Text</Text>
                        <Text style={styles.rawText} selectable numberOfLines={5}>{rawText}</Text>
                    </View>
                ) : null}

                <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.secondaryBtn, busy && styles.disabledBtn]} onPress={resetScan} disabled={busy}>
                        <Ionicons name="refresh" size={16} color="#CBD5E1" />
                        <Text style={styles.secondaryBtnText}>Rescan</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.captureBtn, busy && styles.disabledBtn]} onPress={captureStickerPhoto} disabled={busy}>
                        {capturing || processing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={16} color="#fff" />}
                        <Text style={styles.captureBtnText}>{photoUri ? 'Retake Photo' : 'Capture Sticker'}</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity style={[styles.applyBtn, busy && styles.disabledBtn]} onPress={applyResult} disabled={busy}>
                    {applying ? <ActivityIndicator size="small" color="#0F172A" /> : <Ionicons name="checkmark-circle" size={18} color="#0F172A" />}
                    <Text style={styles.applyBtnText}>Apply to Fields</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

function ScanField({
    label,
    value,
    onChangeText,
    placeholder,
    mono,
}: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    placeholder: string;
    mono?: boolean;
}) {
    return (
        <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{label}</Text>
            <TextInput
                style={[styles.input, mono && { fontFamily: 'monospace' }]}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor="#64748B"
                autoCapitalize="characters"
                autoCorrect={false}
            />
        </View>
    );
}

const CORNER_SIZE = 30;
const CORNER_THICKNESS = 4;

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
    fallbackText: { textAlign: 'center', fontSize: 14, marginTop: 12 },
    permText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
    btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 8 },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    cameraOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'space-between',
        paddingTop: 18,
        paddingBottom: 360,
    },
    topBar: {
        marginHorizontal: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: 'rgba(15,23,42,0.72)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    titleText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    targetText: { color: '#CBD5E1', fontSize: 12, marginTop: 1 },
    iconBtn: {
        width: 38,
        height: 38,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
    },
    frameArea: {
        alignSelf: 'center',
        width: 300,
        height: 210,
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
    },
    frameCenter: {
        width: 54,
        height: 54,
        borderRadius: 27,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15,23,42,0.45)',
    },
    corner: {
        position: 'absolute',
        width: CORNER_SIZE,
        height: CORNER_SIZE,
        borderColor: '#22C55E',
        borderWidth: 0,
    },
    topLeft: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
    topRight: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
    bottomLeft: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
    bottomRight: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '54%',
        backgroundColor: '#0F172A',
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
    },
    sheetContent: { padding: 16, paddingBottom: 28, gap: 12 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    statusChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderWidth: 1,
        borderColor: '#334155',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: '#111827',
    },
    statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    preview: { width: '100%', height: 118, borderRadius: 10, backgroundColor: '#020617' },
    errorBox: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'flex-start',
        borderWidth: 1,
        borderColor: '#7F1D1D',
        backgroundColor: '#450A0A',
        borderRadius: 8,
        padding: 10,
    },
    errorText: { color: '#FCA5A5', fontSize: 12, flex: 1, lineHeight: 16 },
    fieldGrid: { gap: 10 },
    inputGroup: { gap: 4 },
    inputLabel: { color: '#94A3B8', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
    input: {
        color: '#E2E8F0',
        backgroundColor: '#020617',
        borderWidth: 1,
        borderColor: '#334155',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
    },
    rawBox: { backgroundColor: '#020617', borderRadius: 8, borderWidth: 1, borderColor: '#334155', padding: 10 },
    rawTitle: { color: '#94A3B8', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
    rawText: { color: '#CBD5E1', fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
    actionRow: { flexDirection: 'row', gap: 10 },
    secondaryBtn: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: '#475569',
        borderRadius: 8,
        paddingVertical: 11,
    },
    secondaryBtnText: { color: '#CBD5E1', fontSize: 12, fontWeight: '800' },
    captureBtn: {
        flex: 2,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#2563EB',
        borderRadius: 8,
        paddingVertical: 11,
    },
    captureBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    applyBtn: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#22C55E',
        borderRadius: 10,
        paddingVertical: 13,
    },
    applyBtnText: { color: '#0F172A', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
    disabledBtn: { opacity: 0.55 },
});
