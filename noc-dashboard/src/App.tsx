import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import OutageBanner from './components/shared/OutageBanner';
import NotificationToasts from './components/shared/NotificationToasts';
import FocusRibbon from './components/shared/FocusRibbon';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AlarmLogPage from './pages/AlarmLogPage';
import ONUListPage from './pages/ONUListPage';
import ONUDetailPage from './pages/ONUDetailPage';
import MapPage from './pages/MapPage';
import CustomersPage from './pages/CustomersPage';
import CustomerDNAPage from './pages/CustomerDNAPage';
import PGBuildingsPage from './pages/PGBuildingsPage';
import PGReviewsPage from './pages/PGReviewsPage';
import TechnicianTrackerPage from './pages/TechnicianTrackerPage';
import CapacityPage from './pages/CapacityPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TriagePage from './pages/TriagePage';
import PredictionsPage from './pages/PredictionsPage';
import LinkONUsPage from './pages/LinkONUsPage';
import OrphanONUsPage from './pages/OrphanONUsPage';
import MediaAuditPage from './pages/MediaAuditPage';
import HealthReportPage from './pages/HealthReportPage';
import SystemHealthPage from './pages/SystemHealthPage';
import MaintenanceWindowsPage from './pages/MaintenanceWindowsPage';
import ShiftBriefPage from './pages/ShiftBriefPage';
import { useNocSummary } from './hooks/useNocSummary';
import { useAlarmNotifications } from './hooks/useAlarmNotifications';

function AppShell({ onLogout }: { onLogout: () => void }) {
  const { summary, wsConnected } = useNocSummary();
  const { notifications, audioEnabled, toggleAudio, dismiss, dismissAll } = useAlarmNotifications();
  const [tvMode, setTvMode] = useState(false);

  const toggleTvMode = () => {
    if (!tvMode) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setTvMode(!tvMode);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        onLogout={onLogout}
        wsConnected={wsConnected}
        liveDataAvailable={summary?.live_data_available ?? false}
        dataIsStale={summary?.data_is_stale ?? true}
        audioEnabled={audioEnabled}
        onToggleAudio={toggleAudio}
        notificationCount={notifications.length}
        tvMode={tvMode}
        onToggleTvMode={toggleTvMode}
      />
      {!tvMode && <OutageBanner />}
      {tvMode && <OutageBanner />}
      <FocusRibbon />
      <NotificationToasts notifications={notifications} onDismiss={dismiss} onDismissAll={dismissAll} />
      <div className="flex flex-1 overflow-hidden">
        {!tvMode && <Sidebar />}
        <main className={`flex-1 overflow-y-auto ${tvMode ? 'p-3' : 'p-5'}`}>
          <Routes>
            <Route path="/"              element={<DashboardPage />} />
            <Route path="/alarms"        element={<AlarmLogPage />} />
            <Route path="/onus"          element={<ONUListPage />} />
            <Route path="/onus/:mac"     element={<ONUDetailPage />} />
            <Route path="/map"           element={<MapPage />} />
            <Route path="/customers"    element={<CustomersPage />} />
            <Route path="/customers/:username" element={<CustomerDNAPage />} />
            <Route path="/pg"           element={<PGBuildingsPage />} />
            <Route path="/pg-reviews"   element={<PGReviewsPage />} />
            <Route path="/technicians-live" element={<TechnicianTrackerPage />} />
            <Route path="/capacity"     element={<CapacityPage />} />
            <Route path="/analytics"    element={<AnalyticsPage />} />
            <Route path="/triage"       element={<TriagePage />} />
            <Route path="/predictions"  element={<PredictionsPage />} />
            <Route path="/link-onus"    element={<LinkONUsPage />} />
            <Route path="/orphan-onus"  element={<OrphanONUsPage />} />
            <Route path="/media-audit"  element={<MediaAuditPage />} />
            <Route path="/health-report" element={<HealthReportPage />} />
            <Route path="/system-health" element={<SystemHealthPage />} />
            <Route path="/maintenance-windows" element={<MaintenanceWindowsPage />} />
            <Route path="/shift-brief" element={<ShiftBriefPage />} />
            <Route path="*"             element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('noc_token')
  );

  function handleLogin(t: string) {
    localStorage.setItem('noc_token', t);
    setToken(t);
  }

  function handleLogout() {
    localStorage.removeItem('noc_token');
    setToken(null);
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <BrowserRouter>
      <AppShell onLogout={handleLogout} />
    </BrowserRouter>
  );
}
