import { useEffect, useState, useCallback } from 'react';
import { fetchNOCTickets } from '../../api/noc';
import type { NOCTicketItem } from '../../types/noc';
import { useNocFocus } from '../../state/nocFocus';

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: 'bg-red-500/20 text-red-400',
  High: 'bg-orange-500/20 text-orange-400',
  Normal: 'bg-yellow-500/20 text-yellow-400',
  Low: 'bg-slate-500/20 text-slate-400',
};

const FAULT_COLORS: Record<string, string> = {
  POWER_CUT: '#f59e0b',
  FIBER_CRITICAL: '#ef4444',
  FIBER_WEAK: '#f97316',
  FIBER_FLAP: '#f97316',
  ONU_OFFLINE: '#ef4444',
  ONLINE_CHECK_ROUTER: '#3b82f6',
};

function timeAgoShort(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function TicketPanel() {
  const { focus } = useNocFocus();
  const [tickets, setTickets] = useState<NOCTicketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchNOCTickets(10);
      setTickets(data.tickets);
      setTotal(data.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000); // 30s refresh
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Open Tickets</span>
        <span className="text-[10px] text-slate-500">{total} open</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-slate-800/40 rounded animate-pulse" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-slate-600 text-xs text-center py-4">No open tickets</div>
      ) : (
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {tickets.map(t => {
            const isFocused = Boolean(
              focus?.label
              && t.customer_name
              && t.customer_name.toLowerCase().includes(focus.label.toLowerCase())
            );
            return (
            <div key={t.id} className={`p-2 rounded-lg border hover:bg-white/[0.02] transition-colors cursor-pointer ${isFocused ? 'border-cyan-500/60 bg-cyan-950/20' : 'border-slate-700/30'}`}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-slate-500 font-mono">#{t.id} · {timeAgoShort(t.created_at)}</span>
                {t.priority && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.Normal}`}>
                    {t.priority.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="text-[11px] font-medium text-slate-200 truncate">
                {t.customer_name || 'Unknown Customer'}
              </div>
              {t.fault_type && (
                <div className="text-[10px] font-semibold" style={{ color: FAULT_COLORS[t.fault_type] || '#94a3b8' }}>
                  {t.fault_type}
                </div>
              )}
              {!t.fault_type && t.issue_type && (
                <div className="text-[10px] text-slate-500">{t.issue_type}</div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
