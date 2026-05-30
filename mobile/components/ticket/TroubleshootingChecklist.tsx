import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FieldIntelService } from '../../services/fieldIntelService';
import { TroubleshootingGuide, TroubleshootingStep } from '../../types';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface TroubleshootingChecklistProps {
    faultType: string;
}

export default function TroubleshootingChecklist({ faultType }: TroubleshootingChecklistProps) {
    const [guide, setGuide] = useState<TroubleshootingGuide | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(true);
    const [checked, setChecked] = useState<Set<number>>(new Set());

    useEffect(() => {
        if (!faultType) return;
        setLoading(true);
        FieldIntelService.getTroubleshootingGuide(faultType)
            .then(setGuide)
            .catch(() => setGuide(null))
            .finally(() => setLoading(false));
    }, [faultType]);

    if (loading) return null;
    if (!guide) return null;

    const toggleCheck = (stepNum: number) => {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(stepNum)) next.delete(stepNum);
            else next.add(stepNum);
            return next;
        });
    };

    const completedCount = checked.size;
    const totalSteps = guide.steps.length;

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.headerRow} onPress={() => setCollapsed(!collapsed)}>
                <Ionicons name="list" size={18} color={COLORS.primary} />
                <Text style={styles.headerText}>Troubleshooting: {guide.title}</Text>
                <View style={styles.progressBadge}>
                    <Text style={styles.progressText}>{completedCount}/{totalSteps}</Text>
                </View>
                <Ionicons
                    name={collapsed ? 'chevron-down' : 'chevron-up'}
                    size={16}
                    color={COLORS.text.light}
                />
            </TouchableOpacity>

            {!collapsed && (
                <View style={styles.content}>
                    {guide.steps.map((step) => (
                        <StepRow
                            key={step.step_number}
                            step={step}
                            isChecked={checked.has(step.step_number)}
                            onToggle={() => toggleCheck(step.step_number)}
                        />
                    ))}

                    {guide.safety_notes.length > 0 && (
                        <View style={styles.safetyBox}>
                            <View style={styles.safetyHeader}>
                                <Ionicons name="shield-checkmark" size={14} color="#F59E0B" />
                                <Text style={styles.safetyTitle}>Safety Notes</Text>
                            </View>
                            {guide.safety_notes.map((note, i) => (
                                <Text key={i} style={styles.safetyNote}>• {note}</Text>
                            ))}
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

function StepRow({
    step,
    isChecked,
    onToggle,
}: {
    step: TroubleshootingStep;
    isChecked: boolean;
    onToggle: () => void;
}) {
    return (
        <TouchableOpacity
            style={[styles.stepRow, isChecked && styles.stepChecked]}
            onPress={onToggle}
            activeOpacity={0.7}
        >
            <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                {isChecked && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
            </View>
            <View style={styles.stepContent}>
                <Text style={[styles.stepNum, isChecked && styles.stepTextDone]}>
                    Step {step.step_number}
                </Text>
                <Text style={[styles.stepInstruction, isChecked && styles.stepTextDone]}>
                    {step.instruction}
                </Text>
                {step.tool && (
                    <View style={styles.toolRow}>
                        <Ionicons name="construct-outline" size={12} color={COLORS.text.light} />
                        <Text style={styles.toolText}>{step.tool}</Text>
                    </View>
                )}
                {step.expected_outcome && (
                    <Text style={styles.expectedText}>Expected: {step.expected_outcome}</Text>
                )}
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerText: { fontSize: 14, fontWeight: '700', color: COLORS.primary, flex: 1 },
    progressBadge: {
        backgroundColor: COLORS.primary + '15',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: RADIUS.full,
    },
    progressText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
    content: { marginTop: SPACING.sm },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: SPACING.sm,
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    stepChecked: { opacity: 0.6 },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#CBD5E1',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 2,
    },
    checkboxChecked: {
        backgroundColor: '#10B981',
        borderColor: '#10B981',
    },
    stepContent: { flex: 1 },
    stepNum: { fontSize: 11, fontWeight: '700', color: COLORS.text.light, marginBottom: 2 },
    stepInstruction: { fontSize: 13, color: COLORS.text.primary, lineHeight: 19 },
    stepTextDone: { textDecorationLine: 'line-through', color: COLORS.text.light },
    toolRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    toolText: { fontSize: 11, color: COLORS.text.secondary },
    expectedText: { fontSize: 11, color: COLORS.text.light, fontStyle: 'italic', marginTop: 3 },
    safetyBox: {
        backgroundColor: '#FFFBEB',
        borderRadius: RADIUS.sm,
        padding: SPACING.sm,
        marginTop: SPACING.sm,
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    safetyHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
    safetyTitle: { fontSize: 12, fontWeight: '700', color: '#92400E' },
    safetyNote: { fontSize: 12, color: '#92400E', lineHeight: 18, marginLeft: 2 },
});
