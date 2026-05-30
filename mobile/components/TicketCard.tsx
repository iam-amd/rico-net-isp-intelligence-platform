import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Ticket } from '../types';
import { useSettings } from '../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS, SHADOWS, FONTS } from '../constants/theme';
import { formatName } from '../utils/format';
import { haptic } from '../utils/haptics';

interface TicketCardProps {
    ticket: Ticket;
    index?: number;
}

const getPriorityColor = (priority: string) => {
    switch (priority?.toLowerCase()) {
        case 'critical': return '#991B1B'; // Red 800
        case 'high': return COLORS.state.danger;
        case 'medium': return COLORS.state.warning;
        case 'low': return COLORS.state.success;
        default: return COLORS.text.light;
    }
};

const openMap = (address: string) => {
    const query = encodeURIComponent(address);
    const url = Platform.select({
        ios: `maps:0,0?q=${query}`,
        android: `geo:0,0?q=${query}`,
        web: `https://www.google.com/maps/search/?api=1&query=${query}`
    });
    Linking.openURL(url || '');
};

export default function TicketCard({ ticket, index }: TicketCardProps) {
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    // Determine status color
    const statusColor = (() => {
        switch (ticket.status) {
            case 'Ongoing': return COLORS.state.info;
            case 'Resolved': return COLORS.state.success;
            case 'Closed': return COLORS.text.light;
            default: return COLORS.state.pending;
        }
    })();

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}
            onPress={() => { haptic.light(); router.push({ pathname: '/ticket/[id]', params: { id: ticket.id } }); }}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={`Ticket ${ticket.id}, ${ticket.issue_type}, ${formatName(ticket.customer?.first_name, ticket.customer?.last_name)}, ${ticket.status}`}
            accessibilityHint="Opens ticket details"
        >
            {/* LEFT STRIP: Status Indicator */}
            <View style={[styles.statusStrip, { backgroundColor: statusColor }]} />

            {/* CONTENT */}
            <View style={styles.content}>

                {/* Header: ID & Priority */}
                <View style={styles.headerRow}>
                    <Text style={[styles.ticketId, { color: C.text.light }]}>#{ticket.id} <Text style={[styles.issueType, { color: C.text.secondary }]}>• {ticket.issue_type}</Text></Text>
                    <View style={[styles.priorityBadge, { backgroundColor: getPriorityColor(ticket.priority) + '15' }]}>
                        <Text style={[styles.priorityText, { color: getPriorityColor(ticket.priority) }]}>
                            {(ticket.priority ?? 'N/A').toUpperCase()}
                        </Text>
                    </View>
                </View>

                {/* Customer Name */}
                <Text style={[styles.customerName, { color: C.text.primary }]} numberOfLines={1}>
                    {formatName(ticket.customer?.first_name, ticket.customer?.last_name)}
                </Text>

                {/* Address */}
                <View style={styles.addressRow}>
                    <Ionicons name="location-sharp" size={14} color={C.text.light} />
                    <Text style={[styles.addressText, { color: C.text.secondary }]} numberOfLines={1}>
                        {ticket.customer?.railwire_address}
                    </Text>
                </View>

                <View style={[styles.footerRow, { borderTopColor: C.background }]}>
                    <View style={[styles.statusBadge, { borderColor: statusColor }]}>
                        <Text style={[styles.statusText, { color: statusColor }]}>{ticket.status}</Text>
                    </View>

                    <TouchableOpacity
                        style={styles.mapBtn}
                        onPress={(e) => { e.stopPropagation?.(); openMap(ticket.customer?.railwire_address || ''); }}
                        accessibilityLabel="Open in maps"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="map" size={16} color={COLORS.primary} />
                        <Text style={styles.mapBtnText}>Map</Text>
                    </TouchableOpacity>
                </View>

            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        marginBottom: SPACING.md,
        flexDirection: 'row',
        ...SHADOWS.light,
        borderWidth: 1,
        borderColor: COLORS.border,
        overflow: 'hidden',
    },
    statusStrip: {
        width: 6,
        backgroundColor: COLORS.state.pending,
    },
    content: {
        flex: 1,
        padding: SPACING.md,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.xs,
    },
    ticketId: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.text.light,
    },
    issueType: {
        fontWeight: '600',
        color: COLORS.text.secondary,
    },
    priorityBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: RADIUS.sm,
    },
    priorityText: {
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    customerName: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.text.primary,
        marginBottom: 4,
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    addressText: {
        fontSize: 13,
        color: COLORS.text.secondary,
        marginLeft: 4,
        flex: 1,
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: COLORS.background,
        paddingTop: SPACING.sm,
        marginTop: 4,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: RADIUS.full,
        borderWidth: 1,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    mapBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: RADIUS.full,
    },
    mapBtnText: {
        fontSize: 12,
        color: COLORS.primary,
        fontWeight: '600',
        marginLeft: 4,
    },
});
