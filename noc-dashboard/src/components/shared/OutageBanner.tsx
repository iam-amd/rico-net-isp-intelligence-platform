import { useCallback, useEffect, useState } from 'react';
import type { OutageEvent } from '../../types/noc';
import { fetchOutages, fetchSummary } from '../../api/noc';

export default function OutageBanner() {
  const [outages, setOutages] = useState<OutageEvent[]>([]);
  const [stale, setStale] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, summary] = await Promise.all([fetchOutages(), fetchSummary()]);
      setOutages(data);
      setStale(summary.data_is_stale || summary.live_data_available === false);
    } catch {
      // Keep the last known banner state until the next successful poll.
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (outages.length === 0) return null;

  const hasCritical = !stale && outages.some((o) => o.severity === 'CRITICAL' || o.severity === 'TOTAL');
  const totalOutage = stale ? undefined : outages.find((o) => o.severity === 'TOTAL');

  return (
    <>
      {totalOutage && !dismissed && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-red-950/80 backdrop-blur-sm glow-red cursor-pointer"
          onClick={() => setDismissed(true)}
        >
          <div className="text-center">
            <div className="text-6xl mb-4">!</div>
            <div className="text-3xl font-black text-red-400 mb-2">TOTAL PORT OUTAGE</div>
            <div className="text-xl text-red-300 mb-1">
              {totalOutage.pon_port.toUpperCase()} - {totalOutage.affected_count}/{totalOutage.total_count} ONUs offline
            </div>
            <div className="text-sm text-red-400/60 mt-6">Click to dismiss</div>
          </div>
        </div>
      )}

      <div className={`border-b px-5 py-2 flex items-center gap-4 flex-wrap ${
        stale
          ? 'bg-red-950/35 border-red-900/50'
          : hasCritical
            ? 'bg-red-950/60 border-red-800/60'
            : 'bg-orange-950/60 border-orange-800/60'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${stale ? 'text-red-200' : hasCritical ? 'text-red-400' : 'text-orange-400'}`}>
            ! {outages.length} {stale ? 'LAST-KNOWN OUTAGE' : 'ACTIVE OUTAGE'}{outages.length !== 1 ? 'S' : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {outages.map((o) => (
            <span key={`${o.olt_host}-${o.pon_port}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                stale
                  ? 'bg-red-500/10 text-red-200 border border-red-500/25'
                  : o.severity === 'CRITICAL' || o.severity === 'TOTAL'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full bg-current ${stale ? '' : 'pulse-dot'}`} />
              {o.pon_port.toUpperCase()} - {o.affected_count}/{o.total_count} {stale ? 'last offline' : 'offline'}
              <span className="opacity-60">({stale ? 'STALE' : o.severity})</span>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
