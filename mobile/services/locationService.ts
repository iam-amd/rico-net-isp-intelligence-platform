/**
 * Location Service — Field Tech GPS Tracking
 * ===========================================
 * Posts tech GPS to backend every 60 seconds while app is in foreground.
 * Uses expo-location for position.
 *
 * Usage:
 *   import { startLocationTracking, stopLocationTracking } from './locationService';
 *   await startLocationTracking();   // call after login
 *   stopLocationTracking();          // call on logout
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import api from './api';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

async function requestPermission(): Promise<boolean> {
    try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return status === 'granted';
    } catch {
        return false;
    }
}

async function postLocation(): Promise<void> {
    try {
        // Use cached position first for speed (max 30s old)
        let position: Location.LocationObject | null = null;
        try {
            position = await Location.getLastKnownPositionAsync({ maxAge: 30_000 });
        } catch { /* fallback to fresh */ }

        if (!position) {
            position = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });
        }

        if (!position) return;

        const { latitude, longitude, accuracy } = position.coords;

        // Battery level not available on web; null is acceptable
        const battery_pct: number | null = null;

        await api.post('/field-team/location', {
            lat: latitude,
            lng: longitude,
            accuracy_m: accuracy ?? null,
            battery_pct,
        });
    } catch (err: any) {
        // Silently swallow — don't crash the app if GPS or network fails
        console.warn('[LocationService] postLocation failed:', err?.message ?? err);
    }
}

export async function startLocationTracking(): Promise<void> {
    if (isRunning) return;

    // Web doesn't support Location.requestForegroundPermissionsAsync in the same way
    if (Platform.OS !== 'web') {
        const granted = await requestPermission();
        if (!granted) {
            console.warn('[LocationService] Location permission denied — tracking disabled');
            return;
        }
    }

    isRunning = true;

    // Post immediately, then every 60s
    void postLocation();
    intervalId = setInterval(postLocation, POLL_INTERVAL_MS);

    console.log('[LocationService] Started — posting every 60s');
}

export function stopLocationTracking(): void {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
    isRunning = false;
    console.log('[LocationService] Stopped');
}
