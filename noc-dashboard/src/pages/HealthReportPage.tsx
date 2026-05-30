import { useState, useEffect } from 'react';
import { fetchHealthReport, fetchMaintenanceSchedule } from '../api/noc';
import type { HealthReportData, MaintenanceItem } from '../types/noc';

function StatCard({ label, value, sub, color = 'text-slate-200' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const labels: Record<number, [string, string]> = {
    1: ['DISPATCH NOW', 'bg-red-500/20 text-red-300 border border-red-500/30'],
    2: ['48H SCHEDULE', 'bg-orange-500/20 text-orange-300 border border-orange-500/30'],
    3: ['MONITOR', 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'],
  };
  const [label, cls] = labels[priority] ?? ['UNKNOWN', 'bg-slate-600/30 text-slate-400'];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function HealthReportPage() {
  const [report, setReport] = useState<HealthReportData | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceItem[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [highCount, setHighCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'report' | 'maintenance'>('report');

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchHealthReport(), fetchMaintenanceSchedule()])
      .then(([r, m]) => {
        setReport(r);
        setMaintenance(m.items);
        setCriticalCount(m.critical_count);
        setHighCount(m.high_count);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-slate-500">Loading report...</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Network Health Report</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Live snapshot · Generated at {report ? new Date(report.generated_at).toLocaleString() : '—'}
          </p>
        </div>
        <div className="flex gap-2">
          {(['report', 'maintenance'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {tab === 'report' ? '📊 Report' : `🔧 Maintenance (${maintenance.length})`}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'report' && report && (
        <div className="space-y-5">
          {/* Network status */}
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Network Status</h2>
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Total ONUs" value={report.total_onus} />
              <StatCard label="Online" value={report.online}
                sub={`${report.online_pct}% uptime`}
                color={report.online_pct >= 95 ? 'text-green-400' : report.online_pct >= 85 ? 'text-yellow-400' : 'text-red-400'} />
              <StatCard label="Offline" value={report.offline} color={report.offline > 20 ? 'text-red-400' : 'text-slate-200'} />
              <StatCard label="Avg Rx Power" value={report.avg_rx_power !== null ? `${report.avg_rx_power.toFixed(1)} dBm` : '—'} />
            </div>
          </div>

          {/* Signal health */}
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Signal Health</h2>
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Critical Signal" value={report.critical_signal}
                sub="Rx < -27 dBm" color={report.critical_signal > 0 ? 'text-red-400' : 'text-green-400'} />
              <StatCard label="Weak Signal" value={report.weak_signal}
                sub="Rx -24 to -27 dBm" color={report.weak_signal > 10 ? 'text-orange-400' : 'text-slate-200'} />
              <StatCard label="Alarms 24h" value={report.alarm_count_24h} color={report.alarm_count_24h > 20 ? 'text-red-400' : 'text-slate-200'} />
              <StatCard label="Alarms 7d" value={report.alarm_count_7d} />
            </div>
          </div>

          {/* Predictions */}
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Predictions</h2>
            {!report.predictions_available ? (
              <div className="bg-slate-700/30 border border-slate-600/40 rounded-lg p-4 text-sm text-slate-400">
                No predictions available yet — predictions require 7+ days of signal data and run nightly at 2 AM.
                Visit the Predictions page to run manually.
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="ONUs Scored" value={report.total_predictions} />
                <StatCard label="Avg Health Score" value={report.avg_health_score !== null ? Math.round(report.avg_health_score) : '—'}
                  color={report.avg_health_score !== null && report.avg_health_score >= 80 ? 'text-green-400' : 'text-yellow-400'} />
                <StatCard label="High Fiber Risk" value={report.high_fiber_risk}
                  color={report.high_fiber_risk > 0 ? 'text-orange-400' : 'text-green-400'} />
                <StatCard label="High Churn Risk" value={report.high_churn_risk}
                  color={report.high_churn_risk > 0 ? 'text-orange-400' : 'text-green-400'} />
              </div>
            )}
          </div>

          {/* Tickets */}
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Support Queue</h2>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Open Tickets" value={report.open_tickets}
                color={report.open_tickets > 10 ? 'text-orange-400' : 'text-slate-200'} />
            </div>
          </div>

          {/* Overall rating */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">Overall Assessment</h2>
            {(() => {
              const score = report.online_pct;
              const issues: string[] = [];
              if (report.critical_signal > 0) issues.push(`${report.critical_signal} ONUs with critical signal`);
              if (report.offline > 10) issues.push(`${report.offline} ONUs offline`);
              if (report.high_fiber_risk > 5) issues.push(`${report.high_fiber_risk} high fiber-risk ONUs`);
              if (report.alarm_count_24h > 30) issues.push(`${report.alarm_count_24h} alarms in last 24h`);

              const rating = score >= 95 && issues.length === 0 ? 'Excellent'
                : score >= 90 ? 'Good'
                : score >= 80 ? 'Fair'
                : 'Attention Required';
              const ratingColor = rating === 'Excellent' ? 'text-green-400'
                : rating === 'Good' ? 'text-blue-400'
                : rating === 'Fair' ? 'text-yellow-400'
                : 'text-red-400';

              return (
                <div>
                  <span className={`text-2xl font-bold ${ratingColor}`}>{rating}</span>
                  {issues.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {issues.map((issue, i) => (
                        <li key={i} className="text-sm text-slate-400 flex items-center gap-2">
                          <span className="text-orange-400">⚠</span> {issue}
                        </li>
                      ))}
                    </ul>
                  )}
                  {issues.length === 0 && (
                    <p className="text-slate-400 text-sm mt-2">Network is operating within normal parameters.</p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total Needing Attention" value={maintenance.length} />
            <StatCard label="Dispatch Immediately" value={criticalCount} color={criticalCount > 0 ? 'text-red-400' : 'text-green-400'} />
            <StatCard label="Schedule Within 48h" value={highCount} color={highCount > 5 ? 'text-orange-400' : 'text-slate-200'} />
          </div>

          {maintenance.length === 0 ? (
            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-6 text-center">
              <div className="text-3xl mb-2">✓</div>
              <div className="text-green-300 font-medium">No maintenance required</div>
              <div className="text-slate-500 text-sm mt-1">All ONUs have acceptable signal levels.</div>
            </div>
          ) : (
            <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50 text-xs text-slate-400 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Priority</th>
                    <th className="px-4 py-3 text-left">Customer / MAC</th>
                    <th className="px-4 py-3 text-left">Port</th>
                    <th className="px-4 py-3 text-right">Rx Power</th>
                    <th className="px-4 py-3 text-right">Slope 7d</th>
                    <th className="px-4 py-3 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenance.map(item => (
                    <tr key={item.mac_address} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                      <td className="px-4 py-3"><PriorityBadge priority={item.priority} /></td>
                      <td className="px-4 py-3">
                        <div className="text-slate-200">{item.customer_name ?? <span className="text-slate-500 italic">Unknown</span>}</div>
                        <div className="text-slate-500 text-xs font-mono">{item.mac_address}</div>
                        {item.customer_phone && <div className="text-slate-500 text-xs">{item.customer_phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{item.pon_port ?? '—'} · {item.onu_index ?? '?'}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        <span className={item.rx_power_dbm !== null && item.rx_power_dbm < -27 ? 'text-red-400' : 'text-orange-400'}>
                          {item.rx_power_dbm !== null ? `${item.rx_power_dbm.toFixed(1)} dBm` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {item.rx_slope_7d !== null ? (
                          <span className={item.rx_slope_7d < -0.2 ? 'text-red-400' : 'text-yellow-400'}>
                            {item.rx_slope_7d > 0 ? '+' : ''}{item.rx_slope_7d.toFixed(3)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-xs">{item.recommended_action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
