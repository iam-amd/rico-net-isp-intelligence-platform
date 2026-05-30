import { useState, useEffect, useRef } from 'react';

interface UseJobTimerResult {
    elapsed: string; // HH:MM:SS
    seconds: number;
    isRunning: boolean;
}

export function useJobTimer(assignedAt?: string, isActive: boolean = false): UseJobTimerResult {
    const [seconds, setSeconds] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!isActive || !assignedAt) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return;
        }

        const startTime = new Date(assignedAt).getTime();
        const updateTimer = () => {
            const now = Date.now();
            const diff = Math.max(0, Math.floor((now - startTime) / 1000));
            setSeconds(diff);
        };

        updateTimer();
        intervalRef.current = setInterval(updateTimer, 1000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [assignedAt, isActive]);

    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const elapsed = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    return { elapsed, seconds, isRunning: isActive };
}
