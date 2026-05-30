import { useState, useEffect, useRef } from 'react';
import { fetchUnlinkedONUs, searchCustomersForLinking, linkONU } from '../api/noc';
import type { UnlinkedONU, CustomerSearchItem } from '../types/noc';

function signalColor(rx: number | null) {
  if (rx === null) return 'text-slate-500';
  if (rx < -27) return 'text-red-400';
  if (rx < -24) return 'text-orange-400';
  if (rx < -20) return 'text-yellow-400';
  return 'text-green-400';
}

function LinkRow({ onu, onLinked }: { onu: UnlinkedONU; onLinked: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQuery(val);
    if (debounce.current) clearTimeout(debounce.current);
    if (val.length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchCustomersForLinking(val);
        setResults(res.results.slice(0, 8));
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
  }

  async function handleLink(username: string) {
    setLinking(true);
    try {
      await linkONU(onu.mac_address, username);
      onLinked();
    } catch (e: any) {
      alert(e?.response?.data?.detail ?? 'Link failed');
      setLinking(false);
    }
  }

  return (
    <tr className="border-b border-slate-700/30 hover:bg-slate-700/20">
      <td className="px-4 py-3">
        <div className="font-mono text-slate-300 text-sm">{onu.mac_address}</div>
        <div className="text-xs text-slate-500">
          {onu.pon_port ?? '?'} · ONU {onu.onu_index ?? '?'}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
          onu.status === 'online'
            ? 'bg-green-500/20 text-green-400'
            : 'bg-slate-600/30 text-slate-400'
        }`}>{onu.status ?? 'unknown'}</span>
      </td>
      <td className={`px-4 py-3 font-mono text-sm ${signalColor(onu.rx_power_dbm)}`}>
        {onu.rx_power_dbm !== null ? `${onu.rx_power_dbm.toFixed(1)} dBm` : '—'}
      </td>
      <td className="px-4 py-3 w-80">
        {!expanded ? (
          <button
            onClick={() => setExpanded(true)}
            className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 text-xs rounded-lg transition-colors"
          >
            + Link Customer
          </button>
        ) : (
          <div className="space-y-2">
            <input
              autoFocus
              type="text"
              placeholder="Search name, phone, address..."
              value={query}
              onChange={e => handleInput(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
            />
            {searching && <div className="text-xs text-slate-500 px-1">Searching...</div>}
            {results.length > 0 && (
              <div className="bg-slate-700 border border-slate-600 rounded-lg overflow-hidden">
                {results.map(r => (
                  <button
                    key={r.username}
                    disabled={linking || r.has_onu_link}
                    onClick={() => handleLink(r.username)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-600/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-b border-slate-600/50 last:border-0"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-slate-200 text-xs font-medium">{r.name ?? r.username}</div>
                        <div className="text-slate-500 text-xs">{r.phone ?? ''} · {r.plan_name ?? ''}</div>
                      </div>
                      {r.has_onu_link && (
                        <span className="text-xs text-orange-400 shrink-0">Already linked</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {query.length >= 2 && results.length === 0 && !searching && (
              <div className="text-xs text-slate-500 px-1">No customers found</div>
            )}
            <button
              onClick={() => { setExpanded(false); setQuery(''); setResults([]); }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function LinkONUsPage() {
  const [onus, setOnus] = useState<UnlinkedONU[]>([]);
  const [loading, setLoading] = useState(true);
  const [portFilter, setPortFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await fetchUnlinkedONUs();
      setOnus(res.onus);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const ports = [...new Set(onus.map(o => o.pon_port).filter(Boolean))].sort() as string[];

  const filtered = onus.filter(o => {
    if (portFilter && o.pon_port !== portFilter) return false;
    if (statusFilter && o.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Link ONUs to Customers</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          {onus.length} unlinked ONU{onus.length !== 1 ? 's' : ''} — manually match each ONU to a Railwire customer
        </p>
      </div>

      {loading && <div className="text-center py-12 text-slate-500">Loading...</div>}

      {!loading && onus.length === 0 && (
        <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-6 text-center">
          <div className="text-3xl mb-2">✓</div>
          <div className="text-green-300 font-medium">All ONUs are linked!</div>
          <div className="text-slate-500 text-sm mt-1">Every ONU has a customer association.</div>
        </div>
      )}

      {!loading && onus.length > 0 && (
        <>
          <div className="flex gap-3 items-center">
            <select
              value={portFilter}
              onChange={e => setPortFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
            >
              <option value="">All ports</option>
              {ports.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
            >
              <option value="">All statuses</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>
            <span className="text-sm text-slate-500">{filtered.length} shown</span>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50 text-xs text-slate-400 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">ONU MAC / Port</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Signal</th>
                  <th className="px-4 py-3 text-left">Link to Customer</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(onu => (
                  <LinkRow key={onu.mac_address} onu={onu} onLinked={load} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
