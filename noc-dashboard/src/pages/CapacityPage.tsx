import { useState, useEffect } from 'react';
import { fetchCapacityPlanning } from '../api/noc';
import type { CapacityPlanningData, PortCapacity } from '../types/noc';

function UtilBar({ pct, size = 'md' }: { pct: number; size?: 'sm' | 'md' | 'lg' }) {
  const color =
    pct >= 90 ? 'bg-red-500' :
    pct >= 75 ? 'bg-amber-500' :
    pct >= 50 ? 'bg-blue-500' :
    'bg-emerald-500';

  const h = size === 'lg' ? 'h-6' : size === 'md' ? 'h-4' : 'h-2.5';

  return (
    <div className={`w-full ${h} bg-slate-700/50 rounded-full overflow-hidden`}>
      <div
        className={`${h} ${color} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function SignalBar({ dist }: { dist: PortCapacity['signal_distribution'] }) {
  const total = dist.excellent + dist.good + dist.weak + dist.critical;
  if (!total) return <span className="text-slate-500 text-xs">No data</span>;

  const segments = [
    { count: dist.excellent, color: 'bg-emerald-500', label: 'Excellent' },
    { count: dist.good, color: 'bg-yellow-500', label: 'Good' },
    { count: dist.weak, color: 'bg-orange-500', label: 'Weak' },
    { count: dist.critical, color: 'bg-red-500', label: 'Critical' },
  ];

  return (
    <div className="flex h-3 rounded-full overflow-hidden w-full" title={
      segments.map(s => `${s.label}: ${s.count}`).join(', ')
    }>
      {segments.map((seg, i) =>
        seg.count > 0 ? (
          <div
            key={i}
            className={`${seg.color} transition-all`}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        ) : null
      )}
    </div>
  );
}

function AlertBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
    WARNING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    SIGNAL: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold border ${styles[type] || 'bg-slate-700 text-slate-300'}`}>
      {type}
    </span>
  );
}

function KPICard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function CapacityPage() {
  const [data, setData] = useState<CapacityPlanningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await fetchCapacityPlanning();
        if (!cancelled) setData(result);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-400 animate-pulse">Loading capacity data...</div>
    </div>
  );

  if (error || !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-red-400">Error: {error || 'No data'}</div>
    </div>
  );

  const { summary, ports, signal_distribution: sd, growth_trend, alerts } = data;

  const utilizationColor =
    summary.overall_utilization_pct >= 90 ? 'text-red-400' :
    summary.overall_utilization_pct >= 75 ? 'text-amber-400' :
    'text-emerald-400';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Capacity Planning</h1>
        <p className="text-sm text-slate-400 mt-1">
          {summary.total_olts} OLT{summary.total_olts > 1 ? 's' : ''} · {summary.total_ports} PON ports · {summary.total_onus} ONUs deployed
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <KPICard
          label="Overall Utilization"
          value={`${summary.overall_utilization_pct}%`}
          sub={`${summary.total_onus} / ${summary.total_capacity}`}
          color={utilizationColor}
        />
        <KPICard
          label="Active Ports"
          value={`${summary.total_ports}`}
          sub={`${ports.filter(p => p.utilization_pct >= 75).length} at 75%+`}
        />
        <KPICard
          label="Excellent Signal"
          value={`${sd.excellent}`}
          sub={`${Math.round((sd.excellent / (sd.excellent + sd.good + sd.weak + sd.critical || 1)) * 100)}% of monitored`}
          color="text-emerald-400"
        />
        <KPICard
          label="Good Signal"
          value={`${sd.good}`}
          color="text-yellow-400"
        />
        <KPICard
          label="Weak Signal"
          value={`${sd.weak}`}
          sub="Needs maintenance"
          color="text-orange-400"
        />
        <KPICard
          label="Critical Signal"
          value={`${sd.critical}`}
          sub="Dispatch required"
          color="text-red-400"
        />
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">
            Capacity Alerts ({alerts.length})
          </h2>
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <AlertBadge type={a.type} />
                <span className="text-slate-300">{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Port Grid */}
      <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-4">
          PON Port Utilization
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {ports.map((port) => {
            const pctColor =
              port.utilization_pct >= 90 ? 'text-red-400' :
              port.utilization_pct >= 75 ? 'text-amber-400' :
              'text-emerald-400';

            return (
              <div key={`${port.olt_host}-${port.pon_port}`}
                className="bg-slate-900/50 rounded-lg border border-slate-700/30 p-4">
                {/* Port header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <span className="text-white font-mono font-semibold text-sm">
                      {port.pon_port}
                    </span>
                    <span className="text-slate-500 text-xs ml-2">{port.olt_host}</span>
                  </div>
                  <span className={`text-lg font-bold ${pctColor}`}>
                    {port.utilization_pct}%
                  </span>
                </div>

                {/* Utilization bar */}
                <UtilBar pct={port.utilization_pct} size="lg" />

                {/* Stats row */}
                <div className="flex items-center justify-between mt-3 text-xs">
                  <span className="text-slate-400">
                    <span className="text-white font-semibold">{port.total_onus}</span>/{port.max_capacity} ONUs
                  </span>
                  <span className="text-slate-400">
                    <span className="text-emerald-400">{port.online}</span> online ·{' '}
                    <span className="text-red-400">{port.offline}</span> offline
                  </span>
                  <span className="text-slate-400">
                    Avg Rx: <span className="text-white">{port.avg_rx ?? '—'}</span> dBm
                  </span>
                </div>

                {/* Signal distribution bar */}
                <div className="mt-3">
                  <div className="text-xs text-slate-500 mb-1">Signal Quality</div>
                  <SignalBar dist={port.signal_distribution} />
                  <div className="flex justify-between mt-1 text-[10px] text-slate-500">
                    <span className="text-emerald-500">{port.signal_distribution.excellent}E</span>
                    <span className="text-yellow-500">{port.signal_distribution.good}G</span>
                    <span className="text-orange-500">{port.signal_distribution.weak}W</span>
                    <span className="text-red-500">{port.signal_distribution.critical}C</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom row: Growth Trend + Signal Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Growth Trend */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Growth Trend</h2>
          {growth_trend.length === 0 ? (
            <div className="text-slate-500 text-sm py-8 text-center">
              Collecting data... Trends appear after 2+ days of polling.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-4 text-xs text-slate-500 font-semibold pb-1 border-b border-slate-700/30">
                <span>Date</span>
                <span className="text-right">ONUs</span>
                <span className="text-right">Avg Rx</span>
                <span className="text-right">Uptime</span>
              </div>
              {growth_trend.map((g) => (
                <div key={g.date} className="grid grid-cols-4 text-sm">
                  <span className="text-slate-300">{g.date}</span>
                  <span className="text-right text-white font-semibold">{g.onu_count}</span>
                  <span className="text-right text-slate-400">{g.avg_rx ?? '—'} dBm</span>
                  <span className={`text-right font-medium ${
                    (g.avg_uptime ?? 0) >= 90 ? 'text-emerald-400' :
                    (g.avg_uptime ?? 0) >= 70 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {g.avg_uptime?.toFixed(1) ?? '—'}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Signal Distribution Donut (as stacked bars) */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Network Signal Distribution</h2>
          {(() => {
            const total = sd.excellent + sd.good + sd.weak + sd.critical + sd.no_signal;
            const segments = [
              { label: 'Excellent', sub: '> -20 dBm', count: sd.excellent, color: 'bg-emerald-500', text: 'text-emerald-400' },
              { label: 'Good', sub: '-20 to -24 dBm', count: sd.good, color: 'bg-yellow-500', text: 'text-yellow-400' },
              { label: 'Weak', sub: '-24 to -27 dBm', count: sd.weak, color: 'bg-orange-500', text: 'text-orange-400' },
              { label: 'Critical', sub: '< -27 dBm', count: sd.critical, color: 'bg-red-500', text: 'text-red-400' },
              { label: 'No Signal', sub: 'Offline/unknown', count: sd.no_signal, color: 'bg-slate-600', text: 'text-slate-400' },
            ];
            return (
              <div className="space-y-3">
                {segments.map((seg) => (
                  <div key={seg.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={seg.text}>
                        {seg.label} <span className="text-slate-500">{seg.sub}</span>
                      </span>
                      <span className="text-white font-semibold">
                        {seg.count} <span className="text-slate-500">({total ? Math.round((seg.count / total) * 100) : 0}%)</span>
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className={`h-2.5 ${seg.color} rounded-full transition-all duration-500`}
                        style={{ width: `${total ? (seg.count / total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
