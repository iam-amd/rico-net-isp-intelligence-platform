import { useCallback, useEffect, useState } from 'react';
import type { NetworkSummary } from '../types/noc';
import { fetchSummary } from '../api/noc';
import { useWebSocket } from './useWebSocket';

export function useNocSummary() {
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  // Initial load + fallback polling (30s) when WebSocket is disconnected
  const refresh = useCallback(async () => {
    try {
      const data = await fetchSummary();
      setSummary(data);
    } catch { /* keep showing last known */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (!wsConnected) refresh(); // only poll when WS is down
    }, 30000);
    return () => clearInterval(id);
  }, [refresh, wsConnected]);

  // WebSocket live updates — faster than polling
  const { connected } = useWebSocket('/ws/noc', (msg) => {
    if (msg.type === 'summary_update' && msg.data) {
      setSummary(msg.data);
      setLoading(false);
    }
  });

  useEffect(() => { setWsConnected(connected); }, [connected]);

  return { summary, loading, wsConnected: connected, refresh };
}
