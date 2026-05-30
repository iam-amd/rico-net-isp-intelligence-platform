import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip as LeafletTooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchTechMonitor } from '../api/noc';
import type { TechMonitorData, TechMonitorItem } from '../types/noc';

const MAP_CENTER: [number, number] = [12.820, 80.040];

function statusClass(status: string): string {
  if (status === 'live') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'recent') return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
  if (status === 'stale') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-red-500/40 bg-red-500/10 text-red-300';
}

function markerColor(status: string): string {
  if (status === 'live') return '#22c55e';
  if (status === 'recent') return '#06b6d4';
  if (status === 'stale') return '#f59e0b';
  return '#ef4444';
}

function timeLabel(minutesAgo: number | null): string {
  if (minutesAgo == null) return 'No GPS';
  if (minutesAgo < 1) return 'Just now';
  if (minutesAgo < 60) return `${minutesAgo.toFixed(0)}m ago`;
  return `${(minutesAgo / 60).toFixed(1)}h ago`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function TechRow({ tech }: { tech: TechMonitorItem }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-950/35 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-100">{tech.technician_name || tech.technician_username || `Tech #${tech.technician_id}`}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{[tech.phone, tech.area_assigned, tech.role].filter(Boolean).join(' | ') || 'No profile details'}</div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(tech.status)}`}>
          {tech.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
        <div><span className="text-slate-600">GPS</span><br />{timeLabel(tech.minutes_ago)}</div>
        <div><span className="text-slate-600">Tickets</span><br />{tech.active_ticket_count}</div>
        <div><span className="text-slate-600">Battery</span><br />{tech.battery_pct == null ? '-' : `${tech.battery_pct}%`}</div>
      </div>
    </div>
  );
}

export default function TechnicianTrackerPage() {
  const [data, setData] = useState<TechMonitorData | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await fetchTechMonitor(hours);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load technician monitor');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const technicians = data?.technicians || [];
  const plotted = useMemo(() => technicians.filter((tech) => tech.lat != null && tech.lng != null), [technicians]);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Technician Live Monitor</h1>
          <p className="text-[11px] text-slate-500">Tracks every active technician, including stale or missing GPS, even when no ticket is assigned.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
          >
            <option value={4}>4h GPS window</option>
            <option value={12}>12h GPS window</option>
            <option value={24}>24h GPS window</option>
            <option value={72}>72h GPS window</option>
          </select>
          <button onClick={load} className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-cyan-200 hover:bg-cyan-500/20">
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3"><div className="text-slate-500">Active techs</div><div className="text-xl font-black text-white">{data?.total ?? 0}</div></div>
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3"><div className="text-emerald-400">Live</div><div className="text-xl font-black text-white">{data?.live ?? 0}</div></div>
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-3"><div className="text-amber-400">Stale/recent</div><div className="text-xl font-black text-white">{data?.stale ?? 0}</div></div>
        <div className="rounded-xl border border-red-500/25 bg-red-950/20 p-3"><div className="text-red-400">Missing GPS</div><div className="text-xl font-black text-white">{data?.missing ?? 0}</div></div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-700/40 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="min-h-0 overflow-auto rounded-2xl border border-slate-700/50 bg-slate-900/50 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Field staff</div>
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-500">Loading technicians...</div>
          ) : technicians.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">No active technicians found</div>
          ) : (
            <div className="space-y-2">
              {technicians.map((tech) => <TechRow key={tech.technician_id} tech={tech} />)}
            </div>
          )}
        </aside>

        <main className="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-900/50">
          <div className="border-b border-slate-700/50 px-4 py-3 text-xs text-slate-400">
            {plotted.length} technicians plotted. Missing GPS technicians remain visible in the left list.
          </div>
          <div style={{ height: 'calc(100% - 43px)', minHeight: 460 }}>
            <MapContainer center={MAP_CENTER} zoom={13} style={{ height: '100%', width: '100%', background: '#0f172a' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com">CARTO</a>'
              />
              {plotted.map((tech) => {
                const color = markerColor(tech.status);
                return (
                  <CircleMarker
                    key={tech.technician_id}
                    center={[tech.lat!, tech.lng!]}
                    radius={tech.status === 'live' ? 12 : 9}
                    pathOptions={{ fillColor: color, fillOpacity: 0.85, color, weight: tech.status === 'live' ? 3 : 2 }}
                  >
                    <LeafletTooltip direction="top" offset={[0, -8]}>
                      <div style={{ fontSize: 11 }}>
                        <div style={{ fontWeight: 700 }}>{tech.technician_name || tech.technician_username}</div>
                        <div style={{ color }}>{tech.status.toUpperCase()} | {timeLabel(tech.minutes_ago)}</div>
                      </div>
                    </LeafletTooltip>
                    <Popup>
                      <div style={{ background: '#1e293b', color: '#f1f5f9', padding: 12, borderRadius: 8, minWidth: 220, fontSize: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{tech.technician_name || tech.technician_username}</div>
                        <div style={{ color, fontWeight: 700, marginTop: 6 }}>{tech.status.toUpperCase()}</div>
                        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                          <span style={{ color: '#94a3b8' }}>Last GPS</span><span>{timeLabel(tech.minutes_ago)}</span>
                          <span style={{ color: '#94a3b8' }}>Timestamp</span><span>{formatDate(tech.timestamp)}</span>
                          <span style={{ color: '#94a3b8' }}>Accuracy</span><span>{tech.accuracy_m == null ? '-' : `${tech.accuracy_m.toFixed(0)}m`}</span>
                          <span style={{ color: '#94a3b8' }}>Tickets</span><span>{tech.active_ticket_count}</span>
                          <span style={{ color: '#94a3b8' }}>Area</span><span>{tech.area_assigned || '-'}</span>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </main>
      </div>
    </div>
  );
}
