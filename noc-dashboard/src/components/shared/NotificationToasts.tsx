import type { AlarmNotification } from '../../hooks/useAlarmNotifications';

const SEVERITY_STYLES = {
  critical: {
    bg: 'bg-red-950/95 border-red-500/50',
    icon: '🔴',
    text: 'text-red-300',
  },
  warning: {
    bg: 'bg-orange-950/95 border-orange-500/50',
    icon: '🟠',
    text: 'text-orange-300',
  },
  info: {
    bg: 'bg-yellow-950/95 border-yellow-500/50',
    icon: '🟡',
    text: 'text-yellow-300',
  },
};

interface Props {
  notifications: AlarmNotification[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}

export default function NotificationToasts({ notifications, onDismiss, onDismissAll }: Props) {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto w-80">
      {notifications.length > 3 && (
        <button
          onClick={onDismissAll}
          className="text-[10px] text-slate-500 hover:text-slate-300 text-right px-1 transition-colors"
        >
          Dismiss all ({notifications.length})
        </button>
      )}
      {notifications.map((n) => {
        const style = SEVERITY_STYLES[n.severity];
        const age = Math.round((Date.now() - n.timestamp) / 1000);
        return (
          <div
            key={n.id}
            className={`${style.bg} border rounded-lg px-3 py-2 shadow-xl backdrop-blur-sm
              animate-slide-in cursor-pointer transition-opacity hover:opacity-80`}
            onClick={() => onDismiss(n.id)}
          >
            <div className="flex items-start gap-2">
              <span className="text-sm mt-0.5">{style.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold ${style.text}`}>
                  {n.event_type.replace(/_/g, ' ')}
                </div>
                <div className="text-[11px] text-slate-300 font-mono truncate">
                  {n.mac_address}
                </div>
                {n.customer_name && (
                  <div className="text-[10px] text-slate-400">{n.customer_name}</div>
                )}
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {n.pon_port && <span>Port {n.pon_port} · </span>}
                  {age < 5 ? 'Just now' : `${age}s ago`}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }}
                className="text-slate-600 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
