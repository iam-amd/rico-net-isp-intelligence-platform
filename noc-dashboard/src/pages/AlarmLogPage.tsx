import { useCallback, useEffect, useState } from 'react';
import type { AlarmItem } from '../types/noc';
import { acknowledgeAlarm, fetchAlarms, linkAlarmToOutage, resolveAlarm, suppressAlarm } from '../api/noc';
import { formatMac, timeAgo } from '../utils/signal';

const ALARM_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  DYING_GASP:       { label: 'Power Cut',      color: 'text-purple-400', bg: 'bg-purple-500/20' },
  FIBER_CRITICAL:   { label: 'Fiber Critical', color: 'text-red-400',    bg: 'bg-red-500/20' },
  FIBER_WEAK:       { label: 'Fiber Weak',     color: 'text-orange-400', bg: 'bg-orange-500/20' },
  ONU_OFFLINE:      { label: 'ONU Offline',    color: 'text-slate-400',  bg: 'bg-slate-500/20' },
  ONU_OFFLINE_GPON: { label: 'ONU Offline',    color: 'text-slate-400',  bg: 'bg-slate-500/20' },
  FIBER_FLAP:       { label: 'Fiber Flapping', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  HIGH_TEMP:        { label: 'High Temp',      color: 'text-orange-400', bg: 'bg-orange-500/20' },
};

function alarmBadge(eventType: string) {
  return ALARM_LABELS[eventType.toUpperCase()] ?? {
    label: eventType.replace(/_/g, ' '),
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
  };
}

function oltLabel(host: string | null) {
  if (!host) return '-';
  const last = host.split('.').pop();
  if (last === '100') return 'EPON .100';
  if (last === '200') return 'GPON .200';
  if (last === '210') return 'GPON .210';
  return host;
}

export default function AlarmLogPage() {
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState('');
  const [hours, setHours] = useState(24);
  const [statusFilter, setStatusFilter] = useState('open');
  const [actionId, setActionId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const PAGE_SIZE = 50;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAlarms({
        page,
        page_size: PAGE_SIZE,
        event_type: eventType || undefined,
        hours: hours || undefined,
        status: statusFilter,
      });
      setAlarms(data.alarms);
      setTotal(data.total);
      setError('');
    } catch {
      setError('Failed to load alarms');
    } finally {
      setLoading(false);
    }
  }, [page, eventType, hours, statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [eventType, hours, statusFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const runAction = async (alarm: AlarmItem, action: 'ack' | 'suppress' | 'resolve' | 'link') => {
    setActionId(alarm.id);
    setError('');
    try {
      if (action === 'ack') {
        const note = window.prompt('Acknowledge note', alarm.operator_note || '');
        if (note === null) return;
        await acknowledgeAlarm(alarm.id, { note });
      } else if (action === 'suppress') {
        const reason = window.prompt('Suppress reason', 'planned maintenance');
        if (reason === null) return;
        const hoursText = window.prompt('Suppress for how many hours?', '2');
        if (hoursText === null) return;
        const hoursValue = Number(hoursText);
        if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
          setError('Suppress hours must be a positive number');
          return;
        }
        await suppressAlarm(alarm.id, {
          reason,
          suppressed_until: new Date(Date.now() + hoursValue * 3600 * 1000).toISOString(),
        });
      } else if (action === 'resolve') {
        const reason = window.prompt('Resolve reason', 'verified restored');
        if (reason === null) return;
        await resolveAlarm(alarm.id, { reason });
      } else {
        const outageType = window.prompt('Outage type: pon_port or area', 'pon_port');
        if (outageType === null) return;
        const outageIdText = window.prompt('Outage ID');
        if (outageIdText === null) return;
        const outageId = Number(outageIdText);
        if (!Number.isInteger(outageId) || outageId <= 0) {
          setError('Outage ID must be a positive number');
          return;
        }
        const note = window.prompt('Link note', '');
        if (note === null) return;
        await linkAlarmToOutage(alarm.id, { outage_type: outageType, outage_id: outageId, note });
      }
      await refresh();
    } catch {
      setError(`Could not ${action} alarm #${alarm.id}`);
    } finally {
      setActionId(null);
    }
  };

  // Summary counts by type
  const typeCounts: Record<string, number> = {};
  for (const a of alarms) {
    typeCounts[a.event_type] = (typeCounts[a.event_type] || 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-slate-200">Alarm Log</h1>

        {/* Type filter */}
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200"
        >
          <option value="">All Types</option>
          <option value="DYING_GASP">⚡ Power Cut (Dying Gasp)</option>
          <option value="FIBER_CRITICAL">🔴 Fiber Critical</option>
          <option value="FIBER_WEAK">🟠 Fiber Weak</option>
          <option value="ONU_OFFLINE">⬛ ONU Offline</option>
          <option value="FIBER_FLAP">🟡 Fiber Flapping</option>
          <option value="HIGH_TEMP">🌡 High Temp</option>
        </select>

        {/* Time window */}
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200"
        >
          <option value={1}>Last 1h</option>
          <option value={6}>Last 6h</option>
          <option value={24}>Last 24h</option>
          <option value={72}>Last 3d</option>
          <option value={168}>Last 7d</option>
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200"
        >
          <option value="open">Open Only</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>

        <span className="text-xs text-slate-500 ml-auto">{total} alarms</span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/20 px-4 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Type breakdown pills */}
      {Object.keys(typeCounts).length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(typeCounts).map(([t, n]) => {
            const b = alarmBadge(t);
            return (
              <button
                key={t}
                onClick={() => setEventType(eventType === t ? '' : t)}
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                  eventType === t
                    ? `${b.bg} ${b.color} border-current`
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
                }`}
              >
                {b.label} ({n})
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700/50">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Count</th>
              <th className="px-4 py-2.5 font-medium">MAC</th>
              <th className="px-4 py-2.5 font-medium">OLT / Port</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="px-4 py-3">
                    <div className="h-4 bg-slate-700 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : alarms.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No alarms found
                </td>
              </tr>
            ) : (
              alarms.map((a) => {
                const badge = alarmBadge(a.event_type);
                const isResolved = a.status === 'resolved';
                return (
                  <tr key={a.id} className={`hover:bg-slate-700/30 transition-colors ${isResolved ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{timeAgo(a.received_at)}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-300 font-mono">
                      {a.occurrence_count && a.occurrence_count > 1 ? (
                        <span className="bg-slate-700 px-1.5 py-0.5 rounded">×{a.occurrence_count}</span>
                      ) : '1'}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-200">{formatMac(a.mac_address)}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {oltLabel(a.olt_host)}
                      {a.pon_port && <span className="ml-1 text-slate-500">port {a.pon_port}</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-300">{a.customer_name || '-'}</td>
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        isResolved ? 'bg-green-500/10 text-green-500'
                        : a.status === 'suppressed' ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-red-500/10 text-red-400'
                      }`}>
                        {a.status || 'open'}
                      </span>
                      {a.acknowledged_at && <div className="mt-1 text-[10px] text-slate-500">ack {timeAgo(a.acknowledged_at)}</div>}
                      {a.suppressed_until && <div className="mt-1 text-[10px] text-amber-400">until {timeAgo(a.suppressed_until)}</div>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => runAction(a, 'ack')}
                          disabled={actionId === a.id || isResolved}
                          className="rounded border border-slate-600 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                        >
                          Ack
                        </button>
                        <button
                          onClick={() => runAction(a, 'suppress')}
                          disabled={actionId === a.id || isResolved}
                          className="rounded border border-amber-600/50 px-2 py-1 text-[10px] font-semibold text-amber-300 hover:bg-amber-950/30 disabled:opacity-40"
                        >
                          Suppress
                        </button>
                        <button
                          onClick={() => runAction(a, 'resolve')}
                          disabled={actionId === a.id || isResolved}
                          className="rounded border border-green-600/50 px-2 py-1 text-[10px] font-semibold text-green-300 hover:bg-green-950/30 disabled:opacity-40"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => runAction(a, 'link')}
                          disabled={actionId === a.id || isResolved}
                          className="rounded border border-blue-600/50 px-2 py-1 text-[10px] font-semibold text-blue-300 hover:bg-blue-950/30 disabled:opacity-40"
                        >
                          Link
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-700/50 flex justify-between items-center">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="text-xs px-3 py-1 bg-slate-700 rounded disabled:opacity-30 hover:bg-slate-600 text-slate-200"
            >
              Prev
            </button>
            <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="text-xs px-3 py-1 bg-slate-700 rounded disabled:opacity-30 hover:bg-slate-600 text-slate-200"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
