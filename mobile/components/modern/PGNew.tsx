/**
 * PGNew.tsx — Neo-Brutalist / Industrial design system
 * New PG building enrollment form with GPS capture and type selection.
 * Full business logic identical to simple pg/new.tsx.
 */
import React, { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { usePG, PGType } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';

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

const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1 as const,
    shadowRadius: 0,
    elevation: 6,
};

// ── Constants ─────────────────────────────────────────────────────────────────
const PG_TYPES: PGType[] = ['Ladies', 'Gents', 'Mixed'];

const TYPE_COLORS: Record<PGType, string> = {
    Ladies: '#ec4899',
    Gents:  '#3b82f6',
    Mixed:  '#8b5cf6',
};

const TYPE_BORDER: Record<PGType, string> = {
    Ladies: '#ec4899',
    Gents:  '#3b82f6',
    Mixed:  '#8b5cf6',
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function PGNew() {
    const router = useRouter();
    const { addBuilding } = usePG();

    const [name, setName]               = useState('');
    const [type, setType]               = useState<PGType>('Ladies');
    const [ownerName, setOwnerName]     = useState('');
    const [ownerMobile, setOwnerMobile] = useState('');
    const [ownerAlt, setOwnerAlt]       = useState('');
    const [address, setAddress]         = useState('');
    const [gpsLat, setGpsLat]           = useState<number | undefined>();
    const [gpsLng, setGpsLng]           = useState<number | undefined>();
    const [photoUri, setPhotoUri]       = useState<string | undefined>();
    const [gettingGps, setGettingGps]   = useState(false);
    const [saving, setSaving]           = useState(false);

    const pickPhoto = () => {
        Alert.alert('BUILDING PHOTO', 'Add a photo for identification', [
            {
                text: 'Camera',
                onPress: async () => {
                    await ImagePicker.requestCameraPermissionsAsync();
                    const r = await ImagePicker.launchCameraAsync({
                        mediaTypes: ['images'], quality: 0.8,
                    });
                    if (!r.canceled && r.assets[0]) { setPhotoUri(r.assets[0].uri); haptic.success(); }
                },
            },
            {
                text: 'Gallery',
                onPress: async () => {
                    await ImagePicker.requestMediaLibraryPermissionsAsync();
                    const r = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'], quality: 0.8,
                    });
                    if (!r.canceled && r.assets[0]) { setPhotoUri(r.assets[0].uri); haptic.success(); }
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
                Alert.alert('PERMISSION DENIED', 'Location access is required to capture GPS coordinates.');
                return;
            }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            setGpsLat(loc.coords.latitude);
            setGpsLng(loc.coords.longitude);
            haptic.success();
        } catch {
            Alert.alert('GPS ERROR', 'Could not get current location. Try again.');
        } finally {
            setGettingGps(false);
        }
    };

    const handleSave = () => {
        if (!name.trim()) { Alert.alert('REQUIRED', 'PG building name is required.'); return; }

        setSaving(true);
        try {
            addBuilding({
                name: name.trim(),
                type,
                ownerName: ownerName.trim(),
                ownerMobile: ownerMobile.trim(),
                ownerAltMobile: ownerAlt.trim() || undefined,
                address: address.trim(),
                gpsLat,
                gpsLng,
                photoUri,
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
                <TouchableOpacity
                    style={styles.backBtn}
                    onPress={() => { haptic.light(); router.back(); }}
                >
                    <Ionicons name="chevron-back" size={20} color={ORANGE} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>NEW PROPERTY</Text>
                <View style={styles.headerSpacer} />
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
            >
                {/* Form section */}
                <View style={styles.formSection}>
                    {/* PG Name */}
                    <IndustrialField
                        label="PG NAME *"
                        value={name}
                        onChangeText={setName}
                        placeholder="e.g. ROYAL LADIES PG"
                        autoCapitalize="words"
                    />

                    {/* Type selector */}
                    <View style={{ gap: 8 }}>
                        <Text style={styles.fieldLabel}>TYPE *</Text>
                        <View style={styles.typeRow}>
                            {PG_TYPES.map(t => (
                                <TouchableOpacity
                                    key={t}
                                    style={[
                                        styles.typeBtn,
                                        { borderColor: TYPE_BORDER[t] },
                                        type === t && { backgroundColor: TYPE_COLORS[t] + '30' },
                                    ]}
                                    onPress={() => { haptic.light(); setType(t); }}
                                >
                                    <Text style={[
                                        styles.typeBtnText,
                                        { color: type === t ? TYPE_COLORS[t] : MUTED },
                                    ]}>
                                        {t.toUpperCase()}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {/* Photo Section */}
                    <View style={{ gap: 8 }}>
                        <Text style={styles.fieldLabel}>BUILDING PHOTO</Text>
                        <TouchableOpacity style={styles.photoBox} onPress={pickPhoto} activeOpacity={0.85}>
                            {photoUri ? (
                                <>
                                    <Image source={{ uri: photoUri }} style={styles.photoImg} />
                                    <View style={styles.photoOverlay}>
                                        <Ionicons name="camera-reverse-outline" size={20} color="#fff" />
                                        <Text style={styles.photoOverlayText}>TAP TO REPLACE</Text>
                                    </View>
                                </>
                            ) : (
                                <View style={styles.photoPlaceholder}>
                                    <Ionicons name="camera-outline" size={32} color={MUTED} />
                                    <Text style={styles.photoPlaceholderText}>TAP TO ADD PHOTO</Text>
                                    <Text style={styles.photoPlaceholderSub}>For building identification</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Section divider */}
                    <SectionDivider label="OWNER DETAILS" />

                    <IndustrialField
                        label="OWNER NAME"
                        value={ownerName}
                        onChangeText={setOwnerName}
                        placeholder="Full name"
                        autoCapitalize="words"
                    />
                    <IndustrialField
                        label="OWNER MOBILE"
                        value={ownerMobile}
                        onChangeText={setOwnerMobile}
                        placeholder="Primary phone"
                        keyboardType="phone-pad"
                    />
                    <IndustrialField
                        label="ALT MOBILE"
                        value={ownerAlt}
                        onChangeText={setOwnerAlt}
                        placeholder="Secondary phone (optional)"
                        keyboardType="phone-pad"
                    />

                    {/* Section divider */}
                    <SectionDivider label="LOCATION" />

                    <IndustrialField
                        label="ADDRESS"
                        value={address}
                        onChangeText={setAddress}
                        placeholder="Street, area, landmark"
                        multiline
                    />

                    {/* GPS button */}
                    <View style={{ gap: 8 }}>
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
                                    color={gpsLat != null ? SUCCESS : ORANGE}
                                />
                            )}
                            <Text style={[
                                styles.gpsBtnText,
                                gpsLat != null && { color: SUCCESS },
                            ]}>
                                {gpsLat != null
                                    ? `${gpsLat.toFixed(5)}, ${gpsLng?.toFixed(5)}`
                                    : gettingGps ? 'GETTING LOCATION...' : 'GET COORDINATES'}
                            </Text>
                            {gpsLat != null && (
                                <Ionicons name="checkmark-circle" size={16} color={SUCCESS} />
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            {/* Save button */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator size="small" color="#000" />
                    ) : (
                        <>
                            <Ionicons name="save" size={18} color="#000" />
                            <Text style={styles.saveBtnText}>SAVE PROPERTY</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

// ── Field Component ───────────────────────────────────────────────────────────
function IndustrialField({
    label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize,
}: {
    label: string;
    value: string;
    onChangeText: (v: string) => void;
    placeholder?: string;
    multiline?: boolean;
    keyboardType?: any;
    autoCapitalize?: 'none' | 'words' | 'sentences' | 'characters';
}) {
    return (
        <View style={{ gap: 6 }}>
            <Text style={fieldStyles.label}>{label}</Text>
            <TextInput
                style={[fieldStyles.input, multiline && fieldStyles.inputMulti]}
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                placeholderTextColor={MUTED}
                multiline={multiline}
                numberOfLines={multiline ? 3 : 1}
                keyboardType={keyboardType}
                autoCapitalize={autoCapitalize ?? (keyboardType === 'phone-pad' ? 'none' : 'sentences')}
                autoCorrect={false}
                textAlignVertical={multiline ? 'top' : undefined}
            />
        </View>
    );
}

function SectionDivider({ label }: { label: string }) {
    return (
        <View style={dividerStyles.row}>
            <View style={dividerStyles.line} />
            <Text style={dividerStyles.text}>{label}</Text>
            <View style={dividerStyles.line} />
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 52,
        paddingBottom: 14,
        borderBottomWidth: 2,
        borderBottomColor: BORDER_L,
        backgroundColor: BG,
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
        color: TEXT,
        fontSize: 17,
        fontWeight: '900',
        letterSpacing: 2,
    },
    headerSpacer: { width: 40 },

    scroll: {
        padding: 16,
        paddingBottom: 100,
    },

    formSection: {
        backgroundColor: CARD,
        borderWidth: 2,
        borderColor: BORDER_L,
        padding: 16,
        gap: 14,
    },

    fieldLabel: {
        color: MUTED,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 1.5,
    },

    typeRow: { flexDirection: 'row', gap: 10 },
    typeBtn: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 12,
        borderWidth: 2,
    },
    typeBtnText: {
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 1,
    },

    photoBox: {
        width: '100%',
        height: 160,
        borderWidth: 2,
        borderColor: BORDER_L,
        overflow: 'hidden',
        backgroundColor: CARD2,
        position: 'relative',
    },
    photoImg: { width: '100%', height: '100%', resizeMode: 'cover' },
    photoOverlay: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 8,
    },
    photoOverlayText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
    photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
    photoPlaceholderText: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
    photoPlaceholderSub: { color: MUTED + '80', fontSize: 10, fontWeight: '600' },

    gpsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: CARD2,
        borderWidth: 2,
        borderColor: ORANGE,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    gpsBtnActive: {
        borderColor: SUCCESS,
        backgroundColor: SUCCESS + '10',
    },
    gpsBtnText: {
        flex: 1,
        color: ORANGE,
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 0.5,
    },

    footer: {
        padding: 16,
        paddingBottom: 28,
        borderTopWidth: 2,
        borderTopColor: BORDER_L,
        backgroundColor: BG,
    },
    saveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: ORANGE,
        borderWidth: 2,
        borderColor: BORDER,
        paddingVertical: 16,
        ...SHADOW,
    },
    saveBtnText: {
        color: '#000',
        fontSize: 15,
        fontWeight: '900',
        letterSpacing: 2,
    },
});

const fieldStyles = StyleSheet.create({
    label: {
        color: MUTED,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 1.5,
    },
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
    inputMulti: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
});

const dividerStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginVertical: 4,
    },
    line: { flex: 1, height: 2, backgroundColor: BORDER_L },
    text: {
        color: MUTED,
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 2,
    },
});
