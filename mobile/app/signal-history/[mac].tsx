/**
 * Signal History Chart Screen
 * ============================
 * Shows 24h or 7d Rx power trend for a customer's ONU.
 * Route: /signal-history/[mac]?customerName=Full Name&hours=24
 *
 * Uses a lightweight SVG line chart — no heavy chart library.
 * Data from: GET /field-team/onu/{mac}/sparkline?hours=N
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Dimensions,
} from 'react-native';
import Svg, { Path, Line, Text as SvgText, Circle, Rect } from 'react-native-svg';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FieldIntelService } from '../../services/fieldIntelService';
import { SignalPoint } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS } from '../../constants/theme';

const SCREEN_W = Dimensions.get('window').width;
const CHART_H = 200;
const CHART_W = SCREEN_W - 48;
const PAD = { top: 16, right: 12, bottom: 32, left: 48 };

type TimeRange = '24h' | '7d';

// Signal thresholds for color zones
const THRESHOLDS = [
    { min: -20, max: 999, color: '#22C55E', label: 'Excellent' },
    { min: -24, max: -20, color: '#EAB308', label: 'Good' },
    { min: -27, max: -24, color: '#F97316', label: 'Weak' },
    { min: -999, max: -27, color: '#EF4444', label: 'Critical' },
];

function getSignalColor(rx: number | null): string {
    if (rx == null) return '#94A3B8';
    for (const t of THRESHOLDS) {
        if (rx >= t.min && rx < t.max) return t.color;
    }
    return '#EF4444';
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function SignalHistoryScreen() {
    const { mac } = useLocalSearchParams<{ mac: string }>();
    const { customerName, hours: hoursParam } = useLocalSearchParams<{ customerName?: string; hours?: string }>();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    const [range, setRange] = useState<TimeRange>(hoursParam === '168' ? '7d' : '24h');
    const [data, setData] = useState<SignalPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tooltip, setTooltip] = useState<{ point: SignalPoint; x: number; y: number } | null>(null);

    const load = useCallback(async (r: TimeRange) => {
        if (!mac) return;
        setLoading(true);
        setError(null);
        try {
            const hours = r === '7d' ? 168 : 24;
            const points = await FieldIntelService.getSignalSparkline(mac, hours);
            setData(points);
        } catch (e: any) {
            setError(e?.message || 'Failed to load signal data');
        } finally {
            setLoading(false);
        }
    }, [mac]);

    useEffect(() => { load(range); }, [range, load]);

    // Downsample for display (max 200 points on chart)
    const sampled = React.useMemo(() => {
        if (data.length <= 200) return data;
        const step = Math.ceil(data.length / 200);
        return data.filter((_, i) => i % step === 0);
    }, [data]);

    // Chart math
    const chartPoints = React.useMemo(() => {
        const rxValues = sampled.map(p => p.rx_power_dbm).filter((v): v is number => v != null);
        if (rxValues.length === 0) return null;
        const minRx = Math.min(...rxValues) - 1;
        const maxRx = Math.max(...rxValues) + 1;
        const innerW = CHART_W - PAD.left - PAD.right;
        const innerH = CHART_H - PAD.top - PAD.bottom;

        const toX = (i: number) => PAD.left + (i / (sampled.length - 1)) * innerW;
        const toY = (rx: number) => PAD.top + (1 - (rx - minRx) / (maxRx - minRx)) * innerH;

        const pathData = sampled
            .map((p, i) => {
                if (p.rx_power_dbm == null) return null;
                const x = toX(i);
                const y = toY(p.rx_power_dbm);
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .filter(Boolean)
            .join(' ');

        // Y axis labels
        const yLabels: { y: number; label: string }[] = [];
        const step = Math.round((maxRx - minRx) / 4);
        for (let v = Math.round(minRx); v <= Math.round(maxRx); v += (step || 1)) {
            yLabels.push({ y: toY(v), label: `${v}` });
        }

        // X axis labels (show 4-5 timestamps)
        const xLabels: { x: number; label: string }[] = [];
        const indices = [0, Math.floor(sampled.length * 0.25), Math.floor(sampled.length * 0.5),
                         Math.floor(sampled.length * 0.75), sampled.length - 1];
        for (const idx of indices) {
            if (sampled[idx]) {
                xLabels.push({
                    x: toX(idx),
                    label: range === '24h' ? formatTime(sampled[idx].timestamp) : formatDate(sampled[idx].timestamp),
                });
            }
        }

        return { pathData, yLabels, xLabels, toX, toY, minRx, maxRx };
    }, [sampled, range]);

    // Stats
    const stats = React.useMemo(() => {
        const rxs = data.map(p => p.rx_power_dbm).filter((v): v is number => v != null);
        if (rxs.length === 0) return null;
        const avg = rxs.reduce((a, b) => a + b, 0) / rxs.length;
        const min = Math.min(...rxs);
        const max = Math.max(...rxs);
        const offlineCount = data.filter(p => p.status === 'offline').length;
        return { avg, min, max, offlineCount, total: data.length };
    }, [data]);

    const decodedMac = mac ? decodeURIComponent(mac) : '';

    return (
        <View style={[styles.container, { backgroundColor: C.background }]}>
            <Stack.Screen options={{
                title: 'Signal History',
                headerBackTitle: 'Back',
            }} />

            <ScrollView showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                    <View>
                        <Text style={[styles.macText, { color: C.text.primary }]}>{decodedMac}</Text>
                        {customerName ? (
                            <Text style={[styles.customerText, { color: C.text.secondary }]}>{customerName}</Text>
                        ) : null}
                    </View>
                    {/* Range toggle */}
                    <View style={[styles.toggle, { backgroundColor: C.background, borderColor: C.border }]}>
                        {(['24h', '7d'] as TimeRange[]).map(r => (
                            <TouchableOpacity
                                key={r}
                                style={[styles.toggleBtn, range === r && { backgroundColor: C.primary }]}
                                onPress={() => setRange(r)}
                            >
                                <Text style={[styles.toggleText,
                                    { color: range === r ? '#fff' : C.text.secondary }]}>{r}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={C.primary} size="large" />
                        <Text style={[styles.loadingText, { color: C.text.secondary }]}>Loading signal data...</Text>
                    </View>
                ) : error ? (
                    <View style={styles.center}>
                        <Ionicons name="warning-outline" size={40} color="#EF4444" />
                        <Text style={[styles.errorText, { color: C.text.secondary }]}>{error}</Text>
                        <TouchableOpacity style={[styles.retryBtn, { borderColor: C.primary }]} onPress={() => load(range)}>
                            <Text style={{ color: C.primary, fontWeight: '600' }}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                ) : data.length === 0 ? (
                    <View style={styles.center}>
                        <Ionicons name="analytics-outline" size={40} color={C.text.secondary} />
                        <Text style={[styles.errorText, { color: C.text.secondary }]}>
                            No signal data for the last {range}
                        </Text>
                    </View>
                ) : (
                    <>
                        {/* SVG Chart */}
                        <View style={[styles.chartCard, { backgroundColor: C.card, borderColor: C.border }]}>
                            <Text style={[styles.chartTitle, { color: C.text.secondary }]}>
                                Rx Power (dBm) — Last {range}  ·  {data.length} readings
                            </Text>

                            {chartPoints ? (
                                <Svg width={CHART_W} height={CHART_H}>
                                    {/* Background grid */}
                                    {chartPoints.yLabels.map((lbl, i) => (
                                        <React.Fragment key={i}>
                                            <Line
                                                x1={PAD.left} y1={lbl.y}
                                                x2={CHART_W - PAD.right} y2={lbl.y}
                                                stroke={isDarkMode ? '#1E293B' : '#F1F5F9'}
                                                strokeWidth="1"
                                            />
                                            <SvgText
                                                x={PAD.left - 6} y={lbl.y + 4}
                                                fontSize="9" fill={isDarkMode ? '#475569' : '#94A3B8'}
                                                textAnchor="end"
                                            >{lbl.label}</SvgText>
                                        </React.Fragment>
                                    ))}

                                    {/* Threshold line at -27 dBm (critical) */}
                                    {chartPoints.minRx <= -27 && (
                                        <Line
                                            x1={PAD.left} y1={chartPoints.toY(-27)}
                                            x2={CHART_W - PAD.right} y2={chartPoints.toY(-27)}
                                            stroke="#EF4444" strokeWidth="1" strokeDasharray="4,3" opacity="0.5"
                                        />
                                    )}

                                    {/* Signal line */}
                                    <Path
                                        d={chartPoints.pathData}
                                        fill="none"
                                        stroke={getSignalColor(stats?.avg ?? null)}
                                        strokeWidth="2"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                    />

                                    {/* X axis labels */}
                                    {chartPoints.xLabels.map((lbl, i) => (
                                        <SvgText
                                            key={i} x={lbl.x} y={CHART_H - 4}
                                            fontSize="9" fill={isDarkMode ? '#475569' : '#94A3B8'}
                                            textAnchor="middle"
                                        >{lbl.label}</SvgText>
                                    ))}
                                </Svg>
                            ) : null}

                            {/* Legend */}
                            <View style={styles.legend}>
                                {THRESHOLDS.map(t => (
                                    <View key={t.label} style={styles.legendItem}>
                                        <View style={[styles.legendDot, { backgroundColor: t.color }]} />
                                        <Text style={[styles.legendText, { color: C.text.secondary }]}>{t.label}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                        {/* Stats row */}
                        {stats && (
                            <View style={[styles.statsCard, { backgroundColor: C.card, borderColor: C.border }]}>
                                <StatBox label="Average" value={`${stats.avg.toFixed(1)} dBm`}
                                    color={getSignalColor(stats.avg)} C={C} />
                                <View style={[styles.statDivider, { backgroundColor: C.border }]} />
                                <StatBox label="Best" value={`${stats.max.toFixed(1)} dBm`}
                                    color={getSignalColor(stats.max)} C={C} />
                                <View style={[styles.statDivider, { backgroundColor: C.border }]} />
                                <StatBox label="Worst" value={`${stats.min.toFixed(1)} dBm`}
                                    color={getSignalColor(stats.min)} C={C} />
                                <View style={[styles.statDivider, { backgroundColor: C.border }]} />
                                <StatBox label="Offline Events"
                                    value={String(stats.offlineCount)}
                                    color={stats.offlineCount > 0 ? '#EF4444' : '#22C55E'} C={C} />
                            </View>
                        )}

                        {/* Signal health note */}
                        {stats && (
                            <View style={[styles.noteCard, { backgroundColor: C.card, borderColor: C.border }]}>
                                <Ionicons
                                    name={stats.avg >= -20 ? 'checkmark-circle' : stats.avg >= -24 ? 'warning' : 'alert-circle'}
                                    size={18}
                                    color={getSignalColor(stats.avg)}
                                />
                                <Text style={[styles.noteText, { color: C.text.secondary }]}>
                                    {stats.avg >= -20
                                        ? 'Signal is excellent. No action needed.'
                                        : stats.avg >= -24
                                        ? 'Signal is good but monitor for degradation.'
                                        : stats.avg >= -27
                                        ? 'Signal is weak. Schedule fiber maintenance.'
                                        : 'Signal is critical. Dispatch with OTDR kit immediately.'}
                                </Text>
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function StatBox({ label, value, color, C }: { label: string; value: string; color: string; C: any }) {
    return (
        <View style={styles.statBox}>
            <Text style={[styles.statValue, { color }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: C.text.light }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
    },
    macText: { fontSize: 13, fontFamily: 'monospace', fontWeight: '600' },
    customerText: { fontSize: 12, marginTop: 2 },
    toggle: {
        flexDirection: 'row', borderRadius: 8, borderWidth: 1, overflow: 'hidden',
    },
    toggleBtn: { paddingHorizontal: 14, paddingVertical: 6 },
    toggleText: { fontSize: 13, fontWeight: '600' },
    center: { alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 },
    loadingText: { fontSize: 14 },
    errorText: { fontSize: 14, textAlign: 'center' },
    retryBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8, marginTop: 8 },
    chartCard: {
        margin: 16, borderRadius: 12, borderWidth: 1, padding: 16,
    },
    chartTitle: { fontSize: 12, marginBottom: 12 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 11 },
    statsCard: {
        marginHorizontal: 16, marginBottom: 12, borderRadius: 12, borderWidth: 1,
        flexDirection: 'row', alignItems: 'center',
    },
    statBox: { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8 },
    statValue: { fontSize: 14, fontWeight: '700' },
    statLabel: { fontSize: 10, marginTop: 2 },
    statDivider: { width: 1, height: 40 },
    noteCard: {
        marginHorizontal: 16, marginBottom: 24, borderRadius: 10, borderWidth: 1,
        padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    },
    noteText: { fontSize: 13, flex: 1, lineHeight: 18 },
});
