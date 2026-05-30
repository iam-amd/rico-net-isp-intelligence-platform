import { useEffect, useRef, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchCustomerDNA, fetchSignalHistory, rebootONU } from '../api/noc';
import client from '../api/client';
import type { CustomerDNA, SignalPoint } from '../types/noc';
import { timeAgo } from '../utils/signal';
import { setNocFocus } from '../state/nocFocus';

// â”€â”€ Design tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const C = {
  bg0: '#080e1a', bg1: '#0d1624', bg2: '#111d2e', bg3: '#162238',
  border: '#1a2d45', borderLight: '#1e3555',
  textPrimary: '#dde8f5', textSecond: '#7a9cc0', textMuted: '#3d5a7a',
  green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444',
  blue: '#3b82f6', accent: '#2563eb', purple: '#8b5cf6', cyan: '#22d3ee',
} as const;
const MONO = "'JetBrains Mono', monospace";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function rxColor(v: number | null): string {
  if (v == null) return C.textMuted;
  if (v >= -22) return C.green;
  if (v > -26) return C.yellow;
  if (v > -28) return C.orange;
  return C.red;
}
function rxLabel(v: number | null): string {
  if (v == null) return 'No Signal';
  if (v >= -22) return 'Good';
  if (v > -26) return 'Weak';
  if (v > -28) return 'Poor';
  return 'Critical';
}
function initials(name: string | null): string {
  if (!name) return '??';
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function fmtDate(v: string | null): string {
  if (!v) return 'â€”';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDT(v: string | null): string {
  if (!v) return 'â€”';
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(v: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function daysUntil(v: string | null): number | null {
  if (!v) return null;
  return Math.round((new Date(v).getTime() - Date.now()) / 86_400_000);
}
function mediaUrl(p: string | null, base: string): string | null {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const resolvedBase = base.replace(/\/$/, '') || 'http://127.0.0.1:8000';
  return `${resolvedBase}${p.startsWith('/') ? p : '/' + p}`;
}
function fmtDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function parseLooseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const result: Record<string, unknown> = {};
    const pairs = trimmed.matchAll(/['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*(['"])(.*?)\2/g);
    for (const match of pairs) result[match[1]] = match[3];
    return Object.keys(result).length ? result : null;
  }
}

function valueText(value: unknown): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function auditLabel(field: string | null): string {
  const labels: Record<string, string> = {
    gps_lat: 'GPS latitude',
    gps_lng: 'GPS longitude',
    gps_accuracy_m: 'GPS accuracy',
    ont_sticker_data: 'ONT sticker scan',
    sticker_photo_url: 'ONT sticker photo',
    ont_model: 'ONT model',
    ont_serial_number: 'ONT serial',
    mac_address: 'Railwire/account MAC',
  };
  return field ? (labels[field] || field.replace(/_/g, ' ')) : 'Customer update';
}

function formatAuditValue(field: string | null, value: unknown): string {
  if (value == null || value === '') return '-';
  if (field === 'gps_lat' || field === 'gps_lng') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(6) : valueText(value);
  }
  if (field === 'gps_accuracy_m') {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.round(n)} m` : valueText(value);
  }
  if (field === 'ont_sticker_data' || field === 'router_sticker_data') {
    const obj = parseLooseObject(value);
    if (!obj) return valueText(value).slice(0, 80);
    const mac = valueText(obj.macAddress ?? obj.mac_address ?? obj.mac);
    const serial = valueText(obj.serialNumber ?? obj.serial_number ?? obj.gponSn ?? obj.gpon_sn);
    const model = valueText(obj.model);
    const error = valueText(obj.error);
    const errorText = error.toLowerCase().includes('network error')
      ? 'OCR not available during scan'
      : error;
    const parts = [
      mac !== '-' ? `MAC ${mac}` : null,
      serial !== '-' ? `Serial ${serial}` : null,
      model !== '-' ? `Model ${model}` : null,
      obj.photoUrl || obj.photo_url ? 'photo saved' : null,
      errorText !== '-' && errorText.toLowerCase() !== 'none' ? `OCR note: ${errorText}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Sticker photo saved';
  }
  const text = valueText(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
// â”€â”€ Alarm timeline builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ET_MAP: Record<string, string> = {
  DYING_GASP: 'onu-dying-gasp', POWER_OFF: 'onu-dying-gasp',
  OFFLINE: 'onu-link-lost', ONU_OFFLINE: 'onu-link-lost', LINK_LOST: 'onu-link-lost',
  RX_LOW: 'onu-pon-rxpower-low', SIGNAL_DROP: 'onu-pon-rxpower-low', THRESHOLD_CROSSED: 'onu-pon-rxpower-low',
  PON_LOS: 'pon-los', FIBER_CUT: 'pon-los',
};
const ALARM_CODE: Record<string, string> = {
  'onu-dying-gasp': 'Alarm 26', 'pon-los': 'Alarm 18',
  'onu-link-lost': 'Alarm 20', 'onu-pon-rxpower-low': 'Alarm 48', 'onu-register': 'â€”',
};
const EV_COLOR: Record<string, string> = {
  'onu-dying-gasp': '#6b7280', 'pon-los': C.red, 'onu-link-lost': C.red,
  'onu-pon-rxpower-low': C.orange, 'onu-register': C.green,
};
const DIAG_META: Record<string, { bar: string; label: string; icon: string }> = {
  healthy: { bar: C.green, label: 'Healthy', icon: 'â—' },
  power:   { bar: '#6b7280', label: 'Power Failure', icon: 'âš¡' },
  fiber:   { bar: C.red, label: 'Fiber Break', icon: 'âœ‚' },
  signal:  { bar: C.orange, label: 'Signal Issue', icon: 'â–¼' },
};

interface DiagEvent { time: string; event: string; state: 'Active' | 'Cleared' }
interface DiagDay {
  day: string; date: string; rawDate: Date;
  type: 'healthy' | 'power' | 'fiber' | 'signal';
  uptimeHours: number; flaps: number;
  majorEvent: { reason: string; time: string } | null;
  events: DiagEvent[];
}

function buildDiagTimeline(alarms: CustomerDNA['alarms']): DiagDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
    const isToday = i === 6;
    const dayStr = isToday ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' });
    const dateStr = d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    const y = d.getFullYear(), mo = d.getMonth(), day = d.getDate();

    const dayAlarms = alarms.filter(a => {
      const at = new Date(a.received_at);
      return at.getFullYear() === y && at.getMonth() === mo && at.getDate() === day;
    });

    const events: DiagEvent[] = [];
    dayAlarms.forEach(a => {
      const mapped = ET_MAP[a.event_type] || 'onu-link-lost';
      events.push({ time: fmtDT(a.received_at), event: mapped, state: 'Active' });
      if (a.resolved_at) {
        const ra = new Date(a.resolved_at);
        if (ra.getFullYear() === y && ra.getMonth() === mo && ra.getDate() === day)
          events.push({ time: fmtDT(a.resolved_at), event: 'onu-register', state: 'Cleared' });
      }
    });
    events.sort((a, b) => a.time.localeCompare(b.time));

    let type: DiagDay['type'] = 'healthy';
    if (dayAlarms.some(a => ['DYING_GASP', 'POWER_OFF'].includes(a.event_type))) type = 'power';
    else if (dayAlarms.some(a => ['PON_LOS', 'FIBER_CUT'].includes(a.event_type))) type = 'fiber';
    else if (dayAlarms.some(a => ['RX_LOW', 'SIGNAL_DROP', 'THRESHOLD_CROSSED', 'OFFLINE', 'ONU_OFFLINE', 'LINK_LOST'].includes(a.event_type)))
      type = dayAlarms.some(a => ['OFFLINE', 'ONU_OFFLINE', 'LINK_LOST'].includes(a.event_type)) ? 'fiber' : 'signal';

    const majorAlarm = dayAlarms[0] || null;
    const majorEvent = majorAlarm ? {
      reason: type === 'power' ? 'Power Loss (Dying Gasp Â· Alarm 26)'
        : type === 'fiber' ? 'Fiber Break â€” pon-los (Alarm 18)' : 'Low Rx Power â€” Alarm 48',
      time: fmtDT(majorAlarm.received_at).split(' ')[1] || '',
    } : null;

    const totalDownMin = dayAlarms.reduce((s, a) => {
      if (!a.resolved_at) return s;
      return s + Math.max(0, (new Date(a.resolved_at).getTime() - new Date(a.received_at).getTime()) / 60000);
    }, 0);

    return { day: dayStr, date: dateStr, rawDate: d, type, uptimeHours: Math.round(Math.max(0, 24 - totalDownMin / 60) * 10) / 10, flaps: dayAlarms.length, majorEvent, events };
  });
}

function parseTs(ts: string): Date {
  const [date, time] = ts.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m);
}

function calcDowntime(events: DiagEvent[]) {
  const activeMap: Record<string, string> = {};
  const pairs: { event: string; activeTime: string; clearedTime: string; durationMin: number }[] = [];
  for (const ev of events) {
    if (ev.state === 'Active') {
      activeMap[ev.event] = ev.time;
    } else {
      let matchKey: string | null = activeMap[ev.event] ? ev.event : null;
      if (!matchKey && ev.event === 'onu-register') {
        for (const k of ['onu-link-lost', 'onu-pon-rxpower-low', 'pon-los']) {
          if (activeMap[k]) { matchKey = k; break; }
        }
      }
      if (matchKey) {
        const dur = Math.round((parseTs(ev.time).getTime() - parseTs(activeMap[matchKey]).getTime()) / 60000);
        if (dur > 0) pairs.push({ event: matchKey, activeTime: activeMap[matchKey], clearedTime: ev.time, durationMin: dur });
        delete activeMap[matchKey];
      }
    }
  }
  return { totalMinutes: pairs.reduce((s, p) => s + p.durationMin, 0), pairs };
}

// â”€â”€ Shared primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Card({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, ...style }}>{children}</div>;
}
function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}
function KvRow({ label, value, mono, valueStyle }: { label: string; value: React.ReactNode; mono?: boolean; valueStyle?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.border}20` }}>
      <span style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: C.textSecond, textAlign: 'right', fontWeight: 500, fontFamily: mono ? MONO : undefined, ...valueStyle }}>{value ?? 'â€”'}</span>
    </div>
  );
}
function Pill({ label, color = C.green }: { label: string; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', background: color + '15', border: `1px solid ${color}30`, color, borderRadius: 5, padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>{label}</span>
  );
}
function MonitoringScopeNote() {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>Monitoring Scope</div>
      <div style={{ background: C.green + '08', borderRadius: 6, border: `1px solid ${C.green}25`, padding: '14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div>
          <div style={{ color: C.green, fontSize: 12, fontWeight: 800 }}>Online / Offline</div>
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 3 }}>Live ONU state from OLT polling.</div>
        </div>
        <div>
          <div style={{ color: C.green, fontSize: 12, fontWeight: 800 }}>RX Power History</div>
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 3 }}>Stored snapshots feed trend and prediction.</div>
        </div>
        <div>
          <div style={{ color: C.green, fontSize: 12, fontWeight: 800 }}>Fault Alarms</div>
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 3 }}>Power down, fiber cut, and fiber critical are notification-worthy.</div>
        </div>
      </div>
    </div>
  );
}
function AlertBadge({ label }: { label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.yellow + '15', border: `1px solid ${C.yellow}40`, color: C.yellow, borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>âš  {label}</span>;
}
function IconBtn({ icon, label, variant = 'ghost', onClick, disabled }: { icon?: React.ReactNode; label: string; variant?: 'ghost' | 'primary' | 'warn'; onClick?: () => void; disabled?: boolean }) {
  const [h, setH] = useState(false);
  const s = variant === 'primary' ? { bg: C.accent, bdr: C.accent, col: '#fff' }
    : variant === 'warn' ? { bg: C.red + '18', bdr: C.red + '50', col: C.red }
    : { bg: 'transparent', bdr: C.border, col: C.textSecond };
  return (
    <button onClick={onClick} disabled={disabled} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: h && !disabled ? (variant === 'ghost' ? C.bg3 : s.bg) : s.bg, border: `1px solid ${s.bdr}`, borderRadius: 6, color: s.col, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.12s', transform: h && !disabled ? 'translateY(-1px)' : 'none', opacity: disabled ? 0.5 : 1 }}>
      {icon}{label}
    </button>
  );
}

// â”€â”€ Real OpenStreetMap embed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function LocationMap({ lat, lng }: { lat: number | null; lng: number | null; address?: string | null }) {
  if (lat == null || lng == null) {
    return (
      <div style={{ width: '100%', height: 110, borderRadius: 7, background: C.bg0, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
        <span style={{ fontSize: 10, color: C.textMuted }}>GPS not collected</span>
      </div>
    );
  }
  const delta = 0.003;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
  return (
    <div style={{ position: 'relative', width: '100%', height: 110, borderRadius: 7, overflow: 'hidden', border: `1px solid ${C.border}` }}>
      <iframe
        src={mapUrl}
        width="100%" height="110"
        style={{ border: 'none', display: 'block', filter: 'invert(90%) hue-rotate(180deg) brightness(0.85)' }}
        title="Customer Location"
        loading="lazy"
      />
      <a href={mapsLink} target="_blank" rel="noopener noreferrer"
        style={{ position: 'absolute', bottom: 4, right: 5, fontSize: 9, color: C.accent, background: C.bg1 + 'cc', borderRadius: 3, padding: '1px 5px', textDecoration: 'none' }}>
        Open Maps â†—
      </a>
      <div style={{ position: 'absolute', top: 4, left: 5, fontSize: 9, color: C.textMuted, background: C.bg1 + 'cc', borderRadius: 3, padding: '1px 5px', fontFamily: MONO }}>
        {lat.toFixed(4)}Â°N {lng.toFixed(4)}Â°E
      </div>
    </div>
  );
}

// â”€â”€ 7-Day Diagnostic Timeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TimelineBar({ days, oltIp }: { days: DiagDay[]; oltIp: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const expandedDay = expanded !== null ? days[expanded] : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>7-Day Diagnostic Timeline</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {Object.entries(DIAG_META).map(([k, v]) => (
            <span key={k} style={{ fontSize: 8, color: v.bar, display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: v.bar, display: 'inline-block' }}/>{v.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 3, position: 'relative' }}>
        {days.map((seg, i) => {
          const dc = DIAG_META[seg.type];
          const isToday = seg.day === 'Today';
          const isExp = expanded === i;
          const isHov = hovered === i;
          const { pairs } = calcDowntime(seg.events);
          const dayOrigin = seg.rawDate;
          const dayMs = 24 * 3600 * 1000;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              onMouseEnter={e => { setHovered(i); setTipPos({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHovered(null)}
              onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })}
              onClick={() => setExpanded(prev => prev === i ? null : i)}>
              <div style={{ width: '100%', height: 22, borderRadius: 4, overflow: 'hidden', background: dc.bar + (seg.type === 'healthy' ? '90' : '70'), position: 'relative', border: `1px solid ${isExp ? dc.bar : isToday ? C.accent + '60' : isHov ? dc.bar + '60' : 'transparent'}`, transition: 'border-color 0.15s', boxShadow: isExp ? `0 0 8px ${dc.bar}50` : 'none' }}>
                {pairs.map((p, pi) => {
                  const leftPct = Math.max(0, Math.min(100, ((parseTs(p.activeTime).getTime() - dayOrigin.getTime()) / dayMs) * 100));
                  const widthPct = Math.max(0.5, Math.min(100 - leftPct, ((parseTs(p.clearedTime).getTime() - parseTs(p.activeTime).getTime()) / dayMs) * 100));
                  const sc = p.event === 'onu-dying-gasp' ? '#6b7280' : p.event === 'onu-pon-rxpower-low' ? C.orange : C.red;
                  return <div key={pi} style={{ position: 'absolute', top: 0, bottom: 0, left: leftPct + '%', width: widthPct + '%', background: sc, opacity: 0.95 }}/>;
                })}
              </div>
              <span style={{ fontSize: 9, color: isToday ? C.textSecond : C.textMuted, fontWeight: isToday ? 700 : 400, userSelect: 'none' }}>{seg.day}</span>
            </div>
          );
        })}
        {hovered !== null && (() => {
          const seg = days[hovered]; const dc = DIAG_META[seg.type];
          return (
            <div style={{ position: 'fixed', left: tipPos.x + 12, top: tipPos.y - 10, background: C.bg1, border: `1px solid ${dc.bar}60`, borderRadius: 8, padding: '9px 12px', zIndex: 999, pointerEvents: 'none', minWidth: 200, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', animation: 'fadeUp 0.15s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <span style={{ fontSize: 12 }}>{dc.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: dc.bar }}>{dc.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textMuted }}>{seg.date}</span>
              </div>
              <div style={{ fontSize: 11, color: C.textSecond, marginBottom: 4 }}>Uptime: <span style={{ fontFamily: MONO, color: C.textPrimary }}>{seg.uptimeHours}h / 24h</span></div>
              {seg.majorEvent && <div style={{ fontSize: 11, color: dc.bar, marginBottom: 4 }}>Last disconnect: <strong>{seg.majorEvent.reason}</strong><span style={{ marginLeft: 5, fontFamily: MONO, color: C.textMuted }}>@ {seg.majorEvent.time}</span></div>}
              <div style={{ fontSize: 11, color: C.textMuted }}>Alarms: <span style={{ color: seg.flaps > 0 ? C.yellow : C.green, fontWeight: 700 }}>{seg.flaps}</span></div>
              <div style={{ marginTop: 6, fontSize: 9, color: C.textMuted, borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>Click to expand alarm log</div>
            </div>
          );
        })()}
      </div>
      <div style={{ overflow: 'hidden', maxHeight: expandedDay ? 320 : 0, transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)', marginTop: expandedDay ? 10 : 0 }}>
        {expandedDay && (() => {
          const dc = DIAG_META[expandedDay.type];
          const { totalMinutes, pairs } = calcDowntime(expandedDay.events);
          const activeDurMap: Record<string, number> = {};
          pairs.forEach(p => { activeDurMap[p.activeTime + '|' + p.event] = p.durationMin; });
          return (
            <div style={{ background: C.bg0, border: `1px solid ${dc.bar}40`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: dc.bar }}>Alarm & Event History</span>
                <span style={{ fontSize: 10, color: C.textMuted }}>â€” {expandedDay.date}</span>
                <span style={{ fontSize: 9, color: C.textMuted, background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 7px' }}>Source: {oltIp}</span>
                {totalMinutes > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: C.red, background: C.red + '12', border: `1px solid ${C.red}35`, borderRadius: 4, padding: '1px 8px' }}>Total Downtime: {fmtDuration(totalMinutes)}</span>}
                <button onClick={() => setExpanded(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>âœ•</button>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 240 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: C.bg1 }}>
                      {['Timestamp', 'Event', 'Alarm Code', 'State', 'Duration'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expandedDay.events.map((ev, ei) => {
                      const ec = EV_COLOR[ev.event] || C.textSecond;
                      const durMin = activeDurMap[ev.time + '|' + ev.event];
                      const recPair = ev.state === 'Cleared' ? pairs.find(p => p.clearedTime === ev.time) : null;
                      return (
                        <tr key={ei} style={{ borderBottom: `1px solid ${C.border}20` }}
                          onMouseEnter={e => (e.currentTarget.style.background = C.bg3 + '80')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <td style={{ padding: '6px 10px', color: C.textMuted, whiteSpace: 'nowrap', fontSize: 10, fontFamily: MONO }}>{ev.time}</td>
                          <td style={{ padding: '6px 10px' }}><span style={{ color: ec, fontWeight: 600, fontSize: 11 }}>{ev.event}</span></td>
                          <td style={{ padding: '6px 10px' }}><span style={{ fontFamily: MONO, fontSize: 10, color: ALARM_CODE[ev.event] !== 'â€”' ? ec : C.textMuted }}>{ALARM_CODE[ev.event] || 'â€”'}</span></td>
                          <td style={{ padding: '6px 10px' }}><span style={{ fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '1px 7px', background: ev.state === 'Active' ? C.red + '18' : C.green + '12', border: `1px solid ${ev.state === 'Active' ? C.red + '40' : C.green + '30'}`, color: ev.state === 'Active' ? C.red : C.green }}>{ev.state}</span></td>
                          <td style={{ padding: '6px 10px' }}>
                            {durMin !== undefined ? <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: C.orange }}>{fmtDuration(durMin)}</span>
                              : recPair ? <span style={{ fontFamily: MONO, fontSize: 10, color: C.green }}>â†© {fmtDuration(recPair.durationMin)}</span>
                              : <span style={{ fontSize: 10, color: C.textMuted }}>â€”</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

type TrendWindow = '1h' | '6h' | '24h';

interface HoverPoint { idx: number; rx: number; tx: number | null; ts: string; x: number; y: number; }

function SignalTrendChart({ mac, initialHistory }: { mac: string; initialHistory: SignalPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ptsRef = useRef<{ rx: number; tx: number | null; ts: string; px: number; py: number }[]>([]);
  const [trendWindow, setTrendWindow] = useState<TrendWindow>('6h');
  const [history, setHistory] = useState<SignalPoint[]>(initialHistory);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date>(new Date());
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const hoursMap: Record<TrendWindow, number> = { '1h': 1, '6h': 6, '24h': 24 };

  const fetchHistory = useCallback(async (win: TrendWindow) => {
    if (!mac) return;
    setLoading(true);
    try {
      const data = await fetchSignalHistory(mac, hoursMap[win]);
      setHistory(data);
      setLastFetched(new Date());
    } catch { /* keep existing */ }
    finally { setLoading(false); }
  }, [mac]);

  useEffect(() => { fetchHistory(trendWindow); }, [trendWindow, fetchHistory]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.offsetWidth || 340, H = 90;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const pts = history.filter(p => p.rx_power_dbm != null);
    ptsRef.current = [];
    if (pts.length < 2) {
      ctx.fillStyle = C.textMuted; ctx.font = `10px Inter`; ctx.textAlign = 'center';
      ctx.fillText('No signal data for this period', W / 2, H / 2);
      return;
    }

    const minV = -32, maxV = -8, range = maxV - minV;
    const toY = (v: number) => H - ((v - minV) / range) * H * 0.88 - H * 0.06;
    const n = pts.length;
    const step = W / Math.max(n - 1, 1);

    // Threshold zones
    ctx.fillStyle = C.green + '10'; ctx.fillRect(0, toY(-8), W, toY(-22) - toY(-8));
    ctx.fillStyle = C.yellow + '10'; ctx.fillRect(0, toY(-22), W, toY(-26) - toY(-22));
    ctx.fillStyle = C.red + '08'; ctx.fillRect(0, toY(-26), W, H - toY(-26));

    // Grid lines + labels
    [-10, -14, -18, -22, -26, -30].forEach(v => {
      const y = toY(v);
      ctx.strokeStyle = C.border + '50'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = C.textMuted; ctx.font = `8px ${MONO}`; ctx.textAlign = 'left';
      ctx.fillText(String(v), 2, y - 2);
    });

    // Threshold lines
    const drawThreshold = (v: number, color: string) => {
      const y = toY(v);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
    };
    drawThreshold(-24, C.yellow);
    drawThreshold(-27, C.red);

    // Rx line
    const rxData = pts.map(p => p.rx_power_dbm!);
    ctx.beginPath();
    rxData.forEach((v, i) => { const x = i * step, y = toY(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = C.blue; ctx.lineWidth = 2; ctx.stroke();

    // Dots at key points
    const minIdx = rxData.indexOf(Math.min(...rxData));
    const maxIdx = rxData.indexOf(Math.max(...rxData));
    [0, minIdx, maxIdx, n - 1].forEach(idx => {
      ctx.beginPath(); ctx.arc(idx * step, toY(rxData[idx]), 3, 0, Math.PI * 2);
      ctx.fillStyle = rxColor(rxData[idx]); ctx.fill();
    });

    // X-axis time labels
    const labelCount = Math.min(6, n);
    const labelStep = Math.floor(n / labelCount);
    ctx.fillStyle = C.textMuted; ctx.font = `7px Inter`; ctx.textAlign = 'center';
    for (let i = 0; i < n; i += labelStep) {
      ctx.fillText(fmtTime(pts[i].timestamp), i * step, H - 2);
    }

    // Store point positions for hover
    ptsRef.current = pts.map((p, i) => ({
      rx: p.rx_power_dbm!,
      tx: p.tx_power_dbm ?? null,
      ts: p.timestamp,
      px: i * step,
      py: toY(p.rx_power_dbm!),
    }));
  }, [history, trendWindow]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    const stored = ptsRef.current;
    if (!canvas || stored.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const scaleX = canvas.width / rect.width;
    const canvasX = mouseX * scaleX;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    stored.forEach((p, i) => {
      const d = Math.abs(p.px - canvasX);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    });
    const pt = stored[nearestIdx];
    setHover({ idx: nearestIdx, rx: pt.rx, tx: pt.tx, ts: pt.ts, x: pt.px, y: pt.py });
    setTipPos({ x: e.clientX, y: e.clientY });
  }, []);

  const pts = history.filter(p => p.rx_power_dbm != null);
  const minRx = pts.length > 0 ? Math.min(...pts.map(p => p.rx_power_dbm!)) : null;
  const maxRx = pts.length > 0 ? Math.max(...pts.map(p => p.rx_power_dbm!)) : null;
  const rxC = hover ? rxColor(hover.rx) : C.blue;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Rx Signal Trend</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(['1h','6h','24h'] as TrendWindow[]).map(w => (
            <button key={w} onClick={() => setTrendWindow(w)}
              style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${trendWindow === w ? C.accent : C.border}`, background: trendWindow === w ? C.accent + '20' : 'transparent', color: trendWindow === w ? C.accent : C.textMuted, fontSize: 9, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
              {w}
            </button>
          ))}
          {loading && <svg style={{ animation: 'spin 1s linear infinite' }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>}
        </div>
      </div>
      <div ref={containerRef}
        style={{ position: 'relative', background: C.bg0, borderRadius: 6, overflow: 'hidden', border: `1px solid ${hover ? C.accent + '60' : C.border}`, cursor: 'crosshair', transition: 'border-color 0.12s' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 90 }}/>
        {/* Hover vertical line drawn as absolute overlay */}
        {hover && ptsRef.current.length > 0 && (() => {
          const canvas = canvasRef.current;
          if (!canvas) return null;
          const rect = canvas.getBoundingClientRect();
          const scaleX = rect.width / canvas.width;
          const displayX = hover.x * scaleX;
          return (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: displayX, width: 1, background: rxC + '80', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: hover.y * (rect.height / canvas.height) - 4, left: -3, width: 7, height: 7, borderRadius: '50%', background: rxC, border: `1.5px solid ${C.bg0}` }}/>
            </div>
          );
        })()}
      </div>
      {/* Hover tooltip */}
      {hover && (
        <div style={{ position: 'fixed', left: tipPos.x + 14, top: tipPos.y - 8, background: C.bg1, border: `1px solid ${rxC}60`, borderRadius: 8, padding: '9px 12px', zIndex: 999, pointerEvents: 'none', minWidth: 170, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: rxC, flexShrink: 0, display: 'inline-block' }}/>
            <span style={{ fontSize: 13, fontWeight: 800, fontFamily: MONO, color: rxC }}>{hover.rx.toFixed(2)} dBm</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: rxC, marginBottom: 4 }}>{rxLabel(hover.rx)}</div>
          {hover.tx != null && (
            <div style={{ fontSize: 10, color: C.textSecond, marginBottom: 3 }}>
              Tx: <span style={{ fontFamily: MONO, color: C.textSecond }}>{hover.tx.toFixed(2)} dBm</span>
            </div>
          )}
          <div style={{ fontSize: 10, color: C.textMuted, fontFamily: MONO, borderTop: `1px solid ${C.border}`, paddingTop: 4, marginTop: 4 }}>
            {fmtDT(hover.ts)}
          </div>
          <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>
            {hover.rx >= -22 ? 'â— Fiber: Clean' : hover.rx > -26 ? 'â–² Fiber: Monitor' : hover.rx > -28 ? 'âš  Fiber: Weak â€” Schedule' : 'âœ– Fiber: Critical â€” Dispatch'}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontSize: 9, color: C.green }}>â— â‰¥âˆ’22 Good</span>
          <span style={{ fontSize: 9, color: C.yellow }}>-- âˆ’24 threshold</span>
          <span style={{ fontSize: 9, color: C.red }}>-- âˆ’27 critical</span>
        </div>
        <div style={{ fontSize: 9, color: C.textMuted, fontFamily: MONO }}>
          {hover
            ? <span style={{ color: rxC, fontWeight: 700 }}>{hover.rx.toFixed(2)} dBm Â· {rxLabel(hover.rx)}</span>
            : minRx != null && maxRx != null ? `min ${minRx.toFixed(1)} / max ${maxRx.toFixed(1)} dBm` : ''}
          {!hover && lastFetched && <span style={{ marginLeft: 8 }}>Â· {timeAgo(lastFetched.toISOString())}</span>}
        </div>
      </div>
    </div>
  );
}

// â”€â”€ S1 â€” Customer Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function S1({ dna }: { dna: CustomerDNA }) {
  const cust = dna.customer;
  const days = daysUntil(cust.expiry_date);
  const usageMB = cust.monthly_data_used_mb || 0;
  const usageGB = usageMB / 1024;
  const planMatch = cust.plan_name?.match(/(\d[\d.]*)\s*GB/i);
  const totalGB = planMatch ? parseFloat(planMatch[1]) : null;
  const usagePct = totalGB && usageMB > 0 ? Math.min(100, (usageGB / totalGB) * 100) : null;
  const usageColor = usagePct == null ? C.textSecond : usagePct > 80 ? C.red : usagePct > 55 ? C.yellow : C.green;
  const isActive = cust.status?.toLowerCase() === 'active';

  return (
    <Card style={{ flexShrink: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', overflowX: 'auto' }}>
        {/* Identity */}
        <div style={{ padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 16, borderRight: `1px solid ${C.border}`, minWidth: 280, flexShrink: 0 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg, ${C.accent}, #1d4ed8)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0, border: `2px solid ${C.accent}40` }}>
            {initials(cust.name)}
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>{cust.name || cust.username}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.accent }}>{cust.username}</span>
              {cust.phone && <span style={{ fontSize: 11, color: C.textMuted }}>{cust.phone}</span>}
            </div>
            {cust.email && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{cust.email}</div>}
          </div>
        </div>

        {/* Plan & Status */}
        <div style={{ padding: '18px 20px', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minWidth: 180, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Plan</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{cust.plan_name || 'â€”'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={cust.status?.toUpperCase() || 'â€”'} color={isActive ? C.green : C.red}/>
          </div>
        </div>

        {/* Expiry */}
        <div style={{ padding: '18px 20px', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, minWidth: 160, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Expiry</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: C.textPrimary }}>{fmtDate(cust.expiry_date)}</span>
              {days != null && <span style={{ fontSize: 11, fontWeight: 700, color: days < 10 ? C.red : days < 20 ? C.yellow : C.textSecond }}>{days > 0 ? `${days}d left` : `${Math.abs(days)}d ago`}</span>}
            </div>
          </div>
        </div>

        {/* Data usage */}
        <div style={{ padding: '18px 20px', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minWidth: 220, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Data Usage</div>
          {usageMB > 0 ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: usageColor }}>{usageGB.toFixed(1)} GB</span>
                {totalGB && <span style={{ fontSize: 11, color: C.textMuted }}>of {totalGB} GB</span>}
              </div>
              {usagePct != null && (
                <>
                  <div style={{ height: 7, background: C.bg0, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: usagePct + '%', height: '100%', background: `linear-gradient(90deg, ${usageColor}88, ${usageColor})`, borderRadius: 4, transition: 'width 0.5s' }}/>
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>{usagePct.toFixed(0)}% used â€” FUP at 80%</div>
                </>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11, color: C.textMuted }}>
              {totalGB ? `Plan: ${totalGB} GB â€” usage data not synced` : 'No usage data'}
            </div>
          )}
        </div>

        {/* Location */}
        <div style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minWidth: 280, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Location</div>
          <LocationMap lat={cust.map_lat} lng={cust.map_lng} address={cust.rico_address || cust.railwire_address}/>
          <div style={{ fontSize: 10, color: C.textSecond, lineHeight: 1.45 }}>{cust.rico_address || cust.railwire_address || 'Address not set'}</div>
        </div>
      </div>
    </Card>
  );
}

// â”€â”€ S2 â€” Live Status & Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function S2({ dna, diagDays, onReboot }: {
  dna: CustomerDNA; diagDays: DiagDay[];
  onReboot: () => Promise<void>;
}) {
  const onu = dna.onu;
  const online = onu?.status?.toLowerCase() === 'online';
  const isStale = !!onu?.stale;
  const statusColor = online ? C.green : (isStale ? C.textMuted : C.red);
  const statusLabel = isStale ? `LAST KNOWN ${online ? 'ONLINE' : 'OFFLINE'}` : (online ? 'ONLINE' : 'OFFLINE');
  const [rebootState, setRebootState] = useState<'idle' | 'rebooting' | 'done'>('idle');
  const [showConfirm, setShowConfirm] = useState(false);

  const lastDyingGasp = dna.alarms.find(a => a.event_type === 'DYING_GASP');
  const lastOffline = dna.alarms.find(a => ['OFFLINE', 'ONU_OFFLINE', 'LINK_LOST'].includes(a.event_type));
  const hasDyingGasp = !!lastDyingGasp;
  const offlineBadge = {
    label: online
      ? (hasDyingGasp ? 'Last Offline: Power Loss (Dying Gasp Â· Alarm 26)' : 'Last Offline: LOS â€” Fiber Break / Link Lost')
      : (hasDyingGasp ? 'Offline Reason: Power Loss (Dying Gasp Â· Alarm 26)' : 'Offline Reason: LOS â€” Fiber Break / Link Lost'),
    color: hasDyingGasp ? C.orange : C.red,
    icon: hasDyingGasp ? 'âš¡' : (online ? 'ðŸ”´' : 'âœ‚'),
    desc: hasDyingGasp
      ? 'Dying Gasp frame received before power down â€” router/ONU lost power cleanly. Check power supply at premises.'
      : 'No Dying Gasp received â€” abrupt signal loss. Likely fiber cut, connector issue, or ONU hardware fault.',
    ts: lastDyingGasp?.received_at || lastOffline?.received_at || null,
  };

  const handleReboot = async () => {
    setShowConfirm(false); setRebootState('rebooting');
    try { await onReboot(); setRebootState('done'); }
    catch { setRebootState('idle'); }
    setTimeout(() => setRebootState('idle'), 8000);
  };

  const visibleHealthFlags = Object.entries(dna.health.flags || {})
    .filter(([key, value]) => value && !['binding_conflict', 'stale_live_onu'].includes(key));

  return (
    <Card style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader title="Section 2 â€” Live Status & Health" sub="SNMP 60s polling"/>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: statusColor, flexShrink: 0, animation: isStale ? 'none' : (online ? 'pulse-glow-green 2s ease infinite' : 'pulse-glow-red 1.5s ease infinite') }}/>
          <div>
            <div style={{ fontSize: isStale ? 20 : 26, fontWeight: 800, color: statusColor, letterSpacing: '0.06em', lineHeight: 1 }}>{statusLabel}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>Polled {timeAgo(onu?.polled_at || null)}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {visibleHealthFlags.length === 0
              ? <span style={{ fontSize: 11, color: C.green }}>No active alerts</span>
              : visibleHealthFlags.map(([k]) => <AlertBadge key={k} label={k.replace(/_/g, ' ').toUpperCase()}/>)}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setShowConfirm(true)} disabled={rebootState !== 'idle' || !onu || isStale}
              style={{ padding: '6px 13px', borderRadius: 7, cursor: rebootState !== 'idle' || isStale ? 'default' : 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, border: '1px solid', display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'all 0.2s', background: rebootState === 'done' ? C.green + '18' : C.orange + '12', borderColor: rebootState === 'done' ? C.green + '60' : C.orange + '50', color: rebootState === 'done' ? C.green : C.orange, opacity: rebootState === 'rebooting' || isStale ? 0.55 : 1 }}>
              {rebootState === 'rebooting'
                ? <svg style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
                : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>}
              {rebootState === 'rebooting' ? 'Rebootingâ€¦' : rebootState === 'done' ? 'âœ“ Rebooted' : 'Reboot ONU'}
            </button>
            <span style={{ fontSize: 9, color: C.textMuted, fontFamily: MONO }}>ONU #{onu?.onu_index ?? '?'}</span>
          </div>
        </div>

        {isStale && (
          <div style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 13px', color: C.textSecond, fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}>
            Verified ONT binding is present. This row is last-known until the next fresh OLT poll confirms the same ONT identity.
          </div>
        )}

        {/* Reboot confirm overlay */}
        {showConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,14,26,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div style={{ background: C.bg2, border: `1px solid ${C.orange}50`, borderRadius: 12, padding: '22px 28px', textAlign: 'center', maxWidth: 320, animation: 'fadeUp 0.2s ease' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>âš¡</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Confirm ONU Reboot</div>
              <div style={{ fontSize: 12, color: C.textSecond, marginBottom: 20, lineHeight: 1.6 }}>
                This will send a command to <span style={{ fontFamily: MONO, color: C.orange }}>{onu?.olt_host}</span> ONU index <span style={{ fontFamily: MONO, color: C.orange }}>#{onu?.onu_index}</span>.<br/>Customer will lose connection for ~60 seconds.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => setShowConfirm(false)} style={{ padding: '7px 18px', borderRadius: 7, background: 'transparent', border: `1px solid ${C.border}`, color: C.textSecond, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600 }}>Cancel</button>
                <button onClick={handleReboot} style={{ padding: '7px 18px', borderRadius: 7, background: C.orange + '20', border: `1px solid ${C.orange}60`, color: C.orange, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700 }}>Yes, Reboot Now</button>
              </div>
            </div>
          </div>
        )}

        {/* Offline reason badge */}
        {(lastDyingGasp || lastOffline) && !isStale && !online && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: offlineBadge.color + '12', border: `1px solid ${offlineBadge.color}35`, borderRadius: 8, padding: '9px 13px' }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: offlineBadge.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{offlineBadge.icon}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: offlineBadge.color, marginBottom: 2 }}>{offlineBadge.label}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>
                {offlineBadge.desc}
                {offlineBadge.ts && <span style={{ fontFamily: MONO, marginLeft: 6, color: C.textMuted }}>@ {fmtDT(offlineBadge.ts)}</span>}
              </div>
            </div>
          </div>
        )}

        {/* 7-day timeline */}
        <TimelineBar days={diagDays} oltIp={onu?.olt_host || 'â€”'}/>

        {/* Monitoring scope */}
        <MonitoringScopeNote />
      </div>
    </Card>
  );
}

// â”€â”€ S3 â€” Optical Diagnostics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function S3({ dna, history, onRefresh, refreshing }: { dna: CustomerDNA; history: SignalPoint[]; onRefresh: () => void; refreshing: boolean }) {
  const onu = dna.onu;
  const rxC = rxColor(onu?.rx_power_dbm ?? null);
  const mac = onu?.mac_address || dna.binding?.mac_address || '';

  // Get fiber distance from history (use latest non-null value)
  const fiberDist = history.slice().reverse().find(p => p.distance_m != null)?.distance_m ?? null;

  const lastPollAge = onu?.polled_at ? timeAgo(onu.polled_at) : 'N/A';
  const freshness = onu ? (onu.stale ? 'LAST-KNOWN' : 'FRESH') : 'NO LIVE ONU';

  return (
    <Card style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        title="Section 3 â€” Optical Diagnostics"
        sub={`SNMP poll Â· ${freshness} Â· Last: ${lastPollAge}`}
        action={
          <button onClick={onRefresh} disabled={!onu || refreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: `1px solid ${C.accent}`, background: refreshing ? C.accent + '10' : C.accent, color: '#fff', fontSize: 11, fontWeight: 600, cursor: !onu || refreshing ? 'default' : 'pointer', fontFamily: 'Inter, sans-serif', opacity: !onu || refreshing ? 0.7 : 1, transition: 'all 0.15s' }}>
            {refreshing
              ? <svg style={{ animation: 'spin 1s linear infinite' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>}
            {refreshing ? 'Polling OLTâ€¦' : 'Refresh Live Optical'}
          </button>
        }
      />
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        {onu?.stale ? (
          <div style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', color: C.textSecond, fontSize: 12, fontWeight: 600, lineHeight: 1.6 }}>
            Verified ONT identity is bound. Optical values will appear after a fresh OLT poll sees this same ONT again.
            <div style={{ marginTop: 7, color: C.textMuted, fontWeight: 600, fontSize: 11 }}>
              Last known sample: {lastPollAge}. Railwire MAC remains billing/discovery evidence only.
            </div>
          </div>
        ) : (
          <>
        {/* Optical tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {/* Rx Power */}
          <div style={{ background: C.bg0, border: `1px solid ${rxC}30`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Rx Power</div>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: rxC, lineHeight: 1 }}>{onu?.rx_power_dbm?.toFixed(1) ?? 'â€”'}</div>
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>dBm</div>
            <div style={{ height: 4, background: C.bg3, borderRadius: 2, marginTop: 7, overflow: 'hidden' }}>
              <div style={{ width: onu?.rx_power_dbm != null ? `${Math.min(100, Math.max(0, ((onu.rx_power_dbm + 30) / 22) * 100))}%` : '0%', height: '100%', background: rxC, borderRadius: 2 }}/>
            </div>
            <div style={{ fontSize: 9, color: rxC, marginTop: 3, fontWeight: 600 }}>{rxLabel(onu?.rx_power_dbm ?? null)}</div>
          </div>
          {/* Tx Power */}
          <div style={{ background: C.bg0, borderRadius: 8, border: `1px solid ${C.border}`, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Tx Power</div>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: C.textSecond, lineHeight: 1 }}>{onu?.tx_power_dbm?.toFixed(1) ?? 'â€”'}</div>
            <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>dBm</div>
          </div>
          {/* Temperature */}
          <div style={{ background: C.bg0, borderRadius: 8, border: `1px solid ${C.border}`, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Temperature</div>
            {onu?.temperature_c != null ? (
              <>
                <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: onu.temperature_c > 70 ? C.orange : C.textSecond, lineHeight: 1 }}>{onu.temperature_c.toFixed(1)}</div>
                <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>Â°C</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: C.textMuted, lineHeight: 1.3, marginTop: 4 }}>N/A</div>
                <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>EPON â€” not reported</div>
              </>
            )}
          </div>
        </div>

        {/* Fiber distance row */}
        {fiberDist != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg0, borderRadius: 6, padding: '7px 12px', border: `1px solid ${C.border}` }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
            <span style={{ fontSize: 10, color: C.textMuted }}>Fiber Distance</span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.textSecond, marginLeft: 'auto' }}>
              {fiberDist >= 1000 ? `${(fiberDist / 1000).toFixed(2)} km` : `${fiberDist} m`}
            </span>
          </div>
        )}

        {/* Signal trend chart */}
        {mac ? <SignalTrendChart mac={mac} initialHistory={history}/> : (
          <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', padding: '20px 0' }}>No MAC â€” chart unavailable</div>
        )}
          </>
        )}
      </div>
    </Card>
  );
}

// â”€â”€ S4 â€” Network Identity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function S4({ dna }: { dna: CustomerDNA }) {
  const onu = dna.onu; const cust = dna.customer;
  const confident = dna.binding?.confidence === 'verified' || dna.binding?.confidence === 'confirmed';
  const routerMac = cust.router_mac_address;
  const oltIp = onu?.olt_host || cust.olt_host || 'â€”';
  const oltType = oltIp.startsWith('10.10.10.') ? (oltIp === '10.10.10.200' || oltIp === '10.10.10.210' ? 'GPON' : 'EPON') : '';
  const ponPort = onu?.pon_port || cust.pon_port || 'â€”';
  const onuIndex = onu?.onu_index ?? cust.onu_index ?? null;
  const surveyMac = dna.binding?.mac_address || 'â€”';
  const railwireMac = cust.mac_address || 'â€”';
  const liveMac = onu?.mac_address || 'â€”';
  const bindingSource = dna.binding?.binding_source || 'No verified binding';
  const bindingState = dna.binding
    ? (onu?.stale ? 'trusted binding, last-known OLT row' : 'trusted binding, fresh OLT row')
    : 'no trusted binding - Railwire exact match may be used as fallback';
  const serial = cust.ont_serial_number || dna.binding?.serial_number || null;
  const model = cust.ont_model || onu?.model_id || 'â€”';
  const fw = onu?.sw_version || 'â€”';
  const cap = dna.olt_capability;

  return (
    <Card style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader title="Section 4 â€” Network Identity" sub="One binding, separate evidence"/>
      <div style={{ padding: '14px 16px', flex: 1 }}>
        <div style={{ background: C.green + '10', border: `1px solid ${C.green}35`, borderRadius: 8, padding: '10px 12px', marginBottom: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 9, color: C.green, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>System binding used by NOC</span>
            <span style={{ fontSize: 9, color: C.textMuted }}>{bindingSource}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 14, color: surveyMac !== 'â€”' ? C.green : C.textMuted, fontWeight: 800 }}>{surveyMac}</span>
            <span style={{ fontSize: 10, color: C.textMuted, textAlign: 'right' }}>{bindingState}</span>
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 5, lineHeight: 1.45 }}>
            Survey/admin verified ONT identity is the authority. Railwire/account MAC is billing evidence and does not replace this binding automatically.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <KvRow label="OLT Parent" value={oltIp + (oltType ? ` (${oltType})` : '')} mono/>
          <KvRow label="PON Port" value={ponPort} mono/>
          <KvRow label="ONU Index" value={onuIndex != null ? `#${onuIndex}` : 'â€”'} mono/>
          <KvRow label="Trusted Binding MAC" value={surveyMac} mono valueStyle={{ color: surveyMac !== 'â€”' ? C.green : C.textMuted }}/>
          <KvRow label="Railwire Account MAC (billing only)" value={railwireMac} mono valueStyle={{ color: railwireMac !== 'â€”' ? C.yellow : C.textMuted }}/>
          <KvRow label="OLT Row Selected By Binding" value={liveMac} mono valueStyle={{ color: liveMac !== 'â€”' ? C.cyan : C.textMuted }}/>
          {cap && (
            <KvRow
              label="OLT Data Capability"
              value={`${cap.olt_type} ${cap.model} Â· ${cap.has_customer_bandwidth ? 'customer traffic supported' : 'no customer traffic counter'}`}
              valueStyle={{ color: cap.has_customer_bandwidth ? C.green : C.yellow }}
            />
          )}
          {serial
            ? <KvRow label="ONU Serial" value={serial} mono/>
            : <KvRow label="ONU Serial" value={`N/A (${oltType || 'EPON'})`} valueStyle={{ color: C.textMuted }}/>}
          <KvRow label="ONU Model" value={model} mono/>
          <KvRow label="Firmware" value={fw !== 'â€”' ? fw : 'Not reported'} mono valueStyle={{ color: fw === 'â€”' ? C.textMuted : C.textSecond }}/>
          <KvRow label="Voltage" value={onu?.voltage_mv != null ? `${(onu.voltage_mv / 1000).toFixed(2)} V` : 'â€”'} mono/>
        </div>

        {/* Active Router MACs */}
        <div style={{ marginTop: 12, background: C.bg0, borderRadius: 7, border: `1px solid ${routerMac ? C.border : C.yellow + '50'}`, padding: '9px 11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Active Router MACs</div>
            <span style={{ fontSize: 9, fontWeight: 700, color: routerMac ? C.green : C.yellow, background: routerMac ? C.green + '12' : C.yellow + '15', border: `1px solid ${routerMac ? C.green + '30' : C.yellow + '40'}`, borderRadius: 4, padding: '1px 6px' }}>
              {routerMac ? '1 found' : 'âš  0 MACs'}
            </span>
          </div>
          {routerMac ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0 }}/>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.textSecond }}>{routerMac}</span>
              <span style={{ fontSize: 9, color: C.textMuted }}>Primary{cust.router_model ? ` Â· ${cust.router_model}` : ''}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.yellow, lineHeight: 1.5 }}>No router MACs detected â€” customer router may be unplugged or misconfigured.</div>
          )}
        </div>

        {/* Live session */}
        <div style={{ marginTop: 10, background: C.bg0, borderRadius: 7, border: `1px solid ${C.accent}30`, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>â—‰ Live Session</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
            <div>
              <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 2 }}>Connection</div>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{cust.connection_status || 'â€”'}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 2 }}>WAN / Framed IP</div>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.green }}>{cust.framed_ip || 'â€”'}</div>
            </div>
            <div style={{ gridColumn: '1/-1', marginTop: 4 }}>
              <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 2 }}>Last Seen Online</div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.textSecond }}>{timeAgo(cust.last_seen_online)}</div>
            </div>
          </div>
        </div>

        {/* Binding confidence */}
        <div style={{ marginTop: 10, padding: '9px 11px', background: C.bg0, borderRadius: 7, border: `1px solid ${confident ? C.green + '40' : C.yellow + '40'}` }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Binding Confidence</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Pill label={dna.binding?.confidence?.toUpperCase() || 'UNKNOWN'} color={confident ? C.green : C.yellow}/>
            <span style={{ fontSize: 11, color: C.textSecond }}>{dna.binding?.binding_source || 'No binding'}</span>
          </div>
        </div>

        {/* Data provenance */}
        <div style={{ marginTop: 10, background: C.bg0, borderRadius: 7, border: `1px solid ${C.border}`, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>Field Provenance</div>
          {dna.provenance?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {dna.provenance.slice(0, 6).map((item) => (
                <div key={item.field_name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ color: C.textSecond, fontFamily: MONO }}>{item.field_name}</span>
                    <span style={{ color: C.textMuted }}> Â· {item.source}</span>
                  </div>
                  <div style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(item.updated_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.textMuted }}>No field provenance recorded yet.</div>
          )}
        </div>

        {/* Change audit */}
        <div style={{ marginTop: 10, background: C.bg0, borderRadius: 7, border: `1px solid ${C.border}`, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 7 }}>Recent Changes</div>
          {dna.audit_log?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {dna.audit_log.slice(0, 8).map((item) => (
                <div key={item.id} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, marginBottom: 3 }}>
                    <span style={{ color: C.textSecond, fontWeight: 700 }}>{item.action || 'UPDATE'}{item.field_name ? ` / ${auditLabel(item.field_name)}` : ''}</span>
                    <span style={{ color: C.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(item.changed_at)}</span>
                  </div>
                  {item.field_name && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center', fontSize: 10, fontFamily: MONO }}>
                      <span style={{ color: C.red, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatAuditValue(item.field_name, item.old_value)}</span>
                      <span style={{ color: C.textMuted }}>to</span>
                      <span style={{ color: C.green, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatAuditValue(item.field_name, item.new_value)}</span>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>by {item.changed_by || 'System'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: C.textMuted }}>No customer changes recorded yet.</div>
          )}
        </div>

        {/* Topology */}
        <div style={{ marginTop: 10, background: C.bg0, borderRadius: 7, border: `1px solid ${C.border}`, padding: '10px 12px' }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Topology</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 9, color: C.textSecond, textAlign: 'center', lineHeight: 1.4 }}>
              <div style={{ color: C.accent, fontWeight: 700 }}>OLT</div>
              <div style={{ fontFamily: MONO }}>{oltIp}</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 8, color: C.textMuted, marginBottom: 1 }}>PON {ponPort}</div>
              <div style={{ width: '100%', height: 1, background: C.border, position: 'relative' }}>
                <div style={{ position: 'absolute', left: '50%', top: -3, width: 6, height: 6, borderRadius: '50%', background: C.border, transform: 'translateX(-50%)' }}/>
              </div>
            </div>
            <div style={{ background: C.bg2, border: `1px solid ${C.green}50`, borderRadius: 5, padding: '5px 8px', fontSize: 9, color: C.textSecond, textAlign: 'center', lineHeight: 1.4 }}>
              <div style={{ color: C.green, fontWeight: 700 }}>ONU {onuIndex != null ? `#${onuIndex}` : ''}</div>
              <div style={{ fontFamily: MONO }}>{model}</div>
            </div>
            <div style={{ flex: 1, height: 1, background: C.border }}/>
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 9, color: C.textSecond, textAlign: 'center', lineHeight: 1.4 }}>
              <div style={{ color: C.textSecond, fontWeight: 700 }}>Customer</div>
              <div style={{ color: C.textMuted }}>CPE</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// â”€â”€ S5 â€” Support & Field History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function S5({ dna, apiBase, onTicketCreated }: { dna: CustomerDNA; apiBase: string; onTicketCreated: () => void }) {
  const cust = dna.customer;
  const stickerData = cust.ont_sticker_data as Record<string, unknown> | null | undefined;
  const stickerPhotoFromData = typeof stickerData?.photoUrl === 'string'
    ? stickerData.photoUrl
    : (typeof stickerData?.photo_url === 'string' ? stickerData.photo_url : null);
  const sticker = mediaUrl(cust.sticker_photo_url || dna.binding?.sticker_photo_url || stickerPhotoFromData || null, apiBase);
  const installPic = mediaUrl(cust.install_photo_url, apiBase);
  const [showModal, setShowModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [type, setType] = useState('Slow speed');
  const [priority, setPriority] = useState('Medium');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openTickets = dna.tickets.filter(t => t.status?.toLowerCase() === 'open');

  const issueTypeMap: Record<string, string> = {
    'Slow speed': 'slow_speed', 'No internet': 'internet_down',
    'OTT buffering': 'other', 'Device offline': 'onu_offline',
    'Billing dispute': 'billing', 'Line fault': 'fiber_issue',
  };

  const handleSubmit = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await client.post('/tickets/', {
        customer_id: cust.username,
        issue_type: issueTypeMap[type] || 'other',
        description: notes || type,
        priority,
        tags: 'noc_manual',
      });
      setSubmitted(true); onTicketCreated();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setCreateError(typeof detail === 'string' ? detail : 'Could not create the complaint. Check backend/API status and try again.');
    }
    setCreating(false);
  };

  // Survey sticker data check
  const stickerMac = typeof stickerData?.mac_address === 'string'
    ? stickerData.mac_address
    : (typeof stickerData?.mac === 'string' ? stickerData.mac : null);
  const onuMac = dna.onu?.mac_address || cust.mac_address || null;
  const macMismatch = stickerMac && onuMac && stickerMac.toUpperCase().replace(/[^A-F0-9]/g,'') !== onuMac.toUpperCase().replace(/[^A-F0-9]/g,'');

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CardHeader
        title="Section 5 â€” Support & Field History"
        action={
          <IconBtn
            icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
            label="Raise Complaint" variant="primary"
            onClick={() => { setShowModal(true); setSubmitted(false); setNotes(''); setCreateError(null); }}
          />
        }
      />
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Open tickets indicator */}
        {openTickets.length > 0 ? (
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {openTickets.map(t => <AlertBadge key={t.id} label={`#${t.id} ${t.issue_type || 'Open Ticket'}`}/>)}
          </div>
        ) : (
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 11, color: C.green }}>âœ“</span>
            <span style={{ fontSize: 11, color: C.textMuted }}>No open tickets</span>
          </div>
        )}

        {/* History table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: C.bg1 }}>
                {['Date', 'Issue', 'Status', 'Description', 'Tech'].map(h => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: C.textMuted, fontWeight: 600, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dna.tickets.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '16px 12px', color: C.textMuted, fontSize: 11, textAlign: 'center' }}>No ticket history</td></tr>
              ) : dna.tickets.map(row => (
                <tr key={row.id} style={{ borderBottom: `1px solid ${C.border}20` }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.bg3 + '80')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '7px 12px', color: C.textMuted, whiteSpace: 'nowrap', fontFamily: MONO }}>{fmtDate(row.created_at)}</td>
                  <td style={{ padding: '7px 12px', color: C.textPrimary }}>{row.issue_type || 'Support'}</td>
                  <td style={{ padding: '7px 12px' }}><Pill label={row.status?.toUpperCase() || '?'} color={row.status?.toLowerCase() === 'open' ? C.yellow : row.status?.toLowerCase() === 'closed' ? C.green : C.textSecond}/></td>
                  <td style={{ padding: '7px 12px', color: C.textSecond, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.description || 'â€”'}</td>
                  <td style={{ padding: '7px 12px', color: C.textMuted, whiteSpace: 'nowrap' }}>{row.assigned_tech || 'â€”'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Survey proof */}
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.border}`, marginTop: 'auto' }}>
          <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Survey & Installation Proof</div>
          {macMismatch && (
            <div style={{ marginBottom: 8, padding: '6px 10px', background: C.orange + '12', border: `1px solid ${C.orange}40`, borderRadius: 6, fontSize: 10, color: C.orange }}>
              âš  Sticker MAC <span style={{ fontFamily: MONO }}>{stickerMac}</span> doesn't match ONU MAC <span style={{ fontFamily: MONO }}>{onuMac}</span> â€” verify field survey
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 2 }}>Collected by</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecond }}>{dna.survey?.collector_name || 'Not surveyed'}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>{fmtDate(cust.last_surveyed_at || dna.survey?.completed_at || null)}</div>
            </div>
            {([['ONT Sticker', sticker], ['Install Photo', installPic]] as [string, string | null][]).map(([label, url]) => (
              <div key={label}
                onClick={() => url && window.open(url, '_blank')}
                onMouseEnter={e => url && (e.currentTarget.style.borderColor = C.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                style={{ width: url ? 86 : 72, height: 56, background: C.bg0, border: `1px dashed ${C.border}`, borderRadius: 6, overflow: 'hidden', cursor: url ? 'pointer' : 'default', flexShrink: 0, transition: 'border-color 0.15s' }}>
                {url
                  ? <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
                  : <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      <span style={{ fontSize: 8, color: C.textMuted, textAlign: 'center' }}>{label}</span>
                    </div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Complaint Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          {submitted ? (
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 36, textAlign: 'center', animation: 'fadeUp 0.25s ease' }}>
              <div style={{ fontSize: 36, marginBottom: 12, color: C.green }}>âœ“</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.green, marginBottom: 6 }}>Complaint Raised</div>
              <div style={{ fontSize: 13, color: C.textSecond, marginBottom: 22 }}>Ticket created. It will appear in the technician app as an open field job.</div>
              <IconBtn label="Close" onClick={() => setShowModal(false)}/>
            </div>
          ) : (
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 26, width: 400, animation: 'fadeUp 0.2s ease' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Raise New Complaint</span>
                <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 16 }}>âœ•</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 5 }}>Issue Type</div>
                  <select value={type} onChange={e => setType(e.target.value)} style={{ width: '100%', background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 9px', color: C.textPrimary, fontSize: 12, fontFamily: 'Inter, sans-serif', outline: 'none' }}>
                    {['Slow speed', 'No internet', 'OTT buffering', 'Device offline', 'Billing dispute', 'Line fault'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 5 }}>Priority</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['Low', 'Medium', 'High'] as const).map(p => {
                      const pc = p === 'High' ? C.red : p === 'Medium' ? C.yellow : C.green;
                      const sel = priority === p;
                      return <button key={p} onClick={() => setPriority(p)} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: `1px solid ${sel ? pc : C.border}`, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, background: sel ? pc + '18' : 'transparent', color: sel ? pc : C.textMuted, transition: 'all 0.12s' }}>{p}</button>;
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 5 }}>Notes</div>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Describe the issueâ€¦" style={{ width: '100%', background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 9px', color: C.textPrimary, fontSize: 12, fontFamily: 'Inter, sans-serif', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}/>
                </div>
                {createError && (
                  <div style={{ background: C.red + '12', border: `1px solid ${C.red}55`, borderRadius: 7, padding: '8px 10px', color: C.red, fontSize: 11, lineHeight: 1.45 }}>
                    {createError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <IconBtn label="Cancel" onClick={() => setShowModal(false)}/>
                  <IconBtn label={creating ? 'Creatingâ€¦' : 'Submit'} variant="primary" disabled={creating} onClick={handleSubmit}/>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// â”€â”€ S6 â€” Session & Billing History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function S6({ dna }: { dna: CustomerDNA }) {
  const cust = dna.customer;
  const routerMac = cust.router_mac_address;
  // Session data lives in Railwire portal â€” not synced to our DB yet
  // Show what we know: framed_ip, last_seen_online, connection_status

  const knownSessions = [
    { label: 'Current WAN IP', value: cust.framed_ip, mono: true, color: C.green },
    { label: 'Connection Status', value: cust.connection_status, mono: false, color: cust.connection_status?.toLowerCase() === 'active' ? C.green : C.textSecond },
    { label: 'Last Seen Online', value: timeAgo(cust.last_seen_online), mono: false, color: C.textSecond },
    { label: 'Router MAC', value: routerMac, mono: true, color: C.textSecond },
  ].filter(r => r.value);

  return (
    <Card>
      <CardHeader title="Section 6 â€” Railwire Session History" sub="PPPoE billing sessions from Railwire portal"/>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ padding: '10px 14px', background: C.bg0, borderRadius: 8, border: `1px solid ${C.border}`, marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
          <div style={{ fontSize: 11, color: C.textSecond, lineHeight: 1.6 }}>
            Full session history (PPPoE sessions, upload/download per session, IP history) is stored in the <strong style={{ color: C.textPrimary }}>Railwire billing portal</strong> and requires integration with the scraper sync module. Currently showing live session data from our SNMP poller.
            {routerMac && <div style={{ marginTop: 4, fontSize: 10, color: C.textMuted }}>Router MAC for Railwire lookup: <span style={{ fontFamily: MONO, color: C.cyan }}>{routerMac}</span></div>}
          </div>
        </div>

        {knownSessions.length > 0 && (
          <>
            <div style={{ fontSize: 9, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Current Session (Live)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {knownSessions.map(s => (
                <div key={s.label} style={{ background: C.bg0, borderRadius: 6, padding: '9px 12px', border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontFamily: s.mono ? MONO : 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Data age note */}
        {dna.onu?.polled_at && (
          <div style={{ marginTop: 12, fontSize: 10, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ONU data last polled: {fmtDT(dna.onu.polled_at)} ({timeAgo(dna.onu.polled_at)})
          </div>
        )}
      </div>
    </Card>
  );
}

// â”€â”€ Main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function CustomerDNAPage() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const API_BASE = import.meta.env.VITE_API_URL || '';

  const [dna, setDna] = useState<CustomerDNA | null>(null);
  const [history, setHistory] = useState<SignalPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((user: string) => {
    setLoading(true); setError('');
    fetchCustomerDNA(decodeURIComponent(user))
      .then(data => {
        setDna(data);
        const mac = data.onu?.mac_address || data.binding?.mac_address || null;
        if (mac) fetchSignalHistory(mac, 6).then(setHistory).catch(() => {});
      })
      .catch(err => setError(err?.response?.data?.detail || 'Customer not found'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (username) load(username); }, [username, load]);

  useEffect(() => {
    if (!dna) return;
    const focusStatus = dna.onu?.stale
      ? `last known ${dna.onu.status || 'unknown'}`
      : (dna.onu?.status || dna.customer.status);
    setNocFocus({ kind: dna.onu ? 'onu' : 'customer', label: dna.customer.name || dna.customer.username, subtitle: [dna.customer.phone, dna.onu?.pon_port].filter(Boolean).join(' | ') || null, customerUsername: dna.customer.username, macAddress: dna.onu?.mac_address || dna.customer.mac_address, status: focusStatus, targetUrl: `/customers/${encodeURIComponent(dna.customer.username)}`, source: 'customer_dna' });
  }, [dna]);

  const handleRefresh = async () => {
    if (!dna?.onu?.mac_address || refreshing) return;
    setRefreshing(true);
    try {
      await client.post(`/noc/onus/${encodeURIComponent(dna.onu.mac_address)}/refresh`);
      if (username) load(username);
    } finally { setRefreshing(false); }
  };

  const handleReboot = async () => {
    if (!dna?.onu?.mac_address) return;
    await rebootONU(dna.onu.mac_address);
  };

  if (loading) {
    return (
      <div style={{ background: C.bg1, padding: '20px 0', minHeight: '100%' }}>
        <style>{`@keyframes shimmer { 0%{opacity:0.4} 50%{opacity:0.7} 100%{opacity:0.4} }`}</style>
        {[72, 340, 340, 180].map((h, i) => <div key={i} style={{ height: h, background: C.bg2, borderRadius: 10, margin: '0 0 16px', animation: 'shimmer 1.5s ease infinite' }}/>)}
      </div>
    );
  }

  if (error || !dna) {
    return (
      <div style={{ background: C.bg1, minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 }}>
        <div style={{ fontSize: 15, color: C.textPrimary }}>{error || 'Customer not found'}</div>
        <button onClick={() => navigate('/customers')} style={{ padding: '8px 20px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg3, color: C.textSecond, cursor: 'pointer', fontSize: 13 }}>Back to Customers</button>
      </div>
    );
  }

  const diagDays = buildDiagTimeline(dna.alarms);
  const isActive = dna.customer.status?.toLowerCase() === 'active';

  return (
    <div style={{ background: C.bg1, minHeight: '100%', marginTop: -20, marginLeft: -20, marginRight: -20, padding: 20 }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        @keyframes pulse-glow-green { 0%,100%{box-shadow:0 0 8px #22c55e80;} 50%{box-shadow:0 0 20px #22c55ecc;} }
        @keyframes pulse-glow-red { 0%,100%{box-shadow:0 0 8px #ef444480;} 50%{box-shadow:0 0 20px #ef4444cc;} }
        .cdna-page * { box-sizing: border-box; }
        .cdna-page input, .cdna-page select, .cdna-page textarea { color-scheme: dark; }
      `}</style>

      <div className="cdna-page" style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'Inter, sans-serif' }}>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textMuted }}>
          <button onClick={() => navigate('/customers')} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 11, padding: 0 }}>Support</button>
          <span>â€º</span><span style={{ color: C.textSecond }}>Customer Profile</span>
          <span>â€º</span><span style={{ color: C.textPrimary, fontWeight: 600 }}>{dna.customer.name || dna.customer.username}</span>
          <span style={{ marginLeft: 6 }}><Pill label={dna.customer.status?.toUpperCase() || '?'} color={isActive ? C.green : C.red}/></span>
        </div>

        {/* S1 â€” full-width header */}
        <S1 dna={dna}/>

        {/* Row 1: S2 left | S3 right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <S2 dna={dna} diagDays={diagDays} onReboot={handleReboot}/>
          <S3 dna={dna} history={history} onRefresh={handleRefresh} refreshing={refreshing}/>
        </div>

        {/* Row 2: S4 left | S5 right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <S4 dna={dna}/>
          <S5 dna={dna} apiBase={API_BASE} onTicketCreated={() => { if (username) load(username); }}/>
        </div>

        {/* S6 â€” full-width session data */}
        <S6 dna={dna}/>
      </div>
    </div>
  );
}
