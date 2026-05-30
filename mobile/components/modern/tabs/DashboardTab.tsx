import React, { useEffect, useState } from 'react';
import {
    ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../context/AuthContext';
import { useTicketList } from '../../../hooks/useTicketList';
import { TicketStatus } from '../../../types';
import { SurveyService } from '../../../services/collectionService';

type TabKey = 'dashboard' | 'complaints' | 'surveys' | 'search' | 'map';

const PENDING: TicketStatus[] = ['Assigned', 'Open'];
const ONGOING: TicketStatus[] = ['Ongoing'];

const BG   = '#fff8f6';
const CARD  = '#fff8f6';
const BDR   = '#271812';
const ORANGE = '#ff5a00';
const TEXT  = '#271812';
const MUTED = '#5b4137';
const CREAM = '#fadcd2';
const DARK_CARD = '#18181b';

function NeoCard({
    children, style, onPress,
}: { children: React.ReactNode; style?: any; onPress?: () => void }) {
    const inner = (
        <View style={[styles.neoCard, style]}>
            {children}
        </View>
    );
    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.neoWrapper}>
                {inner}
            </TouchableOpacity>
        );
    }
    return <View style={styles.neoWrapper}>{inner}</View>;
}

export default function DashboardTab({ onNavigate }: { onNavigate: (tab: TabKey) => void }) {
    const { user } = useAuth();
    const pending = useTicketList({ statusFilter: PENDING });
    const ongoing = useTicketList({ statusFilter: ONGOING });
    const [surveyActionCount, setSurveyActionCount] = useState<number | null>(null);

    useEffect(() => {
        let mounted = true;
        SurveyService.search({ limit: 1 })
            .then((res) => {
                if (!mounted) return;
                const summary = res.summary;
                if (!summary) {
                    setSurveyActionCount(null);
                    return;
                }
                setSurveyActionCount(
                    (summary.pending ?? 0) + (summary.partial ?? 0) + (summary.needs_review ?? 0),
                );
            })
            .catch(() => {
                if (mounted) setSurveyActionCount(null);
            });
        return () => {
            mounted = false;
        };
    }, []);

    const techName = (user?.full_name || user?.username || 'TECHNICIAN').toUpperCase();

    return (
        <ScrollView
            style={styles.root}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
        >
            {/* Status header */}
            <View style={styles.statusCard}>
                <View>
                    <Text style={styles.statusLabel}>SYSTEM_STATUS: ONLINE</Text>
                    <Text style={styles.dashTitle}>DASHBOARD</Text>
                </View>
                <View style={styles.statusBoxRow}>
                    <View style={styles.statusBox}>
                        <Text style={styles.statusBoxLabel}>TECHNICIAN</Text>
                        <Text style={styles.statusBoxValue}>{techName}</Text>
                    </View>
                    <View style={styles.statusBox}>
                        <Text style={styles.statusBoxLabel}>ZONE</Text>
                        <Text style={styles.statusBoxValue}>TN CENTRAL</Text>
                    </View>
                </View>
            </View>

            {/* Bento grid */}
            <View style={styles.grid}>
                {/* COMPLAINTS — large */}
                <NeoCard onPress={() => onNavigate('complaints')}>
                    <View style={styles.cardIconRow}>
                        <View style={styles.iconBox}>
                            <Ionicons name="alert-circle-outline" size={24} color={TEXT} />
                        </View>
                    </View>
                    <View style={styles.cardBottom}>
                        <Text style={styles.cardTitle}>COMPLAINTS</Text>
                        <View style={styles.cardCountRow}>
                            <Text style={styles.cardBigNumber}>
                                {String(pending.tickets.length + ongoing.tickets.length).padStart(2, '0')}
                            </Text>
                            <Text style={styles.cardSub}>Active tickets requiring{'\n'}immediate attention</Text>
                        </View>
                    </View>
                </NeoCard>

                {/* SURVEYS */}
                <NeoCard onPress={() => onNavigate('surveys')}>
                    <View style={styles.cardIconRow}>
                        <View style={styles.iconBox}>
                            <Ionicons name="list-outline" size={24} color={TEXT} />
                        </View>
                    </View>
                    <View style={styles.cardBottom}>
                        <Text style={styles.cardTitleMd}>SURVEYS</Text>
                        <View style={styles.cardCountRowSm}>
                            <Text style={styles.cardMedNumber}>
                                {String(surveyActionCount ?? 0).padStart(2, '0')}
                            </Text>
                            <Text style={styles.cardSubSm}>Pending{'\n'}reviews</Text>
                        </View>
                    </View>
                </NeoCard>

                {/* CUSTOMER SEARCH */}
                <NeoCard onPress={() => onNavigate('search')} style={styles.halfCard}>
                    <View style={styles.cardIconRow}>
                        <View style={styles.iconBox}>
                            <Ionicons name="person-outline" size={24} color={TEXT} />
                        </View>
                    </View>
                    <Text style={styles.cardTitleMd}>CUSTOMER SEARCH</Text>
                    <View style={styles.fauxSearch}>
                        <Text style={styles.fauxSearchText}>ENTER_ID_OR_NAME...</Text>
                        <Ionicons name="return-down-back-outline" size={18} color={MUTED} />
                    </View>
                </NeoCard>

                {/* MAP VIEW */}
                <TouchableOpacity
                    style={[styles.neoWrapper, styles.halfCard]}
                    onPress={() => onNavigate('map')}
                    activeOpacity={0.85}
                >
                    <View style={[styles.neoCard, styles.mapCard]}>
                        <View style={styles.mapOverlay} />
                        <View style={styles.mapContent}>
                            <View style={styles.cardIconRow}>
                                <View style={[styles.iconBox, styles.iconBoxDark]}>
                                    <Ionicons name="map-outline" size={24} color="#ffffff" />
                                </View>
                            </View>
                            <View style={styles.cardBottom}>
                                <Text style={[styles.cardTitleMd, { color: '#ffffff' }]}>MAP VIEW</Text>
                                <Text style={styles.mapSub}>LIVE_TELEMETRY_FEED_ACTIVE</Text>
                            </View>
                        </View>
                    </View>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    content: { padding: 16, paddingBottom: 24, gap: 16 },
    statusCard: {
        backgroundColor: CREAM,
        borderWidth: 2,
        borderColor: BDR,
        padding: 16,
        shadowColor: BDR,
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 0,
        gap: 12,
    },
    statusLabel: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 },
    dashTitle: { color: TEXT, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, textTransform: 'uppercase' },
    statusBoxRow: { flexDirection: 'row', gap: 10 },
    statusBox: {
        flex: 1, backgroundColor: CARD, borderWidth: 2, borderColor: BDR,
        paddingHorizontal: 12, paddingVertical: 8,
    },
    statusBoxLabel: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 },
    statusBoxValue: { color: TEXT, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
    grid: { gap: 12 },
    neoWrapper: { marginBottom: 0 },
    neoCard: {
        backgroundColor: CARD,
        borderWidth: 2,
        borderColor: BDR,
        padding: 16,
        minHeight: 180,
        shadowColor: BDR,
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 0,
        justifyContent: 'space-between',
    },
    halfCard: { flex: 1 },
    cardIconRow: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 8 },
    iconBox: {
        width: 44, height: 44, borderWidth: 2, borderColor: BDR,
        backgroundColor: CARD, alignItems: 'center', justifyContent: 'center',
    },
    iconBoxDark: { backgroundColor: DARK_CARD, borderColor: '#ffffff' },
    cardBottom: { gap: 4 },
    cardTitle: { color: TEXT, fontSize: 32, fontWeight: '900', textTransform: 'uppercase', letterSpacing: -0.5 },
    cardTitleMd: { color: TEXT, fontSize: 20, fontWeight: '900', textTransform: 'uppercase', letterSpacing: -0.3 },
    cardCountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    cardCountRowSm: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    cardBigNumber: { color: ORANGE, fontSize: 64, fontWeight: '900', lineHeight: 68 },
    cardMedNumber: { color: TEXT, fontSize: 40, fontWeight: '900', lineHeight: 44 },
    cardSub: { color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', paddingBottom: 6, flex: 1 },
    cardSubSm: { color: MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', paddingBottom: 4 },
    fauxSearch: {
        marginTop: 12, backgroundColor: '#fff1ec', borderWidth: 2, borderColor: BDR,
        paddingHorizontal: 14, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    fauxSearchText: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    mapCard: { backgroundColor: DARK_CARD, borderColor: BDR, overflow: 'hidden', minHeight: 160, padding: 0 },
    mapOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(9,9,11,0.65)',
    },
    mapContent: { padding: 16, flex: 1, justifyContent: 'space-between', zIndex: 1 },
    mapSub: { color: '#a1a1aa', fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
});
