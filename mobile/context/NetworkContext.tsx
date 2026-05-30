import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING } from '../constants/theme';
import { offlineQueue } from '../services/offlineQueue';

// ------------------------------------------------------------------
// Network Status Context
// Uses a lightweight polling approach (no extra native dependency)
// to detect connectivity. Works on both web and native.
// ------------------------------------------------------------------

interface NetworkContextType {
    isConnected: boolean;
    lastChecked: Date | null;
    checkNow: () => Promise<boolean>;
}

const NetworkContext = createContext<NetworkContextType>({
    isConnected: true,
    lastChecked: null,
    checkNow: async () => true,
});

export const useNetwork = () => useContext(NetworkContext);

const PING_URL = Platform.OS === 'web'
    ? '/favicon.ico' // Relative URL for web
    : 'https://clients3.google.com/generate_204'; // Lightweight Google endpoint

const POLL_INTERVAL = 15000; // 15 seconds

export function NetworkProvider({ children }: { children: React.ReactNode }) {
    const [isConnected, setIsConnected] = useState(true);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);

    const wasConnectedRef = useRef(true);

    const checkNow = useCallback(async (): Promise<boolean> => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            await fetch(PING_URL, {
                method: 'HEAD',
                cache: 'no-cache',
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            setIsConnected(true);
            setLastChecked(new Date());
            return true;
        } catch {
            setIsConnected(false);
            setLastChecked(new Date());
            return false;
        }
    }, []);

    useEffect(() => {
        // Initial check
        checkNow();

        // Periodic polling
        const interval = setInterval(checkNow, POLL_INTERVAL);

        // Web: listen to browser online/offline events
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
            const handleOnline = () => { setIsConnected(true); setLastChecked(new Date()); };
            const handleOffline = () => { setIsConnected(false); setLastChecked(new Date()); };
            window.addEventListener('online', handleOnline);
            window.addEventListener('offline', handleOffline);

            return () => {
                clearInterval(interval);
                window.removeEventListener('online', handleOnline);
                window.removeEventListener('offline', handleOffline);
            };
        }

        return () => clearInterval(interval);
    }, [checkNow]);

    // Process offline queue when connectivity is restored
    useEffect(() => {
        if (isConnected && !wasConnectedRef.current) {
            console.log('[Network] Reconnected -- processing offline queue');
            offlineQueue.processQueue().then(result => {
                if (result.processed > 0) {
                    console.log(`[Network] Synced ${result.processed} queued operations`);
                }
                if (result.failed > 0) {
                    console.warn(`[Network] ${result.failed} operations failed to sync`);
                }
            });
        }
        wasConnectedRef.current = isConnected;
    }, [isConnected]);

    return (
        <NetworkContext.Provider value={{ isConnected, lastChecked, checkNow }}>
            {children}
            {!isConnected && <OfflineBanner />}
        </NetworkContext.Provider>
    );
}

// ------------------------------------------------------------------
// Offline Banner — shown at top of app when disconnected
// ------------------------------------------------------------------

function OfflineBanner() {
    const [fadeAnim] = useState(() => new Animated.Value(0));

    useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
        }).start();
    }, []);

    return (
        <Animated.View style={[styles.banner, { opacity: fadeAnim }]}>
            <Ionicons name="cloud-offline" size={16} color="#FFFFFF" />
            <Text style={styles.bannerText}>No Internet Connection</Text>
            <Text style={styles.bannerSub}>Using cached data</Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    banner: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: COLORS.state.danger,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: SPACING.md,
        zIndex: 9999,
        gap: 8,
        // Safe area top offset
        paddingTop: Platform.OS === 'ios' ? 50 : Platform.OS === 'android' ? 36 : 8,
    },
    bannerText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    bannerSub: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 11,
    },
});
