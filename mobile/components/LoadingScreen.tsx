import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { COLORS, FONTS } from '../constants/theme';

interface LoadingScreenProps {
    message?: string;
}

export default function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.text}>{message}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: COLORS.background,
    },
    text: {
        marginTop: 12,
        fontSize: 14,
        color: COLORS.text.secondary,
        fontFamily: FONTS.regular,
        fontWeight: '500',
    }
});
