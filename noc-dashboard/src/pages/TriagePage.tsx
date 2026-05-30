import { useState, useEffect, useCallback } from 'react';
import { fetchTriage, rebootONU } from '../api/noc';
import type { TriageData, FaultItem } from '../types/noc';

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  CRITICAL: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', badge: 'bg-red-500/20 text-red-400' },
  HIGH:     { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', badge: 'bg-orange-500/20 text-orange-400' },
  MEDIUM:   { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-400' },
};

const FAULT_ICONS: Record<string, string> = {
  FIBER_CRITICAL: '🔴',
  FIBER_CRITICAL_OFFLINE: '🔴',
  ONU_OFFLINE: '🟠',
  POWER_CUT: '⚡',
  FIBER_WEAK: '🟡',
  FIBER_FLAP: '📶',
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY_STYLES[severity] || SEVERITY_STYLES.MEDIUM;
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${s.badge}`}>
      {severity}
    </span>
  );
}

function FaultTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    FIBER_CRITICAL: 'bg-red-900/50 text-red-300 border-red-500/20',
    FIBER_CRITICAL_OFFLINE: 'bg-red-900/50 text-red-300 border-red-500/20',
    ONU_OFFLINE: 'bg-orange-900/50 text-orange-300 border-orange-500/20',
    POWER_CUT: 'bg-purple-900/50 text-purple-300 border-purple-500/20',
    FIBER_WEAK: 'bg-yellow-900/50 text-yellow-300 border-yellow-500/20',
    FIBER_FLAP: 'bg-amber-900/50 text-amber-300 border-amber-500/20',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${colors[type] || 'bg-slate-700 text-slate-300 border-slate-600'}`}>
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function FaultCard({ fault, onReboot }: { fault: FaultItem; onReboot: (mac: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const s = SEVERITY_STYLES[fault.severity] || SEVERITY_STYLES.MEDIUM;

  const handleReboot = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRebooting(true);
    onReboot(fault.mac_address);
    setTimeout(() => setRebooting(false), 3000);
  };

  return (
    <div
      className={`${s.bg} border ${s.border} rounded-lg p-3 cursor-pointer transition-all hover:brightness-110`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg shrink-0">{FAULT_ICONS[fault.fault_type] || '⚠'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <FaultTypeBadge type={fault.fault_type} />
              <SeverityBadge severity={fault.severity} />
              {fault.alarm_count_24h > 0 && (
                <span className="text-[10px] text-slate-500">{fault.alarm_count_24h} alarms/24h</span>
              )}
            </div>
            <div className="text-xs font-mono text-slate-300 mt-1">{fault.mac_address}</div>
            {fault.customer_name && (
              <div className="text-xs text-slate-400">
                {fault.customer_name}
                {fault.customer_phone && <span className="text-slate-500 ml-2">{fault.customer_phone}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-slate-500 font-mono">{fault.pon_port || '—'}</div>
          <div className="text-xs mt-0.5">
            {fault.rx_power_dbm !== null ? (
              <span className={fault.rx_power_dbm < -27 ? 'text-red-400' : fault.rx_power_dbm < -24 ? 'text-orange-400' : 'text-slate-400'}>
                {fault.rx_power_dbm} dBm
              </span>
            ) : (
              <span className="text-slate-600">No signal</span>
            )}
          </div>
        </div>
      </div>

      {/* Action suggestion */}
      <div className="mt-2 text-xs text-slate-400 italic">
        {fault.action}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-700/30 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-slate-500">Status:</span>{' '}
              <span className={fault.status === 'online' ? 'text-emerald-400' : 'text-red-400'}>
                {fault.status || 'unknown'}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Tx:</span>{' '}
              <span className="text-slate-300">{fault.tx_power_dbm ?? '—'} dBm</span>
            </div>
            <div>
              <span className="text-slate-500">Temp:</span>{' '}
              <span className="text-slate-300">{fault.temperature_c ?? '—'}°C</span>
            </div>
            <div>
              <span className="text-slate-500">OLT:</span>{' '}
              <span className="text-slate-300 font-mono">{fault.olt_host}</span>
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {(fault.fault_type === 'ONU_OFFLINE' || fault.fault_type === 'FIBER_CRITICAL_OFFLINE') && (
              <button
                onClick={handleReboot}
                disabled={rebooting}
                className="px-3 py-1.5 bg-blue-600/30 text-blue-300 rounded text-xs font-medium
                           hover:bg-blue-600/50 transition-all disabled:opacity-50 border border-blue-500/20"
              >
                {rebooting ? 'Rebooting...' : 'Reboot ONU'}
              </button>
            )}
            <button
              className="px-3 py-1.5 bg-slate-700/50 text-slate-300 rounded text-xs font-medium
                         hover:bg-slate-600/50 transition-all border border-slate-600/30"
              onClick={(e) => { e.stopPropagation(); window.open(`/onus/${encodeURIComponent(fault.mac_address)}`, '_self'); }}
            >
              View Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TriagePage() {
  const [data, setData] = useState<TriageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [rebootStatus, setRebootStatus] = useState<{ mac: string; status: 'ok' | 'fail' } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchTriage();
      setData(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000); // Refresh every 30s for triage
    return () => clearInterval(interval);
  }, [load]);

  const handleReboot = useCallback(async (mac: string) => {
    try {
      await rebootONU(mac);
      setRebootStatus({ mac, status: 'ok' });
    } catch {
      setRebootStatus({ mac, status: 'fail' });
    }
    setTimeout(() => setRebootStatus(null), 5000);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-slate-400 animate-pulse">Loading triage data...</div>
    </div>
  );

  if (!data) return (
    <div className="text-red-400 text-center mt-20">Failed to load</div>
  );

  const { summary, fault_breakdown, faults } = data;

  const filteredFaults = filter === 'all'
    ? faults
    : faults.filter(f => f.severity === filter || f.fault_type === filter);

  return (
    <div className="space-y-5">
      {/* Reboot toast */}
      {rebootStatus && (
        <div className={`fixed top-20 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${
          rebootStatus.status === 'ok'
            ? 'bg-emerald-600/90 text-white'
            : 'bg-red-600/90 text-white'
        }`}>
          {rebootStatus.status === 'ok'
            ? `Reboot sent to ${rebootStatus.mac}`
            : `Reboot failed for ${rebootStatus.mac}`
          }
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Diagnostics & Triage</h1>
        <p className="text-sm text-slate-400 mt-1">
          {summary.total_faults} active faults · {summary.total_healthy} healthy ONUs · Auto-refreshes every 30s
        </p>
      </div>

      {/* Severity KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          className={`bg-red-500/10 border border-red-500/20 rounded-xl p-4 cursor-pointer transition-all ${filter === 'CRITICAL' ? 'ring-2 ring-red-500' : ''}`}
          onClick={() => setFilter(filter === 'CRITICAL' ? 'all' : 'CRITICAL')}
        >
          <div className="text-xs text-red-400 uppercase tracking-wider">Critical</div>
          <div className="text-3xl font-bold text-red-400">{summary.critical}</div>
          <div className="text-xs text-slate-500">Immediate dispatch</div>
        </div>
        <div
          className={`bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 cursor-pointer transition-all ${filter === 'HIGH' ? 'ring-2 ring-orange-500' : ''}`}
          onClick={() => setFilter(filter === 'HIGH' ? 'all' : 'HIGH')}
        >
          <div className="text-xs text-orange-400 uppercase tracking-wider">High</div>
          <div className="text-3xl font-bold text-orange-400">{summary.high}</div>
          <div className="text-xs text-slate-500">Reboot / call customer</div>
        </div>
        <div
          className={`bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 cursor-pointer transition-all ${filter === 'MEDIUM' ? 'ring-2 ring-yellow-500' : ''}`}
          onClick={() => setFilter(filter === 'MEDIUM' ? 'all' : 'MEDIUM')}
        >
          <div className="text-xs text-yellow-400 uppercase tracking-wider">Medium</div>
          <div className="text-3xl font-bold text-yellow-400">{summary.medium}</div>
          <div className="text-xs text-slate-500">Schedule maintenance</div>
        </div>
        <div
          className={`bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 cursor-pointer transition-all ${filter === 'all' ? 'ring-2 ring-emerald-500' : ''}`}
          onClick={() => setFilter('all')}
        >
          <div className="text-xs text-emerald-400 uppercase tracking-wider">Healthy</div>
          <div className="text-3xl font-bold text-emerald-400">{summary.total_healthy}</div>
          <div className="text-xs text-slate-500">No issues</div>
        </div>
      </div>

      {/* Fault type breakdown + filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
            filter === 'all'
              ? 'bg-blue-600/30 text-blue-300 border-blue-500/30'
              : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-white'
          }`}
        >
          All Faults ({summary.total_faults})
        </button>
        {fault_breakdown.map(fb => (
          <button
            key={fb.fault_type}
            onClick={() => setFilter(filter === fb.fault_type ? 'all' : fb.fault_type)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              filter === fb.fault_type
                ? 'bg-blue-600/30 text-blue-300 border-blue-500/30'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/50 hover:text-white'
            }`}
          >
            {fb.fault_type.replace(/_/g, ' ')} ({fb.count})
          </button>
        ))}
      </div>

      {/* Fault list */}
      <div className="space-y-2">
        {filteredFaults.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            {filter === 'all' ? 'No active faults — all ONUs healthy!' : `No ${filter} faults`}
          </div>
        ) : (
          filteredFaults.map(fault => (
            <FaultCard key={fault.mac_address} fault={fault} onReboot={handleReboot} />
          ))
        )}
      </div>
    </div>
  );
}
