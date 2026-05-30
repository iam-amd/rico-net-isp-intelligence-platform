import React from 'react';
import { StyleSheet, View, Text, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, DARK_COLORS } from '../constants/theme';
import { useSettings } from '../context/SettingsContext';

interface GradientHeaderProps {
    title: string;
    count?: number;
    rightContent?: React.ReactNode;
}

export default function GradientHeader({ title, count, rightContent }: GradientHeaderProps) {
    const insets = useSafeAreaInsets();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    return (
        <View
            style={[
                styles.header,
                {
                    paddingTop: insets.top + 8,
                    backgroundColor: C.card,
                    borderBottomColor: C.border,
                },
            ]}
            accessibilityRole="header"
        >
            <View style={styles.row}>
                <Text style={[styles.title, { color: C.text.primary }]}>{title}</Text>
                {count !== undefined && (
                    <View style={[styles.badge, { backgroundColor: C.primary + '18' }]}>
                        <Text style={[styles.badgeText, { color: C.primary }]}>{count}</Text>
                    </View>
                )}
                {rightContent && <View style={styles.right}>{rightContent}</View>}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: 16,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '700',
    },
    right: {
        marginLeft: 'auto',
    },
});
