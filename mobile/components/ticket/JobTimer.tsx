import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useJobTimer } from '../../hooks/useJobTimer';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface JobTimerProps {
    assignedAt?: string;
    isActive: boolean;
}

export default function JobTimer({ assignedAt, isActive }: JobTimerProps) {
    const { elapsed, seconds } = useJobTimer(assignedAt, isActive);
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!isActive) return;
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
            ])
        );
        pulse.start();
        return () => pulse.stop();
    }, [isActive]);

    if (!isActive) return null;

    // Color changes based on duration
    const isLong = seconds > 3600; // > 1 hour
    const timerColor = isLong ? COLORS.state.warning : COLORS.state.info;

    return (
        <View style={[styles.container, { borderColor: timerColor + '40' }]}>
            <Animated.View style={[styles.indicator, { backgroundColor: timerColor, opacity: pulseAnim }]} />
            <Ionicons name="timer-outline" size={18} color={timerColor} />
            <View style={styles.textContainer}>
                <Text style={styles.label}>JOB IN PROGRESS</Text>
                <Text style={[styles.timer, { color: timerColor }]}>{elapsed}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        gap: 10,
    },
    indicator: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    textContainer: {
        flex: 1,
    },
    label: {
        fontSize: 10,
        fontWeight: '700',
        color: COLORS.text.light,
        letterSpacing: 1,
    },
    timer: {
        fontSize: 22,
        fontWeight: '800',
        fontVariant: ['tabular-nums'],
        marginTop: 2,
    },
});
