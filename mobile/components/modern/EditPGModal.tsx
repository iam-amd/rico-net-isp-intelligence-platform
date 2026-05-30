import React, { useState, useEffect } from 'react';
import {
    Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
    StyleSheet, Image, Alert, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { usePG, PGBuilding } from '../../context/PGContext';
import { haptic } from '../../utils/haptics';

// Light design from refined_edit_pg_modal_industrial (white/cream surface)
const SURF   = '#ffffff';
const BDR    = '#000000';
const ORANGE = '#FF5A00';
const TEXT   = '#000000';
const MUTED  = '#71717a';
const CREAM  = '#f4f4f5';
const INSET  = { shadowColor: '#000', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 0 } as const;
const NEO    = { shadowColor: '#000', shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 0 } as const;

export default function EditPGModal({
    visible,
    building,
    onClose,
}: {
    visible: boolean;
    building: PGBuilding | null;
    onClose: () => void;
}) {
    const { updateBuilding } = usePG();

    const [name, setName]                   = useState('');
    const [ownerName, setOwnerName]         = useState('');
    const [ownerMobile, setOwnerMobile]     = useState('');
    const [ownerAltMobile, setOwnerAltMobile] = useState('');
    const [address, setAddress]             = useState('');
    const [photoUri, setPhotoUri]           = useState<string | undefined>();
    const [gpsLat, setGpsLat]               = useState<number | undefined>();
    const [gpsLng, setGpsLng]               = useState<number | undefined>();
    const [locating, setLocating]           = useState(false);
    const [saving, setSaving]               = useState(false);

    useEffect(() => {
        if (building) {
            setName(building.name);
            setOwnerName(building.ownerName ?? '');
            setOwnerMobile(building.ownerMobile ?? '');
            setOwnerAltMobile(building.ownerAltMobile ?? '');
            setAddress(building.address);
            setPhotoUri(building.photoUri);
            setGpsLat(building.gpsLat);
            setGpsLng(building.gpsLng);
        }
    }, [building?.id, visible]);

    if (!building) return null;

    const replacePhoto = () => {
        Alert.alert('ASSET_IMG_REF', 'Replace building photo', [
            {
                text: 'Camera',
                onPress: async () => {
                    await ImagePicker.requestCameraPermissionsAsync();
                    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [4, 3] });
                    if (!r.canceled && r.assets[0]) setPhotoUri(r.assets[0].uri);
                },
            },
            {
                text: 'Gallery',
                onPress: async () => {
                    await ImagePicker.requestMediaLibraryPermissionsAsync();
                    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [4, 3] });
                    if (!r.canceled && r.assets[0]) setPhotoUri(r.assets[0].uri);
                },
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    };

    const captureGPS = async () => {
        setLocating(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') { Alert.alert('DENIED', 'Location permission required.'); return; }
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            setGpsLat(loc.coords.latitude);
            setGpsLng(loc.coords.longitude);
            haptic.success();
        } catch {
            Alert.alert('GPS_ERROR', 'Could not get location. Try again.');
        } finally {
            setLocating(false);
        }
    };

    const handleSave = () => {
        if (!name.trim()) { Alert.alert('REQUIRED', 'PROPERTY_NAME_ID is required.'); return; }
        setSaving(true);
        try {
            updateBuilding({
                ...building,
                name: name.trim(),
                ownerName: ownerName.trim(),
                ownerMobile: ownerMobile.trim() || building.ownerMobile,
                ownerAltMobile: ownerAltMobile.trim() || undefined,
                address: address.trim(),
                photoUri,
                gpsLat,
                gpsLng,
                synced: false,
            });
            haptic.success();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const oldCoords = building.gpsLat != null
        ? `${building.gpsLat.toFixed(4)} N, ${building.gpsLng?.toFixed(4)} E`
        : 'NO PRIOR COORDINATES';
    const newCoords = gpsLat != null && (gpsLat !== building.gpsLat || gpsLng !== building.gpsLng)
        ? `${gpsLat.toFixed(4)} N, ${gpsLng?.toFixed(4)} E`
        : null;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.hdr}>
                        <View style={styles.hdrLeft}>
                            <View style={styles.modBadge}><Text style={styles.modBadgeText}>PG_MOD_01</Text></View>
                            <Text style={styles.hdrTitle}>EDIT PROPERTY DATA</Text>
                        </View>
                        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                            <Ionicons name="close" size={20} color={TEXT} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.body} contentContainerStyle={styles.bodyPad}>
                        {/* Image Module */}
                        <View style={[styles.imgModule, NEO]}>
                            <View style={styles.imgBox}>
                                {photoUri
                                    ? <Image source={{ uri: photoUri }} style={styles.img} />
                                    : <View style={styles.imgPlaceholder}>
                                        <Ionicons name="image-outline" size={32} color={MUTED} />
                                    </View>
                                }
                            </View>
                            <View style={styles.imgInfo}>
                                <Text style={styles.fieldLbl}>ASSET_IMG_REF</Text>
                                <Text style={styles.imgFilename} numberOfLines={1}>
                                    {photoUri ? 'photo_captured.jpg' : '— NO IMAGE —'}
                                </Text>
                                <TouchableOpacity style={[styles.replaceBtn, NEO]} onPress={replacePhoto}>
                                    <Ionicons name="camera-reverse-outline" size={18} color={TEXT} />
                                    <Text style={styles.replaceBtnText}>REPLACE IMAGE</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Form Fields */}
                        <View style={styles.formGroup}>
                            <Text style={styles.fieldLbl}>PROPERTY_NAME_ID</Text>
                            <TextInput
                                style={[styles.textInput, INSET]}
                                value={name}
                                onChangeText={setName}
                                placeholder="Building name"
                                placeholderTextColor={MUTED}
                                autoCapitalize="words"
                            />
                        </View>
                        <View style={styles.formGroup}>
                            <Text style={styles.fieldLbl}>PRIMARY_CONTACT_NM</Text>
                            <TextInput
                                style={[styles.textInput, INSET]}
                                value={ownerName}
                                onChangeText={setOwnerName}
                                placeholder="Owner full name"
                                placeholderTextColor={MUTED}
                                autoCapitalize="words"
                            />
                        </View>
                        <View style={styles.formGroup}>
                            <Text style={styles.fieldLbl}>PRIMARY_MOBILE_NO</Text>
                            <TextInput
                                style={[styles.textInput, INSET]}
                                value={ownerMobile}
                                onChangeText={setOwnerMobile}
                                placeholder="Primary phone number"
                                placeholderTextColor={MUTED}
                                keyboardType="phone-pad"
                            />
                        </View>
                        <View style={styles.formGroup}>
                            <Text style={styles.fieldLbl}>ALT_MOBILE_NO</Text>
                            <TextInput
                                style={[styles.textInput, INSET]}
                                value={ownerAltMobile}
                                onChangeText={setOwnerAltMobile}
                                placeholder="Secondary phone (optional)"
                                placeholderTextColor={MUTED}
                                keyboardType="phone-pad"
                            />
                        </View>
                        <View style={styles.formGroup}>
                            <Text style={styles.fieldLbl}>PHYSICAL_LOCATION_ADDR</Text>
                            <TextInput
                                style={[styles.textInput, styles.textMulti, INSET]}
                                value={address}
                                onChangeText={setAddress}
                                placeholder="Street, area, landmark"
                                placeholderTextColor={MUTED}
                                multiline
                                numberOfLines={2}
                                textAlignVertical="top"
                                autoCapitalize="sentences"
                            />
                        </View>

                        {/* GPS Module */}
                        <View style={[styles.gpsModule, NEO]}>
                            <View style={styles.gpsHeader}>
                                <Text style={styles.fieldLbl}>GEO_SPATIAL_DATA</Text>
                                <Ionicons name="location-outline" size={18} color={TEXT} />
                            </View>
                            <View style={styles.coordsRow}>
                                <View style={styles.coordBox}>
                                    <Text style={styles.coordLbl}>OLD COORDINATES</Text>
                                    <View style={[styles.coordValue, INSET]}>
                                        <Text style={styles.coordText}>{oldCoords}</Text>
                                    </View>
                                </View>
                                <View style={styles.coordBox}>
                                    <Text style={styles.coordLbl}>NEW COORDINATES</Text>
                                    <View style={[styles.coordValue, INSET]}>
                                        <Text style={[styles.coordText, newCoords ? styles.coordNew : styles.coordPending]}>
                                            {newCoords ?? 'Pending Capture...'}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={[styles.captureBtn, NEO, locating && { opacity: 0.7 }]}
                                onPress={captureGPS}
                                disabled={locating}
                            >
                                {locating
                                    ? <ActivityIndicator size="small" color={TEXT} />
                                    : <Ionicons name="locate-outline" size={20} color={TEXT} />
                                }
                                <Text style={styles.captureBtnText}>CAPTURE CURRENT LOCATION</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>

                    {/* Footer */}
                    <View style={styles.footer}>
                        <TouchableOpacity
                            style={[styles.saveBtn, NEO, saving && { opacity: 0.7 }]}
                            onPress={handleSave}
                            disabled={saving}
                        >
                            {saving
                                ? <ActivityIndicator size="small" color={TEXT} />
                                : <Ionicons name="save-outline" size={20} color={TEXT} />
                            }
                            <Text style={styles.saveBtnText}>UPDATE RECORD</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
        justifyContent: 'center', alignItems: 'center', padding: 16,
    },
    container: {
        backgroundColor: SURF, borderWidth: 2, borderColor: BDR,
        width: '100%', height: '90%',
        shadowColor: BDR, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0,
    },
    hdr: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderBottomWidth: 2, borderBottomColor: BDR, padding: 14,
    },
    hdrLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    modBadge: { borderWidth: 2, borderColor: BDR, paddingHorizontal: 8, paddingVertical: 4 },
    modBadgeText: { color: TEXT, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
    hdrTitle: { color: ORANGE, fontSize: 15, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
    closeBtn: {
        width: 36, height: 36, borderWidth: 2, borderColor: BDR,
        alignItems: 'center', justifyContent: 'center',
    },
    body: { flex: 1 },
    bodyPad: { padding: 16, gap: 16 },

    // Image module
    imgModule: {
        flexDirection: 'row', gap: 14, borderWidth: 2, borderColor: BDR, padding: 12,
        backgroundColor: SURF,
    },
    imgBox: { width: 120, height: 88, borderWidth: 2, borderColor: BDR, backgroundColor: CREAM, overflow: 'hidden' },
    img: { width: '100%', height: '100%' },
    imgPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    imgInfo: { flex: 1, gap: 6 },
    imgFilename: { color: TEXT, fontSize: 12, fontWeight: '700', borderBottomWidth: 2, borderBottomColor: BDR, paddingBottom: 4 },
    replaceBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 2, borderColor: BDR,
        paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start', backgroundColor: SURF,
    },
    replaceBtnText: { color: TEXT, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },

    // Form
    formGroup: { gap: 4 },
    fieldLbl: { color: TEXT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
    textInput: {
        borderWidth: 2, borderColor: BDR, backgroundColor: SURF,
        paddingHorizontal: 12, paddingVertical: 10,
        color: TEXT, fontSize: 14, fontWeight: '600',
    },
    textMulti: { minHeight: 72, textAlignVertical: 'top' },

    // GPS module
    gpsModule: { borderWidth: 2, borderColor: BDR, padding: 14, gap: 10, backgroundColor: SURF },
    gpsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: BDR, paddingBottom: 8 },
    coordsRow: { flexDirection: 'row', gap: 10 },
    coordBox: { flex: 1, gap: 4 },
    coordLbl: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
    coordValue: { borderWidth: 2, borderColor: BDR, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: CREAM },
    coordText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: MUTED },
    coordNew: { color: TEXT, fontWeight: '900' },
    coordPending: { color: MUTED, fontStyle: 'italic' },
    captureBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: ORANGE, borderWidth: 2, borderColor: BDR,
        paddingVertical: 12,
    },
    captureBtnText: { color: TEXT, fontSize: 13, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },

    // Footer
    footer: { borderTopWidth: 2, borderTopColor: BDR, padding: 14 },
    saveBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        backgroundColor: ORANGE, borderWidth: 2, borderColor: BDR, paddingVertical: 14,
    },
    saveBtnText: { color: TEXT, fontSize: 16, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
});
