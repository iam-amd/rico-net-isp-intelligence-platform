import { classifySignal, signalColor, formatDbm } from '../../utils/signal';

interface SignalBarProps {
  rxPower: number | null;
  showValue?: boolean;
}

export default function SignalBar({ rxPower, showValue = true }: SignalBarProps) {
  const level = classifySignal(rxPower);
  const color = signalColor(level);

  // Map dBm to percentage (0 = -30 dBm, 100 = -8 dBm)
  const pct = rxPower != null
    ? Math.max(0, Math.min(100, ((rxPower + 30) / 22) * 100))
    : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {showValue && (
        <span className="text-xs font-mono whitespace-nowrap" style={{ color }}>
          {formatDbm(rxPower)}
        </span>
      )}
    </div>
  );
}
