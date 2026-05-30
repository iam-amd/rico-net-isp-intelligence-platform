import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';
import { InventoryItem } from '../../types';

interface MaterialsPickerProps {
    materials: string;
    inventory: InventoryItem[];
    onMaterialsChange: (text: string) => void;
    onSaveNotes: () => void;
    onAddMaterial: (item: string) => void;
}

/**
 * Materials / Parts picker with quick-add chips from inventory.
 */
export default function MaterialsPicker({
    materials, inventory, onMaterialsChange, onSaveNotes, onAddMaterial,
}: MaterialsPickerProps) {
    return (
        <View style={styles.inputCard}>
            <Text style={styles.inputLabel}>🔧 Materials / Parts Used</Text>
            <TextInput
                style={styles.input}
                placeholder="E.g. 2m Fiber Cable, 1 Connector..."
                placeholderTextColor={COLORS.text.light}
                value={materials}
                onChangeText={onMaterialsChange}
                onEndEditing={onSaveNotes}
            />

            {inventory.length > 0 && (
                <View style={styles.quickAddContainer}>
                    <Text style={styles.quickAddLabel}>QUICK ADD FROM STOCK</Text>
                    <View style={styles.chipsWrapper}>
                        {inventory.map(item => (
                            <TouchableOpacity
                                key={item.id}
                                style={[
                                    styles.chip,
                                    materials.includes(item.name) && styles.chipActive,
                                ]}
                                onPress={() => onAddMaterial(item.name)}
                                activeOpacity={0.7}
                            >
                                <Text style={[
                                    styles.chipText,
                                    materials.includes(item.name) && styles.chipTextActive,
                                ]}>
                                    {materials.includes(item.name) ? '✓' : '+'} {item.name} ({item.quantity})
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
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
    input: {
        fontSize: 15,
        color: COLORS.text.primary,
        paddingVertical: 4,
    },
    quickAddContainer: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
    },
    quickAddLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: COLORS.text.light,
        marginBottom: 8,
        letterSpacing: 1,
    },
    chipsWrapper: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    chipActive: {
        backgroundColor: '#DBEAFE',
        borderColor: COLORS.primary,
    },
    chipText: {
        fontSize: 12,
        color: COLORS.primary,
        fontWeight: '600',
    },
    chipTextActive: {
        fontWeight: '700',
    },
});
