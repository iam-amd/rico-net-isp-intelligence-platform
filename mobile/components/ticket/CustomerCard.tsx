import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADIUS, SHADOWS, GRADIENTS } from '../../constants/theme';
import { Customer, CustomerSummary } from '../../types';
import { formatName } from '../../utils/format';

interface CustomerCardProps {
    customer: Customer | CustomerSummary;
    onCall: () => void;
    onMap: () => void;
}

export default function CustomerCard({ customer, onCall, onMap }: CustomerCardProps) {
    const fullName = formatName(customer?.first_name, customer?.last_name);

    return (
        <View style={styles.card}>
            {/* Header w/ Gradient */}
            <LinearGradient
                colors={GRADIENTS.cardHeader}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardHeader}
            >
                <View style={styles.iconBox}>
                    <FontAwesome5 name="user" size={14} color={COLORS.primary} />
                </View>
                <Text style={styles.cardTitle}>Customer Details</Text>
            </LinearGradient>

            <View style={styles.content}>
                <Text style={styles.customerName}>{fullName}</Text>

                <TouchableOpacity
                    onPress={onCall}
                    style={styles.phoneRow}
                    accessibilityRole="button"
                    accessibilityLabel="Call customer"
                >
                    <View style={styles.phoneIcon}>
                        <Ionicons name="call" size={14} color="white" />
                    </View>
                    <Text style={styles.phoneText}>{customer?.phone || 'No Phone'}</Text>
                </TouchableOpacity>

                {customer?.phone && (
                    <TouchableOpacity
                        onPress={() => Linking.openURL(`sms:${customer?.phone}?body=Hello, this is Rico Net. I am on my way to your location for the internet repair.`)}
                        style={styles.smsButton}
                    >
                        <Ionicons name="chatbubble-ellipses" size={16} color={COLORS.primary} />
                        <Text style={styles.smsText}>Send "On My Way" SMS</Text>
                    </TouchableOpacity>
                )}

                <View style={styles.divider} />

                <TouchableOpacity
                    onPress={onMap}
                    style={styles.addressContainer}
                    accessibilityRole="button"
                    accessibilityLabel="Open customer location in maps"
                >
                    <View style={{ flex: 1 }}>
                        <Text style={styles.addressLabel}>ADDRESS</Text>
                        <Text style={styles.addressText}>{customer?.railwire_address}</Text>
                    </View>
                    <Ionicons name="map" size={24} color={COLORS.primary} style={{ opacity: 0.8 }} />
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.md,
        ...SHADOWS.medium, // Deeper shadow
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.6)',
        overflow: 'hidden',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm + 4,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    iconBox: {
        width: 28, height: 28, borderRadius: 8,
        backgroundColor: 'white',
        justifyContent: 'center', alignItems: 'center',
        marginRight: SPACING.sm,
        ...SHADOWS.light,
    },
    cardTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: COLORS.text.secondary,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    content: {
        padding: SPACING.md,
    },
    customerName: {
        fontSize: 20,
        fontWeight: '800',
        color: COLORS.text.primary,
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    phoneRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    phoneIcon: {
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: COLORS.state.success,
        justifyContent: 'center', alignItems: 'center',
        marginRight: 8,
    },
    phoneText: {
        fontSize: 16,
        color: COLORS.text.primary,
        fontWeight: '600',
    },
    smsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: RADIUS.sm,
        alignSelf: 'flex-start',
        marginBottom: SPACING.sm,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    smsText: {
        marginLeft: 8,
        color: COLORS.primary,
        fontWeight: '700',
        fontSize: 12,
    },
    divider: {
        height: 1,
        backgroundColor: COLORS.border,
        marginVertical: SPACING.md,
        opacity: 0.5,
    },
    addressContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    addressLabel: {
        fontSize: 10,
        color: COLORS.text.light,
        fontWeight: '800',
        marginBottom: 4,
        letterSpacing: 0.5,
    },
    addressText: {
        fontSize: 14,
        color: COLORS.text.secondary,
        lineHeight: 22,
        fontWeight: '500',
    },
});
