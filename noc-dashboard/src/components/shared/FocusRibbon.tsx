import { useNavigate } from 'react-router-dom';
import { useNocFocus } from '../../state/nocFocus';

function buildCustomerUrl(search: string | null | undefined): string {
  return `/customers?search=${encodeURIComponent(search || '')}`;
}

function buildCustomerProfileUrl(username: string | null | undefined): string | null {
  return username ? `/customers/${encodeURIComponent(username)}` : null;
}

export default function FocusRibbon() {
  const navigate = useNavigate();
  const { focus, clearFocus } = useNocFocus();

  if (!focus) return null;

  const customerSearch = focus.customerUsername || focus.label;
  const customerProfileUrl = buildCustomerProfileUrl(focus.customerUsername);
  const mapUrl = focus.macAddress
    ? `/map?mac=${encodeURIComponent(focus.macAddress)}`
    : buildCustomerUrl(customerSearch);
  const profileUrl = customerProfileUrl || (focus.macAddress
    ? `/onus/${encodeURIComponent(focus.macAddress)}`
    : buildCustomerUrl(customerSearch));

  return (
    <div className="border-b border-cyan-500/20 bg-cyan-950/25 px-5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-cyan-200">
          Focus
        </span>
        <span className="font-semibold text-slate-100">{focus.label}</span>
        {focus.subtitle && <span className="text-slate-400">{focus.subtitle}</span>}
        {focus.status && (
          <span className="rounded bg-slate-900/60 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
            {focus.status}
          </span>
        )}
        {focus.macAddress && <span className="font-mono text-[11px] text-cyan-300">{focus.macAddress}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(profileUrl)}
            className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-500/50"
          >
            Profile
          </button>
          <button
            type="button"
            onClick={() => navigate(mapUrl)}
            className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-500/50"
          >
            Map
          </button>
          <button
            type="button"
            onClick={() => navigate(customerProfileUrl || buildCustomerUrl(customerSearch))}
            className="rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-500/50"
          >
            Customer
          </button>
          <button
            type="button"
            onClick={clearFocus}
            className="rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
