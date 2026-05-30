import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ONUListItem } from '../../types/noc';
import { fetchONUs } from '../../api/noc';
import StatusBadge from '../shared/StatusBadge';
import SignalBar from '../shared/SignalBar';
import { formatMac, timeAgo } from '../../utils/signal';
import { setNocFocus, useNocFocus } from '../../state/nocFocus';

interface ONUTableProps {
  initialStatus?: string;
  initialPort?: string;
  showUnlinkedFilter?: boolean;
}

export default function ONUTable({ initialStatus, initialPort, showUnlinkedFilter }: ONUTableProps) {
  const navigate = useNavigate();
  const { focus } = useNocFocus();
  const [onus, setOnus] = useState<ONUListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(initialStatus || '');
  const [portFilter, setPortFilter] = useState(initialPort || '');
  const [oltFilter, setOltFilter] = useState('');
  const [search, setSearch] = useState('');
  const [linkedFilter, setLinkedFilter] = useState('');

  const PAGE_SIZE = 25;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchONUs({
        page,
        page_size: PAGE_SIZE,
        status: statusFilter || undefined,
        pon_port: portFilter || undefined,
        olt_host: oltFilter || undefined,
        search: search || undefined,
        linked: linkedFilter || undefined,
      });
      setOnus(data.onus);
      setTotal(data.total);
    } catch {
      // Will retry
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, portFilter, oltFilter, search, linkedFilter]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [statusFilter, portFilter, oltFilter, search, linkedFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl">
      {/* Filters */}
      <div className="px-4 py-3 border-b border-slate-700/50 flex flex-wrap gap-3 items-center">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mr-auto">
          ONUs ({total})
        </h2>
        <input
          type="text"
          placeholder="Search MAC..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 w-40 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
        <select
          value={oltFilter}
          onChange={(e) => setOltFilter(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All OLTs</option>
          <option value="10.10.10.100">EPON .100</option>
          <option value="10.10.10.200">GPON .200</option>
          <option value="10.10.10.210">GPON .210</option>
        </select>
        <select
          value={portFilter}
          onChange={(e) => setPortFilter(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Ports</option>
          <optgroup label="EPON (.100)">
            {[...Array(8)].map((_, i) => (
              <option key={`epon-${i}`} value={`0/${i + 1}`}>EPON 0/{i + 1}</option>
            ))}
          </optgroup>
          <optgroup label="GPON (.200 / .210)">
            {[...Array(8)].map((_, i) => (
              <option key={`gpon-${i}`} value={String(i)}>GPON {i}</option>
            ))}
          </optgroup>
        </select>
        {showUnlinkedFilter !== false && (
          <select
            value={linkedFilter}
            onChange={(e) => setLinkedFilter(e.target.value)}
            className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All ONUs</option>
            <option value="unlinked">Unlinked Only</option>
            <option value="linked">Linked Only</option>
          </select>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700/50">
              <th className="px-4 py-2 font-medium">Customer / MAC</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">PON Port</th>
              <th className="px-4 py-2 font-medium">Rx Power</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Last Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading && onus.length === 0 ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-slate-700 rounded animate-pulse" /></td></tr>
              ))
            ) : onus.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No ONUs match filters</td></tr>
            ) : (
              onus.map((onu) => {
                const isFocused = focus?.macAddress?.toLowerCase() === onu.mac_address.toLowerCase();
                return (
                <tr key={onu.mac_address}
                  className={`transition-colors cursor-pointer ${isFocused ? 'bg-cyan-950/25 outline outline-1 outline-cyan-500/50' : 'hover:bg-slate-700/30'}`}
                  onClick={() => {
                    setNocFocus({
                      kind: 'onu',
                      label: onu.customer_name || formatMac(onu.mac_address),
                      subtitle: [onu.pon_port, onu.customer_phone].filter(Boolean).join(' | ') || null,
                      macAddress: onu.mac_address,
                      status: onu.status,
                      targetUrl: `/onus/${encodeURIComponent(onu.mac_address)}`,
                      source: 'onu_table',
                    });
                    navigate(`/onus/${encodeURIComponent(onu.mac_address)}`);
                  }}>
                  <td className="px-4 py-2">
                    {onu.customer_name ? (
                      <div>
                        <div className="text-slate-200 font-medium text-xs">{onu.customer_name}</div>
                        <div className="font-mono text-slate-500 text-xs">{formatMac(onu.mac_address)}</div>
                      </div>
                    ) : (
                      <div className="font-mono text-blue-300 text-xs">{formatMac(onu.mac_address)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2"><StatusBadge status={onu.status} /></td>
                  <td className="px-4 py-2 text-slate-400">{onu.pon_port || '-'}</td>
                  <td className="px-4 py-2 w-40"><SignalBar rxPower={onu.rx_power_dbm} /></td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{onu.customer_plan || '-'}</td>
                  <td className="px-4 py-2 text-slate-500">{timeAgo(onu.polled_at)}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-slate-700/50 flex justify-between items-center">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="text-xs px-3 py-1 bg-slate-700 rounded disabled:opacity-30 hover:bg-slate-600 transition-colors text-slate-200"
          >
            Prev
          </button>
          <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="text-xs px-3 py-1 bg-slate-700 rounded disabled:opacity-30 hover:bg-slate-600 transition-colors text-slate-200"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
