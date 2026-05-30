"use client";
/**
 * useNOCWebSocket
 * ===============
 * Connects to /ws/noc or /ws/alarms and calls onMessage on each push.
 * Auto-reconnects on disconnect. Sends a keep-alive ping every 25s.
 * Returns { connected } so callers can show a live/stale indicator.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { API_URL } from "@/config";

const WS_BASE = API_URL.replace(/^http/, "ws");

export function useNOCWebSocket(
    channel: "noc" | "alarms",
    onMessage: (data: unknown) => void
) {
    const [connected, setConnected] = useState(false);
    const onMsgRef = useRef(onMessage);
    onMsgRef.current = onMessage; // always latest callback, no re-connect on change

    const wsRef = useRef<WebSocket | null>(null);
    const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const unmountedRef = useRef(false);

    const connect = useCallback(() => {
        if (unmountedRef.current) return;
        const token =
            typeof localStorage !== "undefined"
                ? localStorage.getItem("admin_token")
                : null;
        if (!token) return;

        const ws = new WebSocket(`${WS_BASE}/ws/${channel}`, ["rico-jwt", token]);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!unmountedRef.current) setConnected(true);
        };
        ws.onclose = () => {
            if (unmountedRef.current) return;
            setConnected(false);
            retryRef.current = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (e) => {
            try {
                const parsed = JSON.parse(e.data);
                onMsgRef.current(parsed);
            } catch {
                // ignore malformed frames
            }
        };
    }, [channel]);

    useEffect(() => {
        unmountedRef.current = false;
        connect();

        const ping = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send("ping");
            }
        }, 25000);

        return () => {
            unmountedRef.current = true;
            clearInterval(ping);
            clearTimeout(retryRef.current);
            wsRef.current?.close();
        };
    }, [connect]);

    return { connected };
}
