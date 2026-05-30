import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Modal, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS, FONTS, SHADOWS } from '../../constants/theme';
import { haptic } from '../../utils/haptics';
import PhotoGrid from '../../components/PhotoGrid';
import AudioRecorder from '../../components/AudioRecorder';
import AudioList from '../../components/AudioList';
import { TicketMedia } from '../../types';

interface CompleteJobModalProps {
    visible: boolean;
    onClose: () => void;
    ticketNumber?: string;
    onSubmit: (data: { diagnosis: string; signal: string }) => void;
    isSubmitting?: boolean;
    media: TicketMedia[];
    onAddPhoto: () => void;
    onAddAudio: (uri: string) => void;
    onDeletePhoto: (id: number) => void;
}

interface ValidationErrors {
    diagnosis?: string;
    signal?: string;
}

export default function CompleteJobModal({
    visible, onClose, ticketNumber, onSubmit, isSubmitting = false,
    media, onAddPhoto, onAddAudio, onDeletePhoto
}: CompleteJobModalProps) {
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;
    const [diagnosis, setDiagnosis] = useState('');
    const [signal, setSignal] = useState('');
    const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

    // Reset form when modal opens
    useEffect(() => {
        if (visible) {
            setDiagnosis('');
            setSignal('');
            setValidationErrors({});
        }
    }, [visible]);

    const photos = media.filter(m => !m.file_type || m.file_type.startsWith('image'));
    const audios = media.filter(m => m.file_type && m.file_type.startsWith('audio'));

    const validate = (): boolean => {
        const errors: ValidationErrors = {};

        if (!diagnosis.trim()) {
            errors.diagnosis = 'Diagnosis is required';
        } else if (diagnosis.trim().length < 10) {
            errors.diagnosis = 'Diagnosis must be at least 10 characters';
        }

        if (!signal.trim()) {
            errors.signal = 'Signal strength is required';
        }

        setValidationErrors(errors);

        if (Object.keys(errors).length > 0) {
            const messages = Object.values(errors).join('\n');
            if (Platform.OS === 'web') {
                alert('Please fix the following:\n' + messages);
            } else {
                Alert.alert('Validation Error', messages);
            }
            haptic.error();
            return false;
        }

        return true;
    };

    const handleSubmit = () => {
        if (!validate()) return;
        haptic.success();
        onSubmit({ diagnosis: diagnosis.trim(), signal: signal.trim() });
    };

    const clearFieldError = (field: keyof ValidationErrors) => {
        if (validationErrors[field]) {
            setValidationErrors(prev => {
                const updated = { ...prev };
                delete updated[field];
                return updated;
            });
        }
    };

    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={[styles.modalOverlay, { backgroundColor: C.overlay }]}>
                <View style={[styles.modalContent, { backgroundColor: C.card }]}>

                    {/* Header */}
                    <View style={[styles.header, { borderBottomColor: C.border }]}>
                        <View>
                            <Text style={[styles.headerTitle, { color: C.text.primary }]}>Resolving Ticket #{ticketNumber}</Text>
                            <Text style={[styles.headerSubtitle, { color: C.text.secondary }]}>Final technical report</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <Ionicons name="close" size={24} color={C.text.secondary} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView contentContainerStyle={styles.scrollContent}>

                        {/* Diagnosis Input */}
                        <Text style={[styles.label, { color: C.text.secondary }]}>
                            DIAGNOSIS / ROOT CAUSE <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={[
                            styles.inputContainer,
                            { backgroundColor: C.background, borderColor: validationErrors.diagnosis ? COLORS.state.danger : C.border },
                        ]}>
                            <View style={styles.iconBox}>
                                <FontAwesome5 name="stethoscope" size={14} color={validationErrors.diagnosis ? COLORS.state.danger : C.primary} />
                            </View>
                            <TextInput
                                style={[styles.input, { color: C.text.primary }]}
                                placeholder="e.g. Fiber Cut, ONT Reset, Connector Replaced..."
                                placeholderTextColor={C.text.light}
                                value={diagnosis}
                                onChangeText={(t) => { setDiagnosis(t); clearFieldError('diagnosis'); }}
                            />
                        </View>
                        {validationErrors.diagnosis && (
                            <Text style={styles.fieldError}>{validationErrors.diagnosis}</Text>
                        )}

                        {/* Signal Strength */}
                        <Text style={[styles.label, { color: C.text.secondary }]}>
                            SIGNAL STRENGTH (dBm) <Text style={styles.required}>*</Text>
                        </Text>
                        <View style={[
                            styles.inputContainer,
                            { backgroundColor: C.background, borderColor: validationErrors.signal ? COLORS.state.danger : C.border },
                        ]}>
                            <View style={styles.iconBox}>
                                <FontAwesome5 name="wifi" size={14} color={validationErrors.signal ? COLORS.state.danger : C.state.info} />
                            </View>
                            <TextInput
                                style={[styles.input, { color: C.text.primary }]}
                                keyboardType="numeric"
                                placeholder="-21"
                                placeholderTextColor={C.text.light}
                                value={signal}
                                onChangeText={(t) => { setSignal(t); clearFieldError('signal'); }}
                            />
                        </View>
                        {validationErrors.signal && (
                            <Text style={styles.fieldError}>{validationErrors.signal}</Text>
                        )}

                        {/* PROOF OF WORK SECTION */}
                        <Text style={styles.label}>WORK COMPLETION PROOF</Text>
                        <View style={styles.proofContainer}>
                            <PhotoGrid
                                photos={photos}
                                onDelete={onDeletePhoto}
                                readonly={false}
                            />

                            {photos.length < 4 && (
                                <TouchableOpacity
                                    style={styles.addPhotoBtn}
                                    onPress={onAddPhoto}
                                >
                                    <Ionicons name="camera" size={20} color={COLORS.primary} />
                                    <Text style={styles.addPhotoText}>Add Photo ({photos.length}/4)</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* AUDIO RECORDING SECTION */}
                        <Text style={styles.label}>AUDIO NOTES (OPTIONAL)</Text>
                        <View style={styles.proofContainer}>
                            <AudioList audios={audios} onDelete={onDeletePhoto} />
                            <AudioRecorder onRecordingComplete={onAddAudio} />
                        </View>

                        <View style={styles.infoBox}>
                            <Ionicons name="information-circle" size={16} color={COLORS.state.info} />
                            <Text style={styles.infoText}>
                                Diagnosis and signal strength are required. Photos and audio notes are optional but recommended.
                            </Text>
                        </View>

                    </ScrollView>

                    {/* Footer Button */}
                    <View style={styles.footer}>
                        <TouchableOpacity
                            onPress={isSubmitting ? undefined : handleSubmit}
                            activeOpacity={0.8}
                            disabled={isSubmitting}
                        >
                            <LinearGradient
                                colors={[COLORS.state.success, '#059669']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={[styles.submitBtn, isSubmitting && { opacity: 0.7 }]}
                            >
                                {isSubmitting ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={styles.submitText}>SUBMIT & CLOSE</Text>
                                        <Ionicons name="checkmark-circle-outline" size={20} color="white" style={{ marginLeft: 8 }} />
                                    </View>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>

                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: COLORS.overlay,
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: COLORS.card,
        borderTopLeftRadius: RADIUS.lg,
        borderTopRightRadius: RADIUS.lg,
        padding: SPACING.lg,
        maxHeight: '85%',
        ...SHADOWS.medium,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: SPACING.lg,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        paddingBottom: SPACING.md,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.text.primary,
        letterSpacing: 0.5,
    },
    headerSubtitle: {
        fontSize: 13,
        color: COLORS.text.secondary,
        marginTop: 2,
    },
    closeBtn: {
        padding: 4,
    },
    scrollContent: {
        paddingBottom: 20,
    },
    required: {
        color: COLORS.state.danger,
        fontWeight: '800',
        fontSize: 14,
    },
    label: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.text.secondary,
        marginBottom: SPACING.sm,
        letterSpacing: 1,
    },
    inputContainer: {
        backgroundColor: COLORS.background,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.xs,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.sm,
    },
    iconBox: {
        width: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    input: {
        flex: 1,
        paddingVertical: 14,
        paddingRight: 14,
        fontSize: 16,
        color: COLORS.text.primary,
        fontWeight: '500',
    },
    fieldError: {
        color: COLORS.state.danger,
        fontSize: 12,
        fontWeight: '500',
        marginBottom: SPACING.md,
        marginLeft: SPACING.xs,
    },
    infoBox: {
        flexDirection: 'row',
        backgroundColor: '#EFF6FF',
        padding: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    infoText: {
        flex: 1,
        marginLeft: SPACING.sm,
        color: '#1E40AF',
        fontSize: 13,
        lineHeight: 18,
    },
    footer: {
        marginTop: SPACING.md,
        paddingTop: SPACING.md,
    },
    submitBtn: {
        paddingVertical: 16,
        borderRadius: RADIUS.lg,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: COLORS.state.success,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    submitText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 1,
    },
    proofContainer: {
        marginBottom: SPACING.lg,
    },
    addPhotoBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EFF6FF',
        padding: SPACING.md,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderStyle: 'dashed',
        marginTop: 10,
    },
    addPhotoText: {
        marginLeft: SPACING.sm,
        color: COLORS.primary,
        fontWeight: '600',
        fontSize: 14,
    }
});
