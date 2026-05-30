/**
 * Dashboard.tsx — Neo-Brutalist / Industrial design system
 * Main dashboard bento-grid with complaints, surveys, search, and map tiles.
 */
import React from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Design Tokens ────────────────────────────────────────────────────────────
const BG      = '#0F1523';
const CARD    = '#16203D';
const CARD2   = '#1f2947';
const BORDER  = '#0F172A';
const BORDER_L = '#1e293b';
const ORANGE  = '#FF5A00';
const TEXT    = '#ffffff';
const SUB     = '#94a3b8';
const MUTED   = '#64748b';

const SHADOW = {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1 as const,
    shadowRadius: 0,
    elevation: 6,
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DashboardProps {
    ticketCounts: {
        pending: number;
        ongoing: number;
        completed: number;
    };
    techName: string;
    onNavigate: (tab: 'complaints' | 'surveys' | 'search' | 'map') => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Dashboard({ ticketCounts, techName, onNavigate }: DashboardProps) {
    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
        >
            {/* Status Bar */}
            <View style={styles.statusBar}>
                <View style={styles.statusLeft}>
                    <View style={styles.statusDot} />
                    <View>
                        <Text style={styles.statusLabel}>SYSTEM_STATUS: ONLINE</Text>
                        <Text style={styles.h1}>DASHBOARD</Text>
                    </View>
                </View>
                <View style={styles.statusRight}>
                    <View style={styles.chip}>
                        <Ionicons name="person-outline" size={11} color={ORANGE} />
                        <Text style={styles.chipText}>{techName.toUpperCase()}</Text>
                    </View>
                    <View style={[styles.chip, styles.chipSecondary]}>
                        <Text style={styles.chipText}>TN CENTRAL ZONE 3</Text>
                    </View>
                </View>
            </View>

            {/* Bento Row 1 */}
            <View style={styles.bentoRow}>
                {/* COMPLAINTS tile — flex:2 */}
                <TouchableOpacity
                    style={[styles.tile, styles.tileLarge, styles.tileCard]}
                    onPress={() => onNavigate('complaints')}
                    activeOpacity={0.85}
                >
                    <View style={styles.tileIconBox}>
                        <Ionicons name="warning-outline" size={24} color={ORANGE} />
                    </View>
                    <View style={styles.tileSpacer} />
                    <View style={styles.tileBottom}>
                        <Text style={styles.tileTitle}>COMPLAINTS</Text>
                        <Text style={styles.tileBigNum}>{ticketCounts.pending}</Text>
                        <Text style={styles.tileSub}>ACTIVE TICKETS REQUIRING ATTENTION</Text>
                    </View>
                </TouchableOpacity>

                {/* SURVEYS tile — flex:1 */}
                <TouchableOpacity
                    style={[styles.tile, styles.tileSmall, styles.tileCard]}
                    onPress={() => onNavigate('surveys')}
                    activeOpacity={0.85}
                >
                    <View style={styles.tileIconBox}>
                        <Ionicons name="clipboard-outline" size={20} color={ORANGE} />
                    </View>
                    <View style={styles.tileSpacer} />
                    <View style={styles.tileBottom}>
                        <Text style={styles.tileTitle}>SURVEYS</Text>
                        <Text style={styles.tileMidNum}>{ticketCounts.ongoing}</Text>
                        <Text style={styles.tileSub}>PENDING REVIEWS</Text>
                    </View>
                </TouchableOpacity>
            </View>

            {/* Bento Row 2 */}
            <View style={styles.bentoRow}>
                {/* CUSTOMER SEARCH tile */}
                <TouchableOpacity
                    style={[styles.tile, styles.tileHalf, styles.tileCard]}
                    onPress={() => onNavigate('search')}
                    activeOpacity={0.85}
                >
                    <View style={styles.tileIconBox}>
                        <Ionicons name="search-outline" size={20} color={ORANGE} />
                    </View>
                    <Text style={[styles.tileTitle, { marginTop: 12 }]}>CUSTOMER SEARCH</Text>
                    {/* Faux input bar */}
                    <View style={styles.fauxInput}>
                        <Text style={styles.fauxInputText}>ENTER_ID_OR_NAME...</Text>
                    </View>
                </TouchableOpacity>

                {/* MAP tile */}
                <TouchableOpacity
                    style={[styles.tile, styles.tileHalf, styles.tileMapBg]}
                    onPress={() => onNavigate('map')}
                    activeOpacity={0.85}
                >
                    <View style={styles.tileIconBox}>
                        <Ionicons name="map-outline" size={20} color={ORANGE} />
                    </View>
                    <View style={styles.tileSpacer} />
                    <View style={styles.tileBottom}>
                        <Text style={styles.tileTitle}>MAP VIEW</Text>
                        <Text style={styles.tileSub}>LIVE_TELEMETRY_FEED_ACTIVE</Text>
                    </View>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: BG },
    container: {
        padding: 16,
        paddingBottom: 40,
        gap: 12,
    },

    // Status bar
    statusBar: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        borderWidth: 2,
        borderColor: BORDER,
        backgroundColor: CARD,
        padding: 16,
        ...SHADOW,
    },
    statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    statusDot: {
        width: 8,
        height: 8,
        backgroundColor: '#00E676',
        borderWidth: 2,
        borderColor: BORDER,
        marginTop: 6,
    },
    statusLabel: {
        color: MUTED,
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1,
    },
    h1: {
        color: TEXT,
        fontSize: 28,
        fontWeight: '900',
        letterSpacing: 3,
    },
    statusRight: { gap: 6, alignItems: 'flex-end' },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 2,
        borderColor: ORANGE,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    chipSecondary: { borderColor: BORDER_L },
    chipText: {
        color: TEXT,
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 1,
    },

    // Bento rows
    bentoRow: {
        flexDirection: 'row',
        gap: 12,
        minHeight: 200,
    },

    // Tiles
    tile: {
        borderWidth: 2,
        borderColor: BORDER,
        padding: 16,
        ...SHADOW,
    },
    tileCard: { backgroundColor: CARD },
    tileMapBg: { backgroundColor: '#0a0f1a', minHeight: 180 },
    tileLarge: { flex: 2 },
    tileSmall: { flex: 1 },
    tileHalf: { flex: 1 },

    tileIconBox: {
        width: 48,
        height: 48,
        borderWidth: 2,
        borderColor: BORDER_L,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tileSpacer: { flex: 1 },
    tileBottom: { gap: 4 },
    tileTitle: {
        color: TEXT,
        fontSize: 15,
        fontWeight: '900',
        letterSpacing: 2,
    },
    tileBigNum: {
        color: ORANGE,
        fontSize: 72,
        fontWeight: '900',
        lineHeight: 76,
        letterSpacing: -2,
    },
    tileMidNum: {
        color: ORANGE,
        fontSize: 40,
        fontWeight: '900',
        letterSpacing: -1,
    },
    tileSub: {
        color: SUB,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.5,
    },

    // Faux input
    fauxInput: {
        marginTop: 16,
        backgroundColor: CARD2,
        borderWidth: 2,
        borderColor: BORDER_L,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    fauxInputText: {
        color: MUTED,
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 1,
    },
});
