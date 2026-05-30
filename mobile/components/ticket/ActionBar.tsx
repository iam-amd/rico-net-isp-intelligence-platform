import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { TicketStatus } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS, GRADIENTS } from '../../constants/theme';
import { haptic } from '../../utils/haptics';

interface ActionBarProps {
    status: TicketStatus;
    processing: boolean;
    onStartJob: () => void;
    onStopJob: () => void;
    onCompleteJob: () => void;
}

/**
 * Sticky bottom action bar for ticket detail screen.
 * Renders different buttons based on ticket status.
 */
export default function ActionBar({ status, processing, onStartJob, onStopJob, onCompleteJob }: ActionBarProps) {
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;
    const isResolved = status === 'Resolved' || status === 'Closed';

    // No actions for resolved/closed tickets
    if (isResolved) return null;

    return (
        <View style={[styles.container, { backgroundColor: C.card, borderTopColor: C.border }]}>
            {status !== 'Ongoing' ? (
                // PENDING / ASSIGNED → Show START JOB
                <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => { haptic.medium(); onStartJob(); }}
                    disabled={processing}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Start job"
                    accessibilityHint="Changes ticket status to ongoing"
                >
                    <LinearGradient
                        colors={GRADIENTS.primary}
                        style={styles.gradientBtn}
                    >
                        {processing ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <>
                                <FontAwesome5 name="play" size={14} color="white" style={{ marginRight: 10 }} />
                                <Text style={styles.actionBtnText}>START JOB</Text>
                            </>
                        )}
                    </LinearGradient>
                </TouchableOpacity>
            ) : (
                // ONGOING → Show STOP + COMPLETE
                <View style={styles.row}>
                    <TouchableOpacity
                        style={[styles.stopBtn]}
                        onPress={() => { haptic.heavy(); onStopJob(); }}
                        disabled={processing}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Stop job"
                        accessibilityHint="Returns ticket to pending status"
                    >
                        <Ionicons name="stop" size={20} color={COLORS.state.danger} />
                        <Text style={styles.stopBtnText}>STOP</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionBtn, { flex: 1, marginLeft: 12 }]}
                        onPress={() => { haptic.success(); onCompleteJob(); }}
                        disabled={processing}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Complete job"
                        accessibilityHint="Opens completion form"
                    >
                        <LinearGradient
                            colors={GRADIENTS.success}
                            style={styles.gradientBtn}
                        >
                            {processing ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <>
                                    <FontAwesome5 name="check" size={14} color="white" style={{ marginRight: 10 }} />
                                    <Text style={styles.actionBtnText}>COMPLETE JOB</Text>
                                </>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.md,
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionBtn: {
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    gradientBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: RADIUS.lg,
    },
    actionBtnText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: 1,
    },
    stopBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FEE2E2',
        borderWidth: 1,
        borderColor: '#EF4444',
        borderRadius: RADIUS.lg,
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    stopBtnText: {
        color: COLORS.state.danger,
        fontWeight: '800',
        fontSize: 13,
        letterSpacing: 0.5,
        marginLeft: 6,
    },
});
