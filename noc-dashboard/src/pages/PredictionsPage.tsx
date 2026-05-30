import { useState, useEffect } from 'react';
import { fetchPredictions, runPredictionsNow } from '../api/noc';
import type { PredictionItem } from '../types/noc';

function riskBadge(risk: string | null, type: 'fiber' | 'churn') {
  const colors: Record<string, string> = {
    CRITICAL: 'bg-red-500/20 text-red-300 border border-red-500/30',
    HIGH:     'bg-orange-500/20 text-orange-300 border border-orange-500/30',
    MEDIUM:   'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
    LOW:      'bg-green-500/20 text-green-400 border border-green-500/20',
  };
  const label = risk ?? 'N/A';
  const cls = colors[label] ?? 'bg-slate-600/30 text-slate-400';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {type === 'fiber' ? '⟁ ' : '↻ '}{label}
    </span>
  );
}

function healthBar(score: number) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : pct >= 30 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-6 text-right">{score}</span>
    </div>
  );
}

export default function PredictionsPage() {
  const [preds, setPreds] = useState<PredictionItem[]>([]);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterRisk, setFilterRisk] = useState('');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetchPredictions(200);
      setPreds(res.predictions);
      setTotal(res.total);
      setLastRun(res.last_run);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Failed to load predictions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRun() {
    setRunning(true);
    try {
      const res = await runPredictionsNow();
      await load();
      alert(`Prediction run complete — ${res.computed} ONUs scored`);
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  const filtered = preds.filter(p => {
    if (filterRisk && p.fiber_risk !== filterRisk && p.churn_risk !== filterRisk) return false;
    if (search) {
      const q = search.toLowerCase();
      return (p.customer_name ?? '').toLowerCase().includes(q)
        || (p.mac_address ?? '').toLowerCase().includes(q)
        || (p.customer_phone ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const criticalCount = preds.filter(p => p.fiber_risk === 'CRITICAL').length;
  const highCount = preds.filter(p => p.fiber_risk === 'HIGH' || p.churn_risk === 'HIGH').length;
  const lowHealth = preds.filter(p => p.health_score < 50).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Prediction Engine</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Nightly ONU risk scoring — fiber degradation, churn risk, health score
            {lastRun && (
              <span className="ml-2 text-slate-500">· Last run: {new Date(lastRun).toLocaleString()}</span>
            )}
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {running ? 'Running...' : '▶ Run Now'}
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Scored', value: total, color: 'text-slate-200' },
          { label: 'Fiber Critical', value: criticalCount, color: 'text-red-400' },
          { label: 'High Risk', value: highCount, color: 'text-orange-400' },
          { label: 'Health < 50', value: lowHealth, color: 'text-yellow-400' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
            <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
            <div className="text-xs text-slate-400 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {total === 0 && !loading && (
        <div className="bg-slate-800/40 border border-slate-600/40 rounded-lg p-6 text-center">
          <div className="text-3xl mb-2">📊</div>
          <div className="text-slate-300 font-medium">No predictions yet</div>
          <div className="text-slate-500 text-sm mt-1">
            Predictions run nightly at 2 AM and require at least 7 days of ONU signal data.
          </div>
          <button onClick={handleRun} disabled={running} className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm">
            {running ? 'Running...' : 'Run prediction pass now'}
          </button>
        </div>
      )}

      {total > 0 && (
        <>
          {/* Filters */}
          <div className="flex gap-3 items-center">
            <input
              type="text"
              placeholder="Search by name, MAC, phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
            />
            <select
              value={filterRisk}
              onChange={e => setFilterRisk(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
            >
              <option value="">All risk levels</option>
              <option value="CRITICAL">Fiber Critical</option>
              <option value="HIGH">High Risk</option>
              <option value="MEDIUM">Medium Risk</option>
              <option value="LOW">Low Risk</option>
            </select>
            <span className="text-sm text-slate-500">{filtered.length} shown</span>
          </div>

          {/* Table */}
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50 text-xs text-slate-400 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Customer / MAC</th>
                    <th className="px-4 py-3 text-left">Port</th>
                    <th className="px-4 py-3 text-center">Health</th>
                    <th className="px-4 py-3 text-center">Fiber Risk</th>
                    <th className="px-4 py-3 text-center">Churn Risk</th>
                    <th className="px-4 py-3 text-right">Avg Rx 7d</th>
                    <th className="px-4 py-3 text-right">Slope</th>
                    <th className="px-4 py-3 text-right">Alarms 30d</th>
                    <th className="px-4 py-3 text-left">Recommended Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.mac_address} className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-slate-200 font-medium">{p.customer_name ?? <span className="text-slate-500 italic">Unknown</span>}</div>
                        <div className="text-slate-500 text-xs font-mono">{p.mac_address}</div>
                        {p.customer_phone && <div className="text-slate-500 text-xs">{p.customer_phone}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{p.pon_port ?? '—'}</td>
                      <td className="px-4 py-3">{healthBar(p.health_score)}</td>
                      <td className="px-4 py-3 text-center">{riskBadge(p.fiber_risk, 'fiber')}</td>
                      <td className="px-4 py-3 text-center">{riskBadge(p.churn_risk, 'churn')}</td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono text-xs">
                        {p.rx_avg_7d !== null ? `${p.rx_avg_7d.toFixed(1)} dBm` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {p.rx_slope_7d !== null ? (
                          <span className={p.rx_slope_7d < -0.2 ? 'text-red-400' : p.rx_slope_7d < -0.05 ? 'text-yellow-400' : 'text-green-400'}>
                            {p.rx_slope_7d > 0 ? '+' : ''}{p.rx_slope_7d.toFixed(3)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 text-xs">{p.alarm_count_30d}</td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-xs">{p.recommended_action ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {loading && (
        <div className="text-center py-12 text-slate-500">Loading predictions...</div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-4 text-red-300 text-sm">{error}</div>
      )}
    </div>
  );
}
