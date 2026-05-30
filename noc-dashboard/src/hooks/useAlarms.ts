import { useCallback, useEffect, useState } from 'react';
import type { AlarmItem } from '../types/noc';
import { fetchAlarms } from '../api/noc';
import { useWebSocket } from './useWebSocket';
import { playAlertSound } from '../utils/signal';

export function useAlarms(maxItems = 30) {
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAlarms({ page: 1, page_size: maxItems, hours: 24 });
      setAlarms(data.alarms);
      setTotal(data.total);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [maxItems]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000); // fallback poll
    return () => clearInterval(id);
  }, [refresh]);

  // WebSocket: prepend new alarms in real time
  useWebSocket('/ws/alarms', (msg) => {
    if (msg.type === 'new_alarm' && msg.data) {
      const alarm = msg.data as AlarmItem;
      setAlarms((prev) => [alarm, ...prev].slice(0, maxItems));
      setTotal((t) => t + 1);
      // Audio alert for critical events
      const t = alarm.event_type?.toUpperCase() || '';
      if (t.includes('DYING_GASP') || t.includes('FIBER_CRITICAL')) {
        playAlertSound('critical');
      } else if (t.includes('OFFLINE')) {
        playAlertSound('warning');
      }
    }
  });

  return { alarms, total, loading, refresh };
}
