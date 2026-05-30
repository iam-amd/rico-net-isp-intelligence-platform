import React, { useState } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DashboardTab from './tabs/DashboardTab';
import ComplaintsTab from './tabs/ComplaintsTab';
import SurveysTab from './tabs/SurveysTab';
import SearchTab from './tabs/SearchTab';
import MapTab from './tabs/MapTab';

export type ModernTab = 'dashboard' | 'complaints' | 'surveys' | 'search' | 'map';

const HEADER_BG = '#09090b';
const NAV_BG    = '#09090b';
const ACTIVE_BG = '#ea580c';
const WHITE     = '#ffffff';

const TABS: { key: ModernTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'dashboard',  label: 'DASHBOARD',  icon: 'grid-outline' },
    { key: 'complaints', label: 'COMPLAINTS', icon: 'alert-circle-outline' },
    { key: 'surveys',    label: 'SURVEYS',    icon: 'list-outline' },
    { key: 'search',     label: 'SEARCH',     icon: 'search-outline' },
    { key: 'map',        label: 'MAP',        icon: 'map-outline' },
];

export default function ModernAppShell() {
    const [activeTab, setActiveTab] = useState<ModernTab>('dashboard');
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const renderContent = () => {
        switch (activeTab) {
            case 'dashboard':  return <DashboardTab onNavigate={setActiveTab} />;
            case 'complaints': return <ComplaintsTab />;
            case 'surveys':    return <SurveysTab />;
            case 'search':     return <SearchTab />;
            case 'map':        return <MapTab />;
        }
    };

    const STATUS_BAR_H = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;
    const IOS_TOP = Platform.OS === 'ios' ? 44 : 0;

    return (
        <View style={styles.root}>
            <StatusBar barStyle="light-content" backgroundColor={HEADER_BG} />

            {/* ── Top Header ── */}
            <View style={[styles.header, { paddingTop: STATUS_BAR_H + IOS_TOP + 8 }]}>
                <View style={styles.headerLeft}>
                    <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
                        <Ionicons name="menu-outline" size={24} color={WHITE} />
                    </TouchableOpacity>
                    <Text style={styles.brand}>RICO NET FIELD</Text>
                </View>
                <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => router.push('/profile')}
                    activeOpacity={0.7}
                >
                    <Ionicons name="person-circle-outline" size={28} color={WHITE} />
                </TouchableOpacity>
            </View>

            {/* ── Content ── */}
            <View style={styles.content}>{renderContent()}</View>

            {/* ── Bottom Nav ── */}
            <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                {TABS.map((tab, idx) => {
                    const active = activeTab === tab.key;
                    return (
                        <TouchableOpacity
                            key={tab.key}
                            style={[
                                styles.navTab,
                                active && styles.navTabActive,
                                idx > 0 && styles.navBorderL,
                            ]}
                            onPress={() => setActiveTab(tab.key)}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name={tab.icon}
                                size={20}
                                color={active ? '#000000' : WHITE}
                            />
                            <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff8f6' },

    /* Header */
    header: {
        backgroundColor: HEADER_BG,
        borderBottomWidth: 2,
        borderBottomColor: WHITE,
        paddingHorizontal: 16,
        paddingBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    iconBtn: { padding: 6 },
    brand: {
        color: '#ea580c',
        fontSize: 17,
        fontWeight: '900',
        letterSpacing: -0.3,
        textTransform: 'uppercase',
    },

    /* Content */
    content: { flex: 1 },

    /* Nav */
    nav: {
        backgroundColor: NAV_BG,
        borderTopWidth: 2,
        borderTopColor: WHITE,
        flexDirection: 'row',
        alignItems: 'stretch',
        minHeight: 64,
    },
    navTab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        gap: 3,
    },
    navTabActive: { backgroundColor: ACTIVE_BG },
    navBorderL: { borderLeftWidth: 1, borderLeftColor: '#27272a' },
    navLabel: {
        color: WHITE,
        fontSize: 7,
        fontWeight: '800',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    navLabelActive: { color: '#000000' },
});
