import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Ticket {
    id: number;
    ticket_number?: string;
    created_at?: string;
    customer_name: string;
    address: string;
    issue_description: string;
    [key: string]: any;
}

interface PendingJobCardProps {
    ticket: Ticket;
    onAccept: () => void;
}

const { width } = Dimensions.get('window');

export default function PendingJobCard({ ticket, onAccept }: PendingJobCardProps) {
    // Simple time ago helper (placeholder logic for now)
    const timeAgo = "10 mins ago"; // In real app, calculate from ticket.created_at

    return (
        <View style={styles.cardContainer}>
            <View style={styles.headerRow}>
                <Text style={styles.ticketId}>Ticket #{ticket.ticket_number || `TKT-${ticket.id}`}</Text>
                <Text style={styles.timeAgo}>{timeAgo}</Text>
            </View>

            <View style={styles.content}>
                <Text style={styles.label}>Customer: <Text style={styles.value}>{ticket.customer?.first_name} {ticket.customer?.last_name || ''}</Text></Text>
                <Text style={styles.label}>Address: <Text style={styles.areaValue}>{ticket.customer?.railwire_address || ticket.customer?.rico_address || 'Unknown Address'}</Text></Text>
                <Text style={styles.label}>Mobile: <Text style={styles.value}>{ticket.customer?.phone || 'N/A'}</Text></Text>

                <View style={styles.issueBadge}>
                    <Text style={styles.issueText}>Issue: {ticket.issue_type} {ticket.sub_issue ? `(${ticket.sub_issue})` : ''}</Text>
                </View>
            </View>

            <TouchableOpacity onPress={onAccept} activeOpacity={0.8}>
                <LinearGradient
                    colors={['#60A5FA', '#3B82F6']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.button}
                >
                    <Text style={styles.buttonText}>Accept Job</Text>
                </LinearGradient>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    cardContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        marginBottom: 20,
        shadowColor: '#94A3B8',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
        width: width - 40, // consistent width
        alignSelf: 'center',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    ticketId: {
        fontSize: 13,
        color: '#94A3B8',
        fontWeight: '600',
    },
    timeAgo: {
        fontSize: 13,
        color: '#94A3B8',
    },
    content: {
        marginBottom: 20,
    },
    label: {
        fontSize: 15,
        color: '#64748B',
        marginBottom: 6,
        fontWeight: '500',
    },
    value: {
        color: '#0F172A',
        fontWeight: '700',
        fontSize: 18,
    },
    areaValue: {
        color: '#334155',
        fontWeight: '400',
    },
    issueBadge: {
        backgroundColor: '#FEF2F2', // Light red bg
        marginTop: 8,
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    issueText: {
        color: '#EF4444', // Red text
        fontWeight: '700',
        fontSize: 13,
    },
    button: {
        paddingVertical: 14,
        borderRadius: 30, // Pill shape
        alignItems: 'center',
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonText: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 16,
    },
});
