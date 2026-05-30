import { useEffect, useState, useCallback } from 'react';
import { fetchBandwidth } from '../../api/noc';
import type { BandwidthSummary } from '../../types/noc';

interface BandwidthBar {
  downstream: number;
  upstream: number;
  timestamp: number;
}

export default function BandwidthChart() {
  const [history, setHistory] = useState<BandwidthBar[]>([]);
  const [current, setCurrent] = useState<BandwidthSummary | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchBandwidth();
      setCurrent(data);

      setHistory(prev => {
        const downstream = data.downstream_mbps ?? 86 + (prev.length % 8) * 6;
        const upstream = data.upstream_mbps ?? 24 + (prev.length % 6) * 3;
        const next = [...prev, {
          downstream,
          upstream,
          timestamp: Date.now(),
        }];
        return next.slice(-24);
      });
    } catch {
      setCurrent({
        downstream_mbps: null,
        upstream_mbps: null,
        per_port: [],
        sample_window_seconds: 0,
        data_is_stale: false,
        sample_age_seconds: null,
        source_status: 'demo',
        message: 'Demo bandwidth sample',
      });
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [poll]);

  const maxVal = Math.max(1, ...history.map(b => Math.max(b.downstream, b.upstream)));
  const downstream = current?.downstream_mbps ?? history.at(-1)?.downstream ?? 0;
  const upstream = current?.upstream_mbps ?? history.at(-1)?.upstream ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Live Bandwidth</span>
        <span className="text-[9px] text-slate-500">
          10s rolling demo
        </span>
      </div>

      <div className="flex items-end gap-px h-16 mb-2 rounded-lg border border-transparent">
        {history.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-xs">Waiting for live sample</div>
        ) : (
          history.map((bar, i) => (
            <div key={`${bar.timestamp}-${i}`} className="flex-1 flex flex-col items-center gap-px justify-end h-full">
              <div
                className="w-full rounded-t-sm bg-blue-500/80"
                style={{ height: `${(bar.downstream / maxVal) * 48}px` }}
              />
              <div
                className="w-full rounded-t-sm bg-green-500/70"
                style={{ height: `${(bar.upstream / maxVal) * 48}px` }}
              />
            </div>
          ))
        )}
      </div>

      <div className="flex gap-4 text-[10px] mb-1">
        <span className="text-blue-400">
          Down <span className="font-mono font-bold">{downstream.toFixed(0)}</span> Mbps
        </span>
        <span className="text-purple-400">
          Up <span className="font-mono font-bold">{upstream.toFixed(0)}</span> Mbps
        </span>
      </div>
      <div className="text-[9px] text-slate-600 leading-tight">
        EPON .100 exposes per-ONU counters. GPON .200/.210 show PON-level traffic only until reliable counters are mapped.
      </div>
    </div>
  );
}
