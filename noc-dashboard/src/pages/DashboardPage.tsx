import { useNocSummary } from '../hooks/useNocSummary';
import KPIStrip from '../components/dashboard/KPIStrip';
import PortGrid from '../components/dashboard/PortGrid';
import AlarmFeed from '../components/dashboard/AlarmFeed';
import SignalChart from '../components/dashboard/SignalChart';
import TicketPanel from '../components/dashboard/TicketPanel';
import QuickActions from '../components/dashboard/QuickActions';

export default function DashboardPage() {
  const { summary, loading } = useNocSummary();

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* KPI Strip — full width */}
      <KPIStrip summary={summary} loading={loading} />

      {/* Main 2-column layout */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* LEFT — Port grid + Signal chart + Alarm feed */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto">
          <PortGrid />
          <SignalChart />
          <AlarmFeed />
        </div>

        {/* RIGHT — Panels sidebar */}
        <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">
          {/* Tickets */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3 flex-1 min-h-0">
            <TicketPanel />
          </div>

          {/* Quick Actions */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3">
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  );
}
