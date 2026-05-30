import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchCustomerIntelligence } from '../api/noc';
import type { CustomerIntelItem } from '../types/noc';
import SignalBar from '../components/shared/SignalBar';
import StatusBadge from '../components/shared/StatusBadge';
import { setNocFocus, useNocFocus } from '../state/nocFocus';

const FILTERS = [
  { key: '', label: 'All Customers' },
  { key: 'offline', label: 'Offline' },
  { key: 'critical', label: 'Critical Signal' },
  { key: 'weak', label: 'Weak Signal' },
  { key: 'expiring', label: 'Expiring (7d)' },
  { key: 'expired', label: 'Expired' },
  { key: 'no_onu', label: 'No ONU Link' },
] as const;

const HEALTH_COLOR: Record<string, string> = {
  critical: 'bg-red-500',
  poor: 'bg-orange-500',
  fair: 'bg-yellow-500',
  good: 'bg-green-500',
  excellent: 'bg-emerald-400',
};

function healthLabel(score: number): string {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  if (score >= 30) return 'poor';
  return 'critical';
}

function HealthBadge({ score }: { score: number }) {
  const label = healthLabel(score);
  const color = HEALTH_COLOR[label];
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-8 h-2 rounded-full ${color}`} style={{ opacity: 0.8 }}>
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[11px] font-mono">{score}</span>
    </div>
  );
}

function formatExpiry(dateStr: string | null): { text: string; urgent: boolean } {
  if (!dateStr) return { text: '—', urgent: false };
  const exp = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((exp.getTime() - now.getTime()) / 86400000);
  if (days < 0) return { text: `Expired ${Math.abs(days)}d ago`, urgent: true };
  if (days < 3) return { text: `${days}d left`, urgent: true };
  if (days < 7) return { text: `${days}d left`, urgent: false };
  return { text: exp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), urgent: false };
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { focus } = useNocFocus();
  const urlSearch = searchParams.get('search') || '';
  const [customers, setCustomers] = useState<CustomerIntelItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState(urlSearch);
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [filterType, setFilterType] = useState('');
  const [sortBy, setSortBy] = useState('health_score');
  const [sortDir, setSortDir] = useState('asc');
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCustomerIntelligence({
        page,
        page_size: pageSize,
        search: search || undefined,
        filter_type: filterType || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      setCustomers(res.customers);
      setTotal(res.total);
    } catch (err) {
      console.error('Failed to load customers', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, filterType, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setSearch(urlSearch);
    setSearchInput(urlSearch);
    setPage(1);
  }, [urlSearch]);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir(col === 'name' ? 'asc' : 'asc');
    }
    setPage(1);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function focusCustomer(c: CustomerIntelItem) {
    const rowMac = c.onu_mac || c.mac_address;
    setNocFocus({
      kind: rowMac ? 'onu' : 'customer',
      label: c.name || c.username,
      subtitle: [c.phone, c.pon_port, c.address].filter(Boolean).join(' | ') || null,
      customerUsername: c.username,
      macAddress: rowMac,
      status: c.onu_status || c.status,
      targetUrl: `/customers/${encodeURIComponent(c.username)}`,
      source: 'customer_intelligence',
    });
  }

  const totalPages = Math.ceil(total / pageSize);

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <span className="text-slate-600 ml-0.5">↕</span>;
    return <span className="text-blue-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  // Summary stats
  const offlineCount = customers.filter(c => c.onu_status === 'offline').length;
  const criticalCount = customers.filter(c => c.signal_level === 'critical').length;
  const avgHealth = customers.length > 0
    ? Math.round(customers.reduce((s, c) => s + c.health_score, 0) / customers.length)
    : 0;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Customer Intelligence</h1>
          <p className="text-[11px] text-slate-400">
            {total} customers {filterType && `(${FILTERS.find(f => f.key === filterType)?.label})`}
            {' · '}Avg health: {avgHealth} · {offlineCount} offline · {criticalCount} critical
          </p>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search name, phone, MAC..."
            className="bg-slate-900/60 border border-slate-700/50 rounded-lg px-3 py-1.5
              text-[12px] text-slate-200 placeholder:text-slate-500 w-64
              focus:outline-none focus:border-blue-500/50"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded-lg
              text-[11px] text-blue-400 hover:bg-blue-600/30"
          >
            Search
          </button>
        </form>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => { setFilterType(f.key); setPage(1); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors
              ${filterType === f.key
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700/30 hover:bg-slate-700/50'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-700/40 bg-slate-900/40">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-900/95 backdrop-blur">
            <tr className="text-left text-slate-400 border-b border-slate-700/40">
              <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('health_score')}>
                Health <SortIcon col="health_score" />
              </th>
              <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('name')}>
                Customer <SortIcon col="name" />
              </th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('expiry')}>
                Expiry <SortIcon col="expiry" />
              </th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 cursor-pointer hover:text-white" onClick={() => handleSort('rx_power')}>
                Signal <SortIcon col="rx_power" />
              </th>
              <th className="px-3 py-2">Rx (dBm)</th>
              <th className="px-3 py-2">Port</th>
              <th className="px-3 py-2">Alarms</th>
              <th className="px-3 py-2">Profile</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-12 text-slate-500">No customers found</td></tr>
            ) : customers.map(c => {
              const expiry = formatExpiry(c.expiry_date);
              const expanded = expandedRow === c.username;
              const rowMac = c.onu_mac || c.mac_address;
              const isFocused = focus?.customerUsername === c.username
                || Boolean(rowMac && focus?.macAddress?.toLowerCase() === rowMac.toLowerCase());
              return (
                <tr
                  key={c.username}
                  onClick={() => {
                    setExpandedRow(expanded ? null : c.username);
                    focusCustomer(c);
                  }}
                  className={`border-b border-slate-800/40 cursor-pointer transition-colors
                    ${expanded ? 'bg-slate-800/40' : 'hover:bg-slate-800/20'}
                    ${c.onu_status === 'offline' ? 'bg-red-950/10' : ''}
                    ${isFocused ? 'outline outline-1 outline-cyan-500/60 bg-cyan-950/20' : ''}
                  `}
                >
                  <td className="px-3 py-2"><HealthBadge score={c.health_score} /></td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{c.name || c.username}</div>
                    {expanded && (
                      <div className="mt-1 space-y-0.5 text-[10px] text-slate-400">
                        <div>Username: {c.username}</div>
                        <div>MAC: {c.mac_address || '—'}</div>
                        {c.onu_mac && c.onu_mac !== c.mac_address && <div>ONU MAC: {c.onu_mac}</div>}
                        <div>Address: {c.address || '—'}</div>
                        <div>Balance: ₹{c.balance?.toFixed(0) ?? '—'}</div>
                        {c.monthly_data_used_mb != null && <div>Usage: {(c.monthly_data_used_mb / 1024).toFixed(1)} GB/mo</div>}
                        {c.temperature_c != null && <div>ONU Temp: {c.temperature_c}°C</div>}
                        {c.health_factors.length > 0 && (
                          <div className="text-orange-400/80">Issues: {c.health_factors.join(' · ')}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{c.phone || '—'}</td>
                  <td className="px-3 py-2 text-slate-300 max-w-[100px] truncate">{c.plan_name || '—'}</td>
                  <td className={`px-3 py-2 ${expiry.urgent ? 'text-red-400 font-medium' : 'text-slate-300'}`}>
                    {expiry.text}
                  </td>
                  <td className="px-3 py-2">
                    {c.onu_status
                      ? <StatusBadge status={c.onu_status} />
                      : <span className="text-slate-600">—</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <SignalBar rxPower={c.rx_power_dbm} />
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {c.rx_power_dbm != null ? c.rx_power_dbm.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{c.pon_port || '—'}</td>
                  <td className="px-3 py-2">
                    {c.alarm_count_24h > 0
                      ? <span className="text-red-400 font-medium">{c.alarm_count_24h}</span>
                      : <span className="text-slate-600">0</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        focusCustomer(c);
                        navigate(`/customers/${encodeURIComponent(c.username)}`);
                      }}
                      className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300 hover:bg-cyan-500/20"
                    >
                      DNA
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded bg-slate-800/50 border border-slate-700/30
                hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded bg-slate-800/50 border border-slate-700/30
                hover:bg-slate-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
