import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { globalSearch } from '../../api/noc';
import type { GlobalSearchItem } from '../../types/noc';
import { focusFromGlobalResult, setNocFocus } from '../../state/nocFocus';

interface HeaderProps {
  onLogout: () => void;
  wsConnected?: boolean;
  liveDataAvailable?: boolean;
  dataIsStale?: boolean;
  audioEnabled?: boolean;
  onToggleAudio?: () => void;
  notificationCount?: number;
  tvMode?: boolean;
  onToggleTvMode?: () => void;
}

export default function Header({ onLogout, wsConnected = false, audioEnabled = true, onToggleAudio, notificationCount = 0, tvMode = false, onToggleTvMode }: HeaderProps) {
  const navigate = useNavigate();
  const [clock, setClock] = useState(new Date());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(() => {
      globalSearch(trimmed)
        .then((data) => {
          setResults(data.results);
          setSearchOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 220);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  const focusResult = (item: GlobalSearchItem) => {
    setNocFocus(focusFromGlobalResult(item));
    navigate(item.target_url);
    setQuery('');
    setResults([]);
    setSearchOpen(false);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      setNocFocus({
        kind: 'search',
        label: trimmed,
        subtitle: 'Manual NOC search',
        targetUrl: `/customers?search=${encodeURIComponent(trimmed)}`,
        source: 'manual_search',
      });
      navigate(`/customers?search=${encodeURIComponent(trimmed)}`);
      setSearchOpen(false);
    }
  };

  return (
    <header className="h-14 bg-slate-900/90 border-b border-slate-700/50 flex items-center px-5 shrink-0 backdrop-blur-sm z-20">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-blue-900/40">
          R
        </div>
        <div>
          <span className="text-sm font-bold text-slate-100">Rico Net</span>
          <span className="text-xs text-slate-500 ml-2">NOC Dashboard</span>
        </div>
      </div>

      <form onSubmit={submitSearch} className="relative ml-6 hidden w-[420px] max-w-[34vw] lg:block">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          placeholder="Search customer, phone, serial, MAC, OLT..."
          className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none transition focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/40"
        />
        {(searchOpen && (query.trim().length >= 2 || results.length > 0)) && (
          <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40">
            {searching && <div className="px-3 py-2 text-xs text-slate-500">Searching...</div>}
            {!searching && results.length === 0 && query.trim().length >= 2 && (
              <div className="px-3 py-2 text-xs text-slate-500">No matching customer or ONU</div>
            )}
            {results.map((item) => (
              <button
                key={`${item.type}:${item.target_url}:${item.label}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => focusResult(item)}
                className="block w-full border-b border-slate-800 px-3 py-2 text-left last:border-b-0 hover:bg-slate-800/80"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-semibold text-slate-100">{item.label}</span>
                  <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] uppercase text-blue-300">{item.type}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">{item.subtitle || item.mac_address || item.customer_username}</div>
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="flex-1" />

      {/* TV Mode toggle */}
      {onToggleTvMode && (
        <button
          onClick={onToggleTvMode}
          className={`mr-3 px-2 py-1 rounded text-xs transition-colors ${
            tvMode
              ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
              : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
          }`}
          title={tvMode ? 'Exit TV Mode' : 'TV Mode — fullscreen for wall display'}
        >
          {tvMode ? '⊡' : '⊞'}
        </button>
      )}

      {/* Audio toggle */}
      {onToggleAudio && (
        <button
          onClick={onToggleAudio}
          className={`mr-4 px-2 py-1 rounded text-xs transition-colors ${
            audioEnabled
              ? 'text-green-400 hover:bg-green-500/10'
              : 'text-slate-600 hover:bg-slate-800'
          }`}
          title={audioEnabled ? 'Audio alerts ON — click to mute' : 'Audio alerts OFF — click to enable'}
        >
          {audioEnabled ? '🔊' : '🔇'}
        </button>
      )}

      {/* Notification badge */}
      {notificationCount > 0 && (
        <div className="mr-4 relative">
          <span className="text-sm">🔔</span>
          <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {notificationCount > 9 ? '9+' : notificationCount}
          </span>
        </div>
      )}

      {/* WS connection indicator */}
      <div className="flex items-center gap-2 mr-6">
        <span className={`w-2 h-2 rounded-full ${
          wsConnected ? 'bg-green-400 pulse-dot' : 'bg-yellow-400'
        }`} />
        <span className="text-xs text-slate-400">
          {wsConnected ? 'Demo Live' : 'Connecting'}
        </span>
      </div>

      {/* Clock */}
      <div className="text-sm font-mono text-slate-200 mr-6 tabular-nums">
        {clock.toLocaleTimeString('en-IN', { hour12: false })}
      </div>

      <button
        onClick={onLogout}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded hover:bg-slate-800"
      >
        Logout
      </button>
    </header>
  );
}
