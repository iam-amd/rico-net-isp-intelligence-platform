import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FieldIntelService } from '../../services/fieldIntelService';
import { ONULiveStatus, SignalPoint } from '../../types';
import { usePolling } from '../../hooks/usePolling';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface ONUSignalCardProps {
    macAddress: string;
    customerName?: string;
    initialStatus?: ONULiveStatus | null;
    signalHistory?: SignalPoint[];
    children?: React.ReactNode; // Slot for RebootButton
}

const SIGNAL_THRESHOLDS = [
    { max: -27, color: '#EF4444', label: 'Critical' },
    { max: -24, color: '#F97316', label: 'Weak' },
    { max: -20, color: '#F59E0B', label: 'Good' },
    { max: Infinity, color: '#10B981', label: 'Excellent' },
];

function getSignalColor(rx: number | null): { color: string; label: string } {
    if (rx == null) return { color: '#94A3B8', label: 'N/A' };
    for (const t of SIGNAL_THRESHOLDS) {
        if (rx < t.max) return { color: t.color, label: t.label };
    }
    return { color: '#10B981', label: 'Excellent' };
}

function formatTimestamp(ts: string | null): string {
    if (!ts) return 'Never';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function MiniSparkline({ points }: { points: SignalPoint[] }) {
    if (points.length < 2) return null;
    const values = points.map((p) => p.rx_power_dbm).filter((v): v is number => v != null);
    if (values.length < 2) return null;

    const W = 120;
    const H = 28;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const pathData = values
        .map((v, i) => {
            const x = (i / (values.length - 1)) * W;
            const y = H - ((v - min) / range) * (H - 4) - 2;
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    // Simple SVG-like rendering using View + absolute positioning
    // Since we want to keep it lightweight (no chart library), render dots
    const dotsToShow = Math.min(values.length, 30);
    const step = Math.max(1, Math.floor(values.length / dotsToShow));

    return (
        <View style={sparkStyles.container}>
            {values.filter((_, i) => i % step === 0 || i === values.length - 1).map((v, i) => {
                const idx = Math.min(i * step, values.length - 1);
                const x = (idx / (values.length - 1)) * (W - 4);
                const y = H - ((v - min) / range) * (H - 4) - 2;
                const color = getSignalColor(v).color;
                return (
                    <View
                        key={i}
                        style={[sparkStyles.dot, { left: x, top: y, backgroundColor: color }]}
                    />
                );
            })}
            {/* Baseline */}
            <View style={sparkStyles.baseline} />
        </View>
    );
}

const sparkStyles = StyleSheet.create({
    container: { width: 120, height: 28, position: 'relative' },
    dot: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5 },
    baseline: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 1,
        backgroundColor: '#E2E8F0',
    },
});

export default function ONUSignalCard({
    macAddress,
    customerName,
    initialStatus,
    signalHistory = [],
    children,
}: ONUSignalCardProps) {
    const router = useRouter();
    const [status, setStatus] = useState<ONULiveStatus | null>(
        initialStatus
            ? initialStatus
            : null
    );
    const [collapsed, setCollapsed] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const result = await FieldIntelService.getONULiveStatus(macAddress);
            setStatus(result);
        } catch {
            // Keep last known state
        }
    }, [macAddress]);

    // Auto-refresh every 30s
    usePolling({ callback: refresh, interval: 30000, enabled: !!macAddress });

    // Also fetch on mount if no initial status
    React.useEffect(() => {
        if (!initialStatus && macAddress) refresh();
    }, [macAddress]);

    if (!status) return null;

    const { color: rxColor, label: rxLabel } = getSignalColor(status.rx_power);
    const isOnline = status.status === 'online';
    const isDyingGasp = status.dying_gasp;

    const statusDotColor = isDyingGasp ? '#A855F7' : isOnline ? '#10B981' : '#EF4444';
    const statusText = isDyingGasp ? 'Dying Gasp' : isOnline ? 'Online' : 'Offline';

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.headerRow} onPress={() => setCollapsed(!collapsed)}>
                {/* Status dot */}
                <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
                <Text style={[styles.statusText, { color: statusDotColor }]}>{statusText}</Text>

                {/* Rx Power Badge */}
                <View style={[styles.rxBadge, { backgroundColor: rxColor + '15' }]}>
                    <Text style={[styles.rxValue, { color: rxColor }]}>
                        {status.rx_power != null ? `${status.rx_power.toFixed(1)} dBm` : 'N/A'}
                    </Text>
                </View>

                <View style={{ flex: 1 }} />
                <Text style={styles.pollTime}>{formatTimestamp(status.polled_at)}</Text>
                <Ionicons
                    name={collapsed ? 'chevron-down' : 'chevron-up'}
                    size={16}
                    color={COLORS.text.light}
                />
            </TouchableOpacity>

            {!collapsed && (
                <View style={styles.content}>
                    {/* Metrics Grid */}
                    <View style={styles.metricsGrid}>
                        <MetricItem label="Rx Power" value={status.rx_power != null ? `${status.rx_power.toFixed(1)} dBm` : 'N/A'} color={rxColor} />
                        <MetricItem label="Tx Power" value={status.tx_power != null ? `${status.tx_power.toFixed(1)} dBm` : 'N/A'} />
                        <MetricItem
                            label="Temperature"
                            value={status.temperature != null ? `${status.temperature.toFixed(1)}°C` : 'N/A'}
                            color={status.temperature != null && status.temperature > 60 ? '#EF4444' : undefined}
                        />
                        <MetricItem label="Voltage" value={status.voltage != null ? `${status.voltage} mV` : 'N/A'} />
                    </View>

                    {/* 24h Sparkline */}
                    {signalHistory.length > 1 && (
                        <View style={styles.sparkRow}>
                            <Text style={styles.sparkLabel}>24h Signal</Text>
                            <MiniSparkline points={signalHistory} />
                            <TouchableOpacity
                                style={styles.historyBtn}
                                onPress={() => router.push({
                                    pathname: '/signal-history/[mac]' as any,
                                    params: {
                                        mac: encodeURIComponent(macAddress),
                                        customerName: customerName ?? '',
                                        hours: '24',
                                    },
                                })}
                            >
                                <Text style={styles.historyBtnText}>Full Chart</Text>
                                <Ionicons name="chevron-forward" size={11} color={COLORS.primary} />
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Reboot button slot */}
                    {children}
                </View>
            )}
        </View>
    );
}

function MetricItem({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={[styles.metricValue, color ? { color } : {}]}>{value}</Text>
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
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    statusText: { fontSize: 13, fontWeight: '700' },
    rxBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, marginLeft: 6 },
    rxValue: { fontSize: 12, fontWeight: '600' },
    pollTime: { fontSize: 11, color: COLORS.text.light, marginRight: 4 },
    content: { marginTop: SPACING.sm },
    metricsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: SPACING.sm,
    },
    metricItem: {
        width: '47%',
        backgroundColor: '#F8FAFC',
        padding: SPACING.sm,
        borderRadius: RADIUS.sm,
    },
    metricLabel: { fontSize: 11, color: COLORS.text.light, marginBottom: 2 },
    metricValue: { fontSize: 14, fontWeight: '600', color: COLORS.text.primary },
    sparkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: SPACING.sm,
    },
    sparkLabel: { fontSize: 11, color: COLORS.text.light, width: 60 },
    historyBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        marginLeft: 'auto' as any,
        paddingHorizontal: 8, paddingVertical: 3,
        borderRadius: 10, borderWidth: 1, borderColor: COLORS.primary + '40',
    },
    historyBtnText: { fontSize: 11, color: COLORS.primary, fontWeight: '600' },
});
