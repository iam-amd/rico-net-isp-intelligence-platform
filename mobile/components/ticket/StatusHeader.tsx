import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ticket } from '../../types';
import { COLORS, SPACING } from '../../constants/theme';

interface StatusHeaderProps {
    ticket: Ticket;
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Ongoing': return COLORS.state.info;
        case 'Resolved': return COLORS.state.success;
        case 'Closed': return '#94A3B8';
        case 'Assigned': return COLORS.state.pending;
        default: return COLORS.state.warning;
    }
};

const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
        case 'critical': return '#991B1B';
        case 'high': return COLORS.state.danger;
        case 'medium': return COLORS.state.warning;
        case 'low': return COLORS.state.success;
        default: return COLORS.text.light;
    }
};

export default function StatusHeader({ ticket }: StatusHeaderProps) {
    const statusColor = getStatusColor(ticket.status);
    const priorityColor = getPriorityColor(ticket.priority);

    return (
        <View style={styles.container}>
            <View style={styles.row}>
                <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                    <Text style={styles.statusText}>{ticket.status.toUpperCase()}</Text>
                </View>
                <View style={[styles.priorityBadge, { backgroundColor: priorityColor + '18' }]}>
                    <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
                    <Text style={[styles.priorityText, { color: priorityColor }]}>
                        {(ticket.priority ?? 'Normal').toUpperCase()}
                    </Text>
                </View>
            </View>
            <View style={styles.metaRow}>
                <Text style={styles.issueType}>{ticket.issue_type}</Text>
                {ticket.sub_issue && (
                    <Text style={styles.subIssue}> • {ticket.sub_issue}</Text>
                )}
            </View>
            <Text style={styles.dateText}>
                Created {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                }) : 'N/A'}
            </Text>
            {ticket.assigned_tech && (
                <Text style={styles.assignedText}>
                    Assigned to: <Text style={{ fontWeight: '700' }}>{ticket.assigned_tech}</Text>
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: COLORS.card,
        borderRadius: 16,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.sm,
    },
    statusBadge: {
        paddingVertical: 5,
        paddingHorizontal: 12,
        borderRadius: 20,
    },
    statusText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 11,
        letterSpacing: 0.8,
    },
    priorityBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    priorityDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 6,
    },
    priorityText: {
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    issueType: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.text.primary,
    },
    subIssue: {
        fontSize: 14,
        color: COLORS.text.secondary,
    },
    dateText: {
        fontSize: 12,
        color: COLORS.text.light,
        marginTop: 2,
    },
    assignedText: {
        fontSize: 12,
        color: COLORS.text.secondary,
        marginTop: 4,
    },
});
