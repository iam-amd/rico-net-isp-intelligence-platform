import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'DB' },
  { to: '/customers', label: 'Customers', icon: 'CUS' },
  { to: '/onus', label: 'ONU List', icon: 'ONU' },
  { to: '/alarms', label: 'Alarms', icon: 'AL' },
  { to: '/map', label: 'Map', icon: 'MAP' },
  { to: '/triage', label: 'Triage', icon: 'TRI' },
  { to: '/technicians-live', label: 'Tech Live', icon: 'GPS' },
  { to: '/pg', label: 'PG Buildings', icon: 'PG' },
  { to: '/pg-reviews', label: 'PG Reviews', icon: 'REV' },
  { to: '/system-health', label: 'System Health', icon: 'SYS' },
];

export default function Sidebar() {
  return (
    <aside className="w-48 bg-slate-900/60 border-r border-slate-700/50 py-4 shrink-0 z-10">
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-blue-600/25 text-blue-300 font-semibold border border-blue-500/20'
                  : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
              }`
            }
          >
            <span className="w-7 shrink-0 rounded border border-slate-700/70 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-4">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-4 pt-4 border-t border-slate-700/40 absolute bottom-4 left-0 right-0">
        <div className="text-xs text-slate-600 text-center">
          <div>Rico Net v4.0</div>
          <div>Booto Cable Network</div>
        </div>
      </div>
    </aside>
  );
}
