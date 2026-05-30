import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, withSequence, Easing } from 'react-native-reanimated';
import { COLORS } from '../constants/theme';

interface Props {
    isRecording: boolean;
    metering?: number; // Decibels, typically -160 to 0
}

const NUM_BARS = 20; // Increased bars for better resolution

const Bar = ({ index, isRecording, metering = -160 }: { index: number, isRecording: boolean, metering?: number }) => {
    const height = useSharedValue(4);

    useEffect(() => {
        if (isRecording) {
            // Normalize metering (-160 to 0) to 0-1 range approx
            // Typical speech is around -40 to -10
            const minDb = -80; // Lower floor to pick up quieter sounds
            const maxDb = 0;
            const db = Math.max(minDb, Math.min(maxDb, metering));
            const normalized = (db - minDb) / (maxDb - minDb); // 0 to 1

            // Add some randomness based on index to create wave effect
            // Center bars should be higher
            const centerOffset = Math.abs(index - NUM_BARS / 2) / (NUM_BARS / 2); // 0 at center, 1 at edges
            const scaleFactor = 1 - centerOffset * 0.5; // Center bars react more

            // Always add a tiny bit of life if normalized > 0
            const jitter = normalized > 0 ? (Math.random() * 5 * normalized) : 0;
            const targetHeight = 4 + (normalized * 50 * scaleFactor) + jitter;

            height.value = withTiming(targetHeight, { duration: 100, easing: Easing.linear });
        } else {
            height.value = withTiming(4, { duration: 300 });
        }
    }, [isRecording, metering]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            height: height.value,
        };
    });

    return (
        <Animated.View
            style={[
                styles.bar,
                animatedStyle,
                {
                    opacity: isRecording ? 1 : 0.5
                }
            ]}
        />
    );
};

export default function AudioVisualizer({ isRecording, metering }: Props) {
    return (
        <View style={styles.container}>
            {Array.from({ length: NUM_BARS }).map((_, i) => (
                <Bar key={i} index={i} isRecording={isRecording} metering={metering} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 40,
        gap: 4,
        paddingHorizontal: 10,
    },
    bar: {
        width: 4,
        backgroundColor: COLORS.state.danger,
        borderRadius: 2,
    }
});
