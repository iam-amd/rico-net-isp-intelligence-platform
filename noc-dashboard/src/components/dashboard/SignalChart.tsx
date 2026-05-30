import { useCallback, useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer
} from 'recharts';
import client from '../../api/client';
import { fetchSummary } from '../../api/noc';

interface HistoryPoint {
  timestamp: string;
  avg_rx: number | null;
  min_rx: number | null;
  online_count: number;
  total_count: number;
}

interface ChartPoint {
  time: string;
  avgRx: number | null;
  minRx: number | null;
  onlinePct: number;
}

const WINDOWS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
];

function formatTime(iso: string): string {
  let d = new Date(iso);
  if (isNaN(d.getTime())) d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '??:??';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-400 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : 'N/A'}
          {p.name.includes('Rx') ? ' dBm' : '%'}
        </div>
      ))}
    </div>
  );
};

export default function SignalChart() {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [hours, setHours] = useState(6);
  const [loading, setLoading] = useState(true);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, history] = await Promise.all([
        fetchSummary(),
        client.get<HistoryPoint[]>('/noc/history', { params: { hours } }),
      ]);
      setStaleMessage(summary.data_is_stale || summary.live_data_available === false
        ? summary.freshness_message || 'Live OLT polling is stale; this chart is historical only.'
        : null);
      const rows = history.data;
      setData(rows.map((r) => ({
        time: formatTime(r.timestamp),
        avgRx: r.avg_rx,
        minRx: r.min_rx,
        onlinePct: r.total_count > 0 ? Math.round((r.online_count / r.total_count) * 100) : 0,
      })));
    } catch {
      setStaleMessage('Cannot verify live OLT freshness.');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Signal Trend
        </h2>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              onClick={() => setHours(w.hours)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                hours === w.hours
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading && data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
          Loading signal data...
        </div>
      ) : staleMessage ? (
        <div className="h-48 rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-red-300">
            Historical signal only
          </div>
          <div className="text-sm leading-relaxed text-red-100">
            {staleMessage}
          </div>
          <div className="mt-3 text-xs text-red-200/80">
            Current Rx, online/offline, and trend decisions are blocked until fresh OLT polls arrive.
          </div>
        </div>
      ) : data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
          No data for selected window
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="rxGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[-35, -10]}
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}`}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Critical threshold */}
            <ReferenceLine y={-27} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: '-27', fill: '#ef4444', fontSize: 9, position: 'right' }} />
            {/* Warning threshold */}
            <ReferenceLine y={-24} stroke="#eab308" strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: '-24', fill: '#eab308', fontSize: 9, position: 'right' }} />
            <Area
              type="monotone"
              dataKey="avgRx"
              name="Avg Rx"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#rxGradient)"
              dot={false}
              activeDot={{ r: 3, fill: '#3b82f6' }}
            />
            <Area
              type="monotone"
              dataKey="minRx"
              name="Min Rx"
              stroke="#f97316"
              strokeWidth={1}
              fill="none"
              dot={false}
              strokeDasharray="3 3"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
