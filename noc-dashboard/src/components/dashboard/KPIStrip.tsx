import type { NetworkSummary } from '../../types/noc';
import { formatDbm, timeAgo } from '../../utils/signal';

interface KPIStripProps {
  summary: NetworkSummary | null;
  loading: boolean;
}

interface KPICardProps {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
  pulse?: boolean;
  unit?: string;
  blocked?: boolean;
}

function KPICard({ label, value, color = '#f1f5f9', sub, pulse, unit, blocked }: KPICardProps) {
  return (
    <div className={`bg-slate-800/60 border rounded-xl p-3 flex flex-col gap-0.5 ${blocked ? 'border-red-500/30' : 'border-slate-700/50'}`}>
      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5">
        {pulse && <span className="w-2 h-2 rounded-full pulse-dot flex-shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-xl font-bold font-mono" style={{ color }}>{value}</span>
        {unit && <span className="text-xs text-slate-500 font-mono">{unit}</span>}
      </div>
      {sub && <span className={`text-[10px] ${blocked ? 'text-red-300/80' : 'text-slate-500'}`}>{sub}</span>}
    </div>
  );
}

export default function KPIStrip({ summary, loading }: KPIStripProps) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  const stale = summary.data_is_stale || summary.live_data_available === false;
  const staleLabel = summary.staleness_minutes > 60
    ? `${Math.round(summary.staleness_minutes / 60)}h ago`
    : `${Math.round(summary.staleness_minutes)}m ago`;
  const blockedSub = stale ? 'LAST KNOWN - not live' : undefined;

  return (
    <div className="space-y-2">
      {stale && (
        <div className="flex items-start gap-3 bg-red-950/80 border border-red-500/80 rounded-xl px-4 py-3 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]">
          <span className="text-red-300 text-xl leading-none">!</span>
          <div>
            <div className="text-red-200 font-black text-sm uppercase tracking-wide">Live OLT data incomplete</div>
            <div className="text-red-300/90 text-xs mt-0.5">
              Last complete OLT cycle was {staleLabel}. Some OLT data may be fresh, but whole-network numbers below are last-known and must not be used for live outage or dispatch decisions.
            </div>
            {summary.freshness_message && (
              <div className="text-red-200/70 text-[11px] mt-1">{summary.freshness_message}</div>
            )}
          </div>
          <span className="ml-auto text-red-300 text-xs font-mono border border-red-500/40 rounded px-2 py-1">BLOCKED LIVE MODE</span>
        </div>
      )}
      <div className={`grid grid-cols-3 lg:grid-cols-6 gap-2 ${stale ? 'opacity-50' : ''}`}>
        <KPICard
          label="Observed Online"
          value={summary.online}
          color={stale ? '#6b7280' : '#22c55e'}
          pulse={!stale}
          sub={blockedSub || `${summary.total_onus > 0 ? ((summary.online / summary.total_onus) * 100).toFixed(1) : 0}% of ${summary.total_onus}`}
          blocked={stale}
        />
        <KPICard
          label="Offline / Not Seen"
          value={summary.offline}
          color={stale ? '#6b7280' : summary.offline > 0 ? '#ef4444' : '#22c55e'}
          sub={blockedSub || (summary.offline > 0 ? `${((summary.offline / summary.total_onus) * 100).toFixed(1)}%` : 'All clear')}
          blocked={stale}
        />
        <KPICard
          label="Critical Signal"
          value={summary.critical_signal}
          color={stale ? '#6b7280' : summary.critical_signal > 0 ? '#ef4444' : '#22c55e'}
          sub={blockedSub || 'Rx < -27 dBm'}
          blocked={stale}
        />
        <KPICard
          label="Flapping"
          value={summary.flapping}
          color={stale ? '#6b7280' : summary.flapping > 0 ? '#f97316' : '#22c55e'}
          sub={blockedSub || '3+ flips / 24h'}
          blocked={stale}
        />
        <KPICard
          label="Alarms (24h)"
          value={summary.alarm_count_24h}
          color={stale ? '#6b7280' : summary.alarm_count_24h > 0 ? '#f97316' : '#22c55e'}
          sub={stale ? 'traps/polls stale' : `Last: ${timeAgo(summary.last_poll)}`}
          blocked={stale}
        />
        <KPICard
          label="Avg Rx Power"
          value={formatDbm(summary.avg_rx_power)}
          color={
            stale || summary.avg_rx_power == null ? '#6b7280'
            : summary.avg_rx_power >= -20 ? '#22c55e'
            : summary.avg_rx_power >= -24 ? '#eab308'
            : '#ef4444'
          }
          sub={blockedSub || `Worst: ${formatDbm(summary.worst_rx_power)}`}
          blocked={stale}
        />
      </div>
    </div>
  );
}
