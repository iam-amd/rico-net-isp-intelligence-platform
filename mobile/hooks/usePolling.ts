import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

interface UsePollingOptions {
    callback: () => void | Promise<void>;
    interval: number; // milliseconds
    enabled?: boolean;
}

export function usePolling({ callback, interval, enabled = true }: UsePollingOptions) {
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const appStateRef = useRef(AppState.currentState);
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    const startPolling = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
            callbackRef.current();
        }, interval);
    }, [interval]);

    const stopPolling = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!enabled) {
            stopPolling();
            return;
        }

        startPolling();

        // Pause in background, resume in foreground
        const handleAppState = (nextState: AppStateStatus) => {
            if (appStateRef.current === 'active' && nextState.match(/inactive|background/)) {
                stopPolling();
            } else if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
                callbackRef.current(); // Immediate refresh on resume
                startPolling();
            }
            appStateRef.current = nextState;
        };

        const subscription = AppState.addEventListener('change', handleAppState);

        return () => {
            stopPolling();
            subscription.remove();
        };
    }, [enabled, startPolling, stopPolling]);
}
