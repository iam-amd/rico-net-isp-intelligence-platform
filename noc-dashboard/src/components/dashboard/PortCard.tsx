import type { PortStatus } from '../../types/noc';
import { formatDbm, classifySignal, signalColor } from '../../utils/signal';

interface PortCardProps {
  port: PortStatus;
  onClick?: () => void;
}

export default function PortCard({ port, onClick }: PortCardProps) {
  const onlinePct = port.total > 0 ? (port.online / port.total) * 100 : 0;
  const offlinePct = 100 - onlinePct;
  const worstLevel = classifySignal(port.worst_rx);
  const hasIssue = port.offline >= 3 && offlinePct >= 15;
  const stale = port.data_is_stale;
  const hasValidPort = /^(\d+\/)?\d+$/.test(port.pon_port || '');
  const portLabel = hasValidPort ? port.pon_port.replace(/^0\//, '') : null;

  return (
    <div
      onClick={onClick}
      className={`bg-slate-800/60 border rounded-xl p-3 cursor-pointer transition-all hover:bg-slate-700/60 ${
        stale ? 'border-red-500/40 bg-red-950/10' : (hasIssue ? 'border-red-500/50' : 'border-slate-700/50')
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-base font-bold ${hasValidPort ? 'text-slate-200' : 'text-amber-300'}`}>
          {hasValidPort ? `Port ${portLabel}` : 'Unclassified records'}
        </span>
        <span className={`text-xs font-mono ${stale ? 'text-red-300' : 'text-slate-400'}`}>
          {stale ? 'last known' : `${port.total} ONUs`}
        </span>
      </div>

      <div className={`h-2.5 rounded-full overflow-hidden flex mb-2 ${stale ? 'bg-red-950/50' : 'bg-slate-700'}`}>
        <div
          className={`${stale ? 'bg-green-500/35' : 'bg-green-500'} transition-all duration-700`}
          style={{ width: `${onlinePct}%` }}
        />
        {port.offline > 0 && (
          <div
            className={`${stale ? 'bg-red-500/40' : 'bg-red-500'} transition-all duration-700`}
            style={{ width: `${offlinePct}%` }}
          />
        )}
      </div>

      <div className="flex justify-between text-xs mb-2">
        <span className={stale ? 'text-green-300/60' : 'text-green-400'}>
          {port.online} {stale ? 'last online' : 'observed online'}
        </span>
        <span className={stale ? 'text-red-300/70' : (port.offline > 0 ? 'text-red-400' : 'text-slate-500')}>
          {port.offline} {stale ? 'last offline' : 'offline/not seen'}
        </span>
      </div>

      {!hasValidPort ? (
        <div className="text-xs text-amber-300">
          Missing PON slot from collector; not treated as a real port.
        </div>
      ) : port.avg_rx != null ? (
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className={stale ? 'text-slate-500' : 'text-slate-400'}>
            Avg <span className="font-mono">{formatDbm(port.avg_rx)}</span>
          </span>
          <span style={{ color: stale ? '#fca5a5' : signalColor(worstLevel) }} className="text-right">
            Worst <span className="font-mono">{formatDbm(port.worst_rx)}</span>
          </span>
        </div>
      ) : (
        <div className="text-xs text-slate-500">No signal data</div>
      )}
      {stale && (
        <div className="mt-2 rounded border border-red-500/30 bg-red-950/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-200">
          Not live
        </div>
      )}
    </div>
  );
}
