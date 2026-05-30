import type { AlarmItem } from '../../types/noc';
import { useAlarms } from '../../hooks/useAlarms';
import { timeAgo, formatMac } from '../../utils/signal';

// Human-readable labels for NOC operators (no jargon)
const ALARM_META: Record<string, { label: string; icon: string; color: string; action: string }> = {
  DYING_GASP:       { label: 'Power Cut',       icon: '⚡', color: '#a855f7', action: 'Call customer — do NOT dispatch' },
  FIBER_CRITICAL:   { label: 'Fiber Critical',  icon: '🔴', color: '#ef4444', action: 'Dispatch with OTDR + fiber kit' },
  FIBER_WEAK:       { label: 'Fiber Weak',      icon: '🟠', color: '#f97316', action: 'Schedule maintenance 48h' },
  ONU_OFFLINE:      { label: 'ONU Offline',     icon: '⬛', color: '#6b7280', action: 'Try remote reboot first' },
  ONU_OFFLINE_GPON: { label: 'ONU Offline',     icon: '⬛', color: '#6b7280', action: 'Try remote reboot first' },
  FIBER_FLAP:       { label: 'Fiber Flapping',  icon: '🟡', color: '#eab308', action: 'Check splice/connector' },
  HIGH_TEMP:        { label: 'High Temp',       icon: '🌡', color: '#f97316', action: 'Check ONU ventilation' },
};

function alarmMeta(eventType: string) {
  return ALARM_META[eventType.toUpperCase()] ?? {
    label: eventType.replace(/_/g, ' '),
    icon: '🔔',
    color: '#eab308',
    action: '',
  };
}

// Group alarms into 3 NOC-relevant categories
function category(eventType: string): 'power' | 'fiber' | 'connectivity' {
  const t = eventType.toUpperCase();
  if (t.includes('DYING_GASP')) return 'power';
  if (t.includes('FIBER')) return 'fiber';
  return 'connectivity';
}

const CATEGORY_LABEL: Record<string, string> = {
  power:        '⚡ Power Cuts',
  fiber:        '🔴 Fiber Faults',
  connectivity: '⬛ Connectivity',
};

export default function AlarmFeed() {
  const { alarms, total, loading } = useAlarms();

  if (loading) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 h-64 animate-pulse" />
    );
  }

  // Group by category
  const grouped: Record<string, AlarmItem[]> = { power: [], fiber: [], connectivity: [] };
  for (const alarm of alarms) {
    grouped[category(alarm.event_type)].push(alarm);
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-700/50 flex justify-between items-center">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Active Alarms
        </h2>
        <span className="text-xs text-slate-500">{total} total</span>
      </div>

      {alarms.length === 0 ? (
        <div className="p-6 text-center text-slate-500 text-sm">No open alarms</div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {(['power', 'fiber', 'connectivity'] as const).map((cat) => {
            const items = grouped[cat];
            if (!items.length) return null;
            return (
              <div key={cat}>
                <div className="px-4 py-1.5 bg-slate-900/40 text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0">
                  {CATEGORY_LABEL[cat]}
                  <span className="ml-2 text-slate-500">({items.length})</span>
                </div>
                <div className="divide-y divide-slate-700/30">
                  {items.map((alarm) => (
                    <AlarmRow key={alarm.id} alarm={alarm} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlarmRow({ alarm }: { alarm: AlarmItem }) {
  const meta = alarmMeta(alarm.event_type);
  const isResolved = alarm.status === 'resolved';

  return (
    <div className={`px-4 py-2.5 flex items-start gap-3 hover:bg-slate-700/30 transition-colors ${isResolved ? 'opacity-50' : ''}`}>
      <span className="text-sm mt-0.5 shrink-0">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {alarm.occurrence_count && alarm.occurrence_count > 1 && (
            <span className="text-xs bg-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded">
              ×{alarm.occurrence_count}
            </span>
          )}
          {isResolved && (
            <span className="text-xs text-slate-500 bg-slate-700/40 px-1.5 py-0.5 rounded">resolved</span>
          )}
          {alarm.olt_host && (
            <span className="text-xs text-slate-500">
              {alarm.olt_host.split('.').slice(-1)[0] === '100' ? 'EPON'
                : alarm.olt_host.split('.').slice(-1)[0] === '200' ? 'GPON1'
                : alarm.olt_host.split('.').slice(-1)[0] === '210' ? 'GPON2'
                : alarm.olt_host} {alarm.pon_port}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400 truncate">
          {formatMac(alarm.mac_address)}
          {alarm.customer_name && (
            <span className="ml-1 text-slate-300 font-medium">— {alarm.customer_name}</span>
          )}
        </div>
        {meta.action && (
          <div className="text-xs text-slate-500 mt-0.5">{meta.action}</div>
        )}
      </div>
      <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">
        {timeAgo(alarm.received_at)}
      </span>
    </div>
  );
}
