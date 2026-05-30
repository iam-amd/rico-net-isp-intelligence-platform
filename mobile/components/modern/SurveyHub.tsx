/**
 * SurveyHub.tsx — Neo-Brutalist / Industrial design system
 * Survey module selector: Normal Customers vs PG Customers.
 */
import React from 'react';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Design Tokens ────────────────────────────────────────────────────────────
const BG      = '#0F1523';
const CARD    = '#16203D';
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
export interface SurveyHubProps {
    onSelectModule: (module: 'normal' | 'pg') => void;
    techName?: string;
    /** When rendered inside AppShell (which has its own header), hide the built-in header */
    hideHeader?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SurveyHub({ onSelectModule, techName, hideHeader }: SurveyHubProps) {
    return (
        <View style={styles.container}>
            {/* Header — hidden when rendered inside AppShell (which provides its own header) */}
            {!hideHeader && (
                <View style={styles.header}>
                    <View style={styles.headerLeft}>
                        <View style={styles.headerIconBox}>
                            <Ionicons name="menu" size={20} color={MUTED} />
                        </View>
                    </View>
                    <Text style={styles.headerTitle}>SURVEY HUB</Text>
                    <View style={styles.headerRight}>
                        <View style={styles.headerPersonBox}>
                            <Ionicons name="person-outline" size={18} color={MUTED} />
                        </View>
                    </View>
                </View>
            )}

            {/* Main */}
            <View style={styles.main}>
                {/* Module 01 — Normal Customers */}
                <TouchableOpacity
                    style={[styles.moduleCard]}
                    onPress={() => onSelectModule('normal')}
                    activeOpacity={0.85}
                >
                    <View style={styles.moduleIdBox}>
                        <Text style={styles.moduleIdText}>MODULE_ID: 01</Text>
                    </View>
                    <View style={styles.moduleIconBox}>
                        <Ionicons name="people-outline" size={32} color={TEXT} />
                    </View>
                    <Text style={styles.moduleTitle}>NORMAL CUSTOMERS</Text>
                    <Text style={styles.moduleDesc}>
                        Standard residential and commercial survey profiles.
                    </Text>
                    <View style={styles.moduleArrow}>
                        <Ionicons name="arrow-forward" size={20} color={ORANGE} />
                    </View>
                </TouchableOpacity>

                {/* Module 02 — PG Customers */}
                <TouchableOpacity
                    style={[styles.moduleCard]}
                    onPress={() => onSelectModule('pg')}
                    activeOpacity={0.85}
                >
                    <View style={styles.moduleIdBox}>
                        <Text style={styles.moduleIdText}>MODULE_ID: 02</Text>
                    </View>
                    <View style={styles.moduleIconBox}>
                        <Ionicons name="business-outline" size={32} color={TEXT} />
                    </View>
                    <Text style={styles.moduleTitle}>PG CUSTOMERS</Text>
                    <Text style={styles.moduleDesc}>
                        Paying Guest accommodations. Floor-by-room collection.
                    </Text>
                    <View style={styles.moduleArrow}>
                        <Ionicons name="arrow-forward" size={20} color={ORANGE} />
                    </View>
                </TouchableOpacity>

                {techName ? (
                    <Text style={styles.techLabel}>OPERATOR: {techName.toUpperCase()}</Text>
                ) : null}
            </View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 2,
        borderBottomColor: BORDER_L,
        paddingHorizontal: 16,
        paddingTop: 52,
        paddingBottom: 14,
    },
    headerLeft: {},
    headerRight: {},
    headerIconBox: {
        width: 36,
        height: 36,
        borderWidth: 2,
        borderColor: BORDER_L,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        color: ORANGE,
        fontSize: 20,
        fontWeight: '900',
        fontStyle: 'italic',
        letterSpacing: 3,
    },
    headerPersonBox: {
        width: 40,
        height: 40,
        borderWidth: 2,
        borderColor: BORDER_L,
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Main
    main: {
        flex: 1,
        justifyContent: 'center',
        padding: 24,
        gap: 16,
    },

    // Module Cards
    moduleCard: {
        backgroundColor: CARD,
        borderWidth: 2,
        borderColor: BORDER,
        padding: 32,
        gap: 12,
        ...SHADOW,
    },
    moduleIdBox: {
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: BORDER_L,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    moduleIdText: {
        color: MUTED,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 1,
    },
    moduleIconBox: {
        width: 64,
        height: 64,
        borderWidth: 2,
        borderColor: BORDER_L,
        backgroundColor: BG,
        alignItems: 'center',
        justifyContent: 'center',
    },
    moduleTitle: {
        color: TEXT,
        fontSize: 20,
        fontWeight: '900',
        letterSpacing: 2,
    },
    moduleDesc: {
        color: SUB,
        fontSize: 13,
        lineHeight: 20,
    },
    moduleArrow: {
        alignSelf: 'flex-end',
        marginTop: 4,
    },

    techLabel: {
        color: MUTED,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1.5,
        textAlign: 'center',
        marginTop: 8,
    },
});
