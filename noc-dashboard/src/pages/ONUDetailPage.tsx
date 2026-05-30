import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer
} from 'recharts';
import { fetchONUDetail, searchCustomersForLinking, linkONU, unlinkONU } from '../api/noc';
import type { ONUDetail, CustomerSearchItem } from '../types/noc';
import StatusBadge from '../components/shared/StatusBadge';
import { classifySignal, formatDbm, formatMac, signalColor, timeAgo } from '../utils/signal';
import { setNocFocus } from '../state/nocFocus';

const API_BASE = import.meta.env.VITE_API_URL || '';

function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const cleanBase = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function bindingBadgeClass(confidence: string | null): string {
  if (confidence === 'verified') return 'bg-green-500/20 text-green-300 border-green-500/30';
  if (confidence === 'probable') return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
}

function formatTime(iso: string): string {
  let d = new Date(iso);
  if (isNaN(d.getTime())) d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '??:??';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-lg p-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-bold font-mono" style={{ color: color || '#f1f5f9' }}>{value}</div>
    </div>
  );
}

function CustomerLinkPanel({ mac, onLinked }: { mac: string; onLinked: () => void }) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [msg, setMsg] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    searchCustomersForLinking(q)
      .then(d => setResults(d.results))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  const onInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const doLink = async (username: string) => {
    setLinking(true);
    setMsg('');
    try {
      const res = await linkONU(mac, username);
      setMsg(res.message);
      setShowSearch(false);
      setTimeout(onLinked, 500);
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Link failed');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="bg-slate-800/40 border border-amber-700/30 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-amber-400 text-sm font-medium">No customer linked</span>
        {!showSearch && (
          <button
            onClick={() => setShowSearch(true)}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors"
          >
            Link to Customer
          </button>
        )}
      </div>
      {msg && <div className="text-xs text-green-400 mb-2">{msg}</div>}
      {showSearch && (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            placeholder="Search by name, phone, or username..."
            value={query}
            onChange={(e) => onInput(e.target.value)}
            autoFocus
            className="w-full bg-slate-700/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {searching && <div className="text-xs text-slate-500">Searching...</div>}
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {results.map(c => (
                <div
                  key={c.username}
                  className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2 hover:bg-slate-700/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-200 font-medium truncate">
                      {c.name || c.username}
                      {c.has_onu_link && <span className="ml-2 text-xs text-amber-400">(already linked)</span>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {[c.phone, c.plan_name, c.address].filter(Boolean).join(' | ')}
                    </div>
                  </div>
                  <button
                    onClick={() => doLink(c.username)}
                    disabled={linking}
                    className="ml-2 px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    {linking ? '...' : 'Link'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {query.length >= 2 && !searching && results.length === 0 && (
            <div className="text-xs text-slate-500">No customers found</div>
          )}
          <button
            onClick={() => { setShowSearch(false); setQuery(''); setResults([]); }}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function ONUDetailPage() {
  const { mac } = useParams<{ mac: string }>();
  const navigate = useNavigate();
  const [onu, setOnu] = useState<ONUDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unlinkLoading, setUnlinkLoading] = useState(false);

  const loadOnu = () => {
    if (!mac) return;
    setLoading(true);
    fetchONUDetail(decodeURIComponent(mac))
      .then(setOnu)
      .catch(() => setError('ONU not found'))
      .finally(() => setLoading(false));
  };

  const reloadOnu = () => loadOnu();

  useEffect(() => { loadOnu(); }, [mac]);

  useEffect(() => {
    if (!onu) return;
    setNocFocus({
      kind: 'onu',
      label: onu.customer_name || formatMac(onu.mac_address),
      subtitle: [onu.pon_port, onu.customer_phone, onu.customer_address].filter(Boolean).join(' | ') || null,
      customerUsername: onu.binding_customer_id,
      macAddress: onu.mac_address,
      status: onu.status,
      targetUrl: `/onus/${encodeURIComponent(onu.mac_address)}`,
      source: onu.customer_match_source || 'onu_detail',
    });
  }, [onu]);

  const handleUnlink = async () => {
    if (!onu) return;
    if (!confirm(`Unlink ${onu.customer_name || 'this customer'} from ONU ${formatMac(onu.mac_address)}?`)) return;
    setUnlinkLoading(true);
    try {
      await unlinkONU(onu.mac_address);
      reloadOnu();
    } catch {
      // ignore
    } finally {
      setUnlinkLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-slate-800 rounded w-48" />
        <div className="h-48 bg-slate-800 rounded" />
      </div>
    );
  }

  if (error || !onu) {
    return (
      <div className="text-center py-16 text-slate-500">
        <div className="text-2xl mb-2">⊘</div>
        <div>{error || 'ONU not found'}</div>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-400 text-sm hover:underline">Go back</button>
      </div>
    );
  }

  const level = classifySignal(onu.rx_power_dbm);
  const rxColor = signalColor(level);
  const chartData = onu.history_24h.map((h) => ({
    time: formatTime(h.timestamp),
    rx: h.rx_power_dbm,
    tx: h.tx_power_dbm,
  }));

  const hasCustomer = Boolean(onu.customer_name);
  const expiryDate = onu.customer_expiry ? new Date(onu.customer_expiry) : null;
  const expiryStr = expiryDate ? expiryDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  const isExpired = expiryDate ? expiryDate < new Date() : false;
  const hasTrustedBinding = Boolean(onu.binding_id);
  const bindingStickerUrl = mediaUrl(onu.binding_sticker_photo_url);
  const primaryBindingValue = onu.binding_primary_identifier_type === 'serial'
    ? (onu.binding_serial_number || onu.mac_address)
    : (onu.binding_mac_address || onu.mac_address);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Back */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-200 text-sm">
          ← Back
        </button>
        <h1 className="text-base font-bold text-slate-200 font-mono">{formatMac(onu.mac_address)}</h1>
        <StatusBadge status={onu.status} />
        {onu.dying_gasp && (
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs font-medium">⚡ Dying Gasp</span>
        )}
      </div>

      {/* Customer Card */}
      {hasCustomer ? (
        <div className="bg-slate-800/60 border border-blue-700/30 rounded-xl p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-xs text-blue-400 uppercase tracking-wider mb-0.5">Customer</div>
              <div className="text-lg font-semibold text-slate-100">{onu.customer_name}</div>
            </div>
            <div className="flex items-center gap-2">
              {onu.customer_status && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  onu.customer_status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>{onu.customer_status}</span>
              )}
              <button
                onClick={handleUnlink}
                disabled={unlinkLoading}
                className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {unlinkLoading ? 'Unlinking...' : 'Unlink'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {onu.customer_phone && (
              <div className="bg-slate-900/60 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">Phone</div>
                <div className="text-slate-200 font-medium">{onu.customer_phone}</div>
              </div>
            )}
            {onu.customer_plan && (
              <div className="bg-slate-900/60 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">Plan</div>
                <div className="text-slate-200 font-medium">{onu.customer_plan}</div>
              </div>
            )}
            {expiryStr && (
              <div className="bg-slate-900/60 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">Expiry</div>
                <div className={`font-medium ${isExpired ? 'text-red-400' : 'text-slate-200'}`}>
                  {expiryStr}{isExpired ? ' ⚠ Expired' : ''}
                </div>
              </div>
            )}
            {onu.customer_balance != null && (
              <div className="bg-slate-900/60 rounded-lg p-2.5">
                <div className="text-slate-500 mb-0.5">Balance</div>
                <div className={`font-medium ${onu.customer_balance < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  ₹{onu.customer_balance.toFixed(2)}
                </div>
              </div>
            )}
          </div>
          {onu.customer_address && (
            <div className="mt-3 text-xs text-slate-400 bg-slate-900/40 rounded-lg px-3 py-2">
              <span className="text-slate-500">Address: </span>{onu.customer_address}
            </div>
          )}
        </div>
      ) : (
        <CustomerLinkPanel mac={onu.mac_address} onLinked={reloadOnu} />
      )}

      {/* Trusted Binding */}
      {hasTrustedBinding ? (
        <div className="bg-green-950/20 border border-green-700/40 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-xs text-green-400 uppercase tracking-wider mb-0.5">Trusted ONU Binding</div>
              <div className="text-sm text-slate-300">
                Customer match source: <span className="text-green-300 font-medium">{onu.customer_match_source}</span>
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded border text-xs font-medium ${bindingBadgeClass(onu.binding_confidence)}`}>
              {onu.binding_confidence || 'unknown'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div className="bg-slate-900/50 rounded-lg p-2.5">
              <div className="text-slate-500 mb-0.5">Primary</div>
              <div className="text-slate-100 font-mono break-all">{primaryBindingValue}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2.5">
              <div className="text-slate-500 mb-0.5">Serial</div>
              <div className="text-slate-100 font-mono break-all">{onu.binding_serial_number || '-'}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2.5">
              <div className="text-slate-500 mb-0.5">MAC</div>
              <div className="text-slate-100 font-mono break-all">{onu.binding_mac_address || '-'}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2.5">
              <div className="text-slate-500 mb-0.5">Source</div>
              <div className="text-slate-100">{onu.binding_source || '-'}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-2.5">
              <div className="text-slate-500 mb-0.5">Verified</div>
              <div className="text-slate-100">{timeAgo(onu.binding_verified_at)}</div>
            </div>
          </div>
          {bindingStickerUrl && (
            <a
              href={bindingStickerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex mt-3 text-xs text-green-300 hover:text-green-200 hover:underline"
            >
              Open captured sticker photo
            </a>
          )}
        </div>
      ) : (
        <div className="bg-amber-950/20 border border-amber-700/40 rounded-xl p-4">
          <div className="text-xs text-amber-400 uppercase tracking-wider mb-1">No Trusted ONU Binding</div>
          <div className="text-sm text-slate-300">
            {onu.customer_match_source === 'legacy_fuzzy'
              ? 'This customer match is still coming from legacy MAC bridge/fuzzy matching. Field survey or admin verification should create the trusted binding.'
              : 'No verified survey/admin binding exists yet for this ONU.'}
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Rx Power" value={formatDbm(onu.rx_power_dbm)} color={rxColor} />
        <Metric label="Tx Power" value={formatDbm(onu.tx_power_dbm)} color="#3b82f6" />
        <Metric label="Temperature" value={onu.temperature_c != null ? `${onu.temperature_c}°C` : 'N/A'}
          color={onu.temperature_c != null && onu.temperature_c > 65 ? '#ef4444' : '#22c55e'} />
        <Metric label="Voltage" value={onu.voltage_mv != null ? `${onu.voltage_mv} mV` : 'N/A'} />
        <Metric label="PON Port" value={onu.pon_port || '-'} />
        <Metric label="ONU Index" value={onu.onu_index != null ? `#${onu.onu_index}` : '-'} />
        <Metric label="OLT Host" value={onu.olt_host} />
        <Metric label="Last Seen" value={timeAgo(onu.polled_at)} />
      </div>

      {/* 24h Signal Chart */}
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
          24h Signal History ({chartData.length} samples)
        </h2>
        {chartData.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-slate-500 text-sm">No history data</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false}
                axisLine={{ stroke: '#334155' }} interval="preserveStartEnd" />
              <YAxis domain={[-35, -10]} tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value, name) => [`${Number(value).toFixed(1)} dBm`, name === 'rx' ? 'Rx Power' : 'Tx Power']}
              />
              <ReferenceLine y={-27} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.5} />
              <ReferenceLine y={-24} stroke="#eab308" strokeDasharray="4 4" strokeWidth={1.5} />
              <Line type="monotone" dataKey="rx" name="Rx" stroke="#3b82f6" strokeWidth={2} dot={false}
                activeDot={{ r: 3 }} />
              <Line type="monotone" dataKey="tx" name="Tx" stroke="#22c55e" strokeWidth={1.5}
                dot={false} strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
