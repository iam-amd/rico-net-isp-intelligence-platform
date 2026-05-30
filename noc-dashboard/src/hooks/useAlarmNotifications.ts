import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from './useWebSocket';

export interface AlarmNotification {
  id: string;
  mac_address: string;
  event_type: string;
  pon_port?: string;
  olt_host?: string;
  customer_name?: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: number;
}

const SEVERITY_MAP: Record<string, 'critical' | 'warning' | 'info'> = {
  FIBER_CRITICAL: 'critical',
  FIBER_CRITICAL_OFFLINE: 'critical',
  FIBER_CUT: 'critical',
  LINK_LOST: 'critical',
  ONU_OFFLINE: 'critical',
  ONU_OFFLINE_GPON: 'critical',
  DYING_GASP: 'warning',
  POWER_CUT: 'warning',
};

const NOTIFICATION_EVENT_TYPES = new Set([
  'DYING_GASP',
  'POWER_CUT',
  'FIBER_CUT',
  'LINK_LOST',
  'ONU_OFFLINE',
  'ONU_OFFLINE_GPON',
  'FIBER_CRITICAL',
  'FIBER_CRITICAL_OFFLINE',
]);

function notificationLabel(eventType: string): string {
  const type = eventType.toUpperCase();
  if (type === 'DYING_GASP' || type === 'POWER_CUT') return 'Power cut / ONU power down';
  if (type === 'FIBER_CRITICAL' || type === 'FIBER_CRITICAL_OFFLINE') return 'Fiber critical';
  if (type === 'ONU_OFFLINE' || type === 'ONU_OFFLINE_GPON' || type === 'FIBER_CUT' || type === 'LINK_LOST') {
    return 'Fiber cut / link lost';
  }
  return eventType.replace(/_/g, ' ');
}

// Web Audio API beep — works without any audio files
function playBeep(severity: 'critical' | 'warning' | 'info') {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (severity === 'critical') {
      // Urgent double-beep at 880Hz
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0, ctx.currentTime + 0.4);
      osc.stop(ctx.currentTime + 0.5);
    } else if (severity === 'warning') {
      // Single beep at 660Hz
      osc.frequency.value = 660;
      gain.gain.value = 0.2;
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else {
      // Soft blip at 440Hz
      osc.frequency.value = 440;
      gain.gain.value = 0.1;
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }

    // Cleanup
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext may fail if no user interaction yet — ignore
  }
}

const MAX_NOTIFICATIONS = 20;

export function useAlarmNotifications() {
  const [notifications, setNotifications] = useState<AlarmNotification[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(() => {
    return localStorage.getItem('noc_audio') !== 'off';
  });
  const lastAlarmRef = useRef<number>(0);

  const toggleAudio = useCallback(() => {
    setAudioEnabled(prev => {
      const next = !prev;
      localStorage.setItem('noc_audio', next ? 'on' : 'off');
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Subscribe to alarm WebSocket
  useWebSocket('/ws/alarms', (msg) => {
    if (msg.type !== 'new_alarm' || !msg.data) return;

    const alarm = msg.data;
    const eventType = String(alarm.event_type || '').toUpperCase();
    if (!NOTIFICATION_EVENT_TYPES.has(eventType)) return;
    const alarmStatus = String(alarm.status || 'open').toLowerCase();
    if (alarmStatus === 'resolved' || alarmStatus === 'suppressed') return;

    const severity = SEVERITY_MAP[eventType] || 'info';
    const now = Date.now();
    const receivedAt = alarm.received_at ? new Date(alarm.received_at).getTime() : now;
    if (Number.isFinite(receivedAt) && now - receivedAt > 120_000) return;

    // Deduplicate: ignore if same MAC alarm within 5 seconds
    if (now - lastAlarmRef.current < 1000) return;
    lastAlarmRef.current = now;

    const notification: AlarmNotification = {
      id: `${alarm.id || now}-${alarm.mac_address}`,
      mac_address: alarm.mac_address,
      event_type: eventType,
      pon_port: alarm.pon_port,
      olt_host: alarm.olt_host,
      customer_name: alarm.customer_name,
      severity,
      message: `${notificationLabel(eventType)} - ${alarm.mac_address}${alarm.pon_port ? ` (${alarm.pon_port})` : ''}`,
      timestamp: now,
    };

    setNotifications(prev => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

    if (audioEnabled) {
      playBeep(severity);
    }
  });

  // Auto-dismiss old notifications after 30s
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      setNotifications(prev => prev.filter(n => n.timestamp > cutoff));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return { notifications, audioEnabled, toggleAudio, dismiss, dismissAll };
}
