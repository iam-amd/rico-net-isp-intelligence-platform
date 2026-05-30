import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    ActivityIndicator,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../../constants/theme';
import { SurveyService, type OcrIdentityMatchType, type StickerOcrResponse, type SurveyDeviceSetup } from '../../services/collectionService';
import { CustomerService } from '../../services/customerService';
import { surveyDraftService, type NormalSurveyDraftInput } from '../../services/surveyDraftService';
import { stickerScanResultService, type StickerScanResult } from '../../services/stickerScanResultService';
import { Customer } from '../../types';
import { haptic } from '../../utils/haptics';

const SKIP_REASONS = [
    'Not home',
    'Access denied',
    'Wrong address',
    'ONT not accessible',
    'Disconnected',
    'Other',
];

const GPS_WARN_ACCURACY = 50;

export default function SurveyFormScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    // `id` is the customer username (street-walking flow) — NOT a numeric assignment id
    const customerUsername = String(id || '');
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Primary capture
    const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
    const [gpsLoading, setGpsLoading] = useState(false);
    const [onuIdentifier, setOnuIdentifier] = useState('');

    // Sticker scan data
    const [stickerPhotoUri, setStickerPhotoUri] = useState<string | null>(null);
    const [ontSerialNumber, setOntSerialNumber] = useState('');
    const [ontMacAddress, setOntMacAddress] = useState('');
    const [ontModel, setOntModel] = useState('');
    const [showStickerFields, setShowStickerFields] = useState(false);
    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrConfidence, setOcrConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
    // MAC-specific confidence: high=explicit format/label, medium=MAC line, low=fuzzy fallback
    const [macConfidence, setMacConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
    const [macInDatabase, setMacInDatabase] = useState<boolean | null>(null);
    const [identityInDatabase, setIdentityInDatabase] = useState<boolean | null>(null);
    const [identityStatus, setIdentityStatus] = useState<string | null>(null);
    const [identityMatchType, setIdentityMatchType] = useState<OcrIdentityMatchType>(null);
    const [identityLocation, setIdentityLocation] = useState<string | null>(null);
    const [ocrRawText, setOcrRawText] = useState<string | null>(null);
    const [showRawText, setShowRawText] = useState(false);
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [previewVisible, setPreviewVisible] = useState(false);
    const [deviceSetup, setDeviceSetup] = useState<SurveyDeviceSetup>('single_ont');
    const [ontStickerData, setOntStickerData] = useState<Record<string, any> | undefined>();

    // Router sticker (only when deviceSetup === 'onu_router')
    const [routerStickerUri, setRouterStickerUri] = useState<string | null>(null);
    const [routerMacAddress, setRouterMacAddress] = useState('');
    const [routerModel, setRouterModel] = useState('');
    const [routerSerial, setRouterSerial] = useState('');
    const [routerStickerData, setRouterStickerData] = useState<Record<string, any> | undefined>();
    const [routerOcrLoading, setRouterOcrLoading] = useState(false);
    const [routerPreviewVisible, setRouterPreviewVisible] = useState(false);

    // Optional enrichment
    const [altPhones, setAltPhones] = useState<string[]>([]);
    const [phoneDraft, setPhoneDraft] = useState('');

    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [skipModal, setSkipModal] = useState(false);
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [autoSaveDraft, setAutoSaveDraft] = useState(true);
    const [localDraftSavedAt, setLocalDraftSavedAt] = useState<string | null>(null);
    const [localDraftPendingSubmit, setLocalDraftPendingSubmit] = useState(false);
    const [localDraftPartial, setLocalDraftPartial] = useState(false);
    const [localDraftError, setLocalDraftError] = useState<string | null>(null);

    const clearLiveIdentity = () => {
        setMacInDatabase(null);
        setIdentityInDatabase(null);
        setIdentityStatus(null);
        setIdentityMatchType(null);
        setIdentityLocation(null);
    };

    const buildStickerData = (
        ocr: StickerOcrResponse,
        stickerType: 'ont' | 'router',
        photoUrl?: string | null,
    ) => ({
        stickerType,
        photoUrl: photoUrl ?? undefined,
        capturedAt: new Date().toISOString(),
        confidence: ocr.confidence,
        macConfidence: ocr.mac_confidence ?? null,
        deviceType: ocr.device_type,
        macAddress: ocr.mac_address,
        gponSn: ocr.gpon_sn,
        serialNumber: ocr.ont_serial_number,
        model: ocr.ont_model,
        serialCandidates: ocr.serial_candidates ?? [],
        macCandidates: ocr.mac_candidates ?? [],
        stickerFields: ocr.sticker_fields ?? {},
        rawText: ocr.raw_text ?? '',
        identityInDatabase: !!ocr.identity_in_database,
        identityStatus: ocr.identity_status ?? ocr.onu_status ?? null,
        identityMatchType: ocr.identity_match_type ?? null,
        identityMatchValue: ocr.identity_match_value ?? null,
        identityOltHost: ocr.identity_olt_host ?? null,
        identityPonPort: ocr.identity_pon_port ?? null,
        identityOnuIndex: ocr.identity_onu_index ?? null,
        error: ocr.error,
    });

    const buildStickerDataFromScan = (
        scan: StickerScanResult,
        scanStickerType: 'ont' | 'router',
    ) => ({
        stickerType: scanStickerType,
        photoUrl: scan.photoUrl ?? scan.photoUri ?? undefined,
        capturedAt: scan.capturedAt,
        confidence: scan.confidence,
        macConfidence: scan.macConfidence,
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
        identityStatus: scan.identityStatus,
        identityMatchType: scan.identityMatchType,
        identityMatchValue: scan.identityMatchValue,
        identityOltHost: scan.identityOltHost,
        identityPonPort: scan.identityPonPort,
        identityOnuIndex: scan.identityOnuIndex,
        error: scan.error,
    });

    const applyStickerScanResult = (scan: StickerScanResult, scanStickerType: 'ont' | 'router') => {
        const localPhoto = scan.photoUrl ?? scan.photoUri ?? null;
        const serial = scan.gponSn || scan.serialNumber || '';
        const mac = scan.macAddress || '';
        const extractedModel = scan.model || '';

        if (scanStickerType === 'router') {
            setRouterStickerUri(localPhoto);
            setRouterMacAddress(mac);
            setRouterSerial(serial);
            setRouterModel(extractedModel);
            setRouterStickerData(buildStickerDataFromScan(scan, 'router'));
            setRouterOcrLoading(false);
            setRouterPreviewVisible(false);
            haptic.success();
            return;
        }

        setStickerPhotoUri(localPhoto);
        setShowStickerFields(true);
        setOcrLoading(false);
        setOcrConfidence(scan.confidence);
        setMacConfidence(scan.macConfidence);
        setMacInDatabase(scan.identityInDatabase ?? null);
        setIdentityInDatabase(scan.identityInDatabase);
        setIdentityStatus(scan.identityStatus);
        setIdentityMatchType(scan.identityMatchType);
        setIdentityLocation([
            scan.identityOltHost,
            scan.identityPonPort,
            scan.identityOnuIndex != null ? `ONU ${scan.identityOnuIndex}` : null,
        ].filter(Boolean).join(' / ') || null);
        setOcrRawText(scan.rawText || null);
        setShowRawText(scan.confidence === 'low' || scan.macConfidence === 'low');
        setOcrError(scan.error || null);
        setOntStickerData(buildStickerDataFromScan(scan, 'ont'));
        setOnuIdentifier(scan.onuIdentifier || scan.gponSn || scan.macAddress || '');
        setOntMacAddress(mac);
        setOntSerialNumber(serial);
        setOntModel(extractedModel);
        if (scan.deviceType === 'router') {
            setDeviceSetup('onu_router');
        }
        haptic.success();
    };

    const hasDraftContent = () => (
        !!gps ||
        !!stickerPhotoUri ||
        !!routerStickerUri ||
        onuIdentifier.trim().length > 0 ||
        ontSerialNumber.trim().length > 0 ||
        ontMacAddress.trim().length > 0 ||
        ontModel.trim().length > 0 ||
        routerMacAddress.trim().length > 0 ||
        routerModel.trim().length > 0 ||
        routerSerial.trim().length > 0 ||
        altPhones.length > 0 ||
        phoneDraft.trim().length > 0 ||
        notes.trim().length > 0
    );

    const buildCurrentDraft = (
        partial = false,
        pendingSubmit = false,
        lastError?: string,
    ): NormalSurveyDraftInput => ({
        username: customerUsername,
        pendingSubmit,
        partial,
        gps,
        onuIdentifier,
        stickerPhotoUri,
        ontSerialNumber,
        ontMacAddress,
        ontModel,
        showStickerFields,
        ocrConfidence,
        macConfidence,
        macInDatabase,
        identityInDatabase,
        identityStatus,
        identityMatchType,
        identityLocation,
        ocrRawText,
        ocrError,
        deviceSetup,
        ontStickerData,
        routerStickerUri,
        routerMacAddress,
        routerModel,
        routerSerial,
        routerStickerData,
        altPhones,
        phoneDraft,
        notes,
        lastError,
    });

    const loadCustomer = useCallback(async () => {
        if (!customerUsername) {
            setLoadError('No customer selected');
            setLoading(false);
            return;
        }
        try {
            setLoadError(null);
            const c = await CustomerService.getByUsername(customerUsername);
            setCustomer(c);
        } catch (e: any) {
            setLoadError(e?.message || 'Failed to load customer');
        } finally {
            setLoading(false);
        }
    }, [customerUsername]);

    useEffect(() => {
        loadCustomer();
    }, [loadCustomer]);

    useEffect(() => {
        let active = true;

        (async () => {
            if (!customerUsername) {
                setDraftLoaded(true);
                return;
            }
            try {
                const draft = await surveyDraftService.getDraft(customerUsername);
                if (!active) return;
                if (draft) {
                    setGps(draft.gps);
                    setOnuIdentifier(draft.onuIdentifier);
                    setStickerPhotoUri(draft.stickerPhotoUri);
                    setOntSerialNumber(draft.ontSerialNumber);
                    setOntMacAddress(draft.ontMacAddress);
                    setOntModel(draft.ontModel);
                    setShowStickerFields(draft.showStickerFields || !!draft.stickerPhotoUri);
                    setOcrConfidence(draft.ocrConfidence);
                    setMacConfidence(draft.macConfidence);
                    setMacInDatabase(draft.macInDatabase);
                    setIdentityInDatabase(draft.identityInDatabase);
                    setIdentityStatus(draft.identityStatus);
                    setIdentityMatchType(draft.identityMatchType);
                    setIdentityLocation(draft.identityLocation);
                    setOcrRawText(draft.ocrRawText);
                    setOcrError(draft.ocrError);
                    setDeviceSetup(draft.deviceSetup);
                    setOntStickerData(draft.ontStickerData);
                    setRouterStickerUri(draft.routerStickerUri);
                    setRouterMacAddress(draft.routerMacAddress);
                    setRouterModel(draft.routerModel);
                    setRouterSerial(draft.routerSerial);
                    setRouterStickerData(draft.routerStickerData);
                    setAltPhones(draft.altPhones);
                    setPhoneDraft(draft.phoneDraft);
                    setNotes(draft.notes);
                    setLocalDraftSavedAt(draft.updatedAt);
                    setLocalDraftPendingSubmit(draft.pendingSubmit);
                    setLocalDraftPartial(draft.partial);
                    setLocalDraftError(draft.lastError ?? null);
                }
            } finally {
                if (active) setDraftLoaded(true);
            }
        })();

        return () => {
            active = false;
        };
    }, [customerUsername]);

    useFocusEffect(
        useCallback(() => {
            let active = true;
            (async () => {
                if (!customerUsername) return;
                const [ontScan, routerScan] = await Promise.all([
                    stickerScanResultService.consumeNormalSurveyResult(customerUsername, 'ont'),
                    stickerScanResultService.consumeNormalSurveyResult(customerUsername, 'router'),
                ]);
                if (!active) return;
                if (ontScan) applyStickerScanResult(ontScan, 'ont');
                if (routerScan) applyStickerScanResult(routerScan, 'router');
            })();
            return () => {
                active = false;
            };
        }, [customerUsername]),
    );

    useEffect(() => {
        if (!draftLoaded || !autoSaveDraft || !customerUsername || !hasDraftContent()) return;

        const timeout = setTimeout(() => {
            surveyDraftService
                .saveDraft(buildCurrentDraft(localDraftPartial, localDraftPendingSubmit, localDraftError ?? undefined))
                .then((draft) => {
                    setLocalDraftSavedAt(draft.updatedAt);
                    setLocalDraftPendingSubmit(draft.pendingSubmit);
                    setLocalDraftPartial(draft.partial);
                    setLocalDraftError(draft.lastError ?? null);
                })
                .catch((error) => {
                    console.warn('[SurveyDraft] Auto-save failed:', error);
                });
        }, 700);

        return () => clearTimeout(timeout);
    }, [
        draftLoaded,
        autoSaveDraft,
        customerUsername,
        gps,
        onuIdentifier,
        stickerPhotoUri,
        ontSerialNumber,
        ontMacAddress,
        ontModel,
        showStickerFields,
        ocrConfidence,
        macConfidence,
        macInDatabase,
        identityInDatabase,
        identityStatus,
        identityMatchType,
        identityLocation,
        ocrRawText,
        ocrError,
        deviceSetup,
        ontStickerData,
        routerStickerUri,
        routerMacAddress,
        routerModel,
        routerSerial,
        routerStickerData,
        altPhones,
        phoneDraft,
        notes,
        localDraftPartial,
        localDraftPendingSubmit,
        localDraftError,
    ]);

    // ----------------------------------------------------------------
    // GPS
    // ----------------------------------------------------------------
    const captureGps = async () => {
        setGpsLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission denied', 'Location permission is required to capture GPS.');
                return;
            }
            const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });
            setGps({
                lat: loc.coords.latitude,
                lng: loc.coords.longitude,
                accuracy: loc.coords.accuracy ?? null,
            });
            haptic.success();
        } catch (e: any) {
            Alert.alert('GPS error', e?.message || 'Could not capture location');
        } finally {
            setGpsLoading(false);
        }
    };

    const openStickerScanner = (scanStickerType: 'ont' | 'router') => {
        router.push({
            pathname: '/scan-onu' as any,
            params: {
                mode: 'survey',
                stickerType: scanStickerType,
                customerUsername,
                customerName: customer
                    ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username
                    : customerUsername,
            },
        });
    };

    // ----------------------------------------------------------------
    // Sticker Photo (Step 2 camera)
    // ----------------------------------------------------------------
    const captureStickerPhoto = async () => {
        try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
                Alert.alert('Permission denied', 'Camera access is required to photograph the sticker.');
                return;
            }
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 1,
                allowsEditing: true,
            });
            if (!result.canceled && result.assets[0]) {
                const uri = result.assets[0].uri;
                setStickerPhotoUri(uri);
                setShowStickerFields(true);
                haptic.light();

                // Run OCR in background — auto-fill fields
                setOcrLoading(true);
                setOcrConfidence(null);
                setMacConfidence(null);
                setMacInDatabase(null);
                clearLiveIdentity();
                setOcrRawText(null);
                setShowRawText(false);
                setOcrError(null);
                try {
                    const ocr = await SurveyService.ocrSticker(uri);
                    setOcrConfidence(ocr.confidence);
                    setMacConfidence(ocr.mac_confidence ?? null);
                    setMacInDatabase(ocr.mac_in_database ?? null);
                    setIdentityInDatabase(ocr.identity_in_database ?? ocr.mac_in_database ?? null);
                    setIdentityStatus(ocr.identity_status ?? ocr.onu_status ?? null);
                    setIdentityMatchType(ocr.identity_match_type ?? (ocr.mac_in_database ? 'mac' : null));
                    setIdentityLocation([
                        ocr.identity_olt_host,
                        ocr.identity_pon_port,
                        ocr.identity_onu_index != null ? `ONU ${ocr.identity_onu_index}` : null,
                    ].filter(Boolean).join(' / ') || null);
                    setOcrRawText(ocr.raw_text || null);
                    if (ocr.error) {
                        setOcrError(ocr.error);
                    }
                    setOntStickerData(buildStickerData(ocr, 'ont', uri));
                    if (ocr.onu_identifier && !onuIdentifier) {
                        setOnuIdentifier(ocr.onu_identifier);
                    }
                    if (ocr.mac_address && !ontMacAddress) {
                        setOntMacAddress(ocr.mac_address);
                    }
                    if (ocr.ont_model && !ontModel) {
                        setOntModel(ocr.ont_model);
                    }
                    if (ocr.ont_serial_number && !ontSerialNumber) {
                        setOntSerialNumber(ocr.ont_serial_number);
                    }
                    if (ocr.device_type === 'router') {
                        setDeviceSetup('onu_router');
                    }
                    // Auto-show raw text when MAC confidence is low — tech must verify
                    if (ocr.mac_confidence === 'low' || ocr.mac_confidence == null) {
                        setShowRawText(true);
                    }
                    if (ocr.confidence !== 'low') haptic.success();
                    else haptic.error();
                } catch (e: any) {
                    setOcrConfidence('low');
                    clearLiveIdentity();
                    setOcrError(e?.message || 'Network error');
                } finally {
                    setOcrLoading(false);
                }
            }
        } catch (e: any) {
            Alert.alert('Camera error', e?.message || 'Could not capture sticker photo');
        }
    };

    // ----------------------------------------------------------------
    // Router Sticker Photo (only when deviceSetup === 'onu_router')
    // ----------------------------------------------------------------
    const captureRouterStickerPhoto = async () => {
        try {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission needed', 'Camera access is required to photograph the router sticker.');
                return;
            }
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 1,
                allowsEditing: true,
            });
            if (!result.canceled && result.assets[0]) {
                const uri = result.assets[0].uri;
                setRouterStickerUri(uri);
                setRouterOcrLoading(true);
                try {
                    const ocr = await SurveyService.ocrSticker(uri);
                    setRouterStickerData(buildStickerData(ocr, 'router', uri));
                    if (ocr.mac_address && !routerMacAddress) setRouterMacAddress(ocr.mac_address);
                    if (ocr.ont_model && !routerModel) setRouterModel(ocr.ont_model);
                    if ((ocr.ont_serial_number || ocr.gpon_sn) && !routerSerial) {
                        setRouterSerial(ocr.ont_serial_number || ocr.gpon_sn || '');
                    }
                    haptic.success();
                } catch {
                    // OCR failure is non-critical for router — tech fills manually
                } finally {
                    setRouterOcrLoading(false);
                }
            }
        } catch (e: any) {
            Alert.alert('Camera error', e?.message || 'Could not capture router sticker photo');
        }
    };

    // ----------------------------------------------------------------
    // Alt phones (chip input)
    // ----------------------------------------------------------------
    const addPhoneChip = () => {
        const cleaned = phoneDraft.trim().replace(/\D/g, '');
        if (!cleaned) return;
        if (cleaned.length !== 10) {
            Alert.alert('Invalid number', 'Please enter a 10-digit mobile number (digits only).');
            return;
        }
        // Check if already in database for this customer
        const existingPhones = [
            customer?.phone?.replace(/\D/g, ''),
            ...(customer?.phones?.map(p => p.phone_number?.replace(/\D/g, '')) || []),
        ].filter(Boolean);
        if (existingPhones.includes(cleaned)) {
            Alert.alert('Already saved', 'This number is already recorded for this customer.');
            setPhoneDraft('');
            return;
        }
        if (altPhones.includes(cleaned)) {
            setPhoneDraft('');
            return;
        }
        setAltPhones([...altPhones, cleaned]);
        setPhoneDraft('');
    };

    const removePhoneChip = (phone: string) => {
        setAltPhones(altPhones.filter((p) => p !== phone));
    };

    // ----------------------------------------------------------------
    // Submit (full + partial)
    // ----------------------------------------------------------------
    const hasGps = !!gps;
    const hasSticker = (
        onuIdentifier.trim().length >= 4 ||
        ontSerialNumber.trim().length >= 4 ||
        ontMacAddress.trim().length >= 4
    );
    const hasExistingGps = !!(customer?.gps_lat && customer?.gps_lng);
    // GPS is strongly recommended but not a hard blocker — tech confirms via dialog if missing
    const canSubmitFull = hasSticker;   // GPS missing or reused from file -> warn only when needed
    const canSubmitPartial = hasGps || hasExistingGps || hasSticker;

    const doSubmit = async (partial: boolean) => {
        // Warn but allow submit without GPS — tech may be in a poor signal area
        if (!gps && !hasExistingGps) {
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    'No GPS Captured',
                    'You have not captured a GPS location. The survey will be submitted without coordinates and flagged for review. Continue?',
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                        { text: 'Submit Anyway', style: 'destructive', onPress: () => resolve(true) },
                    ],
                );
            });
            if (!proceed) return;
        }

        // Warn on low GPS accuracy (only if GPS was actually captured)
        if (gps && gps.accuracy != null && gps.accuracy > GPS_WARN_ACCURACY) {
            const proceed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                    'Low GPS accuracy',
                    `Accuracy is ${gps!.accuracy!.toFixed(0)}m. Consider stepping outside for a cleaner fix. Continue anyway?`,
                    [
                        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                        { text: 'Submit anyway', onPress: () => resolve(true) },
                    ],
                );
            });
            if (!proceed) return;
        }

        const draftForSubmit = buildCurrentDraft(partial, true);

        setSubmitting(true);
        try {
            await surveyDraftService.saveDraft(draftForSubmit);
            setLocalDraftPendingSubmit(true);
            setLocalDraftPartial(partial);
            setLocalDraftError(null);

            const result = await surveyDraftService.submitDraft(draftForSubmit);

            haptic.success();
            setAutoSaveDraft(false);
            setLocalDraftSavedAt(null);
            setLocalDraftPendingSubmit(false);
            setLocalDraftError(null);

            const title =
                result.status === 'partial'
                    ? 'Partial saved'
                    : result.status === 'duplicate'
                        ? 'Duplicate detected'
                        : result.warnings.length
                            ? 'Submitted — flagged for review'
                            : 'Saved';
            const body2 = result.warnings.length
                ? `${result.message}\n\n${result.warnings.join('\n')}`
                : result.message;
            Alert.alert(title, body2, [{ text: 'OK', onPress: () => router.back() }]);
        } catch (e: any) {
            const message = e?.message || 'Please try again';
            const savedDraft = await surveyDraftService.saveDraft({
                ...draftForSubmit,
                pendingSubmit: true,
                partial,
                lastError: message,
            });
            setLocalDraftSavedAt(savedDraft.updatedAt);
            setLocalDraftPendingSubmit(true);
            setLocalDraftPartial(partial);
            setLocalDraftError(message);
            Alert.alert(
                'Saved locally',
                `${message}\n\nThis survey is stored on this phone with photos and OCR data. Reopen this customer and tap Retry Sync when network is back.`,
            );
        } finally {
            setSubmitting(false);
        }
    };

    const handleSkip = async (reason: string) => {
        setSkipModal(false);
        setSubmitting(true);
        try {
            // Map legacy labels to the new enum
            const reasonMap: Record<string, 'not_home' | 'refused' | 'locked' | 'wrong_address' | 'other'> = {
                'Not home': 'not_home',
                'Access denied': 'locked',
                'Wrong address': 'wrong_address',
                'ONT not accessible': 'locked',
                'Disconnected': 'other',
                'Other': 'other',
            };
            const mapped = reasonMap[reason] || 'other';
            await SurveyService.skipByCustomer(customerUsername, mapped, reason);
            await surveyDraftService.clearDraft(customerUsername);
            setAutoSaveDraft(false);
            setLocalDraftSavedAt(null);
            setLocalDraftPendingSubmit(false);
            setLocalDraftError(null);
            haptic.light();
            router.back();
        } catch (e: any) {
            Alert.alert('Skip failed', e?.message || 'Please try again');
        } finally {
            setSubmitting(false);
        }
    };

    // ----------------------------------------------------------------
    // Render
    // ----------------------------------------------------------------
    if (loading) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <Stack.Screen options={{ title: 'Survey' }} />
                <ActivityIndicator size="large" color={C.primary} />
            </View>
        );
    }

    if (loadError || !customer) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <Stack.Screen options={{ title: 'Survey' }} />
                <Ionicons name="alert-circle" size={48} color={C.text.light} />
                <Text style={[styles.errorTitle, { color: C.text.primary }]}>
                    {loadError || 'Customer not found'}
                </Text>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username;
    const customerAddress = customer.rico_address || customer.railwire_address || '—';
    const alreadyBound = !!(customer.mac_address || customer.ont_serial_number);
    // No ownership lock in the walk-in flow — any tech can re-survey to correct.
    const disabled = false;
    const identityMatched = identityInDatabase === true || macInDatabase === true;
    const identityMatchLabel =
        identityMatchType === 'serial'
            ? 'serial'
            : identityMatchType === 'mac_4a_fix'
                ? 'MAC corrected'
                : identityMatchType === 'mac'
                    ? 'MAC'
                    : 'OLT';
    const draftTimeLabel = localDraftSavedAt
        ? new Date(localDraftSavedAt).toLocaleString()
        : null;
    const retryDraftDisabled = submitting || (!gps && !hasExistingGps && !hasSticker) || (!localDraftPartial && !hasSticker);

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: C.background }]}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
        >
            <Stack.Screen options={{ title: `Survey: ${customer.username}` }} />

            {/* Customer info */}
            <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[styles.customerName, { color: C.text.primary }]}>
                    {customerName}
                </Text>
                <View style={styles.infoRow}>
                    <Ionicons name="call" size={13} color={C.text.light} />
                    <Text style={[styles.infoText, { color: C.text.secondary }]}>
                        {customer.phone || '—'}
                    </Text>
                </View>
                <View style={styles.infoRow}>
                    <Ionicons name="location" size={13} color={C.text.light} />
                    <Text style={[styles.infoText, { color: C.text.secondary }]}>
                        {customerAddress}
                    </Text>
                </View>
                {customer.pg_name && (
                    <View style={[styles.warnChip, { backgroundColor: '#fef9c3', borderColor: '#fde047' }]}>
                        <Ionicons name="people" size={13} color="#854d0e" />
                        <Text style={[styles.warnText, { color: '#854d0e' }]}>
                            PG Group: {customer.pg_name} — visit all customers in this building
                        </Text>
                    </View>
                )}
                {alreadyBound && (
                    <View style={styles.warnChip}>
                        <Ionicons name="information-circle" size={13} color={COLORS.state.info} />
                        <Text style={styles.warnText}>
                            Already bound: {customer.mac_address || customer.ont_serial_number} - this will update it.
                        </Text>
                    </View>
                )}
            </View>

            {localDraftSavedAt && (
                <View style={[styles.draftBanner, { backgroundColor: localDraftPendingSubmit ? '#fff7ed' : '#eff6ff', borderColor: localDraftPendingSubmit ? '#fed7aa' : '#bfdbfe' }]}>
                    <View style={[styles.draftIcon, { backgroundColor: localDraftPendingSubmit ? '#ffedd5' : '#dbeafe' }]}>
                        <Ionicons
                            name={localDraftPendingSubmit ? 'cloud-upload-outline' : 'save-outline'}
                            size={18}
                            color={localDraftPendingSubmit ? '#c2410c' : '#1d4ed8'}
                        />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.draftTitle, { color: localDraftPendingSubmit ? '#9a3412' : '#1e40af' }]}>
                            {localDraftPendingSubmit ? 'Sync pending on this phone' : 'Draft auto-saved on this phone'}
                        </Text>
                        <Text style={[styles.draftSub, { color: localDraftPendingSubmit ? '#c2410c' : '#2563eb' }]}>
                            {localDraftError ? `Last error: ${localDraftError}` : `Saved ${draftTimeLabel}`}
                        </Text>
                    </View>
                    {localDraftPendingSubmit && (
                        <TouchableOpacity
                            style={[styles.draftRetryBtn, retryDraftDisabled && { opacity: 0.45 }]}
                            onPress={() => doSubmit(localDraftPartial)}
                            disabled={retryDraftDisabled}
                        >
                            <Text style={styles.draftRetryText}>{submitting ? 'Syncing' : 'Retry'}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* Step 1: GPS */}
            <SectionCard title="1. Capture GPS" subtitle="Stand at the customer's home" isDark={isDarkMode}>
                <TouchableOpacity
                    style={[
                        styles.bigBtn,
                        gps ? { backgroundColor: COLORS.state.success } : { backgroundColor: C.primary },
                    ]}
                    onPress={captureGps}
                    disabled={gpsLoading || disabled}
                >
                    {gpsLoading ? (
                        <ActivityIndicator color="#fff" />
                    ) : gps ? (
                        <>
                            <Ionicons name="checkmark-circle" size={20} color="#fff" />
                            <Text style={styles.bigBtnText}>GPS Captured — Recapture</Text>
                        </>
                    ) : (
                        <>
                            <Ionicons name="locate" size={20} color="#fff" />
                            <Text style={styles.bigBtnText}>Capture Location</Text>
                        </>
                    )}
                </TouchableOpacity>

                {gps && (
                    <View style={styles.gpsInfo}>
                        <Text style={[styles.gpsText, { color: C.text.secondary }]}>
                            {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                        </Text>
                        {gps.accuracy != null && (
                            <Text
                                style={[
                                    styles.gpsAccuracy,
                                    {
                                        color:
                                            gps.accuracy > GPS_WARN_ACCURACY
                                                ? COLORS.state.warning
                                                : COLORS.state.success,
                                    },
                                ]}
                            >
                                ±{gps.accuracy.toFixed(0)}m{' '}
                                {gps.accuracy > GPS_WARN_ACCURACY ? '(poor — step outside)' : '(good)'}
                            </Text>
                        )}
                    </View>
                )}
            </SectionCard>

            {/* Step 2: ONT Sticker Scanner */}
            <SectionCard
                title={deviceSetup === 'onu_router' ? '2. Scan ONU Sticker' : '2. Scan ONT Sticker'}
                subtitle="Photograph the sticker — text is auto-extracted. Fix if wrong."
                isDark={isDarkMode}
            >
                {/* Device setup selector */}
                <View style={styles.deviceToggleRow}>
                    <TouchableOpacity
                        style={[styles.deviceToggleBtn, deviceSetup === 'single_ont' && styles.deviceToggleBtnActive]}
                        onPress={() => setDeviceSetup('single_ont')}
                    >
                        <Ionicons name="cube" size={14} color={deviceSetup === 'single_ont' ? '#fff' : C.text.secondary} />
                        <Text style={[styles.deviceToggleText, deviceSetup === 'single_ont' && { color: '#fff' }]}>
                            Single ONT
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.deviceToggleBtn, deviceSetup === 'onu_router' && styles.deviceToggleBtnActive]}
                        onPress={() => setDeviceSetup('onu_router')}
                    >
                        <Ionicons name="git-branch" size={14} color={deviceSetup === 'onu_router' ? '#fff' : C.text.secondary} />
                        <Text style={[styles.deviceToggleText, deviceSetup === 'onu_router' && { color: '#fff' }]}>
                            ONU + Router
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Camera button */}
                <TouchableOpacity
                    style={[
                        styles.bigBtn,
                        stickerPhotoUri
                            ? { backgroundColor: COLORS.state.success }
                            : { backgroundColor: '#6366f1' },
                    ]}
                    onPress={() => openStickerScanner('ont')}
                    disabled={disabled || ocrLoading}
                >
                    {ocrLoading ? (
                        <>
                            <ActivityIndicator color="#fff" size="small" />
                            <Text style={styles.bigBtnText}>Reading sticker...</Text>
                        </>
                    ) : (
                        <>
                            <Ionicons
                                name={stickerPhotoUri ? 'checkmark-circle' : 'scan'}
                                size={20}
                                color="#fff"
                            />
                            <Text style={styles.bigBtnText}>
                                {stickerPhotoUri ? 'Rescan Sticker' : 'Scan Sticker'}
                            </Text>
                        </>
                    )}
                </TouchableOpacity>

                {/* Camera tip — shown only before first photo */}
                {!stickerPhotoUri && !ocrLoading && (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, opacity: 0.7 }}>
                        <Ionicons name="information-circle-outline" size={13} color={C.text.light} style={{ marginTop: 1 }} />
                        <Text style={{ fontSize: 11, color: C.text.light, flex: 1, lineHeight: 16 }}>
                            Tip: Hold close (20–30 cm), keep steady, ensure good lighting. Avoid shadows and glare on the sticker.
                        </Text>
                    </View>
                )}

                {/* OCR confidence badge */}
                {ocrConfidence && !ocrLoading && (
                    <View style={[styles.ocrBadge, {
                        backgroundColor: ocrConfidence === 'high' ? COLORS.state.success + '20'
                            : ocrConfidence === 'medium' ? COLORS.state.warning + '20'
                            : COLORS.state.danger + '20',
                    }]}>
                        <Ionicons
                            name={ocrConfidence === 'high' ? 'checkmark-circle' : ocrConfidence === 'medium' ? 'warning' : 'alert-circle'}
                            size={14}
                            color={ocrConfidence === 'high' ? COLORS.state.success : ocrConfidence === 'medium' ? COLORS.state.warning : COLORS.state.danger}
                        />
                        <Text style={[styles.ocrBadgeText, {
                            color: ocrConfidence === 'high' ? COLORS.state.success : ocrConfidence === 'medium' ? COLORS.state.warning : COLORS.state.danger,
                        }]}>
                            {ocrConfidence === 'high' ? 'Auto-filled — please verify'
                                : ocrConfidence === 'medium' ? 'Partially read — fill missing fields'
                                : ocrError ? `OCR failed — type manually`
                                : 'Could not read — enter manually'}
                        </Text>
                    </View>
                )}

                {/* Sticker photo preview — tap to fullscreen */}
                {stickerPhotoUri && (
                    <TouchableOpacity
                        onPress={() => setPreviewVisible(true)}
                        activeOpacity={0.85}
                        style={styles.stickerPreviewWrapper}
                    >
                        <Image source={{ uri: stickerPhotoUri }} style={styles.stickerPreview} resizeMode="contain" />
                        <View style={styles.stickerPreviewOverlay}>
                            <Ionicons name="expand-outline" size={18} color="#fff" />
                            <Text style={styles.stickerPreviewOverlayText}>Tap to expand</Text>
                        </View>
                    </TouchableOpacity>
                )}

                {/* Fullscreen image preview modal */}
                <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
                    <View style={styles.fullscreenOverlay}>
                        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPreviewVisible(false)} />
                        <Image
                            source={{ uri: stickerPhotoUri || undefined }}
                            style={styles.fullscreenImage}
                            resizeMode="contain"
                        />
                        <TouchableOpacity style={styles.fullscreenClose} onPress={() => setPreviewVisible(false)}>
                            <Ionicons name="close-circle" size={40} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </Modal>

                {/* Toggle fields manually if no photo taken */}
                {!showStickerFields && !stickerPhotoUri && (
                    <TouchableOpacity
                        style={styles.toggleFieldsBtn}
                        onPress={() => setShowStickerFields(true)}
                    >
                        <Ionicons name="pencil" size={14} color={C.primary} />
                        <Text style={[styles.toggleFieldsText, { color: C.primary }]}>
                            Enter details manually
                        </Text>
                    </TouchableOpacity>
                )}

                {/* Sticker data fields */}
                {(showStickerFields || stickerPhotoUri) && (
                    <View style={styles.stickerFields}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <Text style={[styles.fieldLabel, { color: C.text.secondary, marginBottom: 0, flex: 1 }]}>
                                MAC Address or GPON SN *
                            </Text>
                            {identityMatched && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                    <Ionicons name="checkmark-circle" size={13} color={COLORS.state.success} />
                                    <Text style={{ fontSize: 11, color: COLORS.state.success, fontWeight: '600' }}>
                                        In OLT DB ({identityMatchLabel})
                                    </Text>
                                </View>
                            )}
                        </View>
                        <TextInput
                            style={[styles.input, {
                                backgroundColor: C.background,
                                color: C.text.primary,
                                borderColor: identityMatched
                                    ? COLORS.state.success
                                    : macConfidence === 'low'
                                        ? COLORS.state.danger
                                        : macConfidence === 'medium'
                                            ? COLORS.state.warning
                                            : C.border,
                                borderWidth: (macConfidence === 'low' || identityMatched) ? 2 : 1,
                            }]}
                            placeholder="8CC7C3XXXXXX or ALCL12345678"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={onuIdentifier}
                            onChangeText={(value) => {
                                setOnuIdentifier(value);
                                clearLiveIdentity();
                            }}
                            editable={!disabled}
                        />
                        {macConfidence === 'low' && !identityMatched && (
                            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4, marginBottom: 4 }}>
                                <Ionicons name="alert-circle" size={13} color={COLORS.state.danger} style={{ marginTop: 1 }} />
                                <Text style={{ fontSize: 11, color: COLORS.state.danger, flex: 1, lineHeight: 16 }}>
                                    OCR uncertain — compare this identifier against the sticker label before submitting.
                                </Text>
                            </View>
                        )}
                        {macConfidence === 'medium' && !identityMatched && (
                            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4, marginBottom: 4 }}>
                                <Ionicons name="warning-outline" size={13} color={COLORS.state.warning} style={{ marginTop: 1 }} />
                                <Text style={{ fontSize: 11, color: COLORS.state.warning, flex: 1, lineHeight: 16 }}>
                                    Verify the identifier matches the sticker label.
                                </Text>
                            </View>
                        )}
                        <Text style={[styles.hint, { color: C.text.light, marginBottom: 10 }]}>
                            Auto-detects: MAC → EPON, GPON serial/SN → GPON. GPON serial is checked first.
                        </Text>
                        {identityMatched && (
                            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginBottom: 10 }}>
                                <Ionicons name="radio" size={13} color={COLORS.state.success} style={{ marginTop: 1 }} />
                                <Text style={{ fontSize: 11, color: COLORS.state.success, flex: 1, lineHeight: 16, fontWeight: '600' }}>
                                    Live OLT match: {identityStatus || 'status unknown'}{identityLocation ? ` / ${identityLocation}` : ''}
                                </Text>
                            </View>
                        )}

                        <Text style={[styles.fieldLabel, { color: C.text.secondary }]}>
                            MAC Address Printed On Sticker
                        </Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border, marginBottom: 10 }]}
                            placeholder="Optional, e.g. 8CC7C3XXXXXX"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={ontMacAddress}
                            onChangeText={setOntMacAddress}
                            editable={!disabled}
                        />

                        {/* Raw OCR text — always shown when mac_confidence is low; collapsible otherwise */}
                        {ocrRawText && (
                            <View style={{ marginBottom: 10 }}>
                                <TouchableOpacity
                                    onPress={() => setShowRawText(v => !v)}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons
                                        name={showRawText ? 'chevron-down' : 'chevron-forward'}
                                        size={13}
                                        color={macConfidence === 'low' ? COLORS.state.danger : C.text.light}
                                    />
                                    <Text style={{ fontSize: 11, color: macConfidence === 'low' ? COLORS.state.danger : C.text.light, fontWeight: macConfidence === 'low' ? '600' : '400' }}>
                                        {macConfidence === 'low' ? 'OCR text — find MAC here manually' : 'View OCR text'}
                                    </Text>
                                </TouchableOpacity>
                                {showRawText && (
                                    <View style={{ backgroundColor: C.border + '40', borderRadius: 6, padding: 8, borderLeftWidth: 3, borderLeftColor: macConfidence === 'low' ? COLORS.state.danger : COLORS.state.warning }}>
                                        <Text style={{ fontFamily: 'monospace', fontSize: 11, color: C.text.secondary, lineHeight: 18 }} selectable>
                                            {ocrRawText}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        )}

                        <Text style={[styles.fieldLabel, { color: C.text.secondary }]}>
                            Serial Number (S/N)
                        </Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border, marginBottom: 10 }]}
                            placeholder="e.g. NL12345678"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={ontSerialNumber}
                            onChangeText={setOntSerialNumber}
                            editable={!disabled}
                        />

                        <Text style={[styles.fieldLabel, { color: C.text.secondary }]}>
                            Model
                        </Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border, marginBottom: 10 }]}
                            placeholder="e.g. GP1101D, HG8145V5"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={ontModel}
                            onChangeText={setOntModel}
                            editable={!disabled}
                        />

                    </View>
                )}
            </SectionCard>

            {/* Router Sticker - only shown when ONU + Router */}
            {deviceSetup === 'onu_router' && (
                <SectionCard
                    title="2b. Router Sticker"
                    subtitle="Photograph the TP-Link / router label — model & serial extracted automatically"
                    isDark={isDarkMode}
                >
                    <TouchableOpacity
                        style={[styles.bigBtn, routerStickerUri ? { backgroundColor: COLORS.state.success } : { backgroundColor: '#f97316' }]}
                        onPress={() => openStickerScanner('router')}
                        disabled={disabled || routerOcrLoading}
                    >
                        {routerOcrLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Ionicons name="wifi" size={20} color="#fff" />
                        )}
                        <Text style={styles.bigBtnText}>
                            {routerStickerUri ? 'Rescan Router Sticker' : 'Scan Router Sticker'}
                        </Text>
                    </TouchableOpacity>

                    {routerStickerUri && (
                        <>
                            <TouchableOpacity
                                onPress={() => setRouterPreviewVisible(true)}
                                activeOpacity={0.85}
                                style={styles.stickerPreviewWrapper}
                            >
                                <Image source={{ uri: routerStickerUri }} style={styles.stickerPreview} resizeMode="contain" />
                                <View style={styles.stickerPreviewOverlay}>
                                    <Ionicons name="expand-outline" size={18} color="#fff" />
                                    <Text style={styles.stickerPreviewOverlayText}>Tap to expand</Text>
                                </View>
                            </TouchableOpacity>
                            <Modal visible={routerPreviewVisible} transparent animationType="fade" onRequestClose={() => setRouterPreviewVisible(false)}>
                                <View style={styles.fullscreenOverlay}>
                                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setRouterPreviewVisible(false)} />
                                    <Image source={{ uri: routerStickerUri }} style={styles.fullscreenImage} resizeMode="contain" />
                                    <TouchableOpacity style={styles.fullscreenClose} onPress={() => setRouterPreviewVisible(false)}>
                                        <Ionicons name="close-circle" size={40} color="#fff" />
                                    </TouchableOpacity>
                                </View>
                            </Modal>
                        </>
                    )}

                    <View style={styles.stickerFields}>
                        <Text style={[styles.fieldLabel, { color: C.text.secondary }]}>Router MAC Address</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border, marginBottom: 10 }]}
                            placeholder="Optional, e.g. 8CC7C3XXXXXX"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={routerMacAddress}
                            onChangeText={setRouterMacAddress}
                            editable={!disabled}
                        />
                        <Text style={[styles.fieldLabel, { color: C.text.secondary }]}>Router Model</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border, marginBottom: 10 }]}
                            placeholder="e.g. Archer C24, TL-WR841N"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="words"
                            autoCorrect={false}
                            value={routerModel}
                            onChangeText={setRouterModel}
                            editable={!disabled}
                        />
                        <Text style={[styles.fieldLabel, { color: C.text.secondary }]}>Router Serial Number</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border }]}
                            placeholder="e.g. 221420403838"
                            placeholderTextColor={C.text.light}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            value={routerSerial}
                            onChangeText={setRouterSerial}
                            editable={!disabled}
                        />
                    </View>
                </SectionCard>
            )}

            {/* Step 3: Alt phones + notes */}
            <SectionCard
                title="3. Extras (optional)"
                subtitle="Add any secondary numbers used to identify the customer"
                isDark={isDarkMode}
            >
                <View style={styles.chipRow}>
                    {altPhones.map((p) => (
                        <TouchableOpacity
                            key={p}
                            style={styles.chip}
                            onPress={() => removePhoneChip(p)}
                        >
                            <Text style={styles.chipText}>{p}</Text>
                            <Ionicons name="close" size={12} color="#fff" />
                        </TouchableOpacity>
                    ))}
                </View>
                <View style={styles.row}>
                    <TextInput
                        style={[styles.input, { flex: 1, backgroundColor: C.background, color: C.text.primary, borderColor: C.border }]}
                        placeholder="Add alt phone"
                        placeholderTextColor={C.text.light}
                        keyboardType="phone-pad"
                        value={phoneDraft}
                        onChangeText={setPhoneDraft}
                        onSubmitEditing={addPhoneChip}
                        returnKeyType="done"
                        editable={!disabled}
                    />
                    <TouchableOpacity
                        style={[styles.addBtn, !phoneDraft.trim() && { opacity: 0.4 }]}
                        onPress={addPhoneChip}
                        disabled={!phoneDraft.trim() || disabled}
                    >
                        <Ionicons name="add" size={22} color="#fff" />
                    </TouchableOpacity>
                </View>
                <TextInput
                    style={[styles.input, { backgroundColor: C.background, color: C.text.primary, borderColor: C.border, marginTop: 8, height: 60 }]}
                    placeholder="Notes (optional)"
                    placeholderTextColor={C.text.light}
                    multiline
                    value={notes}
                    onChangeText={setNotes}
                    editable={!disabled}
                />
            </SectionCard>

            {/* Submit / Partial / Skip */}
            {!disabled && (
                <>
                    {/* Inline hint — explains why submit may warn */}
                    {(!hasGps || !hasSticker) && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                            {!hasGps && !hasExistingGps && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7C3AED20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                                    <Ionicons name="location-outline" size={13} color="#7C3AED" />
                                    <Text style={{ fontSize: 11, color: '#7C3AED', fontWeight: '600' }}>GPS not captured — tap above to fix</Text>
                                </View>
                            )}
                            {!hasGps && hasExistingGps && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10B98120', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                                    <Ionicons name="location" size={13} color="#059669" />
                                    <Text style={{ fontSize: 11, color: '#059669', fontWeight: '600' }}>Using existing GPS on file</Text>
                                </View>
                            )}
                            {!hasSticker && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#D9770620', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                                    <Ionicons name="scan-outline" size={13} color="#D97706" />
                                    <Text style={{ fontSize: 11, color: '#D97706', fontWeight: '600' }}>No ONT sticker scanned yet</Text>
                                </View>
                            )}
                        </View>
                    )}

                    <TouchableOpacity
                        style={[styles.submitBtn, !canSubmitFull && styles.submitBtnDisabled]}
                        onPress={() => doSubmit(false)}
                        disabled={!canSubmitFull || submitting}
                    >
                        {submitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <>
                                <Ionicons name="cloud-upload" size={18} color="#fff" />
                                <Text style={styles.submitBtnText}>Submit</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.partialBtn,
                            !canSubmitPartial && { opacity: 0.4 },
                        ]}
                        onPress={() =>
                            Alert.alert(
                                'Mark as Partial',
                                hasSticker
                                    ? 'Submit the captured sticker details as a partial correction. Existing GPS, if already on file, will stay attached.'
                                    : 'Submit the captured GPS as a partial survey. Admin will follow up on the ONT sticker.',
                                [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Yes', onPress: () => doSubmit(true) },
                                ],
                            )
                        }
                        disabled={!canSubmitPartial || submitting}
                    >
                        <Ionicons name="warning-outline" size={16} color={COLORS.state.warning} />
                        <Text style={styles.partialBtnText}>
                            Save Partial Update
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.skipBtn, { borderColor: C.border }]}
                        onPress={() => setSkipModal(true)}
                        disabled={submitting}
                    >
                        <Ionicons name="close-circle-outline" size={16} color={COLORS.state.danger} />
                        <Text style={styles.skipBtnText}>Skip assignment</Text>
                    </TouchableOpacity>
                </>
            )}

            {disabled && (
                <View style={[styles.doneBanner, { backgroundColor: COLORS.state.success + '20' }]}>
                    <Ionicons name="checkmark-done" size={18} color={COLORS.state.success} />
                    <Text style={styles.doneBannerText}>This assignment is already complete.</Text>
                </View>
            )}

            {/* Skip modal */}
            <Modal visible={skipModal} transparent animationType="fade" onRequestClose={() => setSkipModal(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[styles.modalTitle, { color: C.text.primary }]}>Skip Reason</Text>
                        {SKIP_REASONS.map((reason) => (
                            <TouchableOpacity
                                key={reason}
                                style={[styles.reasonBtn, { borderColor: C.border }]}
                                onPress={() => handleSkip(reason)}
                            >
                                <Text style={[styles.reasonText, { color: C.text.primary }]}>{reason}</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            style={[styles.reasonBtn, { borderColor: C.border }]}
                            onPress={() => setSkipModal(false)}
                        >
                            <Text style={[styles.reasonText, { color: COLORS.state.danger }]}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

function SectionCard({
    title,
    subtitle,
    isDark,
    children,
}: {
    title: string;
    subtitle?: string;
    isDark: boolean;
    children: React.ReactNode;
}) {
    const C = isDark ? DARK_COLORS : COLORS;
    return (
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.sectionTitle, { color: C.text.primary }]}>{title}</Text>
            {subtitle && <Text style={[styles.sectionSub, { color: C.text.light }]}>{subtitle}</Text>}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
    scrollContent: { padding: SPACING.md, paddingBottom: 60 },
    card: {
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
    },
    sectionTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
    sectionSub: { fontSize: 11, marginBottom: SPACING.sm },
    customerName: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    infoText: { fontSize: 13, flex: 1 },
    warnChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: COLORS.state.info + '15',
        padding: 8,
        borderRadius: RADIUS.sm,
        marginTop: 8,
    },
    warnText: { fontSize: 11, color: COLORS.state.info, fontWeight: '600', flex: 1 },
    bigBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: RADIUS.md,
    },
    bigBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    gpsInfo: { marginTop: 10, alignItems: 'center' },
    gpsText: { fontSize: 13, fontWeight: '600' },
    gpsAccuracy: { fontSize: 11, marginTop: 2, fontWeight: '600' },
    hint: { fontSize: 11, marginTop: 6 },
    stickerPreviewWrapper: {
        marginTop: SPACING.sm,
        borderRadius: RADIUS.sm,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: '#000',
    },
    stickerPreview: {
        width: '100%',
        height: 300,
        borderRadius: RADIUS.sm,
    },
    stickerPreviewOverlay: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(0,0,0,0.55)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
    },
    stickerPreviewOverlayText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '600',
    },
    fullscreenOverlay: {
        flex: 1,
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullscreenImage: {
        width: '100%',
        height: '100%',
    },
    fullscreenClose: {
        position: 'absolute',
        top: 48,
        right: 16,
        zIndex: 10,
    },
    toggleFieldsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        marginTop: SPACING.sm,
    },
    toggleFieldsText: { fontSize: 13, fontWeight: '600' },
    deviceToggleRow: { flexDirection: 'row', gap: 6, marginBottom: SPACING.sm },
    deviceToggleBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 4, paddingVertical: 8, borderRadius: RADIUS.sm,
        borderWidth: 1, borderColor: COLORS.primary,
    },
    deviceToggleBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    deviceToggleText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
    ocrBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        padding: 8, borderRadius: RADIUS.sm, marginTop: SPACING.sm,
    },
    ocrBadgeText: { fontSize: 12, fontWeight: '600', flex: 1 },
    stickerFields: { marginTop: SPACING.sm },
    fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
    input: {
        borderWidth: 1,
        borderRadius: RADIUS.sm,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
    },
    row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    addBtn: {
        width: 42,
        height: 42,
        borderRadius: RADIUS.sm,
        backgroundColor: COLORS.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: COLORS.primary,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    preview: {
        width: '100%',
        height: 160,
        borderRadius: RADIUS.sm,
        marginTop: SPACING.sm,
        resizeMode: 'cover',
    },
    submitBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: RADIUS.md,
        backgroundColor: COLORS.state.success,
        marginTop: SPACING.sm,
    },
    submitBtnDisabled: { backgroundColor: '#CBD5E1' },
    submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    partialBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: COLORS.state.warning,
        marginTop: SPACING.sm,
    },
    partialBtnText: { color: COLORS.state.warning, fontSize: 13, fontWeight: '700' },
    skipBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        marginTop: SPACING.sm,
    },
    skipBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.state.danger },
    doneBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: SPACING.md,
        borderRadius: RADIUS.md,
    },
    doneBannerText: { fontSize: 13, color: COLORS.state.success, fontWeight: '600' },
    draftBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderRadius: RADIUS.md,
        padding: SPACING.sm,
        marginBottom: SPACING.md,
    },
    draftIcon: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftTitle: { fontSize: 12, fontWeight: '800' },
    draftSub: { fontSize: 10, marginTop: 2 },
    draftRetryBtn: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: RADIUS.sm,
        backgroundColor: '#ea580c',
    },
    draftRetryText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        padding: SPACING.lg,
    },
    modalCard: {
        borderRadius: RADIUS.md,
        padding: SPACING.md,
    },
    modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: SPACING.sm },
    reasonBtn: {
        paddingVertical: 12,
        borderTopWidth: 1,
    },
    reasonText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
    errorTitle: { fontSize: 16, fontWeight: '700', marginTop: 12, textAlign: 'center' },
    backBtn: {
        marginTop: 16,
        paddingVertical: 10,
        paddingHorizontal: 24,
        backgroundColor: COLORS.primary,
        borderRadius: RADIUS.md,
    },
    backBtnText: { color: '#fff', fontWeight: '700' },
});
