import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchOrphanONUs } from '../api/noc';
import type { OrphanONU, OrphanONUSummary } from '../types/noc';

function reasonLabel(reason: string) {
  if (reason === 'missing_customer') return 'No Customer';
  if (reason === 'inactive_customer') return 'Inactive Customer';
  if (reason === 'expired_customer') return 'Expired Billing';
  return reason;
}

function reasonClass(reason: string) {
  if (reason === 'missing_customer') return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (reason === 'inactive_customer') return 'bg-orange-500/15 text-orange-300 border-orange-500/30';
  if (reason === 'expired_customer') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
}

function signalColor(rx: number | null) {
  if (rx === null) return 'text-slate-500';
  if (rx < -27) return 'text-red-400';
  if (rx < -24) return 'text-orange-400';
  if (rx < -20) return 'text-yellow-400';
  return 'text-green-400';
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="border border-slate-700/60 bg-slate-900/50 rounded-lg px-4 py-3">
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

export default function OrphanONUsPage() {
  const [onus, setOnus] = useState<OrphanONU[]>([]);
  const [summary, setSummary] = useState<OrphanONUSummary | null>(null);
  const [includeOffline, setIncludeOffline] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchOrphanONUs(includeOffline);
      setOnus(data.onus);
      setSummary(data.summary);
    } catch {
      setError('Could not load orphan ONU report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [includeOffline]);

  const filtered = useMemo(() => {
    return onus.filter((onu) => !reason || onu.reason === reason);
  }, [onus, reason]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Orphan ONU Audit</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            ONUs still visible on the OLT that need billing or customer-record action.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200"
        >
          Refresh
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <StatTile label="Total" value={summary.total} />
          <StatTile label="No Customer" value={summary.missing_customer} tone="text-red-300" />
          <StatTile label="Inactive" value={summary.inactive_customer} tone="text-orange-300" />
          <StatTile label="Expired" value={summary.expired_customer} tone="text-yellow-300" />
          <StatTile label="Online" value={summary.online} tone="text-green-300" />
          <StatTile label="Offline" value={summary.offline} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
        >
          <option value="">All reasons</option>
          <option value="missing_customer">No customer</option>
          <option value="inactive_customer">Inactive customer</option>
          <option value="expired_customer">Expired billing</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={includeOffline}
            onChange={e => setIncludeOffline(e.target.checked)}
            className="accent-blue-500"
          />
          Include offline ONUs
        </label>
        <span className="text-sm text-slate-500">{filtered.length} shown</span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-500">Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-green-500/30 bg-green-950/20 p-6 text-center">
          <div className="text-green-300 font-medium">No orphan ONUs found</div>
          <div className="text-slate-500 text-sm mt-1">Billing, bindings, and OLT visibility are aligned for this filter.</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">ONU</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Signal</th>
                <th className="px-4 py-3 text-left">Last Poll</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((onu) => (
                <tr key={`${onu.mac_address}-${onu.reason}`} className="border-b border-slate-700/30 hover:bg-slate-700/20">
                  <td className="px-4 py-3 align-top">
                    <Link to={`/onus/${encodeURIComponent(onu.mac_address)}`} className="font-mono text-blue-300 hover:text-blue-200">
                      {onu.mac_address}
                    </Link>
                    <div className="text-xs text-slate-500 mt-1">
                      {onu.olt_host} / {onu.pon_port ?? '?'} / ONU {onu.onu_index ?? '?'}
                    </div>
                    <div className="text-xs text-slate-500">{onu.match_source}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${reasonClass(onu.reason)}`}>
                      {reasonLabel(onu.reason)}
                    </span>
                    <div className="text-xs text-slate-500 mt-1">{onu.severity}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {onu.customer_username ? (
                      <Link to={`/customers/${encodeURIComponent(onu.customer_username)}`} className="text-slate-200 hover:text-blue-300">
                        {onu.customer_name ?? onu.customer_username}
                      </Link>
                    ) : (
                      <span className="text-slate-500">No customer match</span>
                    )}
                    <div className="text-xs text-slate-500 mt-1">
                      {onu.customer_phone ?? '-'} / {onu.customer_status ?? '-'}
                    </div>
                    {onu.customer_expiry_date && (
                      <div className="text-xs text-slate-500">Expiry: {formatDate(onu.customer_expiry_date)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className={`font-mono ${signalColor(onu.rx_power_dbm)}`}>
                      {onu.rx_power_dbm !== null ? `${onu.rx_power_dbm.toFixed(1)} dBm` : '-'}
                    </div>
                    <div className={`text-xs mt-1 ${onu.status === 'online' ? 'text-green-400' : 'text-slate-500'}`}>
                      {onu.status ?? 'unknown'}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-400">
                    {formatDate(onu.polled_at)}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300 max-w-md">
                    {onu.recommended_action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
