import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FieldIntelService } from '../../services/fieldIntelService';
import { TicketBriefing, FaultType, SignalLevel } from '../../types';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface BriefingCardProps {
    customerUsername: string;
    onBriefingLoaded?: (briefing: TicketBriefing) => void;
}

const SIGNAL_COLORS: Record<string, string> = {
    excellent: '#10B981',
    good: '#F59E0B',
    weak: '#F97316',
    critical: '#EF4444',
};

const FAULT_CONFIG: Record<string, { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
    POWER_CUT: { color: '#EF4444', bg: '#FEF2F2', icon: 'flash', label: 'Power Cut' },
    FIBER_CRITICAL: { color: '#EF4444', bg: '#FEF2F2', icon: 'git-branch', label: 'Fiber Critical' },
    FIBER_WEAK: { color: '#F97316', bg: '#FFF7ED', icon: 'git-branch', label: 'Fiber Weak' },
    FIBER_FLAP: { color: '#F59E0B', bg: '#FFFBEB', icon: 'pulse', label: 'Fiber Flap' },
    ONU_OFFLINE: { color: '#EF4444', bg: '#FEF2F2', icon: 'wifi-outline', label: 'ONU Offline' },
};

const BILLING_COLORS: Record<string, { color: string; bg: string }> = {
    active: { color: '#10B981', bg: '#F0FDF4' },
    expiring: { color: '#F59E0B', bg: '#FFFBEB' },
    expired: { color: '#EF4444', bg: '#FEF2F2' },
    unknown: { color: '#94A3B8', bg: '#F1F5F9' },
};

export default function BriefingCard({ customerUsername, onBriefingLoaded }: BriefingCardProps) {
    const [data, setData] = useState<TicketBriefing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    const fetchBriefing = () => {
        if (!customerUsername) return;
        setLoading(true);
        setError(null);
        FieldIntelService.getTicketBriefing(customerUsername)
            .then((result) => {
                setData(result);
                onBriefingLoaded?.(result);
            })
            .catch((e: any) => setError(e?.message || 'Failed to load briefing'))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchBriefing();
    }, [customerUsername]);

    if (loading) {
        return (
            <View style={styles.container}>
                <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={styles.loadingText}>Loading intelligence briefing...</Text>
                </View>
            </View>
        );
    }

    if (error || !data) {
        return (
            <View style={[styles.container, { borderColor: '#FEE2E2' }]}>
                <View style={styles.headerRow}>
                    <Ionicons name="warning" size={18} color={COLORS.state.warning} />
                    <Text style={[styles.headerText, { color: COLORS.state.warning }]}>Briefing Unavailable</Text>
                </View>
                <Text style={styles.errorText}>{error || 'Could not load intelligence data'}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={fetchBriefing}>
                    <Ionicons name="refresh" size={14} color={COLORS.primary} />
                    <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (data.no_onu_linked) {
        return (
            <View style={[styles.container, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}>
                <View style={styles.headerRow}>
                    <Ionicons name="hardware-chip-outline" size={18} color={COLORS.text.light} />
                    <Text style={[styles.headerText, { color: COLORS.text.secondary }]}>No ONU Linked</Text>
                </View>
                <Text style={styles.noDataText}>This customer has no linked ONU device. Signal data unavailable.</Text>
            </View>
        );
    }

    const faultCfg = data.fault_type ? FAULT_CONFIG[data.fault_type] : null;
    const signalColor = data.signal_level ? SIGNAL_COLORS[data.signal_level] : '#94A3B8';
    const billingCfg = BILLING_COLORS[data.billing_status || 'unknown'];

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.headerRow} onPress={() => setCollapsed(!collapsed)}>
                <Ionicons name="analytics" size={18} color={COLORS.primary} />
                <Text style={[styles.headerText, { color: COLORS.primary, flex: 1 }]}>Intelligence Briefing</Text>
                <Ionicons
                    name={collapsed ? 'chevron-down' : 'chevron-up'}
                    size={16}
                    color={COLORS.text.light}
                />
            </TouchableOpacity>

            {!collapsed && (
                <View style={styles.content}>
                    {/* Fault Type Badge */}
                    {faultCfg && (
                        <View style={[styles.faultBadge, { backgroundColor: faultCfg.bg }]}>
                            <Ionicons name={faultCfg.icon} size={16} color={faultCfg.color} />
                            <Text style={[styles.faultText, { color: faultCfg.color }]}>{faultCfg.label}</Text>
                        </View>
                    )}

                    {/* Signal + Billing Row */}
                    <View style={styles.metricsRow}>
                        {/* Signal Level */}
                        <View style={[styles.metricBadge, { backgroundColor: signalColor + '15' }]}>
                            <Ionicons name="cellular" size={14} color={signalColor} />
                            <Text style={[styles.metricValue, { color: signalColor }]}>
                                {data.rx_power != null ? `${data.rx_power.toFixed(1)} dBm` : 'N/A'}
                            </Text>
                        </View>

                        {/* Billing Status */}
                        <View style={[styles.metricBadge, { backgroundColor: billingCfg.bg }]}>
                            <Ionicons
                                name={data.billing_status === 'expired' ? 'card-outline' : 'card'}
                                size={14}
                                color={billingCfg.color}
                            />
                            <Text style={[styles.metricValue, { color: billingCfg.color }]}>
                                {data.billing_status === 'expired'
                                    ? 'Expired'
                                    : data.billing_status === 'expiring'
                                    ? `${data.days_until_expiry}d left`
                                    : 'Active'}
                            </Text>
                        </View>

                        {/* Alarm Count */}
                        {data.alarm_count_24h > 0 && (
                            <View style={[styles.metricBadge, { backgroundColor: '#FEF2F2' }]}>
                                <Ionicons name="notifications" size={14} color="#EF4444" />
                                <Text style={[styles.metricValue, { color: '#EF4444' }]}>
                                    {data.alarm_count_24h} alarm{data.alarm_count_24h > 1 ? 's' : ''}
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Health Score */}
                    {data.health_score != null && (
                        <View style={styles.healthRow}>
                            <Text style={styles.healthLabel}>Health Score</Text>
                            <View style={styles.healthBarBg}>
                                <View
                                    style={[
                                        styles.healthBarFill,
                                        {
                                            width: `${data.health_score}%`,
                                            backgroundColor:
                                                data.health_score >= 80 ? '#10B981' :
                                                data.health_score >= 60 ? '#F59E0B' :
                                                data.health_score >= 30 ? '#F97316' : '#EF4444',
                                        },
                                    ]}
                                />
                            </View>
                            <Text style={styles.healthValue}>{data.health_score}/100</Text>
                        </View>
                    )}

                    {/* Recommended Action */}
                    {data.recommended_action && (
                        <View style={styles.actionBox}>
                            <Ionicons name="bulb" size={14} color={COLORS.primary} />
                            <Text style={styles.actionText}>{data.recommended_action}</Text>
                        </View>
                    )}

                    {/* Recommended Tools */}
                    {data.recommended_tools.length > 0 && (
                        <View style={styles.toolsRow}>
                            <Ionicons name="construct" size={13} color={COLORS.text.light} />
                            {data.recommended_tools.map((tool, i) => (
                                <View key={i} style={styles.toolChip}>
                                    <Text style={styles.toolText}>{tool}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: COLORS.card,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    loadingText: { fontSize: 13, color: COLORS.text.secondary },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerText: { fontSize: 14, fontWeight: '700' },
    content: { marginTop: SPACING.sm },
    faultBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: RADIUS.full,
        gap: 5,
        marginBottom: SPACING.sm,
    },
    faultText: { fontSize: 13, fontWeight: '700' },
    metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm },
    metricBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: RADIUS.sm,
        gap: 4,
    },
    metricValue: { fontSize: 12, fontWeight: '600' },
    healthRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: SPACING.sm,
    },
    healthLabel: { fontSize: 12, color: COLORS.text.secondary, width: 80 },
    healthBarBg: {
        flex: 1,
        height: 6,
        backgroundColor: '#E2E8F0',
        borderRadius: 3,
        overflow: 'hidden',
    },
    healthBarFill: { height: '100%', borderRadius: 3 },
    healthValue: { fontSize: 12, fontWeight: '600', color: COLORS.text.primary, width: 45, textAlign: 'right' },
    actionBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: COLORS.primary + '08',
        padding: SPACING.sm,
        borderRadius: RADIUS.sm,
        gap: 6,
        marginBottom: SPACING.sm,
    },
    actionText: { flex: 1, fontSize: 12, color: COLORS.text.primary, lineHeight: 18 },
    toolsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },
    toolChip: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: RADIUS.full,
    },
    toolText: { fontSize: 11, color: COLORS.text.secondary, fontWeight: '500' },
    errorText: { fontSize: 12, color: COLORS.text.secondary, marginTop: SPACING.xs },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: SPACING.sm,
        gap: 4,
    },
    retryText: { fontSize: 13, fontWeight: '600', color: COLORS.primary },
    noDataText: { fontSize: 12, color: COLORS.text.light, marginTop: SPACING.xs },
});
