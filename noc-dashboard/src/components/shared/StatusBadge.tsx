interface StatusBadgeProps {
  status: string | null;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const s = (status || 'unknown').toLowerCase();

  let classes = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium';

  if (s === 'online') {
    classes += ' bg-green-500/20 text-green-400';
  } else if (s === 'offline') {
    classes += ' bg-red-500/20 text-red-400';
  } else {
    classes += ' bg-gray-500/20 text-gray-400';
  }

  return (
    <span className={classes}>
      <span className={`w-1.5 h-1.5 rounded-full ${s === 'online' ? 'bg-green-400 pulse-dot' : s === 'offline' ? 'bg-red-400' : 'bg-gray-400'}`} />
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}
