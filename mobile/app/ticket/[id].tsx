import React, { useEffect, useState, useCallback } from 'react';
import {
    StyleSheet, TouchableOpacity, ScrollView, Alert, Platform,
    View, Text, StatusBar, ActivityIndicator, RefreshControl, Linking as RNLinking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';

import { compressImage } from '../../utils/imageCompression';
import { TicketService } from '../../services/ticketService';
import { Ticket, TicketStatus, InventoryItem, TicketMedia, TicketCompletePayload } from '../../types';
import { useSettings } from '../../context/SettingsContext';
import { COLORS, DARK_COLORS, SPACING, RADIUS } from '../../constants/theme';

// Extracted Components
import CompleteJobModal from './complete-modal';
import LoadingScreen from '../../components/LoadingScreen';
import CustomerCard from '../../components/ticket/CustomerCard';
import IssueCard from '../../components/ticket/IssueCard';
import StatusHeader from '../../components/ticket/StatusHeader';
import ActionBar from '../../components/ticket/ActionBar';
import WorkspaceSection from '../../components/ticket/WorkspaceSection';
import DiagnosticsCard from '../../components/ticket/DiagnosticsCard';
import JobTimer from '../../components/ticket/JobTimer';
import CommentsSection from '../../components/ticket/CommentsSection';

// Intelligence Components
import BriefingCard from '../../components/ticket/BriefingCard';
import ONUSignalCard from '../../components/ticket/ONUSignalCard';
import AreaOutageBanner from '../../components/ticket/AreaOutageBanner';
import RebootButton from '../../components/ticket/RebootButton';
import TroubleshootingChecklist from '../../components/ticket/TroubleshootingChecklist';
import { useAuth } from '../../context/AuthContext';
import { TicketBriefing } from '../../types';

// ------------------------------------------------------------------
// TICKET DETAIL SCREEN
// Orchestrates the full ticket lifecycle workflow.
// ------------------------------------------------------------------

export default function TicketDetails() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { isDarkMode } = useSettings();
    const { user } = useAuth();
    const C = isDarkMode ? DARK_COLORS : COLORS;
    const ticketId = id?.toString() ?? '';

    // Core state
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [statusChanging, setStatusChanging] = useState(false);

    // Form state
    const [notes, setNotes] = useState('');
    const [materials, setMaterials] = useState('');
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [modalVisible, setModalVisible] = useState(false);

    // Media state
    const [uploadingImg, setUploadingImg] = useState(false);
    const [media, setMedia] = useState<TicketMedia[]>([]);

    // Intelligence state
    const [briefing, setBriefing] = useState<TicketBriefing | null>(null);

    // ------------------------------------------------------------------
    // DATA FETCHING
    // ------------------------------------------------------------------

    const fetchDetails = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const [ticketData, inventoryData] = await Promise.all([
                TicketService.getTicketById(ticketId),
                TicketService.getInventory(),
            ]);

            setTicket(ticketData);
            setInventory(inventoryData);
            setMedia(ticketData.media || []);
            setNotes(ticketData.internal_notes || '');
            setMaterials(ticketData.materials_used || '');
        } catch (err: any) {
            console.error('[TicketDetail] Fetch error:', err);
            setError(err?.message || 'Failed to load ticket details');
        } finally {
            setLoading(false);
        }
    }, [ticketId]);

    useEffect(() => { fetchDetails(); }, [fetchDetails]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const [ticketData, inventoryData] = await Promise.all([
                TicketService.getTicketById(ticketId),
                TicketService.getInventory(),
            ]);
            setTicket(ticketData);
            setInventory(inventoryData);
            setMedia(ticketData.media || []);
            setNotes(ticketData.internal_notes || '');
            setMaterials(ticketData.materials_used || '');
            setError(null);
        } catch (err: any) {
            console.error('[TicketDetail] Refresh error:', err);
        } finally {
            setRefreshing(false);
        }
    }, [ticketId]);

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------

    const showAlert = (title: string, message: string) => {
        if (Platform.OS === 'web') {
            alert(`${title}\n${message}`);
        } else {
            Alert.alert(title, message);
        }
    };

    const confirmAction = (title: string, message: string, onConfirm: () => void, destructive = false) => {
        if (Platform.OS === 'web') {
            if (window.confirm(`${title}\n${message}`)) onConfirm();
        } else {
            Alert.alert(title, message, [
                { text: 'Cancel', style: 'cancel' },
                { text: destructive ? 'Confirm' : 'OK', style: destructive ? 'destructive' : 'default', onPress: onConfirm },
            ]);
        }
    };

    // ------------------------------------------------------------------
    // STATUS ACTIONS
    // ------------------------------------------------------------------

    const handleStartJob = () => {
        confirmAction(
            'Start Job',
            'Are you ready to begin working on this ticket?',
            async () => {
                setProcessing(true);
                setStatusChanging(true);
                try {
                    const updated = await TicketService.updateTicket(ticketId, { status: 'Ongoing' }, ticket?.status);
                    setTicket(updated);
                } catch (e: any) {
                    showAlert('Error', e.message || 'Could not start job');
                } finally {
                    setProcessing(false);
                    setStatusChanging(false);
                }
            }
        );
    };

    const handleStopJob = () => {
        confirmAction(
            'Stop Job',
            'Return this ticket to Pending status?',
            async () => {
                setProcessing(true);
                setStatusChanging(true);
                try {
                    const updated = await TicketService.updateTicket(ticketId, { status: 'Assigned' }, ticket?.status);
                    setTicket(updated);
                } catch (e: any) {
                    showAlert('Error', e.message || 'Could not stop job');
                } finally {
                    setProcessing(false);
                    setStatusChanging(false);
                }
            },
            true
        );
    };

    const handleCompletePress = async () => {
        // Request location permission before opening modal
        if (Platform.OS !== 'web') {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                showAlert('Permission Required', 'We need location access to verify job completion.');
                return;
            }
        }
        setModalVisible(true);
    };

    const handleModalSubmit = async (data: { diagnosis: string; signal: string }) => {
        setProcessing(true);
        try {
            // 1. Get location
            let lat: number | undefined;
            let long: number | undefined;

            if (Platform.OS !== 'web') {
                try {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                        lat = loc.coords.latitude;
                        long = loc.coords.longitude;
                    }
                } catch (e) {
                    console.warn('[TicketDetail] Location fetch failed');
                }
            }

            // 2. Ask if this is the customer's location
            let updateLocation = false;
            if (lat && long) {
                await new Promise<void>((resolve) => {
                    if (Platform.OS === 'web') {
                        updateLocation = window.confirm(
                            `Location Detected\nLat: ${lat?.toFixed(5)}, Long: ${long?.toFixed(5)}\n\nIs this the customer's location?`
                        );
                        resolve();
                    } else {
                        Alert.alert(
                            'Location Detected',
                            `Lat: ${lat?.toFixed(5)}, Long: ${long?.toFixed(5)}\n\nIs this the customer's location?`,
                            [
                                { text: 'No', style: 'cancel', onPress: () => resolve() },
                                { text: 'Yes', onPress: () => { updateLocation = true; resolve(); } },
                            ]
                        );
                    }
                });
            }

            // 3. Build the complete payload for the dedicated endpoint
            const completePayload: TicketCompletePayload = {
                resolution_remarks: data.diagnosis || 'Resolved on-site',
                materials_used: materials || undefined,
                enrichment: {
                    geo_lat: updateLocation && lat ? lat : undefined,
                    geo_long: updateLocation && long ? long : undefined,
                },
            };

            await TicketService.completeTicket(ticketId, completePayload);
            setModalVisible(false);

            showAlert('Success', 'Job Completed Successfully!');
            router.replace('/(tabs)/history');
        } catch (error: any) {
            showAlert('Error', error.message || 'Failed to complete job. Please try again.');
        } finally {
            setProcessing(false);
        }
    };

    // ------------------------------------------------------------------
    // NOTES & MATERIALS
    // ------------------------------------------------------------------

    const handleSaveNotes = async () => {
        if (!ticket) return;
        try {
            await TicketService.updateTicket(ticketId, {
                internal_notes: notes,
                materials_used: materials,
            });
            console.log('[TicketDetail] Notes auto-saved');
        } catch (e) {
            console.warn('[TicketDetail] Auto-save failed');
        }
    };

    const addMaterial = (item: string) => {
        setMaterials(prev => {
            if (prev.includes(item)) return prev;
            return prev ? `${prev}, ${item}` : item;
        });
    };

    // ------------------------------------------------------------------
    // MEDIA
    // ------------------------------------------------------------------

    const handleDeleteMedia = (mediaId: number) => {
        const item = media.find(m => m.id === mediaId);
        const isAudio = item?.file_type?.startsWith('audio');
        const title = isAudio ? 'Delete Audio Note' : 'Delete Photo';
        const message = isAudio ? 'Are you sure you want to delete this audio note?' : 'Are you sure you want to delete this photo?';

        confirmAction(title, message, async () => {
            try {
                await TicketService.deleteMedia(mediaId);
                setMedia(prev => prev.filter(m => m.id !== mediaId));
            } catch (e: any) {
                showAlert('Error', e.message || `Failed to delete ${isAudio ? 'audio' : 'photo'}`);
            }
        }, true);
    };

    const pickImage = async () => {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            allowsMultipleSelection: true,
            quality: 0.5,
        });

        if (!result.canceled) {
            setUploadingImg(true);
            try {
                const newMediaItems: TicketMedia[] = [];
                for (const asset of result.assets) {
                    const compressedUri = await compressImage(asset.uri);
                    const uploaded = await TicketService.uploadMedia(ticketId, compressedUri);
                    newMediaItems.push(uploaded);
                }
                setMedia(prev => [...prev, ...newMediaItems]);
            } catch (e: any) {
                showAlert('Error', e.message || 'Photo upload failed');
            } finally {
                setUploadingImg(false);
            }
        }
    };

    const handleAudioUpload = async (uri: string) => {
        try {
            const fileType = Platform.OS === 'ios' ? 'audio/x-m4a' : 'audio/m4a';
            const fileName = `audio_${Date.now()}.m4a`;
            const uploaded = await TicketService.uploadMedia(ticketId, uri, fileType, fileName);
            setMedia(prev => [...prev, uploaded]);
        } catch (e: any) {
            showAlert('Error', e.message || 'Audio upload failed');
        }
    };

    // ------------------------------------------------------------------
    // CUSTOMER ACTIONS
    // ------------------------------------------------------------------

    const callCustomer = () => {
        if (ticket?.customer?.phone) {
            RNLinking.openURL(`tel:${ticket.customer.phone}`);
        }
    };

    const openMap = () => {
        const { railwire_address, geo_lat, geo_long, first_name, last_name } = ticket?.customer || {};
        const label = `${first_name || ''} ${last_name || ''}`.trim();

        if (geo_lat && geo_long) {
            const scheme = Platform.select({ ios: 'maps:', android: 'geo:' });
            const url = Platform.select({
                ios: `${scheme}?q=${label}&ll=${geo_lat},${geo_long}`,
                android: `${scheme}${geo_lat},${geo_long}?q=${geo_lat},${geo_long}(${label})`,
                web: `https://www.google.com/maps?q=${geo_lat},${geo_long}`,
            });
            if (url) { RNLinking.openURL(url); return; }
        }

        if (railwire_address) {
            const query = encodeURIComponent(railwire_address);
            RNLinking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
        }
    };

    const openPhoneDialer = (phone: string) => {
        RNLinking.openURL(`tel:${phone}`);
    };

    const openAddressInMaps = (address: string) => {
        const query = encodeURIComponent(address);
        const url = Platform.select({
            ios: `maps:0,0?q=${query}`,
            android: `geo:0,0?q=${query}`,
            web: `https://www.google.com/maps/search/?api=1&query=${query}`,
        });
        if (url) RNLinking.openURL(url);
    };

    // ------------------------------------------------------------------
    // CONNECTION STATUS HELPER
    // ------------------------------------------------------------------

    const getConnectionStatus = () => {
        // Derive from ticket status and customer data
        if (!ticket?.customer) return { color: COLORS.text.light, label: 'Unknown' };
        if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
            return { color: COLORS.state.success, label: 'Connected' };
        }
        if (ticket.issue_type?.toLowerCase().includes('no signal') || ticket.issue_type?.toLowerCase().includes('down')) {
            return { color: COLORS.state.danger, label: 'Disconnected' };
        }
        return { color: COLORS.state.warning, label: 'Degraded' };
    };

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------

    if (loading) return <LoadingScreen message="Loading ticket details..." />;

    if (error || !ticket) {
        const connStatus = getConnectionStatus();
        return (
            <View style={[styles.container, { backgroundColor: C.background }]}>
                <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={C.card} />
                <Stack.Screen options={{
                    title: `Ticket #${ticketId}`,
                    headerStyle: { backgroundColor: C.card },
                    headerShadowVisible: false,
                    headerTintColor: C.text.primary,
                }} />
                <View style={styles.errorContainer}>
                    <View style={[styles.errorIconCircle, { backgroundColor: COLORS.state.danger + '15' }]}>
                        <Ionicons name="alert-circle" size={48} color={COLORS.state.danger} />
                    </View>
                    <Text style={[styles.errorTitle, { color: C.text.primary }]}>
                        Failed to Load Ticket
                    </Text>
                    <Text style={[styles.errorMessage, { color: C.text.secondary }]}>
                        {error || 'Ticket data not available'}
                    </Text>
                    <TouchableOpacity style={[styles.retryBtn, { backgroundColor: C.primary }]} onPress={fetchDetails}>
                        <Ionicons name="refresh" size={18} color="#FFF" />
                        <Text style={styles.retryBtnText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const isOngoing = ticket.status === 'Ongoing';
    const isResolved = ticket.status === 'Resolved' || ticket.status === 'Closed';
    const showWorkspace = isOngoing || isResolved;
    const connStatus = getConnectionStatus();

    return (
        <View style={[styles.container, { backgroundColor: C.background }]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={C.card} />
            <Stack.Screen options={{
                title: `Ticket #${ticket.id}`,
                headerStyle: { backgroundColor: C.card },
                headerShadowVisible: false,
                headerTintColor: C.text.primary,
            }} />

            {/* Status change overlay */}
            {statusChanging && (
                <View style={styles.statusOverlay}>
                    <ActivityIndicator size="large" color={C.primary} />
                    <Text style={[styles.statusOverlayText, { color: C.text.primary }]}>
                        Updating status...
                    </Text>
                </View>
            )}

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[C.primary]}
                        tintColor={C.primary}
                    />
                }
            >
                {/* 0. Area Outage Banner (top priority warning) */}
                {briefing?.area_outage && (
                    <AreaOutageBanner outage={briefing.area_outage} />
                )}

                {/* 1. Status & Priority Header */}
                <StatusHeader ticket={ticket} />

                {/* 1.3 Intelligence Briefing (when customer has ONU) */}
                {ticket.customer?.username && (
                    <BriefingCard
                        customerUsername={ticket.customer.username}
                        onBriefingLoaded={setBriefing}
                    />
                )}

                {/* 1.5 ONU Signal Card (live metrics with auto-refresh) */}
                {briefing && !briefing.no_onu_linked && briefing.mac_address && (
                    <ONUSignalCard
                        macAddress={briefing.mac_address}
                        customerName={ticket.customer ? `${ticket.customer.first_name ?? ''} ${ticket.customer.last_name ?? ''}`.trim() : undefined}
                        initialStatus={briefing ? {
                            mac_address: briefing.mac_address!,
                            status: briefing.onu_status,
                            rx_power: briefing.rx_power,
                            tx_power: briefing.tx_power,
                            temperature: briefing.temperature,
                            voltage: briefing.voltage,
                            dying_gasp: briefing.dying_gasp,
                            signal_level: briefing.signal_level,
                            polled_at: briefing.polled_at,
                        } : null}
                        signalHistory={briefing.signal_history}
                    >
                        {ticket.customer?.username && (
                            <RebootButton
                                customerUsername={ticket.customer.username}
                                userRole={user?.role || 'Field Tech'}
                            />
                        )}
                    </ONUSignalCard>
                )}

                {/* 1.6 Troubleshooting Checklist (when fault detected) */}
                {briefing?.fault_type && (
                    <TroubleshootingChecklist faultType={briefing.fault_type} />
                )}

                {/* 1.7 Legacy Diagnostics (fallback when no ONU linked) */}
                {ticket.customer?.username && (!briefing || briefing.no_onu_linked) && (
                    <DiagnosticsCard customerUsername={ticket.customer.username} />
                )}

                {/* 1.8 Job Timer */}
                <JobTimer assignedAt={ticket.assigned_at} isActive={isOngoing} />

                {/* 2. Customer Card with connection status and clickable phone/address */}
                {ticket.customer && (
                    <View>
                        <CustomerCard customer={ticket.customer} onCall={callCustomer} onMap={openMap} />
                        {/* Connection status + clickable phone/address row */}
                        <View style={[styles.customerExtras, { backgroundColor: C.card, borderColor: C.border }]}>
                            {/* Connection Status */}
                            <View style={styles.connectionRow}>
                                <View style={[styles.connectionDot, { backgroundColor: connStatus.color }]} />
                                <Text style={[styles.connectionLabel, { color: C.text.secondary }]}>
                                    {connStatus.label}
                                </Text>
                            </View>

                            {/* Clickable Phone */}
                            {ticket.customer.phone && (
                                <TouchableOpacity
                                    style={styles.clickableRow}
                                    onPress={() => openPhoneDialer(ticket.customer!.phone!)}
                                >
                                    <Ionicons name="call-outline" size={14} color={C.primary} />
                                    <Text style={[styles.clickableText, { color: C.primary }]}>
                                        {ticket.customer.phone}
                                    </Text>
                                </TouchableOpacity>
                            )}

                            {/* Clickable Address */}
                            {ticket.customer.railwire_address && (
                                <TouchableOpacity
                                    style={styles.clickableRow}
                                    onPress={() => openAddressInMaps(ticket.customer!.railwire_address!)}
                                >
                                    <Ionicons name="map-outline" size={14} color={C.primary} />
                                    <Text style={[styles.clickableText, { color: C.primary }]} numberOfLines={2}>
                                        {ticket.customer.railwire_address}
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}

                {/* 3. Issue Details */}
                <IssueCard ticket={ticket} />

                {/* 4. Technician Workspace (during Ongoing + post-resolve) */}
                {showWorkspace && (
                    <WorkspaceSection
                        notes={notes}
                        materials={materials}
                        media={media}
                        inventory={inventory}
                        uploadingImg={uploadingImg}
                        isResolved={isResolved}
                        onNotesChange={setNotes}
                        onMaterialsChange={setMaterials}
                        onSaveNotes={handleSaveNotes}
                        onPickImage={pickImage}
                        onDeleteMedia={handleDeleteMedia}
                        onAddMaterial={addMaterial}
                    />
                )}

                {/* 5. Comments & Activity */}
                <CommentsSection
                    ticketId={ticketId}
                    readonly={ticket.status === 'Closed'}
                />

                {/* Bottom spacer (action bar sits on top) */}
                <View style={{ height: 120 }} />
            </ScrollView>

            {/* 5. Sticky Action Bar */}
            <ActionBar
                status={ticket.status}
                processing={processing}
                onStartJob={handleStartJob}
                onStopJob={handleStopJob}
                onCompleteJob={handleCompletePress}
            />

            {/* 6. Complete Job Modal */}
            <CompleteJobModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                ticketNumber={ticket.id.toString()}
                onSubmit={handleModalSubmit}
                isSubmitting={processing}
                media={media}
                onAddPhoto={pickImage}
                onAddAudio={handleAudioUpload}
                onDeletePhoto={handleDeleteMedia}
            />
        </View>
    );
}

// ------------------------------------------------------------------
// STYLES (minimal -- most styling lives in sub-components)
// ------------------------------------------------------------------

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F1F5F9',
    },
    scrollContent: {
        padding: SPACING.md,
        paddingTop: SPACING.sm,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
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
    statusOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255,255,255,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 999,
    },
    statusOverlayText: {
        marginTop: SPACING.sm,
        fontSize: 14,
        fontWeight: '600',
    },
    customerExtras: {
        marginBottom: SPACING.md,
        marginTop: -SPACING.sm,
        padding: SPACING.md,
        paddingTop: SPACING.sm,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        gap: 8,
    },
    connectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    connectionDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    connectionLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    clickableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 2,
    },
    clickableText: {
        fontSize: 13,
        fontWeight: '500',
        textDecorationLine: 'underline',
        flex: 1,
    },
});
