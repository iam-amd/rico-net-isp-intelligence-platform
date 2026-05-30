import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { cancelMaintenanceWindow, createMaintenanceWindow, fetchMaintenanceWindows } from '../api/noc';
import type { MaintenanceWindow } from '../types/noc';
import { timeAgo } from '../utils/signal';

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromLocal(value: string): string {
  return new Date(value).toISOString();
}

function statusLabel(window: MaintenanceWindow): string {
  if (!window.is_active) return 'cancelled';
  const now = Date.now();
  const start = new Date(window.starts_at).getTime();
  const end = new Date(window.ends_at).getTime();
  if (now < start) return 'scheduled';
  if (now <= end) return 'active';
  return 'expired';
}

function statusClass(status: string): string {
  if (status === 'active') return 'border-amber-500/40 bg-amber-950/20 text-amber-200';
  if (status === 'scheduled') return 'border-blue-500/40 bg-blue-950/20 text-blue-200';
  if (status === 'cancelled') return 'border-slate-600 bg-slate-900/60 text-slate-400';
  return 'border-slate-700 bg-slate-900/40 text-slate-300';
}

export default function MaintenanceWindowsPage() {
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [includeExpired, setIncludeExpired] = useState(false);

  const defaultStart = toLocalInputValue(new Date(Date.now() + 15 * 60 * 1000));
  const defaultEnd = toLocalInputValue(new Date(Date.now() + 75 * 60 * 1000));
  const [oltHost, setOltHost] = useState('');
  const [ponPort, setPonPort] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [endsAt, setEndsAt] = useState(defaultEnd);
  const [reason, setReason] = useState('');

  const load = () => {
    setLoading(true);
    fetchMaintenanceWindows({ active_only: false, include_expired: includeExpired })
      .then((items) => {
        setWindows(items);
        setError('');
      })
      .catch(() => setError('Could not load maintenance windows'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [includeExpired]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!oltHost.trim()) {
      setError('OLT host is required');
      return;
    }
    setSaving(true);
    try {
      await createMaintenanceWindow({
        olt_host: oltHost.trim(),
        pon_port: ponPort.trim() || null,
        starts_at: toIsoFromLocal(startsAt),
        ends_at: toIsoFromLocal(endsAt),
        reason: reason.trim() || null,
      });
      setReason('');
      load();
    } catch {
      setError('Could not create maintenance window');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: number) => {
    setSaving(true);
    try {
      await cancelMaintenanceWindow(id);
      load();
    } catch {
      setError('Could not cancel maintenance window');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Maintenance Windows</h1>
          <p className="mt-1 text-sm text-slate-400">
            Planned OLT or PON work suppresses matching lifecycle alarms and prevents false auto-ticket noise.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700/40 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-y border-slate-800 py-4 lg:grid-cols-6">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-500">OLT host</span>
          <input
            value={oltHost}
            onChange={(event) => setOltHost(event.target.value)}
            placeholder="10.10.10.100"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-500">PON port</span>
          <input
            value={ponPort}
            onChange={(event) => setPonPort(event.target.value)}
            placeholder="all or 0/1"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-500">Starts</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-500">Ends</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-slate-500">Reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Firmware reboot"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
        <div className="flex items-end">
          <button
            disabled={saving}
            className="w-full rounded-lg border border-blue-500/40 bg-blue-600/25 px-3 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-600/35 disabled:opacity-60"
          >
            Create Window
          </button>
        </div>
      </form>

      <label className="inline-flex items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={includeExpired}
          onChange={(event) => setIncludeExpired(event.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-900"
        />
        Show expired windows
      </label>

      {loading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-slate-400">Loading maintenance windows...</div>
      ) : windows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-slate-400">No maintenance windows scheduled.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {windows.map((item) => {
            const status = statusLabel(item);
            return (
              <div key={item.id} className={`rounded-xl border p-4 ${statusClass(status)}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{item.olt_host} {item.pon_port ? `port ${item.pon_port}` : 'all ports'}</div>
                    <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{status}</div>
                  </div>
                  {item.is_active && status !== 'expired' && (
                    <button
                      disabled={saving}
                      onClick={() => cancel(item.id)}
                      className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-950/40 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-950/40 p-2">
                    <div className="text-slate-500">Starts</div>
                    <div className="mt-0.5 text-slate-200">{timeAgo(item.starts_at)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/40 p-2">
                    <div className="text-slate-500">Ends</div>
                    <div className="mt-0.5 text-slate-200">{timeAgo(item.ends_at)}</div>
                  </div>
                </div>
                {item.reason && <div className="mt-3 text-sm text-slate-300">{item.reason}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
