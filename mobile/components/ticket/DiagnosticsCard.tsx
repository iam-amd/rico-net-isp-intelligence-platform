import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DiagnosticsService } from '../../services/diagnosticsService';
import { DiagnosticAlert, DiagnosticsResponse } from '../../types';
import { COLORS, SPACING, RADIUS } from '../../constants/theme';

interface DiagnosticsCardProps {
    customerUsername: string;
}

const severityConfig = {
    critical: { color: COLORS.state.danger, bg: '#FEF2F2', border: '#FEE2E2', icon: 'alert-circle' as const },
    warning: { color: COLORS.state.warning, bg: '#FFFBEB', border: '#FEF3C7', icon: 'warning' as const },
    info: { color: COLORS.state.info, bg: '#EFF6FF', border: '#DBEAFE', icon: 'information-circle' as const },
};

export default function DiagnosticsCard({ customerUsername }: DiagnosticsCardProps) {
    const [data, setData] = useState<DiagnosticsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const runDiagnostics = () => {
        if (!customerUsername) return;
        setLoading(true);
        setError(null);
        DiagnosticsService.runDiagnostics(customerUsername)
            .then(setData)
            .catch((e: any) => setError(e?.message || 'Diagnostics check failed'))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        runDiagnostics();
    }, [customerUsername]);

    if (loading) {
        return (
            <View style={styles.container}>
                <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={styles.loadingText}>Running diagnostics...</Text>
                </View>
            </View>
        );
    }

    if (error || !data) {
        return (
            <View style={[styles.container, { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }]}>
                <TouchableOpacity style={styles.headerRow} onPress={() => setCollapsed(!collapsed)}>
                    <Ionicons name="warning" size={18} color={COLORS.state.warning} />
                    <Text style={[styles.headerText, { color: COLORS.state.warning, flex: 1 }]}>
                        Diagnostics Unavailable
                    </Text>
                    <Ionicons
                        name={collapsed ? 'chevron-down' : 'chevron-up'}
                        size={16}
                        color={COLORS.text.light}
                    />
                </TouchableOpacity>
                {!collapsed && (
                    <View style={styles.errorContent}>
                        <Text style={styles.errorText}>
                            {error || 'Could not retrieve diagnostics data'}
                        </Text>
                        <TouchableOpacity style={styles.retryBtn} onPress={runDiagnostics}>
                            <Ionicons name="refresh" size={14} color={COLORS.primary} />
                            <Text style={styles.retryText}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    }

    if (data.alerts.length === 0) {
        return (
            <View style={[styles.container, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
                <View style={styles.headerRow}>
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.state.success} />
                    <Text style={[styles.headerText, { color: COLORS.state.success }]}>All Clear</Text>
                </View>
                <Text style={styles.summary}>{data.summary}</Text>
            </View>
        );
    }

    const hasCritical = data.alerts.some(a => a.severity === 'critical');

    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.headerRow} onPress={() => setCollapsed(!collapsed)}>
                <Ionicons
                    name={hasCritical ? 'alert-circle' : 'warning'}
                    size={18}
                    color={hasCritical ? COLORS.state.danger : COLORS.state.warning}
                />
                <Text style={[styles.headerText, { color: hasCritical ? COLORS.state.danger : COLORS.state.warning }]}>
                    {data.alerts.length} Alert{data.alerts.length > 1 ? 's' : ''} Found
                </Text>
                <Ionicons
                    name={collapsed ? 'chevron-down' : 'chevron-up'}
                    size={16}
                    color={COLORS.text.light}
                    style={{ marginLeft: 'auto' }}
                />
            </TouchableOpacity>

            {!collapsed && (
                <>
                    <Text style={styles.summary}>{data.summary}</Text>
                    {data.alerts.map((alert, i) => {
                        const config = severityConfig[alert.severity] || severityConfig.info;
                        return (
                            <View key={i} style={[styles.alertItem, { backgroundColor: config.bg, borderColor: config.border }]}>
                                <Ionicons name={config.icon} size={16} color={config.color} />
                                <Text style={[styles.alertText, { color: config.color }]}>{alert.message}</Text>
                            </View>
                        );
                    })}
                </>
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
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    loadingText: {
        fontSize: 13,
        color: COLORS.text.secondary,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '700',
    },
    summary: {
        fontSize: 12,
        color: COLORS.text.secondary,
        marginTop: SPACING.xs,
        marginBottom: SPACING.sm,
    },
    alertItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: SPACING.sm,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        marginTop: SPACING.xs,
        gap: 8,
    },
    alertText: {
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
    },
    errorContent: {
        marginTop: SPACING.sm,
        alignItems: 'center',
        gap: 8,
    },
    errorText: {
        fontSize: 12,
        color: COLORS.text.secondary,
        textAlign: 'center',
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.primary + '15',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: RADIUS.full,
        gap: 4,
    },
    retryText: {
        fontSize: 13,
        fontWeight: '600',
        color: COLORS.primary,
    },
});
