import { useState } from 'react';
import { forcePoll, rebootONU } from '../../api/noc';

export default function QuickActions() {
  const [pollStatus, setPollStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [rebootMac, setRebootMac] = useState('');
  const [rebootStatus, setRebootStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [reportMsg, setReportMsg] = useState('');

  async function handleForcePoll() {
    setPollStatus('loading');
    try {
      await forcePoll();
      setPollStatus('success');
      setTimeout(() => setPollStatus('idle'), 3000);
    } catch {
      setPollStatus('error');
      setTimeout(() => setPollStatus('idle'), 3000);
    }
  }

  async function handleReboot() {
    const mac = rebootMac.trim();
    if (!mac) return;
    setRebootStatus('loading');
    try {
      await rebootONU(mac);
      setRebootStatus('success');
      setRebootMac('');
      setTimeout(() => setRebootStatus('idle'), 3000);
    } catch {
      setRebootStatus('error');
      setTimeout(() => setRebootStatus('idle'), 3000);
    }
  }

  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
        Quick Actions
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          onClick={handleForcePoll}
          disabled={pollStatus === 'loading'}
          className="text-left px-3 py-2 rounded-lg border text-[11px] transition-colors
            bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pollStatus === 'loading' ? 'Polling...' :
           pollStatus === 'success' ? 'Poll triggered' :
           pollStatus === 'error' ? 'Proxy unreachable' :
           'Force Full OLT Poll'}
        </button>

        {/* ONU Reboot */}
        <div className="rounded-lg border bg-red-500/10 border-red-500/30 p-2">
          <div className="text-[10px] text-red-400 font-semibold mb-1">Reboot ONU</div>
          <div className="flex gap-1">
            <input
              type="text"
              value={rebootMac}
              onChange={e => setRebootMac(e.target.value)}
              placeholder="MAC address"
              className="flex-1 bg-slate-900/60 border border-slate-700/50 rounded px-2 py-1
                text-[11px] text-slate-200 placeholder:text-slate-600
                focus:outline-none focus:border-red-500/50"
              onKeyDown={e => e.key === 'Enter' && handleReboot()}
            />
            <button
              onClick={handleReboot}
              disabled={rebootStatus === 'loading' || !rebootMac.trim()}
              className="px-2 py-1 rounded text-[10px] font-bold transition-colors
                bg-red-500/20 text-red-400 hover:bg-red-500/30
                disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {rebootStatus === 'loading' ? '...' :
               rebootStatus === 'success' ? 'Sent' :
               rebootStatus === 'error' ? 'Failed' : 'Reboot'}
            </button>
          </div>
        </div>

        <button
          onClick={() => { setMaintenanceMsg('Coming in Milestone C'); setTimeout(() => setMaintenanceMsg(''), 3000); }}
          className="text-left px-3 py-2 rounded-lg border text-[11px] transition-colors
            bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20"
        >
          {maintenanceMsg || 'Generate Maintenance Schedule'}
        </button>
        <button
          onClick={() => { setReportMsg('Export coming soon'); setTimeout(() => setReportMsg(''), 3000); }}
          className="text-left px-3 py-2 rounded-lg border text-[11px] transition-colors
            bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
        >
          {reportMsg || 'Send NOC Report'}
        </button>
      </div>
    </div>
  );
}
