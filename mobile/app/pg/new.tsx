/**
 * New PG Building Enrollment — /pg/new
 * Collect: property photo, name, type, owner details, address, GPS.
 * Saves to PGContext (AsyncStorage, offline-first).
 */
import React, { useState } from 'react';
import {
    Alert, KeyboardAvoidingView, Platform, ScrollView,
    StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { usePG, PGType } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';
import { useSettings } from '../../context/SettingsContext';
import ModernPGNew from '../../components/modern/PGNew';

const BG = '#0D1B2A';
const CARD = '#1A2535';
const BORDER = '#2A3A4A';
const ORANGE = '#FF6B00';
const TEXT = '#E2E8F0';
const SUB = '#64748B';
const INPUT_BG = '#0F2133';

const PG_TYPES: PGType[] = ['Ladies', 'Gents', 'Mixed'];
const TYPE_COLORS: Record<PGType, string> = { Ladies: '#EC4899', Gents: '#3B82F6', Mixed: '#8B5CF6' };

export default function NewPGScreen() {
    const router = useRouter();
    const { isModernUI } = useSettings();
    const { addBuilding } = usePG();

    if (isModernUI) return <ModernPGNew />;

    const [name, setName]               = useState('');
    const [type, setType]               = useState<PGType>('Ladies');
    const [ownerName, setOwnerName]     = useState('');
    const [ownerMobile, setOwnerMobile] = useState('');
    const [ownerAlt, setOwnerAlt]       = useState('');
    const [address, setAddress]         = useState('');
    const [photoUri, setPhotoUri]       = useState<string | undefined>();
    const [gpsLat, setGpsLat]           = useState<number | undefined>();
    const [gpsLng, setGpsLng]           = useState<number | undefined>();
    const [gettingGps, setGettingGps]   = useState(false);
    const [saving, setSaving]           = useState(false);

    const pickPhoto = async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
            if (camStatus !== 'granted') return;
        }
        Alert.alert('Property Evidence', 'Choose photo source', [
            {
                text: 'Camera',
                onPress: async () => {
                    const result = await ImagePicker.launchCameraAsync({
                        mediaTypes: ['images'],
                        quality: 0.7,
                    });
                    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
                },
            },
            {
                text: 'Gallery',
                onPress: async () => {
                    const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'],
                        quality: 0.7,
                    });
                    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
                },
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    const getGps = async () => {
        setGettingGps(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location access is required to capture GPS coordinates.');
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            setGpsLat(loc.coords.latitude);
            setGpsLng(loc.coords.longitude);
            haptic.success();
        } catch {
            Alert.alert('GPS Error', 'Could not get current location. Try again.');
        } finally {
            setGettingGps(false);
        }
    };

    const handleSave = () => {
        if (!name.trim()) { Alert.alert('Required', 'PG building name is required.'); return; }

        setSaving(true);
        try {
            addBuilding({
                name: name.trim(),
                type,
                ownerName: ownerName.trim(),
                ownerMobile: ownerMobile.trim(),
                ownerAltMobile: ownerAlt.trim() || undefined,
                address: address.trim(),
                photoUri,
                gpsLat,
                gpsLng,
            });
            haptic.success();
            router.back();
        } finally {
            setSaving(false);
        }
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
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>NEW PROPERTY</Text>
                    <Text style={styles.headerSub}>Enrollment Form</Text>
                </View>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 16 }}
                keyboardShouldPersistTaps="handled"
            >
                {/* Photo Upload */}
                <TouchableOpacity style={styles.photoUpload} onPress={pickPhoto} activeOpacity={0.8}>
                    {photoUri ? (
                        <View style={styles.photoPreview}>
                            <Ionicons name="image" size={32} color="#10B981" />
                            <Text style={styles.photoOkText}>Property photo captured</Text>
                            <Text style={styles.photoChangeText}>Tap to change</Text>
                        </View>
                    ) : (
                        <View style={styles.photoEmpty}>
                            <View style={styles.photoIcon}>
                                <Ionicons name="camera" size={28} color={ORANGE} />
                            </View>
                            <Text style={styles.photoLabel}>PROPERTY EVIDENCE</Text>
                            <Text style={styles.photoSub}>Tap to capture building photo</Text>
                        </View>
                    )}
                </TouchableOpacity>

                {/* Section: Building Info */}
                <SectionLabel text="BUILDING INFORMATION" />

                <Field label="PG NAME *" value={name} onChangeText={setName} placeholder="e.g. Royal Ladies PG" />

                <View>
                    <Text style={styles.fieldLabel}>TYPE *</Text>
                    <View style={styles.typeRow}>
                        {PG_TYPES.map(t => (
                            <TouchableOpacity
                                key={t}
                                style={[
                                    styles.typeBtn,
                                    { borderColor: TYPE_COLORS[t] + '55' },
                                    type === t && { backgroundColor: TYPE_COLORS[t] + '22', borderColor: TYPE_COLORS[t] },
                                ]}
                                onPress={() => { haptic.light(); setType(t); }}
                            >
                                <Text style={[styles.typeBtnText, { color: type === t ? TYPE_COLORS[t] : SUB }]}>{t}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Section: Owner */}
                <SectionLabel text="OWNER DETAILS" />

                <Field label="OWNER NAME" value={ownerName} onChangeText={setOwnerName} placeholder="Full name" />
                <Field label="OWNER MOBILE" value={ownerMobile} onChangeText={setOwnerMobile} placeholder="Primary phone number" keyboardType="phone-pad" />
                <Field label="ALT MOBILE" value={ownerAlt} onChangeText={setOwnerAlt} placeholder="Secondary phone (optional)" keyboardType="phone-pad" />

                {/* Section: Location */}
                <SectionLabel text="LOCATION" />

                <Field label="ADDRESS" value={address} onChangeText={setAddress} placeholder="Street, area, landmark" multiline />

                <View>
                    <Text style={styles.fieldLabel}>SPATIAL DATA</Text>
                    <TouchableOpacity
                        style={[styles.gpsBtn, gpsLat != null && styles.gpsBtnActive]}
                        onPress={getGps}
                        disabled={gettingGps}
                    >
                        {gettingGps ? (
                            <ActivityIndicator size="small" color={ORANGE} />
                        ) : (
                            <Ionicons
                                name={gpsLat != null ? 'location' : 'locate-outline'}
                                size={18}
                                color={gpsLat != null ? '#10B981' : ORANGE}
                            />
                        )}
                        <Text style={[styles.gpsBtnText, gpsLat != null && { color: '#10B981' }]}>
                            {gpsLat != null
                                ? `${gpsLat.toFixed(5)}, ${gpsLng?.toFixed(5)}`
                                : gettingGps ? 'Getting location…' : 'GET COORDINATES'}
                        </Text>
                        {gpsLat != null && <Ionicons name="checkmark-circle" size={16} color="#10B981" />}
                    </TouchableOpacity>
                </View>
            </ScrollView>

            {/* Save Button */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    <Ionicons name="save" size={18} color="#fff" />
                    <Text style={styles.saveBtnText}>SAVE PROPERTY</Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

function SectionLabel({ text }: { text: string }) {
    return (
        <View style={styles.sectionLabel}>
            <View style={styles.sectionLine} />
            <Text style={styles.sectionText}>{text}</Text>
            <View style={styles.sectionLine} />
        </View>
    );
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType }: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    placeholder?: string;
    multiline?: boolean;
    keyboardType?: any;
}) {
    return (
        <View>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
                style={[styles.input, multiline && styles.inputMulti]}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={SUB}
                multiline={multiline}
                numberOfLines={multiline ? 3 : 1}
                keyboardType={keyboardType}
                autoCapitalize={keyboardType === 'phone-pad' ? 'none' : 'words'}
                autoCorrect={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
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
        width: 36, height: 36, borderRadius: 8,
        backgroundColor: CARD, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: BORDER,
    },
    headerTitle: { color: TEXT, fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
    headerSub:   { color: SUB, fontSize: 11, marginTop: 1 },
    photoUpload: {
        backgroundColor: CARD, borderRadius: 12, borderWidth: 2,
        borderColor: BORDER, borderStyle: 'dashed', overflow: 'hidden',
    },
    photoEmpty: {
        alignItems: 'center', paddingVertical: 28, gap: 8,
    },
    photoIcon: {
        width: 56, height: 56, borderRadius: 12, backgroundColor: ORANGE + '18',
        alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ORANGE + '40',
    },
    photoLabel: { color: TEXT, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
    photoSub:   { color: SUB, fontSize: 12 },
    photoPreview: { alignItems: 'center', paddingVertical: 20, gap: 6 },
    photoOkText: { color: '#10B981', fontSize: 14, fontWeight: '700' },
    photoChangeText: { color: SUB, fontSize: 11 },
    sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
    sectionLine:  { flex: 1, height: 1, backgroundColor: BORDER },
    sectionText:  { color: SUB, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
    fieldLabel: { color: SUB, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
    input: {
        backgroundColor: INPUT_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
        color: TEXT, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },
    typeRow: { flexDirection: 'row', gap: 10 },
    typeBtn: {
        flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8,
        borderWidth: 1, borderColor: BORDER,
    },
    typeBtnText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
    gpsBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: CARD, borderRadius: 8, borderWidth: 1, borderColor: ORANGE + '55',
        paddingHorizontal: 14, paddingVertical: 12,
    },
    gpsBtnActive: { borderColor: '#10B98155', backgroundColor: '#10B98110' },
    gpsBtnText: { flex: 1, color: ORANGE, fontSize: 13, fontWeight: '700' },
    footer: {
        padding: 16, paddingBottom: 28,
        borderTopWidth: 1, borderTopColor: BORDER,
        backgroundColor: BG,
    },
    saveBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        backgroundColor: ORANGE, borderRadius: 10, paddingVertical: 14,
    },
    saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 1 },
});
