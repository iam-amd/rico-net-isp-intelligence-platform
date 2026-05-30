import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Linking,
    Modal,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import GradientHeader from '../../components/GradientHeader';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../../constants/theme';
import { SurveyService, SurveyCustomerRow, SkipReason } from '../../services/collectionService';
import { surveyDraftService, type SurveyDraftSummary } from '../../services/surveyDraftService';
import { haptic } from '../../utils/haptics';
import ModernSurveyHub from '../../components/modern/SurveyHub';

type FilterKey = 'all' | 'unlinked' | 'done' | 'partial' | 'needs_review' | 'skipped';
type ModuleKey = 'hub' | 'normal';

interface Summary {
    done: number;
    partial: number;
    skipped: number;
    needs_review: number;
    pending: number;
    bound: number;
    unlinked: number;
}
interface SearchParams { query: string; filter: FilterKey; lat: number | null; lng: number | null; }

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
    { key: 'all',      label: 'All',      icon: 'list-outline' },
    { key: 'unlinked', label: 'Unlinked', icon: 'scan-outline' },
    { key: 'done',     label: 'Done',     icon: 'checkmark-circle-outline' },
    { key: 'partial',  label: 'Partial',  icon: 'alert-circle-outline' },
    { key: 'needs_review', label: 'Review', icon: 'warning-outline' },
    { key: 'skipped',  label: 'Skipped',  icon: 'close-circle-outline' },
];

const SKIP_REASONS: { key: SkipReason; label: string; icon: string }[] = [
    { key: 'not_home',      label: 'Not at home',  icon: 'home-outline' },
    { key: 'refused',       label: 'Refused',       icon: 'hand-left-outline' },
    { key: 'locked',        label: 'Door locked',   icon: 'lock-closed-outline' },
    { key: 'wrong_address', label: 'Wrong address', icon: 'close-circle-outline' },
    { key: 'other',         label: 'Other',         icon: 'ellipsis-horizontal' },
];

const PAGE_SIZE = 50;

function formatDistance(m: number | null | undefined): string | null {
    if (m == null) return null;
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function SurveyScreen() {
    const router = useRouter();
    const { isDarkMode, isModernUI } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;
    // startNormal=1: skip hub, go straight to list (called from AppShell SurveysTab)
    // fromShell=1: "Back to Hub" should navigate back instead of resetting module state
    const { startNormal, fromShell } = useLocalSearchParams<{ startNormal?: string; fromShell?: string }>();

    const [module, setModule]         = useState<ModuleKey>('hub');

    // Navigate directly to normal list when called from AppShell
    useEffect(() => {
        if (startNormal === '1') setModule('normal');
    }, [startNormal]);
    const [query, setQuery]           = useState('');
    const [filter, setFilter]         = useState<FilterKey>('all');
    const [rows, setRows]             = useState<SurveyCustomerRow[]>([]);
    const [total, setTotal]           = useState(0);
    const [summary, setSummary]       = useState<Summary | null>(null);
    const [loading, setLoading]       = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError]           = useState<string | null>(null);
    const [gpsReady, setGpsReady]     = useState(false);
    const [skipTarget, setSkipTarget] = useState<SurveyCustomerRow | null>(null);
    const [skipBusy, setSkipBusy]     = useState(false);
    const [draftSummary, setDraftSummary] = useState<SurveyDraftSummary>({ total: 0, pendingSubmit: 0, failed: 0 });
    const [draftSyncing, setDraftSyncing] = useState(false);

    const offsetRef    = useRef(0);
    const debounceRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const requestIdRef = useRef(0);
    const gpsRef       = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

    const paramsRef = useRef<SearchParams>({ query, filter, lat: null, lng: null });
    paramsRef.current = { query, filter, lat: gpsRef.current.lat, lng: gpsRef.current.lng };

    const refreshDraftSummary = useCallback(async () => {
        const summary = await surveyDraftService.getSummary();
        setDraftSummary(summary);
    }, []);

    // GPS
    useEffect(() => {
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                gpsRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
            } catch {
                // GPS unavailable
            } finally {
                setGpsReady(true);
            }
        })();
    }, []);

    const doSearch = useCallback(async (p: SearchParams, append = false) => {
        const reqId = ++requestIdRef.current;
        const notBound = p.filter === 'unlinked';
        const status   = p.filter === 'all' || p.filter === 'unlinked' ? undefined : p.filter;

        try {
            setError(null);
            const offset = append ? offsetRef.current : 0;
            const res = await SurveyService.search({
                q:        p.query.trim() || undefined,
                status,
                notBound,
                nearLat:  p.lat,
                nearLng:  p.lng,
                sort:     'auto',
                limit:    PAGE_SIZE,
                offset,
            });

            if (reqId !== requestIdRef.current) return;

            if (append) {
                setRows(prev => [...prev, ...res.items]);
            } else {
                setRows(res.items);
                if (res.summary) setSummary(res.summary);
            }
            setTotal(res.total);
            offsetRef.current = offset + res.items.length;
        } catch (e: any) {
            if (reqId !== requestIdRef.current) return;
            setError(e?.message || 'Search failed');
            if (!append) setRows([]);
        } finally {
            if (reqId === requestIdRef.current) {
                setLoading(false);
                setRefreshing(false);
                setLoadingMore(false);
            }
        }
    }, []);

    useEffect(() => {
        if (module !== 'normal' || !gpsReady) return;
        setRows([]);
        setLoading(true);
        offsetRef.current = 0;
        clearTimeout(debounceRef.current);
        const p: SearchParams = { query, filter, lat: gpsRef.current.lat, lng: gpsRef.current.lng };
        debounceRef.current = setTimeout(() => doSearch(p), query.trim() ? 300 : 0);
        return () => clearTimeout(debounceRef.current);
    }, [query, filter, gpsReady, doSearch, module]);

    useFocusEffect(
        useCallback(() => {
            if (module !== 'normal' || !gpsReady) return;
            offsetRef.current = 0;
            doSearch(paramsRef.current);
        }, [gpsReady, doSearch, module]),
    );

    useFocusEffect(
        useCallback(() => {
            refreshDraftSummary();
        }, [refreshDraftSummary]),
    );

    const onRefresh = () => {
        setRefreshing(true);
        offsetRef.current = 0;
        doSearch(paramsRef.current);
    };

    const onEndReached = () => {
        if (loadingMore || loading || rows.length >= total) return;
        setLoadingMore(true);
        doSearch(paramsRef.current, true);
    };

    const openForm = (row: SurveyCustomerRow) => {
        haptic.light();
        router.push({ pathname: '/survey-form/[id]', params: { id: row.username } } as any);
    };

    const callCustomer = (phone?: string | null) => {
        if (!phone) return;
        haptic.light();
        Linking.openURL(`tel:${phone}`);
    };

    const confirmSkip = async (reason: SkipReason) => {
        if (!skipTarget) return;
        setSkipBusy(true);
        try {
            await SurveyService.skipByCustomer(skipTarget.username, reason);
            haptic.success();
            setSkipTarget(null);
            doSearch(paramsRef.current);
        } catch (e: any) {
            setError(e?.message || 'Skip failed');
        } finally {
            setSkipBusy(false);
        }
    };

    const syncPendingDrafts = async () => {
        if (draftSyncing || draftSummary.pendingSubmit === 0) return;
        setDraftSyncing(true);
        try {
            const result = await surveyDraftService.processPendingDrafts();
            await refreshDraftSummary();
            offsetRef.current = 0;
            doSearch(paramsRef.current);
            if (result.failed > 0) {
                setError(`${result.failed} survey draft(s) still failed to sync. Open the customer and check the saved error.`);
            } else if (result.processed > 0) {
                setError(null);
            }
        } catch (e: any) {
            setError(e?.message || 'Draft sync failed');
        } finally {
            setDraftSyncing(false);
        }
    };

    const hasGps = gpsRef.current.lat != null;

    // ── Hub screen ──────────────────────────────────────────────────────────
    if (module === 'hub' && isModernUI) {
        return (
            <ModernSurveyHub
                onSelectModule={(m) => {
                    if (m === 'pg') router.push('/pg' as any);
                    else setModule('normal');
                }}
            />
        );
    }

    if (module === 'hub') {
        return (
            <View style={hubStyles.container}>
                <View style={hubStyles.header}>
                    <View style={hubStyles.headerIcon}>
                        <Ionicons name="scan-circle" size={28} color="#FF6B00" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={hubStyles.headerTitle}>SURVEY HUB</Text>
                        <Text style={hubStyles.headerSub}>Select Collection Module</Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={[hubStyles.moduleCard, { borderLeftColor: '#FF6B00' }]}
                    activeOpacity={0.85}
                    onPress={() => {
                        haptic.light();
                        setModule('normal');
                    }}
                >
                    <View style={[hubStyles.moduleNumBadge, { backgroundColor: '#FF6B0022', borderColor: '#FF6B0055' }]}>
                        <Text style={[hubStyles.moduleNumText, { color: '#FF6B00' }]}>MODULE 01</Text>
                    </View>
                    <View style={hubStyles.moduleIconWrap}>
                        <Ionicons name="people" size={44} color="#FF6B00" />
                    </View>
                    <Text style={hubStyles.moduleTitle}>NORMAL CUSTOMERS</Text>
                    <Text style={hubStyles.moduleDesc}>
                        Door-to-door field survey. Scan ONT sticker, confirm GPS location, and link MAC address to each customer account.
                    </Text>
                    <View style={hubStyles.moduleFooter}>
                        <View style={hubStyles.moduleTag}>
                            <Ionicons name="scan-outline" size={12} color="#FF6B00" />
                            <Text style={[hubStyles.moduleTagText, { color: '#FF6B00' }]}>MAC Linking</Text>
                        </View>
                        <View style={hubStyles.moduleTag}>
                            <Ionicons name="location-outline" size={12} color="#FF6B00" />
                            <Text style={[hubStyles.moduleTagText, { color: '#FF6B00' }]}>GPS Capture</Text>
                        </View>
                        <View style={{ flex: 1 }} />
                        <Ionicons name="chevron-forward" size={20} color="#FF6B00" />
                    </View>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[hubStyles.moduleCard, { borderLeftColor: '#3B82F6' }]}
                    activeOpacity={0.85}
                    onPress={() => {
                        haptic.light();
                        router.push('/pg' as any);
                    }}
                >
                    <View style={[hubStyles.moduleNumBadge, { backgroundColor: '#3B82F622', borderColor: '#3B82F655' }]}>
                        <Text style={[hubStyles.moduleNumText, { color: '#3B82F6' }]}>MODULE 02</Text>
                    </View>
                    <View style={hubStyles.moduleIconWrap}>
                        <Ionicons name="business" size={44} color="#3B82F6" />
                    </View>
                    <Text style={hubStyles.moduleTitle}>PG CUSTOMERS</Text>
                    <Text style={hubStyles.moduleDesc}>
                        Paying Guest building matrix. Floor-by-room collection with router groups, ONT scanning, and shared connection tracking.
                    </Text>
                    <View style={hubStyles.moduleFooter}>
                        <View style={[hubStyles.moduleTag, { borderColor: '#3B82F655' }]}>
                            <Ionicons name="grid-outline" size={12} color="#3B82F6" />
                            <Text style={[hubStyles.moduleTagText, { color: '#3B82F6' }]}>Room Matrix</Text>
                        </View>
                        <View style={[hubStyles.moduleTag, { borderColor: '#3B82F655' }]}>
                            <Ionicons name="wifi" size={12} color="#3B82F6" />
                            <Text style={[hubStyles.moduleTagText, { color: '#3B82F6' }]}>Router Groups</Text>
                        </View>
                        <View style={{ flex: 1 }} />
                        <Ionicons name="chevron-forward" size={20} color="#3B82F6" />
                    </View>
                </TouchableOpacity>

                <Text style={hubStyles.versionNote}>Rico Net Field Collection v4.2</Text>
            </View>
        );
    }

    // ── Normal survey list ───────────────────────────────────────────────────
    return (
        <View style={[styles.container, { backgroundColor: C.background }]}>
            <View style={styles.surveyHeader}>
                <TouchableOpacity
                    style={styles.backToHub}
                    onPress={() => {
                        haptic.light();
                        // If we navigated here from AppShell, go back to restore its chrome
                        if (fromShell === '1') router.back();
                        else setModule('hub');
                    }}
                >
                    <Ionicons name="chevron-back" size={16} color="#FF6B00" />
                    <Text style={styles.backToHubText}>Hub</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <GradientHeader title="Field Survey" count={total} />
                </View>
            </View>

            <View style={styles.searchWrap}>
                <View style={[styles.searchBox, { backgroundColor: C.card }]}>
                    <Ionicons name="search" size={18} color={C.text.light} />
                    <TextInput
                        style={[styles.searchInput, { color: C.text.primary }]}
                        placeholder="Name, username, phone, or address"
                        placeholderTextColor={C.text.light}
                        value={query}
                        onChangeText={setQuery}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                    />
                    {loading && !refreshing ? (
                        <ActivityIndicator size="small" color={C.primary} />
                    ) : query.length > 0 ? (
                        <TouchableOpacity onPress={() => setQuery('')}>
                            <Ionicons name="close-circle" size={18} color={C.text.light} />
                        </TouchableOpacity>
                    ) : null}
                </View>

                <View style={styles.filterRow}>
                    {FILTERS.map((f) => {
                        const active = f.key === filter;
                        const chipColor = f.key === 'unlinked' ? '#ea580c'
                                        : f.key === 'done'     ? '#10b981'
                                        : f.key === 'partial'  ? '#f59e0b'
                                        : f.key === 'needs_review' ? '#dc2626'
                                        : f.key === 'skipped'  ? '#94a3b8'
                                        : C.primary;
                        return (
                            <TouchableOpacity
                                key={f.key}
                                style={[
                                    styles.filterChip,
                                    {
                                        backgroundColor: active ? chipColor : C.card,
                                        borderColor:     active ? chipColor : C.border,
                                    },
                                ]}
                                onPress={() => setFilter(f.key)}
                            >
                                <Ionicons name={f.icon as any} size={12} color={active ? '#fff' : C.text.light} />
                                <Text style={{ color: active ? '#fff' : C.text.primary, fontSize: 11, fontWeight: '600' }}>
                                    {f.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <View style={styles.statsRow}>
                    <StatPill label="Total"    value={total}                   color={C.primary} />
                    <StatPill label="Done"     value={summary?.done    ?? 0}   color="#10b981" />
                    <StatPill label="Partial"  value={summary?.partial ?? 0}   color="#f59e0b" />
                    <StatPill label="Review"   value={summary?.needs_review ?? 0} color="#dc2626" />
                    <StatPill label="Unlinked" value={summary?.unlinked ?? 0}  color="#ea580c" />
                    {hasGps && (
                        <View style={[styles.gpsBadge, { backgroundColor: '#d1fae5', borderColor: '#6ee7b7' }]}>
                            <Ionicons name="navigate" size={10} color="#065f46" />
                            <Text style={{ fontSize: 9, color: '#065f46', fontWeight: '700' }}>GPS</Text>
                        </View>
                    )}
                </View>
            </View>

            {error && (
                <View style={[styles.errorBanner, { backgroundColor: '#fee2e2' }]}>
                    <Ionicons name="alert-circle" size={16} color="#991b1b" />
                    <Text style={{ color: '#991b1b', fontSize: 12, flex: 1 }}>{error}</Text>
                    <TouchableOpacity onPress={() => setError(null)}>
                        <Ionicons name="close" size={16} color="#991b1b" />
                    </TouchableOpacity>
                </View>
            )}

            {draftSummary.total > 0 && (
                <View style={styles.draftBanner}>
                    <Ionicons name="save-outline" size={16} color="#c2410c" />
                    <Text style={styles.draftBannerText}>
                        {draftSummary.pendingSubmit > 0
                            ? `${draftSummary.pendingSubmit} survey sync pending`
                            : `${draftSummary.total} survey draft saved`}
                        {draftSummary.failed > 0 ? ` (${draftSummary.failed} failed)` : ''}
                    </Text>
                    {draftSummary.pendingSubmit > 0 && (
                        <TouchableOpacity
                            style={[styles.draftSyncBtn, draftSyncing && { opacity: 0.5 }]}
                            onPress={syncPendingDrafts}
                            disabled={draftSyncing}
                        >
                            {draftSyncing ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.draftSyncText}>Sync</Text>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            )}

            <FlatList
                data={rows}
                keyExtractor={(item) => item.username}
                contentContainerStyle={{ padding: SPACING.md, paddingBottom: 80 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
                }
                onEndReached={onEndReached}
                onEndReachedThreshold={0.3}
                ListEmptyComponent={
                    loading ? (
                        <View style={styles.center}>
                            <ActivityIndicator color={C.primary} size="large" />
                            <Text style={{ color: C.text.light, fontSize: 13, marginTop: 8 }}>
                                {!gpsReady ? 'Getting location…' : 'Searching…'}
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.center}>
                            <Ionicons name="search-outline" size={44} color={C.text.light} />
                            <Text style={[styles.emptyText, { color: C.text.light }]}>
                                {filter === 'unlinked'
                                    ? 'All visible customers are already linked.'
                                    : query.trim()
                                        ? 'No customers match your search.'
                                        : 'Search by name, phone, or address.'}
                            </Text>
                        </View>
                    )
                }
                ListFooterComponent={
                    loadingMore ? (
                        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                            <ActivityIndicator color={C.primary} size="small" />
                        </View>
                    ) : rows.length > 0 && rows.length < total ? (
                        <Text style={{ textAlign: 'center', color: C.text.light, fontSize: 11, paddingVertical: 8 }}>
                            {rows.length} of {total} — scroll for more
                        </Text>
                    ) : null
                }
                renderItem={({ item }) => (
                    <CustomerCard
                        row={item}
                        C={C}
                        showDistance={hasGps}
                        onOpen={() => openForm(item)}
                        onCall={() => callCustomer(item.phone)}
                        onSkip={() => setSkipTarget(item)}
                    />
                )}
            />

            <Modal
                visible={!!skipTarget}
                transparent
                animationType="slide"
                onRequestClose={() => setSkipTarget(null)}
            >
                <TouchableOpacity
                    style={styles.modalBackdrop}
                    activeOpacity={1}
                    onPress={() => !skipBusy && setSkipTarget(null)}
                >
                    <View style={[styles.modalSheet, { backgroundColor: C.card }]}>
                        <Text style={[styles.modalTitle, { color: C.text.primary }]}>
                            Skip {skipTarget?.first_name || skipTarget?.username}
                        </Text>
                        <Text style={[styles.modalSub, { color: C.text.light }]}>Pick a reason</Text>
                        {SKIP_REASONS.map((r) => (
                            <TouchableOpacity
                                key={r.key}
                                style={[styles.reasonRow, { borderColor: C.border }]}
                                onPress={() => confirmSkip(r.key)}
                                disabled={skipBusy}
                            >
                                <Ionicons name={r.icon as any} size={20} color={C.text.primary} />
                                <Text style={[styles.reasonText, { color: C.text.primary }]}>{r.label}</Text>
                                <Ionicons name="chevron-forward" size={18} color={C.text.light} />
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            style={[styles.cancelBtn, { borderColor: C.border }]}
                            onPress={() => setSkipTarget(null)}
                            disabled={skipBusy}
                        >
                            <Text style={{ color: C.text.primary, fontWeight: '600' }}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

// ---------------------------------------------------------------------------
// Customer card
// ---------------------------------------------------------------------------

function CustomerCard({ row, C, showDistance, onOpen, onCall, onSkip }: {
    row: SurveyCustomerRow;
    C: any;
    showDistance: boolean;
    onOpen: () => void;
    onCall: () => void;
    onSkip: () => void;
}) {
    const fullName    = [row.first_name, row.last_name].filter(Boolean).join(' ');
    const displayName = fullName || row.username;
    const address     = row.rico_address || row.railwire_address;
    const statusMeta  = STATUS_META[row.survey_status] || STATUS_META.pending;
    const dist        = formatDistance(row.distance_m);
    const activeIdentifier = row.mac_address || row.ont_serial_number || row.onu_identifier || null;
    const reviewWarning = row.review_warnings?.find(Boolean) || row.review_detail || null;

    return (
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
            <TouchableOpacity style={styles.cardBody} onPress={onOpen} activeOpacity={0.75}>

                <View style={styles.cardHeader}>
                    <Text style={[styles.name, { color: C.text.primary, flex: 1 }]} numberOfLines={1}>
                        {displayName}
                    </Text>
                    <View style={styles.badgeGroup}>
                        <View style={[styles.statusBadge, { backgroundColor: statusMeta.bg }]}>
                            <Text style={[styles.statusText, { color: statusMeta.fg }]}>{statusMeta.label}</Text>
                        </View>
                        {showDistance && dist && (
                            <View style={styles.distBadge}>
                                <Ionicons name="navigate" size={10} color="#6366f1" />
                                <Text style={styles.distText}>{dist}</Text>
                            </View>
                        )}
                    </View>
                </View>

                <View style={styles.metaRow}>
                    <Ionicons name="person-outline" size={11} color={C.text.light} />
                    <Text style={[styles.metaText, { color: C.text.light }]} numberOfLines={1}>
                        {row.username}
                    </Text>
                    {row.phone ? (
                        <>
                            <Text style={{ color: C.border, fontSize: 11 }}>·</Text>
                            <Ionicons name="call-outline" size={11} color={C.text.light} />
                            <Text style={[styles.metaText, { color: C.text.light }]}>{row.phone}</Text>
                        </>
                    ) : null}
                </View>

                {address ? (
                    <View style={styles.addressRow}>
                        <Ionicons name="location-outline" size={12} color={C.text.light} />
                        <Text style={[styles.address, { color: C.text.light }]} numberOfLines={1}>
                            {address}
                        </Text>
                    </View>
                ) : null}

                <View style={styles.chipRow}>
                    {!row.has_binding ? (
                        <View style={[styles.miniChip, { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' }]}>
                            <Ionicons name="scan-outline" size={10} color="#c2410c" />
                            <Text style={{ fontSize: 9, color: '#c2410c', fontWeight: '700' }}>Unlinked</Text>
                        </View>
                    ) : (
                        <View style={[styles.miniChip, { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' }]}>
                            <Ionicons name="link" size={10} color="#15803d" />
                            <Text style={{ fontSize: 9, color: '#15803d', fontWeight: '600' }}>Linked</Text>
                        </View>
                    )}
                    {row.gps_confirmed && (
                        <View style={[styles.miniChip, { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' }]}>
                            <Ionicons name="location" size={10} color="#1d4ed8" />
                            <Text style={{ fontSize: 9, color: '#1d4ed8', fontWeight: '600' }}>GPS</Text>
                        </View>
                    )}
                    {activeIdentifier ? (
                        <View style={[styles.idChip]}>
                            <Ionicons name="hardware-chip-outline" size={10} color="#0f766e" />
                            <Text style={styles.idChipText} numberOfLines={1}>
                                {activeIdentifier}
                            </Text>
                        </View>
                    ) : null}
                    {row.binding_confidence ? (
                        <View style={[styles.miniChip, { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1' }]}>
                            <Text style={{ fontSize: 9, color: '#475569', fontWeight: '700' }}>
                                {row.binding_confidence.toUpperCase()}
                            </Text>
                        </View>
                    ) : null}
                    {row.pg_name ? (
                        <View style={[styles.pgChip]}>
                            <Ionicons name="people" size={10} color="#7c3aed" />
                            <Text style={{ fontSize: 9, color: '#7c3aed', fontWeight: '700' }} numberOfLines={1}>
                                {row.pg_name}
                            </Text>
                        </View>
                    ) : null}
                    {row.skip_reason ? (
                        <Text style={{ fontSize: 10, color: '#dc2626', fontWeight: '500' }}>
                            • {row.skip_reason.replace('_', ' ')}
                        </Text>
                    ) : null}
                    {reviewWarning ? (
                        <Text style={styles.reviewWarningText} numberOfLines={1}>
                            {reviewWarning}
                        </Text>
                    ) : null}
                </View>
            </TouchableOpacity>

            <View style={[styles.actionRow, { borderTopColor: C.border }]}>
                <TouchableOpacity
                    style={[styles.actionBtn, !row.phone && styles.actionBtnDisabled]}
                    onPress={onCall}
                    disabled={!row.phone}
                >
                    <Ionicons name="call" size={15} color={row.phone ? '#10b981' : C.text.light} />
                    <Text style={[styles.actionText, { color: row.phone ? '#10b981' : C.text.light }]}>Call</Text>
                </TouchableOpacity>
                <View style={[styles.actionDivider, { backgroundColor: C.border }]} />
                <TouchableOpacity style={[styles.actionBtn, { flex: 2 }]} onPress={onOpen}>
                    <Ionicons name="document-text-outline" size={15} color={C.primary} />
                    <Text style={[styles.actionText, { color: C.primary }]}>Open Survey</Text>
                </TouchableOpacity>
                <View style={[styles.actionDivider, { backgroundColor: C.border }]} />
                <TouchableOpacity style={styles.actionBtn} onPress={onSkip}>
                    <Ionicons name="close-circle-outline" size={15} color="#ef4444" />
                    <Text style={[styles.actionText, { color: '#ef4444' }]}>Skip</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <View style={[styles.statPill, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
            <Text style={[styles.statPillValue, { color }]}>{value}</Text>
            <Text style={[styles.statPillLabel, { color }]}>{label}</Text>
        </View>
    );
}

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
    pending:      { label: 'Pending',  bg: '#f1f5f9', fg: '#475569' },
    done:         { label: 'Done',     bg: '#dcfce7', fg: '#166534' },
    partial:      { label: 'Partial',  bg: '#fef3c7', fg: '#92400e' },
    skipped:      { label: 'Skipped',  bg: '#fee2e2', fg: '#991b1b' },
    needs_review: { label: 'Review',   bg: '#ffedd5', fg: '#9a3412' },
    surveyed:     { label: 'Surveyed', bg: '#dbeafe', fg: '#1e40af' },
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    container:   { flex: 1 },
    surveyHeader: { flexDirection: 'row', alignItems: 'center' },
    backToHub: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 2,
    },
    backToHubText: { color: '#FF6B00', fontSize: 13, fontWeight: '600' },
    searchWrap:  { padding: SPACING.md, paddingBottom: 4, gap: SPACING.sm },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: SPACING.md,
        paddingVertical: 10,
        borderRadius: RADIUS.md,
    },
    searchInput: { flex: 1, fontSize: 15, padding: 0 },
    filterRow:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        flexGrow: 1,
        minWidth: 82,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
    },
    statsRow:    { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
    statPill: {
        flexGrow: 1,
        minWidth: 62,
        paddingVertical: 5,
        paddingHorizontal: 6,
        borderRadius: 8,
        borderWidth: 1,
        alignItems: 'center',
    },
    statPillValue: { fontSize: 16, fontWeight: '700', lineHeight: 20 },
    statPillLabel: { fontSize: 9, fontWeight: '600', lineHeight: 13 },
    gpsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: SPACING.md,
        paddingVertical: 8,
        marginHorizontal: SPACING.md,
        marginBottom: 4,
        borderRadius: RADIUS.sm,
    },
    draftBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: SPACING.md,
        marginBottom: 4,
        paddingHorizontal: SPACING.md,
        paddingVertical: 8,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: '#fed7aa',
        backgroundColor: '#fff7ed',
    },
    draftBannerText: {
        flex: 1,
        color: '#9a3412',
        fontSize: 12,
        fontWeight: '700',
    },
    draftSyncBtn: {
        minWidth: 54,
        alignItems: 'center',
        borderRadius: 999,
        backgroundColor: '#ea580c',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    draftSyncText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    center:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 8 },
    emptyText: { fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
    card: {
        borderRadius: RADIUS.md,
        borderWidth: 1,
        marginBottom: SPACING.sm,
        overflow: 'hidden',
    },
    cardBody:   { paddingHorizontal: SPACING.md, paddingTop: 10, paddingBottom: 8, gap: 4 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
    name:       { fontSize: 15, fontWeight: '600' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    statusText:  { fontSize: 10, fontWeight: '700' },
    distBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#eef2ff',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
    },
    distText:   { fontSize: 10, fontWeight: '700', color: '#6366f1' },
    metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText:   { fontSize: 11, flex: 1 },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    address:    { fontSize: 12, flex: 1 },
    chipRow:    { flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 1 },
    miniChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
    },
    pgChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        maxWidth: 140,
    },
    idChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: '#ccfbf1',
        borderWidth: 1,
        borderColor: '#99f6e4',
        maxWidth: 180,
    },
    idChipText: {
        fontSize: 9,
        color: '#0f766e',
        fontWeight: '800',
        fontFamily: 'monospace',
        maxWidth: 150,
    },
    reviewWarningText: {
        fontSize: 10,
        color: '#b45309',
        fontWeight: '700',
        flexShrink: 1,
    },
    actionRow:         { flexDirection: 'row', borderTopWidth: 1 },
    actionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        paddingVertical: 8,
    },
    actionBtnDisabled: { opacity: 0.4 },
    actionText:        { fontSize: 12, fontWeight: '600' },
    actionDivider:     { width: 1 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalSheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: SPACING.lg,
        paddingBottom: SPACING.xl,
    },
    modalTitle:  { fontSize: 18, fontWeight: '700' },
    modalSub:    { fontSize: 12, marginTop: 4, marginBottom: SPACING.md },
    reasonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 12,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        marginBottom: 8,
    },
    reasonText: { flex: 1, fontSize: 15, fontWeight: '500' },
    cancelBtn: {
        marginTop: 8,
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
    },
});

// Hub styles — always dark navy, theme-independent
const hubStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0D1B2A',
        padding: 20,
        paddingTop: 56,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 28,
    },
    headerIcon: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: '#FF6B0015',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#FF6B0030',
    },
    headerTitle: {
        color: '#E2E8F0',
        fontSize: 22,
        fontWeight: '800',
        letterSpacing: 2,
    },
    headerSub: {
        color: '#64748B',
        fontSize: 12,
        letterSpacing: 0.5,
        marginTop: 2,
    },
    moduleCard: {
        backgroundColor: '#1A2535',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#2A3A4A',
        borderLeftWidth: 4,
        padding: 20,
        marginBottom: 16,
        gap: 8,
    },
    moduleNumBadge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        marginBottom: 4,
    },
    moduleNumText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 1.5,
    },
    moduleIconWrap: {
        marginBottom: 4,
    },
    moduleTitle: {
        color: '#E2E8F0',
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: 1.5,
    },
    moduleDesc: {
        color: '#64748B',
        fontSize: 13,
        lineHeight: 20,
    },
    moduleFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
    },
    moduleTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: '#FF6B0015',
        borderWidth: 1,
        borderColor: '#FF6B0030',
    },
    moduleTagText: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    versionNote: {
        color: '#2A3A4A',
        fontSize: 11,
        textAlign: 'center',
        marginTop: 8,
        letterSpacing: 0.5,
    },
});
