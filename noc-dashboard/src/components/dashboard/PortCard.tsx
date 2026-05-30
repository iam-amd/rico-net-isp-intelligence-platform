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
  const rawPort = port.pon_port || '';
  const hasValidPort = /^(epon|gpon)?0\/\d+$/i.test(rawPort) || /^(\d+\/)?\d+$/.test(rawPort);
  const portLabel = hasValidPort ? rawPort.toUpperCase().replace(/^0\//, '') : null;

  return (
    <div
      onClick={onClick}
      className={`bg-slate-800/60 border rounded-xl p-3 cursor-pointer transition-all hover:bg-slate-700/60 ${
        hasIssue ? 'border-red-500/50' : 'border-slate-700/50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-base font-bold text-slate-200">
          {hasValidPort ? `Port ${portLabel}` : 'Collector Pool'}
        </span>
        <span className="text-xs font-mono text-slate-400">
          {port.total} ONUs
        </span>
      </div>

      <div className="h-2.5 rounded-full overflow-hidden flex mb-2 bg-slate-700">
        <div
          className="bg-green-500 transition-all duration-700"
          style={{ width: `${onlinePct}%` }}
        />
        {port.offline > 0 && (
          <div
            className="bg-red-500 transition-all duration-700"
            style={{ width: `${offlinePct}%` }}
          />
        )}
      </div>

      <div className="flex justify-between text-xs mb-2">
        <span className="text-green-400">
          {port.online} observed online
        </span>
        <span className={port.offline > 0 ? 'text-red-400' : 'text-slate-500'}>
          {port.offline} offline/not seen
        </span>
      </div>

      {!hasValidPort ? (
        <div className="text-xs text-slate-400">
          Aggregated simulator records awaiting exact PON slot labels.
        </div>
      ) : port.avg_rx != null ? (
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className="text-slate-400">
            Avg <span className="font-mono">{formatDbm(port.avg_rx)}</span>
          </span>
          <span style={{ color: signalColor(worstLevel) }} className="text-right">
            Worst <span className="font-mono">{formatDbm(port.worst_rx)}</span>
          </span>
        </div>
      ) : (
        <div className="text-xs text-slate-500">No signal data</div>
      )}
    </div>
  );
}
