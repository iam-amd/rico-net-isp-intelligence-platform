import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchShiftBrief } from '../api/noc';
import type { ShiftBriefData } from '../types/noc';

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

export default function ShiftBriefPage() {
  const [hours, setHours] = useState(12);
  const [data, setData] = useState<ShiftBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await fetchShiftBrief(hours));
    } catch {
      setError('Could not load shift brief');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [hours]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Shift Brief</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Operator handoff from alarms, tickets, maintenance, system health, and orphan ONU audit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
          </select>
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-500">Loading...</div>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Stat label="Open Alarms" value={data.alarms.open_total} tone={data.alarms.open_total ? 'text-red-300' : 'text-green-300'} />
            <Stat label="Window Alarms" value={data.alarms.received_in_window} />
            <Stat label="Open Tickets" value={data.tickets.open} />
            <Stat label="Ongoing" value={data.tickets.ongoing} />
            <Stat label="Overdue" value={data.tickets.overdue} tone={data.tickets.overdue ? 'text-orange-300' : 'text-slate-100'} />
            <Stat label="Orphan ONUs" value={data.orphan_onus.total} tone={data.orphan_onus.total ? 'text-yellow-300' : 'text-green-300'} />
          </div>

          <section className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-4">
            <div className="text-xs uppercase tracking-wide text-blue-300 mb-3">Handoff Actions</div>
            <div className="space-y-2">
              {data.handoff_actions.map((action, index) => (
                <div key={index} className="flex gap-3 text-sm text-slate-200">
                  <span className="font-mono text-blue-300">{index + 1}</span>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="rounded-lg border border-slate-700/60 bg-slate-900/40">
              <div className="px-4 py-3 border-b border-slate-700/60 font-semibold text-slate-100">Latest Open Alarms</div>
              <div className="divide-y divide-slate-800">
                {data.alarms.latest_open.length === 0 && (
                  <div className="px-4 py-5 text-sm text-slate-500">No open alarms.</div>
                )}
                {data.alarms.latest_open.map(alarm => (
                  <div key={alarm.id} className="px-4 py-3">
                    <div className="flex justify-between gap-3">
                      <Link to="/alarms" className="text-sm font-medium text-red-300 hover:text-red-200">{alarm.event_type}</Link>
                      <span className="text-xs text-slate-500">{formatDate(alarm.received_at)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400 font-mono">
                      {alarm.mac_address} / {alarm.olt_host ?? '?'} / {alarm.pon_port ?? '?'} / ONU {alarm.onu_index ?? '?'}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-700/60 bg-slate-900/40">
              <div className="px-4 py-3 border-b border-slate-700/60 font-semibold text-slate-100">Alarm Mix</div>
              <div className="divide-y divide-slate-800">
                {data.alarms.breakdown.length === 0 && (
                  <div className="px-4 py-5 text-sm text-slate-500">No alarms in selected window.</div>
                )}
                {data.alarms.breakdown.map(item => (
                  <div key={item.event_type} className="px-4 py-3 flex justify-between text-sm">
                    <span className="text-slate-300">{item.event_type}</span>
                    <span className="font-mono text-slate-100">{item.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-700/60 bg-slate-900/40">
              <div className="px-4 py-3 border-b border-slate-700/60 font-semibold text-slate-100">Maintenance Next 24h</div>
              <div className="divide-y divide-slate-800">
                {data.maintenance.length === 0 && (
                  <div className="px-4 py-5 text-sm text-slate-500">No active or upcoming maintenance windows.</div>
                )}
                {data.maintenance.map(item => (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-slate-200">{item.olt_host} {item.pon_port ?? 'all ports'}</span>
                      <span className={item.is_current ? 'text-orange-300' : 'text-slate-500'}>
                        {item.is_current ? 'current' : 'upcoming'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{formatDate(item.starts_at)} - {formatDate(item.ends_at)}</div>
                    {item.reason && <div className="mt-1 text-xs text-slate-400">{item.reason}</div>}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-700/60 bg-slate-900/40">
              <div className="px-4 py-3 border-b border-slate-700/60 font-semibold text-slate-100">System Health Watch</div>
              <div className="divide-y divide-slate-800">
                {data.system_health.components.length === 0 && (
                  <div className="px-4 py-5 text-sm text-green-300">No warning or critical components.</div>
                )}
                {data.system_health.components.map(component => (
                  <div key={`${component.category}-${component.name}`} className="px-4 py-3">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="text-slate-200">{component.name}</span>
                      <span className={component.status === 'critical' ? 'text-red-300' : 'text-yellow-300'}>{component.status}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{component.message}</div>
                    {component.operator_action && <div className="mt-1 text-xs text-slate-400">{component.operator_action}</div>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
