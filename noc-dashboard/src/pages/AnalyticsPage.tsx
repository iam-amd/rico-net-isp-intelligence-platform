import { useState, useEffect } from 'react';
import { fetchAnalytics } from '../api/noc';
import type { AnalyticsData } from '../types/noc';

function KPI({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function BarSegment({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-5 bg-slate-700/40 rounded-full overflow-hidden">
        <div className={`h-5 ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-12 text-right">{value.toLocaleString()}</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnalytics(days).then(r => {
      if (!cancelled) { setData(r); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-400 animate-pulse">Loading analytics...</div>
    </div>
  );

  if (!data) return (
    <div className="text-red-400 text-center mt-20">Failed to load analytics</div>
  );

  const { summary, alarm_by_type, alarm_trend, alarm_by_port, top_problem_onus, uptime_sla, worst_uptime_onus, signal_degradation } = data;
  const maxAlarmType = Math.max(...alarm_by_type.map(a => a.count), 1);
  const maxAlarmPort = Math.max(...alarm_by_port.map(a => a.count), 1);

  // Build alarm trend chart data
  const allEventTypes = [...new Set(alarm_by_type.map(a => a.event_type))];
  const eventColors: Record<string, string> = {
    ONU_OFFLINE: 'bg-orange-500',
    FIBER_CRITICAL: 'bg-red-500',
    SNMP_TRAP: 'bg-blue-500',
    FIBER_WEAK: 'bg-yellow-500',
  };
  const eventTextColors: Record<string, string> = {
    ONU_OFFLINE: 'text-orange-400',
    FIBER_CRITICAL: 'text-red-400',
    SNMP_TRAP: 'text-blue-400',
    FIBER_WEAK: 'text-yellow-400',
  };

  const uptimeColor = (v: number | null) => {
    if (v === null) return 'text-slate-500';
    if (v >= 95) return 'text-emerald-400';
    if (v >= 85) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Network Analytics</h1>
          <p className="text-sm text-slate-400 mt-1">
            {summary.total_alarms.toLocaleString()} alarms analyzed over {summary.days_analyzed} days
          </p>
        </div>
        <div className="flex gap-1 bg-slate-800/60 rounded-lg p-1 border border-slate-700/50">
          {[1, 3, 7].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                days === d
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI
          label="Total Alarms"
          value={summary.total_alarms.toLocaleString()}
          sub={`${summary.days_analyzed} day${summary.days_analyzed > 1 ? 's' : ''}`}
          color="text-amber-400"
        />
        <KPI
          label="Avg Uptime"
          value={summary.avg_network_uptime ? `${summary.avg_network_uptime}%` : 'N/A'}
          sub="Network-wide"
          color={uptimeColor(summary.avg_network_uptime)}
        />
        <KPI
          label="Problem ONUs"
          value={`${summary.problem_onu_count}`}
          sub="50+ alarms"
          color={summary.problem_onu_count > 10 ? 'text-red-400' : 'text-white'}
        />
        <KPI
          label="Signal Degrading"
          value={`${summary.degrading_onu_count}`}
          sub="Rx dropping"
          color={summary.degrading_onu_count > 5 ? 'text-orange-400' : 'text-white'}
        />
        <KPI
          label="Alarm Rate"
          value={summary.days_analyzed ? `${Math.round(summary.total_alarms / summary.days_analyzed)}/day` : '—'}
          sub="Average"
        />
      </div>

      {/* Row: Alarm by Type + Alarm by Port */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Alarm by Type */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Alarms by Type</h2>
          <div className="space-y-3">
            {alarm_by_type.map(a => (
              <div key={a.event_type}>
                <div className="flex justify-between text-xs mb-1">
                  <span className={eventTextColors[a.event_type] || 'text-slate-300'}>
                    {a.event_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-slate-400">
                    {Math.round((a.count / summary.total_alarms) * 100)}%
                  </span>
                </div>
                <BarSegment
                  value={a.count}
                  max={maxAlarmType}
                  color={eventColors[a.event_type] || 'bg-slate-500'}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Alarm by Port */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Alarms by PON Port</h2>
          <div className="space-y-3">
            {alarm_by_port.map(a => (
              <div key={a.pon_port}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 font-mono">{a.pon_port}</span>
                  <span className="text-slate-400">
                    {Math.round((a.count / summary.total_alarms) * 100)}%
                  </span>
                </div>
                <BarSegment
                  value={a.count}
                  max={maxAlarmPort}
                  color={a.count > maxAlarmPort * 0.5 ? 'bg-red-500' : 'bg-blue-500'}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alarm Trend (stacked daily) */}
      <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
        <h2 className="text-sm font-semibold text-white mb-3">Daily Alarm Trend</h2>
        {alarm_trend.length === 0 ? (
          <div className="text-slate-500 text-sm py-6 text-center">No trend data yet</div>
        ) : (
          <div className="space-y-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: '80px 1fr 60px' }}>
              {alarm_trend.map((day) => {
                const dateStr = day.date;
                const total = allEventTypes.reduce((s, t) => s + (day[t] || 0), 0);
                const maxDay = Math.max(...alarm_trend.map(d =>
                  allEventTypes.reduce((s, t) => s + (d[t] || 0), 0)
                ), 1);

                return (
                  <div key={dateStr} className="contents">
                    <span className="text-xs text-slate-400 self-center">{dateStr.slice(5)}</span>
                    <div className="flex h-5 rounded overflow-hidden bg-slate-700/30">
                      {allEventTypes.map(t => {
                        const v = day[t] || 0;
                        if (!v) return null;
                        return (
                          <div
                            key={t}
                            className={eventColors[t] || 'bg-slate-500'}
                            style={{ width: `${(v / maxDay) * 100}%` }}
                            title={`${t}: ${v}`}
                          />
                        );
                      })}
                    </div>
                    <span className="text-xs text-slate-300 text-right self-center">{total.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex gap-4 mt-2 pt-2 border-t border-slate-700/30">
              {allEventTypes.map(t => (
                <span key={t} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <span className={`w-2.5 h-2.5 rounded-sm ${eventColors[t] || 'bg-slate-500'}`} />
                  {t.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Row: Problem ONUs + Uptime SLA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Problem ONUs */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">
            Top Problem ONUs
            <span className="text-slate-500 font-normal ml-2">by alarm count</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-700/30">
                  <th className="text-left py-1.5 font-medium">ONU / Customer</th>
                  <th className="text-right py-1.5 font-medium">Alarms</th>
                  <th className="text-right py-1.5 font-medium">Port</th>
                  <th className="text-right py-1.5 font-medium">Rx</th>
                  <th className="text-center py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {top_problem_onus.slice(0, 10).map((o) => (
                  <tr key={o.mac_address} className="border-b border-slate-800/50 hover:bg-slate-700/20">
                    <td className="py-2">
                      <div className="text-slate-200 font-mono text-[11px]">{o.mac_address}</div>
                      {o.customer_name && (
                        <div className="text-slate-400">{o.customer_name}</div>
                      )}
                    </td>
                    <td className="text-right">
                      <span className={`font-bold ${o.alarm_count >= 1000 ? 'text-red-400' : o.alarm_count >= 500 ? 'text-orange-400' : 'text-yellow-400'}`}>
                        {o.alarm_count.toLocaleString()}
                      </span>
                    </td>
                    <td className="text-right text-slate-400 font-mono">{o.pon_port || '—'}</td>
                    <td className="text-right">
                      {o.rx_power_dbm !== null ? (
                        <span className={o.rx_power_dbm < -27 ? 'text-red-400' : o.rx_power_dbm < -24 ? 'text-orange-400' : 'text-slate-300'}>
                          {o.rx_power_dbm}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${o.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Uptime SLA */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Daily Uptime SLA</h2>
          {uptime_sla.length === 0 ? (
            <div className="text-slate-500 text-sm py-6 text-center">
              Collecting data... SLA metrics appear after 2+ days of polling.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-700/30">
                    <th className="text-left py-1.5 font-medium">Date</th>
                    <th className="text-right py-1.5 font-medium">Avg Uptime</th>
                    <th className="text-right py-1.5 font-medium">SLA 99%</th>
                    <th className="text-right py-1.5 font-medium">SLA 95%</th>
                    <th className="text-right py-1.5 font-medium">Avg Rx</th>
                    <th className="text-right py-1.5 font-medium">ONUs</th>
                  </tr>
                </thead>
                <tbody>
                  {uptime_sla.map(u => (
                    <tr key={u.date} className="border-b border-slate-800/50">
                      <td className="py-2 text-slate-300">{u.date}</td>
                      <td className={`text-right font-semibold ${uptimeColor(u.avg_uptime)}`}>
                        {u.avg_uptime?.toFixed(1) ?? '—'}%
                      </td>
                      <td className={`text-right ${uptimeColor(u.sla_99_pct)}`}>
                        {u.sla_99_pct.toFixed(1)}%
                      </td>
                      <td className={`text-right ${uptimeColor(u.sla_95_pct)}`}>
                        {u.sla_95_pct.toFixed(1)}%
                      </td>
                      <td className="text-right text-slate-400">{u.avg_rx ?? '—'} dBm</td>
                      <td className="text-right text-slate-400">{u.onu_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Row: Worst Uptime + Signal Degradation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Worst Uptime ONUs */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">
            Worst Uptime ONUs
            <span className="text-slate-500 font-normal ml-2">chronic offenders</span>
          </h2>
          {worst_uptime_onus.length === 0 ? (
            <div className="text-slate-500 text-sm py-6 text-center">Need 2+ days of data</div>
          ) : (
            <div className="space-y-2">
              {worst_uptime_onus.map(o => (
                <div key={o.mac_address}
                  className="flex items-center justify-between py-1.5 border-b border-slate-700/20 last:border-0">
                  <div>
                    <div className="text-xs text-slate-300 font-mono">{o.mac_address}</div>
                    {o.customer_name && <div className="text-[10px] text-slate-500">{o.customer_name}</div>}
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${o.avg_uptime < 10 ? 'text-red-400' : o.avg_uptime < 50 ? 'text-orange-400' : 'text-yellow-400'}`}>
                      {o.avg_uptime.toFixed(1)}%
                    </span>
                    <div className="text-[10px] text-slate-500">{o.days_tracked}d tracked</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Signal Degradation */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
          <h2 className="text-sm font-semibold text-white mb-3">
            Signal Degradation
            <span className="text-slate-500 font-normal ml-2">Rx power dropping</span>
          </h2>
          {signal_degradation.length === 0 ? (
            <div className="text-slate-500 text-sm py-6 text-center">
              No degradation detected yet
            </div>
          ) : (
            <div className="space-y-2">
              {signal_degradation.map(s => (
                <div key={s.mac_address}
                  className="flex items-center justify-between py-1.5 border-b border-slate-700/20 last:border-0">
                  <div>
                    <div className="text-xs text-slate-300 font-mono">{s.mac_address}</div>
                    {s.customer_name && <div className="text-[10px] text-slate-500">{s.customer_name}</div>}
                  </div>
                  <div className="text-right text-xs">
                    <span className="text-slate-400">{s.first_rx}</span>
                    <span className="text-slate-600 mx-1">&rarr;</span>
                    <span className={s.last_rx < -27 ? 'text-red-400' : s.last_rx < -24 ? 'text-orange-400' : 'text-yellow-400'}>
                      {s.last_rx}
                    </span>
                    <span className="text-red-400 font-bold ml-2">
                      {s.delta.toFixed(2)} dBm
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
