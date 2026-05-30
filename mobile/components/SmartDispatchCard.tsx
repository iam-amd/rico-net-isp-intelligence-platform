import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SmartDispatchItem, SignalLevel } from '../types';
import { useSettings } from '../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS, SHADOWS } from '../constants/theme';
import { haptic } from '../utils/haptics';

interface SmartDispatchCardProps {
    item: SmartDispatchItem;
}

const FAULT_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
    POWER_CUT: { icon: 'flash', color: '#EF4444' },
    FIBER_CRITICAL: { icon: 'git-branch', color: '#EF4444' },
    FIBER_WEAK: { icon: 'git-branch', color: '#F97316' },
    FIBER_FLAP: { icon: 'pulse', color: '#F59E0B' },
    ONU_OFFLINE: { icon: 'wifi-outline', color: '#EF4444' },
};

const SEVERITY_COLORS: Record<number, string> = {
    5: '#EF4444',
    4: '#F97316',
    3: '#F59E0B',
    2: '#3B82F6',
    1: '#10B981',
    0: '#94A3B8',
};

const SIGNAL_COLORS: Record<string, string> = {
    excellent: '#10B981',
    good: '#F59E0B',
    weak: '#F97316',
    critical: '#EF4444',
};

function getHealthColor(score: number | null): string {
    if (score == null) return '#94A3B8';
    if (score >= 80) return '#10B981';
    if (score >= 60) return '#F59E0B';
    if (score >= 30) return '#F97316';
    return '#EF4444';
}

const openMap = (address: string) => {
    const query = encodeURIComponent(address);
    const url = Platform.select({
        ios: `maps:0,0?q=${query}`,
        android: `geo:0,0?q=${query}`,
        web: `https://www.google.com/maps/search/?api=1&query=${query}`,
    });
    Linking.openURL(url || '');
};

export default function SmartDispatchCard({ item }: SmartDispatchCardProps) {
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    const faultCfg = item.fault_type ? FAULT_ICONS[item.fault_type] : null;
    const stripColor = SEVERITY_COLORS[item.fault_severity || 0] || '#94A3B8';
    const healthColor = getHealthColor(item.health_score);
    const signalColor = item.signal_level ? SIGNAL_COLORS[item.signal_level] : '#94A3B8';

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}
            onPress={() => {
                haptic.light();
                router.push({ pathname: '/ticket/[id]', params: { id: item.ticket_id } });
            }}
            activeOpacity={0.9}
        >
            {/* Left strip — fault severity color */}
            <View style={[styles.strip, { backgroundColor: stripColor }]} />

            <View style={styles.content}>
                {/* Header Row */}
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        {faultCfg && (
                            <Ionicons name={faultCfg.icon} size={14} color={faultCfg.color} />
                        )}
                        <Text style={[styles.ticketId, { color: C.text.light }]}>
                            #{item.ticket_id}
                        </Text>
                        {item.issue_type && (
                            <Text style={[styles.issueType, { color: C.text.secondary }]}>
                                {item.issue_type}
                            </Text>
                        )}
                    </View>

                    {/* Health Score Badge */}
                    {item.health_score != null && (
                        <View style={[styles.healthBadge, { borderColor: healthColor }]}>
                            <Text style={[styles.healthText, { color: healthColor }]}>
                                {item.health_score}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Customer Name */}
                <Text style={[styles.name, { color: C.text.primary }]} numberOfLines={1}>
                    {item.customer_name || 'Unknown Customer'}
                </Text>

                {/* Address */}
                {item.customer_address && (
                    <View style={styles.addressRow}>
                        <Ionicons name="location-sharp" size={13} color={C.text.light} />
                        <Text style={[styles.address, { color: C.text.secondary }]} numberOfLines={1}>
                            {item.customer_address}
                        </Text>
                    </View>
                )}

                {/* Intelligence Row */}
                <View style={styles.intelRow}>
                    {/* Fault badge */}
                    {item.fault_type && faultCfg && (
                        <View style={[styles.chip, { backgroundColor: faultCfg.color + '15' }]}>
                            <Text style={[styles.chipText, { color: faultCfg.color }]}>
                                {item.fault_type.replace('_', ' ')}
                            </Text>
                        </View>
                    )}

                    {/* Signal badge */}
                    {item.rx_power != null && (
                        <View style={[styles.chip, { backgroundColor: signalColor + '15' }]}>
                            <Ionicons name="cellular" size={10} color={signalColor} />
                            <Text style={[styles.chipText, { color: signalColor }]}>
                                {item.rx_power.toFixed(1)} dBm
                            </Text>
                        </View>
                    )}

                    {/* ONU status */}
                    {item.onu_status && (
                        <View style={[
                            styles.chip,
                            { backgroundColor: item.onu_status === 'online' ? '#F0FDF4' : '#FEF2F2' },
                        ]}>
                            <View style={[
                                styles.statusDot,
                                { backgroundColor: item.onu_status === 'online' ? '#10B981' : '#EF4444' },
                            ]} />
                            <Text style={[
                                styles.chipText,
                                { color: item.onu_status === 'online' ? '#10B981' : '#EF4444' },
                            ]}>
                                {item.onu_status}
                            </Text>
                        </View>
                    )}

                    {/* Area outage indicator */}
                    {item.has_area_outage && (
                        <View style={[styles.chip, { backgroundColor: '#FEF2F2' }]}>
                            <Ionicons name="warning" size={10} color="#EF4444" />
                            <Text style={[styles.chipText, { color: '#EF4444' }]}>Outage</Text>
                        </View>
                    )}
                </View>

                {/* Recommended Action */}
                {item.recommended_action && (
                    <Text style={[styles.action, { color: C.text.secondary }]} numberOfLines={1}>
                        {item.recommended_action}
                    </Text>
                )}

                {/* Tools + Map */}
                <View style={styles.footerRow}>
                    {/* Tools */}
                    {item.recommended_tools.length > 0 && (
                        <View style={styles.toolsRow}>
                            {item.recommended_tools.slice(0, 3).map((tool, i) => (
                                <View key={i} style={styles.toolChip}>
                                    <Text style={styles.toolText}>{tool}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={{ flex: 1 }} />

                    {item.customer_address && (
                        <TouchableOpacity
                            style={styles.mapBtn}
                            onPress={(e) => {
                                e.stopPropagation();
                                openMap(item.customer_address!);
                            }}
                        >
                            <Ionicons name="map" size={14} color={COLORS.primary} />
                            <Text style={styles.mapText}>Map</Text>
                        </TouchableOpacity>
                    )}
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
    strip: { width: 6 },
    content: { flex: 1, padding: SPACING.md },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 3,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    ticketId: { fontSize: 12, fontWeight: '700' },
    issueType: { fontSize: 12, fontWeight: '600' },
    healthBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    healthText: { fontSize: 10, fontWeight: '800' },
    name: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
    addressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 3 },
    address: { fontSize: 12, flex: 1 },
    intelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: RADIUS.full,
        gap: 3,
    },
    chipText: { fontSize: 10, fontWeight: '700' },
    statusDot: { width: 5, height: 5, borderRadius: 2.5 },
    action: { fontSize: 11, fontStyle: 'italic', marginBottom: 6 },
    footerRow: { flexDirection: 'row', alignItems: 'center' },
    toolsRow: { flexDirection: 'row', gap: 4 },
    toolChip: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: RADIUS.full,
    },
    toolText: { fontSize: 9, color: '#64748B', fontWeight: '600' },
    mapBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: RADIUS.full,
        gap: 3,
    },
    mapText: { fontSize: 11, color: COLORS.primary, fontWeight: '600' },
});
