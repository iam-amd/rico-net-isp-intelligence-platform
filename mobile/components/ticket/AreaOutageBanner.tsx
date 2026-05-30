import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AreaOutageInfo } from '../../types';
import { SPACING, RADIUS } from '../../constants/theme';

interface AreaOutageBannerProps {
    outage: AreaOutageInfo;
}

const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
    TOTAL: { bg: '#7F1D1D', border: '#991B1B', text: '#FFFFFF' },
    CRITICAL: { bg: '#DC2626', border: '#EF4444', text: '#FFFFFF' },
    MAJOR: { bg: '#EA580C', border: '#F97316', text: '#FFFFFF' },
    MINOR: { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' },
};

export default function AreaOutageBanner({ outage }: AreaOutageBannerProps) {
    const [expanded, setExpanded] = useState(false);
    const colors = SEVERITY_COLORS[outage.severity] || SEVERITY_COLORS.MINOR;

    const pctAffected = outage.total_count > 0
        ? Math.round((outage.affected_count / outage.total_count) * 100)
        : 0;

    const causeGuess = outage.detection === 'CONCURRENT'
        ? 'Likely area power cut'
        : pctAffected >= 80
        ? 'Likely fiber cut or OLT port failure'
        : 'Partial outage — check specific ONUs';

    return (
        <TouchableOpacity
            style={[styles.banner, { backgroundColor: colors.bg, borderColor: colors.border }]}
            onPress={() => setExpanded(!expanded)}
            activeOpacity={0.8}
        >
            <View style={styles.mainRow}>
                <Ionicons name="warning" size={20} color={colors.text} />
                <View style={styles.textCol}>
                    <Text style={[styles.title, { color: colors.text }]}>
                        Area Outage Detected
                    </Text>
                    <Text style={[styles.subtitle, { color: colors.text + 'CC' }]}>
                        {outage.affected_count} ONU{outage.affected_count > 1 ? 's' : ''} offline on port {outage.pon_port} — {causeGuess}
                    </Text>
                </View>
                <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.text + '80'}
                />
            </View>

            {expanded && (
                <View style={styles.detailRow}>
                    <DetailItem label="OLT Host" value={outage.olt_host} color={colors.text} />
                    <DetailItem label="Port" value={outage.pon_port} color={colors.text} />
                    <DetailItem label="Affected" value={`${outage.affected_count} / ${outage.total_count} (${pctAffected}%)`} color={colors.text} />
                    <DetailItem label="Severity" value={outage.severity} color={colors.text} />
                    <DetailItem label="Detection" value={outage.detection === 'CONCURRENT' ? 'Time Correlation' : 'Port Threshold'} color={colors.text} />
                </View>
            )}
        </TouchableOpacity>
    );
}

function DetailItem({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: color + '99' }]}>{label}</Text>
            <Text style={[styles.detailValue, { color }]}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
    },
    mainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    textCol: { flex: 1 },
    title: { fontSize: 14, fontWeight: '800' },
    subtitle: { fontSize: 12, marginTop: 2, lineHeight: 17 },
    detailRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: SPACING.sm,
        paddingTop: SPACING.sm,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.2)',
    },
    detailItem: { width: '47%' },
    detailLabel: { fontSize: 10, fontWeight: '500' },
    detailValue: { fontSize: 12, fontWeight: '700' },
});
