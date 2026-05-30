import type { SignalLevel } from '../types/noc';

export function classifySignal(rxPower: number | null | undefined): SignalLevel {
  if (rxPower == null) return 'offline';
  if (rxPower >= -20) return 'excellent';
  if (rxPower >= -24) return 'good';
  if (rxPower >= -27) return 'weak';
  return 'critical';
}

export function signalColor(level: SignalLevel): string {
  switch (level) {
    case 'excellent': return '#22c55e';
    case 'good':      return '#eab308';
    case 'weak':      return '#f97316';
    case 'critical':  return '#ef4444';
    case 'offline':   return '#6b7280';
  }
}

export function signalBgClass(level: SignalLevel): string {
  switch (level) {
    case 'excellent': return 'bg-green-500/20 text-green-400';
    case 'good':      return 'bg-yellow-500/20 text-yellow-400';
    case 'weak':      return 'bg-orange-500/20 text-orange-400';
    case 'critical':  return 'bg-red-500/20 text-red-400';
    case 'offline':   return 'bg-gray-500/20 text-gray-400';
  }
}

export function formatDbm(val: number | null | undefined): string {
  if (val == null) return 'N/A';
  return `${val.toFixed(1)} dBm`;
}

export function formatMac(mac: string): string {
  return mac.toUpperCase();
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  // Direct parse handles ISO 8601 with any timezone (Z, +05:30, +00:00, etc.)
  let d = new Date(dateStr);
  // Fallback: timezone-naive strings like "2026-03-29 08:13:05" — treat as UTC
  if (isNaN(d.getTime())) d = new Date(dateStr.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return 'Unknown';
  const diff = Date.now() - d.getTime();
  if (diff < 5000) return 'Just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Play an alert sound using Web Audio API — no audio file needed. */
export function playAlertSound(type: 'critical' | 'warning' = 'warning') {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = type === 'critical' ? 880 : 660;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* browser may block before first user interaction */ }
}
