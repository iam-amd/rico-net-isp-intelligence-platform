import { useCallback, useEffect, useState } from 'react';
import type { PortStatus } from '../../types/noc';
import { fetchPorts } from '../../api/noc';
import PortCard from './PortCard';

const OLT_NAMES: Record<string, string> = {
  '100': 'EPON .100',
  '200': 'GPON .200',
  '210': 'GPON .210',
};

function oltName(host: string): string {
  const last = host.split('.').pop() || host;
  return OLT_NAMES[last] ?? host;
}

function portSortKey(pon_port: string): number {
  const m = pon_port.match(/(\d+)$/);
  return m ? parseInt(m[1]) : 0;
}

interface PortGridProps {
  oltHost?: string;
  pollInterval?: number;
}

export default function PortGrid({ oltHost, pollInterval = 10000 }: PortGridProps) {
  const [ports, setPorts] = useState<PortStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPorts(oltHost);
      setPorts(data);
    } catch {
      // Retry on the next interval; stale state is handled by the API payload.
    } finally {
      setLoading(false);
    }
  }, [oltHost]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollInterval);
    return () => clearInterval(id);
  }, [refresh, pollInterval]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 h-36 animate-pulse" />
        ))}
      </div>
    );
  }

  const byOlt: Record<string, PortStatus[]> = {};
  for (const p of ports) {
    const host = p.olt_host || 'unknown';
    if (!byOlt[host]) byOlt[host] = [];
    byOlt[host].push(p);
  }
  for (const host of Object.keys(byOlt)) {
    byOlt[host].sort((a, b) => portSortKey(a.pon_port) - portSortKey(b.pon_port));
  }

  const oltOrder = Object.keys(byOlt).sort((a, b) => {
    const aLast = parseInt(a.split('.').pop() || '0');
    const bLast = parseInt(b.split('.').pop() || '0');
    return aLast - bLast;
  });

  const totalPorts = ports.length;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          PON Ports ({totalPorts})
        </h2>
        <span className="rounded border border-blue-500/30 bg-blue-950/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-200">
          Demo OLT simulation
        </span>
      </div>

      {oltOrder.map((host) => {
        const hostPorts = byOlt[host];
        const totalOnus = hostPorts.reduce((s, p) => s + p.total, 0);
        const onlineOnus = hostPorts.reduce((s, p) => s + p.online, 0);
        const offlineOnus = totalOnus - onlineOnus;
        const last = host.split('.').pop();
        const typeTag = last === '100' ? 'EPON' : 'GPON';
        return (
          <div key={host}>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                typeTag === 'EPON'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-purple-500/20 text-purple-400'
              }`}>
                {typeTag}
              </span>
              <span className="text-xs font-semibold text-slate-300">{oltName(host)}</span>
              <span className="text-xs text-slate-500">{hostPorts.length} ports - {totalOnus} ONUs</span>
              <span className="text-xs text-green-500">
                {onlineOnus} observed online
              </span>
              {offlineOnus > 0 && (
                <span className="text-xs text-red-400">
                  {offlineOnus} offline/not seen
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-1">
              {hostPorts.map((port) => (
                <PortCard key={`${port.olt_host}-${port.pon_port}`} port={port} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
