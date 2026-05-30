import { useEffect, useState } from 'react';
import { fetchSystemHealth } from '../api/noc';
import type { SystemHealthComponent, SystemHealthData } from '../types/noc';
import { timeAgo } from '../utils/signal';

function statusClass(status: string): string {
  if (status === 'ok') return 'border-green-500/30 bg-green-950/20 text-green-300';
  if (status === 'warning') return 'border-amber-500/30 bg-amber-950/20 text-amber-300';
  if (status === 'critical') return 'border-red-500/30 bg-red-950/20 text-red-300';
  return 'border-slate-500/30 bg-slate-900/60 text-slate-300';
}

function statusDot(status: string): string {
  if (status === 'ok') return 'bg-green-400 shadow-green-400/60';
  if (status === 'warning') return 'bg-amber-400 shadow-amber-400/60';
  if (status === 'critical') return 'bg-red-400 shadow-red-400/60';
  return 'bg-slate-500 shadow-slate-500/60';
}

function ageLabel(seconds: number | null): string {
  if (seconds == null) return 'Unknown';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function detailValue(value: unknown): string {
  if (value == null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function detailEntries(details: Record<string, unknown> | undefined): [string, unknown][] {
  const rows: [string, unknown][] = [];
  for (const [key, value] of Object.entries(details || {})) {
    if (value == null || value === '') continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (childValue == null || childValue === '') continue;
        rows.push([`${key}.${childKey}`, childValue]);
      }
      continue;
    }
    rows.push([key, value]);
  }
  return rows;
}

function ComponentCard({ component }: { component: SystemHealthComponent }) {
  const details = detailEntries(component.details);

  return (
    <div className={`rounded-xl border p-4 ${statusClass(component.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full shadow ${statusDot(component.status)}`} />
            <h3 className="text-sm font-semibold text-slate-100 truncate">{component.name}</h3>
          </div>
          <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{component.category}</div>
        </div>
        <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs font-semibold uppercase">
          {component.status}
        </span>
      </div>

      <p className="mt-3 min-h-10 text-sm text-slate-300">{component.message}</p>
      {component.operator_action && (
        <div className="mt-3 rounded-lg border border-current/20 bg-slate-950/30 p-3 text-xs text-slate-200">
          <div className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Operator action</div>
          <div>{component.operator_action}</div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-slate-950/40 p-2">
          <div className="text-slate-500">Last seen</div>
          <div className="mt-0.5 font-medium text-slate-200">{component.last_seen ? timeAgo(component.last_seen) : 'Unknown'}</div>
        </div>
        <div className="rounded-lg bg-slate-950/40 p-2">
          <div className="text-slate-500">Age</div>
          <div className="mt-0.5 font-mono text-slate-200">{ageLabel(component.age_seconds)}</div>
        </div>
      </div>

      {details.length > 0 && (
        <div className="mt-4 space-y-1 border-t border-slate-700/40 pt-3 text-xs">
          {details.slice(0, 18).map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-3">
              <span className="text-slate-500">{key}</span>
              <span className="max-w-[65%] break-all text-right font-mono text-slate-300">{detailValue(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    fetchSystemHealth()
      .then((response) => {
        setData(response);
        setError('');
      })
      .catch(() => setError('Failed to load system health'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const componentsByCategory = (data?.components || []).reduce<Record<string, SystemHealthComponent[]>>((acc, component) => {
    if (!acc[component.category]) acc[component.category] = [];
    acc[component.category].push(component);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-64 rounded bg-slate-800" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-32 rounded-xl bg-slate-800" />
          <div className="h-32 rounded-xl bg-slate-800" />
          <div className="h-32 rounded-xl bg-slate-800" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-700/40 bg-red-950/20 p-6 text-red-300">
        <div className="font-semibold">{error || 'System health unavailable'}</div>
        <div className="mt-2 text-sm text-red-200/80">
          Backend may have been restarted or the NOC API was temporarily unavailable.
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100 hover:bg-red-900/40"
        >
          Retry system health
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">System Health</h1>
          <p className="mt-1 text-sm text-slate-400">
            Backend, database, OLT ingest, scraper, workers, media storage, and realtime channel status.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      <div className={`rounded-2xl border p-5 ${statusClass(data.overall_status)}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-slate-500">Overall Status</div>
            <div className="mt-1 text-3xl font-black uppercase text-slate-100">{data.overall_status}</div>
            <div className="mt-1 text-sm text-slate-400">Generated {timeAgo(data.generated_at)}</div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {['ok', 'warning', 'critical', 'unknown'].map((status) => (
              <div key={status} className="rounded-xl bg-slate-950/40 px-4 py-3">
                <div className="text-2xl font-bold text-slate-100">{data.counts[status] || 0}</div>
                <div className="mt-1 uppercase text-slate-500">{status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {Object.entries(componentsByCategory).map(([category, components]) => (
        <section key={category} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{category}</h2>
            <span className="text-xs text-slate-500">{components.length} component(s)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {components.map((component) => (
              <ComponentCard key={`${component.category}:${component.name}`} component={component} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
