import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../../constants/theme';
import { TicketMedia, InventoryItem } from '../../types';
import PhotoGrid from '../PhotoGrid';
import MaterialsPicker from './MaterialsPicker';

interface WorkspaceSectionProps {
    notes: string;
    materials: string;
    media: TicketMedia[];
    inventory: InventoryItem[];
    uploadingImg: boolean;
    isResolved: boolean;
    onNotesChange: (text: string) => void;
    onMaterialsChange: (text: string) => void;
    onSaveNotes: () => void;
    onPickImage: () => void;
    onDeleteMedia: (id: number) => void;
    onAddMaterial: (item: string) => void;
}

/**
 * Technician Workspace — available during ONGOING and post-resolve.
 * Contains: Notes editor, Materials input, Photo uploads.
 */
export default function WorkspaceSection({
    notes, materials, media, inventory, uploadingImg, isResolved,
    onNotesChange, onMaterialsChange, onSaveNotes, onPickImage, onDeleteMedia, onAddMaterial,
}: WorkspaceSectionProps) {
    const photos = media.filter(m => !m.file_type || m.file_type.startsWith('image'));

    return (
        <View style={styles.container}>
            {/* Section Header */}
            <View style={styles.sectionHeader}>
                <Ionicons name="construct-outline" size={16} color={COLORS.text.light} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>
                    {isResolved ? 'POST-JOB UPDATES' : 'TECHNICIAN WORKSPACE'}
                </Text>
            </View>

            {/* Internal Notes */}
            <View style={styles.inputCard}>
                <Text style={styles.inputLabel}>📝 Field Notes</Text>
                <TextInput
                    style={styles.textArea}
                    placeholder={isResolved
                        ? "Add any post-job remarks here..."
                        : "What did you find on-site? Document your observations..."
                    }
                    placeholderTextColor={COLORS.text.light}
                    multiline
                    value={notes}
                    onChangeText={onNotesChange}
                    onEndEditing={onSaveNotes}
                />
            </View>

            {/* Materials Input */}
            <MaterialsPicker
                materials={materials}
                inventory={inventory}
                onMaterialsChange={onMaterialsChange}
                onSaveNotes={onSaveNotes}
                onAddMaterial={onAddMaterial}
            />

            {/* Photo Evidence */}
            <View style={styles.inputCard}>
                <Text style={styles.inputLabel}>📸 Job Photos</Text>

                <PhotoGrid
                    photos={photos}
                    onDelete={onDeleteMedia}
                    readonly={false}
                />

                <TouchableOpacity
                    style={styles.addPhotoBtn}
                    onPress={onPickImage}
                    disabled={uploadingImg}
                    activeOpacity={0.7}
                >
                    {uploadingImg ? (
                        <ActivityIndicator color={COLORS.primary} />
                    ) : (
                        <>
                            <Ionicons name="images" size={20} color={COLORS.primary} />
                            <Text style={styles.addPhotoText}>
                                Add Photos ({photos.length})
                            </Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: SPACING.md,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
        marginLeft: 4,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: COLORS.text.light,
        letterSpacing: 1.2,
    },
    inputCard: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    inputLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: COLORS.text.secondary,
        marginBottom: SPACING.sm,
    },
    textArea: {
        minHeight: 80,
        textAlignVertical: 'top',
        fontSize: 15,
        color: COLORS.text.primary,
        lineHeight: 22,
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
        marginTop: SPACING.sm,
    },
    addPhotoText: {
        marginLeft: SPACING.sm,
        color: COLORS.primary,
        fontWeight: '600',
        fontSize: 14,
    },
});
