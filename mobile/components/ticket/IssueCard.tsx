import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADIUS, SHADOWS, GRADIENTS } from '../../constants/theme';
import { Ticket } from '../../types';

interface IssueCardProps {
    ticket: Ticket;
}

export default function IssueCard({ ticket }: IssueCardProps) {
    return (
        <View style={styles.card}>
            <LinearGradient
                colors={['#FFFBEB', '#FEF3C7']} // Subtle Amber Gradient
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardHeader}
            >
                <View style={[styles.iconBox, { backgroundColor: '#F59E0B' }]}>
                    <FontAwesome5 name="exclamation-triangle" size={12} color="white" />
                </View>
                <Text style={styles.cardTitle}>Issue Report</Text>
            </LinearGradient>

            <View style={styles.content}>
                <Text style={styles.issueType}>{ticket.issue_type}</Text>
                <Text style={styles.description}>{ticket.description || "No specific description provided."}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.md,
        ...SHADOWS.medium,
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
        borderBottomColor: '#FDE68A',
    },
    iconBox: {
        width: 24, height: 24, borderRadius: 8,
        justifyContent: 'center', alignItems: 'center',
        marginRight: SPACING.sm,
        ...SHADOWS.light,
    },
    cardTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#D97706', // Darker Amber
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    content: {
        padding: SPACING.md,
    },
    issueType: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.text.primary,
        marginBottom: 6,
    },
    description: {
        fontSize: 15,
        color: COLORS.text.secondary,
        lineHeight: 24,
    },
});
