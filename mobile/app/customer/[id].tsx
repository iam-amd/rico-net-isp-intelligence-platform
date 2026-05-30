import React, { useState, useCallback } from 'react';
import {
    View, Text, ScrollView, TouchableOpacity, StyleSheet,
    ActivityIndicator, Linking, Platform, Alert, Image,
} from 'react-native';
import { useLocalSearchParams, Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { CustomerService } from '../../services/customerService';
import { Customer, Ticket } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../../constants/theme';
import { formatName } from '../../utils/format';
import TicketCard from '../../components/TicketCard';

export default function CustomerDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const C = isDarkMode ? DARK_COLORS : COLORS;

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingGps, setSavingGps] = useState(false);

    // Reload every time this screen comes into focus — covers the case where
    // the tech just linked an ONU via scan-onu.tsx and router.back() returns here.
    useFocusEffect(useCallback(() => {
        loadData();
    }, [id]));

    const loadData = async () => {
        try {
            setError(null);
            setLoading(true);
            // Backend uses username (string) as primary key, not numeric id
            const customerUsername = String(id);
            const [cust, tix] = await Promise.all([
                CustomerService.getByUsername(customerUsername),
                CustomerService.getTickets(customerUsername),
            ]);
            setCustomer(cust);
            setTickets(tix);
        } catch (e: any) {
            console.error('[CustomerDetail] Load failed', e);
            setError(e?.message || 'Failed to load customer details');
        } finally {
            setLoading(false);
        }
    };

    const callCustomer = () => {
        if (customer?.phone) Linking.openURL(`tel:${customer.phone}`);
    };

    const saveGpsLocation = async () => {
        if (!customer) return;
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Denied', 'Location access is required to save GPS coordinates.');
            return;
        }
        setSavingGps(true);
        try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            await CustomerService.saveLocation(customer.username, loc.coords.latitude, loc.coords.longitude);
            // Update local state so the GPS row shows immediately
            setCustomer(prev => prev ? {
                ...prev,
                geo_lat: loc.coords.latitude,
                geo_long: loc.coords.longitude,
            } : prev);
            Alert.alert('Saved', `GPS location saved (±${Math.round(loc.coords.accuracy ?? 10)}m accuracy).`);
        } catch {
            Alert.alert('Error', 'Failed to save GPS location. Check your connection.');
        } finally {
            setSavingGps(false);
        }
    };

    const openMap = () => {
        if (customer?.geo_lat && customer?.geo_long) {
            const url = Platform.select({
                ios: `maps:?q=${customer.geo_lat},${customer.geo_long}`,
                android: `geo:${customer.geo_lat},${customer.geo_long}`,
                web: `https://www.google.com/maps?q=${customer.geo_lat},${customer.geo_long}`,
            });
            if (url) Linking.openURL(url);
        } else if (customer?.railwire_address) {
            const query = encodeURIComponent(customer.railwire_address);
            Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
        }
    };

    if (loading) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <Stack.Screen options={{
                    title: 'Customer',
                    headerStyle: { backgroundColor: C.card },
                    headerTitleStyle: { color: C.text.primary },
                    headerShadowVisible: false,
                }} />
                <ActivityIndicator size="large" color={C.primary} />
            </View>
        );
    }

    if (error || !customer) {
        return (
            <View style={[styles.center, { backgroundColor: C.background }]}>
                <Stack.Screen options={{
                    title: 'Customer',
                    headerStyle: { backgroundColor: C.card },
                    headerTitleStyle: { color: C.text.primary },
                    headerShadowVisible: false,
                }} />
                <View style={styles.errorContainer}>
                    <View style={[styles.errorIconCircle, { backgroundColor: C.state?.danger ? C.state.danger + '15' : '#FEF2F2' }]}>
                        <Ionicons name="alert-circle" size={48} color={C.state?.danger || COLORS.state.danger} />
                    </View>
                    <Text style={[styles.errorTitle, { color: C.text.primary }]}>
                        Failed to Load Customer
                    </Text>
                    <Text style={[styles.errorMessage, { color: C.text.secondary }]}>
                        {error || 'Customer data not available'}
                    </Text>
                    <TouchableOpacity style={[styles.retryBtn, { backgroundColor: C.primary }]} onPress={loadData}>
                        <Ionicons name="refresh" size={18} color="#FFF" />
                        <Text style={styles.retryBtnText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const name = formatName(customer.first_name, customer.last_name);

    return (
        <ScrollView style={[styles.container, { backgroundColor: C.background }]}>
            <Stack.Screen options={{
                title: name,
                headerStyle: { backgroundColor: C.card },
                headerTitleStyle: { color: C.text.primary },
                headerShadowVisible: false,
            }} />

            {/* Customer Info Card */}
            <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={[styles.avatarLarge, { backgroundColor: C.primary + '15' }]}>
                    <Text style={[styles.avatarLargeText, { color: C.primary }]}>
                        {customer.first_name?.charAt(0)?.toUpperCase() || '?'}
                    </Text>
                </View>
                <Text style={[styles.name, { color: C.text.primary }]}>{name}</Text>
                {customer.username && (
                    <Text style={[styles.username, { color: C.text.light }]}>@{customer.username}</Text>
                )}

                <View style={styles.actions}>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.state.success + '15' }]} onPress={callCustomer}>
                        <Ionicons name="call" size={20} color={COLORS.state.success} />
                        <Text style={[styles.actionText, { color: COLORS.state.success }]}>Call</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.state.info + '15' }]} onPress={() => { if (customer.phone) Linking.openURL(`sms:${customer.phone}`); }}>
                        <Ionicons name="chatbox" size={20} color={COLORS.state.info} />
                        <Text style={[styles.actionText, { color: COLORS.state.info }]}>SMS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.primary + '15' }]} onPress={openMap}>
                        <Ionicons name="navigate" size={20} color={C.primary} />
                        <Text style={[styles.actionText, { color: C.primary }]}>Map</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#a855f715' }]}
                        onPress={saveGpsLocation}
                        disabled={savingGps}
                    >
                        {savingGps
                            ? <ActivityIndicator size="small" color="#a855f7" />
                            : <Ionicons name="location" size={20} color="#a855f7" />
                        }
                        <Text style={[styles.actionText, { color: '#a855f7' }]}>
                            {customer.geo_lat ? 'Update GPS' : 'Save GPS'}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#f59e0b15' }]}
                        onPress={() => router.push({
                            pathname: '/survey-form/[id]' as any,
                            params: { id: customer.username },
                        })}
                    >
                        <Ionicons name="scan" size={20} color="#f59e0b" />
                        <Text style={[styles.actionText, { color: '#f59e0b' }]}>
                            {customer.mac_address ? 'Update Device' : 'Scan Device'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Contact Details */}
            <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <Text style={[styles.sectionTitle, { color: C.text.light }]}>CONTACT DETAILS</Text>
                <DetailRow icon="call" label="Phone" value={customer.phone || 'N/A'} color={C} />
                {customer.email && <DetailRow icon="mail" label="Email" value={customer.email} color={C} />}
                {customer.username && <DetailRow icon="card" label="Username" value={customer.username} color={C} />}
                <DetailRow icon="location" label="Address" value={customer.railwire_address || customer.rico_address || 'N/A'} color={C} />
                {customer.geo_lat && (
                    <DetailRow icon="pin" label="GPS" value={`${customer.geo_lat.toFixed(5)}, ${customer.geo_long?.toFixed(5)}`} color={C} />
                )}
                {customer.pg_name && (
                    <DetailRow icon="people" label="PG Group" value={customer.pg_name} color={C} accent="#7c3aed" />
                )}
            </View>

            {/* Device Info + Link ONU button */}
            <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={[styles.sectionTitle, { color: C.text.light, marginBottom: 0 }]}>DEVICE INFO</Text>
                    <TouchableOpacity
                        style={[styles.scanBtn, { borderColor: C.primary }]}
                        onPress={() => router.push({
                            pathname: '/scan-onu' as any,
                            params: {
                                customerUsername: customer.username,
                                customerName: `${customer.first_name} ${customer.last_name || ''}`.trim(),
                            },
                        })}
                    >
                        <Ionicons name="barcode-outline" size={14} color={C.primary} />
                        <Text style={[styles.scanBtnText, { color: C.primary }]}>
                            {customer.mac_address ? 'Rescan ONU' : 'Link ONU'}
                        </Text>
                    </TouchableOpacity>
                </View>
                {/* OLT link type badge */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <View style={[styles.typeBadge, customer.mac_address ? { backgroundColor: '#2563eb20', borderColor: '#2563eb' } : customer.ont_serial_number ? { backgroundColor: '#7c3aed20', borderColor: '#7c3aed' } : { backgroundColor: '#94a3b820', borderColor: '#94a3b8' }]}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: customer.mac_address ? '#2563eb' : customer.ont_serial_number ? '#7c3aed' : '#94a3b8' }}>
                            {customer.mac_address ? 'EPON — MAC' : customer.ont_serial_number ? 'GPON — SERIAL' : 'NOT LINKED'}
                        </Text>
                    </View>
                </View>
                {(customer.mac_address || customer.ont_serial_number) ? (
                    <>
                        {customer.mac_address && <DetailRow icon="hardware-chip" label="MAC" value={customer.mac_address} color={C} />}
                        {customer.ont_serial_number && <DetailRow icon="barcode" label="Serial" value={customer.ont_serial_number} color={C} />}
                        <TouchableOpacity
                            style={[styles.historyBtn, { borderColor: C.primary }]}
                            onPress={() => {
                                // EPON: signal history by MAC; GPON: by SN: prefix
                                const ident = customer.mac_address || `SN:${customer.ont_serial_number}`;
                                router.push({
                                    pathname: '/signal-history/[mac]' as any,
                                    params: {
                                        mac: encodeURIComponent(ident),
                                        customerName: `${customer.first_name} ${customer.last_name || ''}`.trim(),
                                        hours: '24',
                                    },
                                });
                            }}
                        >
                            <Ionicons name="analytics-outline" size={14} color={C.primary} />
                            <Text style={[styles.historyBtnText, { color: C.primary }]}>View Signal History</Text>
                            <Ionicons name="chevron-forward" size={13} color={C.primary} />
                        </TouchableOpacity>
                    </>
                ) : (
                    <Text style={{ color: C.text.light, fontSize: 12, fontStyle: 'italic' }}>No ONU linked — tap "Link ONU" to scan</Text>
                )}
                {customer.ont_model && <DetailRow icon="cube" label="ONT Model" value={customer.ont_model} color={C} />}
                {customer.router_model && <DetailRow icon="cube-outline" label="Router" value={customer.router_model} color={C} />}
                {customer.olt_host && <DetailRow icon="server" label="OLT" value={[customer.olt_host, customer.pon_port].filter(Boolean).join(' / ')} color={C} />}
            </View>

            {/* WiFi Credentials */}
            {(customer.wifi_ssid || customer.wifi_ssid_5g || customer.wifi_password) && (
                <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                    <Text style={[styles.sectionTitle, { color: C.text.light }]}>WIFI CREDENTIALS</Text>
                    {customer.wifi_ssid && <DetailRow icon="wifi" label="2.4 GHz" value={customer.wifi_ssid} color={C} />}
                    {customer.wifi_ssid_5g && <DetailRow icon="wifi" label="5 GHz" value={customer.wifi_ssid_5g} color={C} />}
                    {customer.wifi_password && <DetailRow icon="key" label="Password" value={customer.wifi_password} color={C} />}
                </View>
            )}

            {/* Survey Photos */}
            {(customer.install_photo_url || customer.sticker_photo_url || customer.router_sticker_photo_url) && (
                <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                    <Text style={[styles.sectionTitle, { color: C.text.light }]}>SURVEY PHOTOS</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        {customer.install_photo_url && (
                            <View style={styles.photoThumb}>
                                <Image source={{ uri: customer.install_photo_url }} style={styles.photoImg} resizeMode="cover" />
                                <Text style={styles.photoLabel}>Install</Text>
                            </View>
                        )}
                        {customer.sticker_photo_url && (
                            <View style={styles.photoThumb}>
                                <Image source={{ uri: customer.sticker_photo_url }} style={styles.photoImg} resizeMode="contain" />
                                <Text style={styles.photoLabel}>ONT Sticker</Text>
                            </View>
                        )}
                        {customer.router_sticker_photo_url && (
                            <View style={styles.photoThumb}>
                                <Image source={{ uri: customer.router_sticker_photo_url }} style={styles.photoImg} resizeMode="contain" />
                                <Text style={styles.photoLabel}>Router</Text>
                            </View>
                        )}
                    </View>
                </View>
            )}

            {/* Survey Summary */}
            {customer.last_surveyed_at && (
                <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
                    <Text style={[styles.sectionTitle, { color: C.text.light }]}>SURVEY SUMMARY</Text>
                    <DetailRow icon="checkmark-circle" label="Last Survey" value={new Date(customer.last_surveyed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} color={C} accent="#22c55e" />
                    {customer.gps_lat && <DetailRow icon="pin" label="GPS (survey)" value={`${customer.gps_lat.toFixed(5)}, ${customer.gps_lng?.toFixed(5)}`} color={C} accent="#22c55e" />}
                </View>
            )}

            {/* Recent Tickets */}
            <View style={styles.ticketSection}>
                <Text style={[styles.sectionTitle, { color: C.text.light, marginLeft: 4 }]}>
                    RECENT TICKETS ({tickets.length})
                </Text>
                {tickets.length === 0 ? (
                    <View style={[styles.emptyCard, { backgroundColor: C.card, borderColor: C.border }]}>
                        <Text style={{ color: C.text.light, fontSize: 13 }}>No tickets found</Text>
                    </View>
                ) : (
                    tickets.slice(0, 10).map(ticket => (
                        <TicketCard key={ticket.id} ticket={ticket} />
                    ))
                )}
            </View>

            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

function DetailRow({ icon, label, value, color, accent }: { icon: string; label: string; value: string; color: any; accent?: string }) {
    const iconColor = accent || color.text.light;
    return (
        <View style={detailStyles.row}>
            <Ionicons name={icon as any} size={16} color={iconColor} />
            <Text style={[detailStyles.label, { color: iconColor }]}>{label}</Text>
            <Text style={[detailStyles.value, { color: accent || color.text.primary, fontWeight: accent ? '600' : '400' }]}>{value}</Text>
        </View>
    );
}

const detailStyles = StyleSheet.create({
    row: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.background, gap: 8,
    },
    label: { fontSize: 12, fontWeight: '600', width: 80 },
    value: { flex: 1, fontSize: 14 },
});

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    card: {
        margin: SPACING.md, marginBottom: 0, padding: SPACING.md,
        borderRadius: RADIUS.md, borderWidth: 1,
    },
    avatarLarge: {
        width: 64, height: 64, borderRadius: 32,
        justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: SPACING.sm,
    },
    avatarLargeText: { fontSize: 26, fontWeight: '800' },
    name: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
    username: { fontSize: 13, textAlign: 'center', marginTop: 2 },
    actions: {
        flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: SPACING.md,
    },
    actionBtn: {
        alignItems: 'center', paddingVertical: SPACING.sm,
        paddingHorizontal: SPACING.md, borderRadius: RADIUS.md, gap: 4,
    },
    actionText: { fontSize: 12, fontWeight: '600' },
    sectionTitle: {
        fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: SPACING.sm,
    },
    scanBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, paddingVertical: 5,
        borderRadius: 6, borderWidth: 1,
    },
    scanBtnText: { fontSize: 12, fontWeight: '600' },
    historyBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 10, marginTop: 2, borderTopWidth: 1, borderTopColor: COLORS.background,
    },
    historyBtnText: { fontSize: 13, fontWeight: '600', flex: 1 },
    typeBadge: {
        paddingHorizontal: 8, paddingVertical: 3,
        borderRadius: 4, borderWidth: 1,
    },
    photoThumb: { alignItems: 'center', gap: 4 },
    photoImg: { width: 90, height: 70, borderRadius: 6, backgroundColor: '#f1f5f9' },
    photoLabel: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
    ticketSection: { paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
    emptyCard: {
        padding: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center',
    },
    errorContainer: {
        alignItems: 'center',
        padding: SPACING.xl,
    },
    errorIconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: SPACING.xs,
        textAlign: 'center',
    },
    errorMessage: {
        fontSize: 14,
        textAlign: 'center',
        marginBottom: SPACING.lg,
        lineHeight: 20,
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: RADIUS.md,
        gap: 8,
    },
    retryBtnText: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '700',
    },
});
