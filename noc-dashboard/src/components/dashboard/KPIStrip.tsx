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
}

function KPICard({ label, value, color = '#f1f5f9', sub, pulse, unit }: KPICardProps) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5">
        {pulse && <span className="w-2 h-2 rounded-full pulse-dot flex-shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-xl font-bold font-mono" style={{ color }}>{value}</span>
        {unit && <span className="text-xs text-slate-500 font-mono">{unit}</span>}
      </div>
      {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
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
  const demoSub = stale ? 'Synthetic demo feed' : undefined;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        <KPICard
          label="Observed Online"
          value={summary.online}
          color="#22c55e"
          pulse
          sub={demoSub || `${summary.total_onus > 0 ? ((summary.online / summary.total_onus) * 100).toFixed(1) : 0}% of ${summary.total_onus}`}
        />
        <KPICard
          label="Offline / Not Seen"
          value={summary.offline}
          color={summary.offline > 0 ? '#ef4444' : '#22c55e'}
          sub={demoSub || (summary.offline > 0 ? `${((summary.offline / summary.total_onus) * 100).toFixed(1)}%` : 'All clear')}
        />
        <KPICard
          label="Critical Signal"
          value={summary.critical_signal}
          color={summary.critical_signal > 0 ? '#ef4444' : '#22c55e'}
          sub="Rx < -27 dBm"
        />
        <KPICard
          label="Flapping"
          value={summary.flapping}
          color={summary.flapping > 0 ? '#f97316' : '#22c55e'}
          sub="3+ flips / 24h"
        />
        <KPICard
          label="Alarms (24h)"
          value={summary.alarm_count_24h}
          color={summary.alarm_count_24h > 0 ? '#f97316' : '#22c55e'}
          sub={stale ? 'Demo alarm feed' : `Last: ${timeAgo(summary.last_poll)}`}
        />
        <KPICard
          label="Avg Rx Power"
          value={formatDbm(summary.avg_rx_power)}
          color={
            summary.avg_rx_power == null ? '#6b7280'
            : summary.avg_rx_power >= -20 ? '#22c55e'
            : summary.avg_rx_power >= -24 ? '#eab308'
            : '#ef4444'
          }
          sub={`Worst: ${formatDbm(summary.worst_rx_power)}`}
        />
      </div>
    </div>
  );
}
