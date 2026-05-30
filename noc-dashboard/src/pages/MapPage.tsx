import { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip as LeafletTooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { HeatmapPoint, PortStatus } from '../types/noc';
import { fetchHeatmap, fetchPorts } from '../api/noc';
import { classifySignal, formatDbm, signalColor } from '../utils/signal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setNocFocus, useNocFocus } from '../state/nocFocus';

// Correct service area: SRM Potheri / Kattankulathur, Kancheepuram District
// NOT Kanchipuram city — address data confirms 603203 pincode (Potheri)
const MAP_CENTER: [number, number] = [12.820, 80.040];
const MAP_ZOOM = 14;

// Approximate PON port cluster positions in SRM Potheri area
const PORT_COORDS: Record<string, [number, number]> = {
  'EPON0/1': [12.832, 80.032],
  'EPON0/2': [12.830, 80.044],
  'EPON0/3': [12.825, 80.053],
  'EPON0/4': [12.816, 80.052],
  'EPON0/5': [12.810, 80.043],
  'EPON0/6': [12.811, 80.033],
  'EPON0/7': [12.817, 80.025],
  'EPON0/8': [12.824, 80.026],
  'GPON0/1': [12.812, 80.048],
  'GPON0/2': [12.806, 80.042],
  'GPON0/3': [12.798, 80.034],
  'GPON0/4': [12.792, 80.026],
};

function portKey(port: PortStatus): string {
  const n = port.pon_port.toUpperCase();
  if (n.startsWith('EPON') || n.startsWith('GPON')) return n;
  return `EPON${n.replace(/^0?\//, '0/')}`;
}

type ViewMode = 'ports' | 'heatmap';

const SIGNAL_LEVELS = [
  { label: 'Excellent (> −20)', color: '#22c55e' },
  { label: 'Good (−20 to −24)', color: '#eab308' },
  { label: 'Weak (−24 to −27)', color: '#f97316' },
  { label: 'Critical (< −27)', color: '#ef4444' },
  { label: 'Offline', color: '#6b7280' },
];

export default function MapPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { focus } = useNocFocus();
  const [ports, setPorts] = useState<PortStatus[]>([]);
  const [heatPoints, setHeatPoints] = useState<HeatmapPoint[]>([]);
  const [view, setView] = useState<ViewMode>('heatmap');
  const [loading, setLoading] = useState(true);
  const focusedMac = (searchParams.get('mac') || focus?.macAddress || '').toLowerCase();
  const focusedCustomer = (searchParams.get('customer') || focus?.customerUsername || '').toLowerCase();

  const load = useCallback(async () => {
    try {
      if (view === 'ports') {
        const data = await fetchPorts();
        setPorts(data);
      } else {
        const data = await fetchHeatmap();
        setHeatPoints(data);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (focusedMac || focusedCustomer) setView('heatmap');
  }, [focusedMac, focusedCustomer]);

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-slate-200">Network Map</h1>
        <span className="text-xs text-slate-500">Potheri / Kattankulathur, Kancheepuram — Booto Cable Network</span>

        {/* View toggle */}
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1 ml-auto">
          <button
            onClick={() => setView('ports')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              view === 'ports' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ▦ Port Overview
          </button>
          <button
            onClick={() => setView('heatmap')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              view === 'heatmap' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ◉ Signal Heatmap
          </button>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {SIGNAL_LEVELS.map((l) => (
            <span key={l.label} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: l.color }} />
              <span className="hidden sm:inline">{l.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Stats bar for heatmap mode */}
      {view === 'heatmap' && heatPoints.length > 0 && (
        <div className="flex gap-4 text-xs text-slate-400 bg-slate-800/60 border border-slate-700/50 rounded-lg px-4 py-2 flex-wrap">
          <span><span className="text-slate-200 font-medium">{heatPoints.length}</span> customer locations plotted</span>
          <span><span className="text-green-400 font-medium">{heatPoints.filter(p => p.status === 'online').length}</span> online</span>
          <span><span className="text-red-400 font-medium">{heatPoints.filter(p => p.status !== 'online').length}</span> offline</span>
          <span><span className="text-blue-400 font-medium">{heatPoints.filter(p => p.customer_name).length}</span> customer-linked</span>
          <span title="GPS coordinates saved by field tech or admin"><span className="text-purple-400 font-medium">{heatPoints.filter(p => p.location_tier === 1).length}</span> GPS exact</span>
          <span title="PG building coordinate, not per-room GPS"><span className="text-orange-400 font-medium">{heatPoints.filter(p => p.location_source === 'pg_building').length}</span> PG building</span>
          <span title="Positioned by address area (~300m accuracy)"><span className="text-yellow-400 font-medium">{heatPoints.filter(p => p.location_tier === 2).length}</span> area-level</span>
          <span title="Spread by PON port (~600m)"><span className="text-slate-500 font-medium">{heatPoints.filter(p => p.location_tier === 3).length}</span> cluster</span>
        </div>
      )}

      {(focusedMac || focusedCustomer) && view === 'heatmap' && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-4 py-2 text-xs text-cyan-100">
          Map focus is locked to <span className="font-mono text-cyan-300">{focusedMac || focusedCustomer}</span>. The matching marker is enlarged and outlined.
        </div>
      )}

      {/* Map */}
      <div className="rounded-xl overflow-hidden border border-slate-700/50 flex-1" style={{ minHeight: 420 }}>
        {loading ? (
          <div className="w-full h-full bg-slate-800/60 flex items-center justify-center text-slate-500 min-h-96">
            Loading map...
          </div>
        ) : (
          <MapContainer
            center={MAP_CENTER}
            zoom={MAP_ZOOM}
            style={{ height: '100%', width: '100%', minHeight: 420, background: '#0f172a' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com">CARTO</a>'
            />

            {/* PORT OVERVIEW MODE */}
            {view === 'ports' && ports.map((port) => {
              const key = portKey(port);
              const coords = PORT_COORDS[key];
              if (!coords) return null;

              const level = classifySignal(port.worst_rx);
              const color = signalColor(level);
              const offlinePct = port.total > 0 ? (port.offline / port.total) * 100 : 0;
              const hasOutage = port.offline >= 3 && offlinePct >= 15;
              const radius = 14 + (port.total / 12) + (offlinePct / 6);

              return (
                <CircleMarker
                  key={key}
                  center={coords}
                  radius={radius}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: 0.75,
                    color: hasOutage ? '#ef4444' : color,
                    weight: hasOutage ? 3 : 1.5,
                  }}
                >
                  <LeafletTooltip permanent direction="top" offset={[0, -12]}>
                    <div className="font-bold">{port.pon_port.toUpperCase()}</div>
                    <div style={{ color }}>{port.online}↑ {port.offline}↓ / {port.total}</div>
                  </LeafletTooltip>
                  <Popup>
                    <div style={{ background: '#1e293b', color: '#f1f5f9', padding: 12, borderRadius: 8, minWidth: 200, fontSize: 13 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{port.pon_port.toUpperCase()}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12 }}>
                        <span style={{ color: '#94a3b8' }}>OLT</span><span>{port.olt_host}</span>
                        <span style={{ color: '#94a3b8' }}>Total</span><span>{port.total}</span>
                        <span style={{ color: '#22c55e' }}>Online</span><span style={{ color: '#22c55e' }}>{port.online}</span>
                        <span style={{ color: '#ef4444' }}>Offline</span><span style={{ color: '#ef4444' }}>{port.offline}</span>
                        <span style={{ color: '#94a3b8' }}>Avg Rx</span><span>{formatDbm(port.avg_rx)}</span>
                        <span style={{ color: '#94a3b8' }}>Worst Rx</span><span style={{ color }}>{formatDbm(port.worst_rx)}</span>
                      </div>
                      {hasOutage && (
                        <div style={{ marginTop: 8, color: '#ef4444', fontWeight: 600, textAlign: 'center' }}>
                          ⚠ OUTAGE DETECTED
                        </div>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* SIGNAL HEATMAP MODE */}
            {view === 'heatmap' && heatPoints.map((pt) => {
              const level = classifySignal(pt.rx_power_dbm);
              const color = signalColor(level);
              const isOffline = pt.status !== 'online';
              // Tier 1 (GPS exact): large, bright, solid border
              // Tier 2 (area-level): medium, semi-bright
              // Tier 3 (cluster): small, dim
              const tier = pt.location_tier ?? 3;
              const isPg = pt.location_source === 'pg_building';
              const isFocused = Boolean(
                (focusedMac && pt.mac_address.toLowerCase() === focusedMac)
                || (focusedCustomer && pt.customer_username?.toLowerCase() === focusedCustomer)
              );
              const radius = (isPg ? 5.5 : tier === 1 ? 4.5 : tier === 2 ? 4 : 3) + (isFocused ? 4 : 0);
              const opacity = isFocused ? 0.92 : tier === 1 ? 0.56 : tier === 2 ? 0.48 : 0.30;
              const borderColor = isFocused ? '#38bdf8' : isPg ? '#f97316' : tier === 1 ? color : tier === 2 ? color : '#334155';
              const borderWeight = isFocused ? 2.5 : isPg ? 1.4 : tier === 1 ? 0.9 : tier === 2 ? 0.8 : 0.4;

              return (
                <CircleMarker
                  key={pt.mac_address}
                  center={[pt.lat, pt.lng]}
                  radius={radius}
                  pathOptions={{
                    fillColor: isOffline ? '#6b7280' : color,
                    fillOpacity: opacity,
                    color: borderColor,
                    weight: borderWeight,
                    opacity: isFocused ? 0.95 : 0.62,
                  }}
                  eventHandlers={{
                    click: () => {
                      setNocFocus({
                        kind: 'onu',
                        label: pt.customer_name || pt.mac_address,
                        subtitle: [pt.pon_port, pt.customer_phone].filter(Boolean).join(' | ') || null,
                        customerUsername: pt.customer_username,
                        macAddress: pt.mac_address,
                        status: pt.status,
                        targetUrl: pt.customer_username
                          ? `/customers/${encodeURIComponent(pt.customer_username)}`
                          : `/onus/${encodeURIComponent(pt.mac_address)}`,
                        source: 'map',
                      });
                      navigate(pt.customer_username
                        ? `/customers/${encodeURIComponent(pt.customer_username)}`
                        : `/onus/${encodeURIComponent(pt.mac_address)}`);
                    },
                  }}
                >
                  <LeafletTooltip permanent={isFocused} direction="top" offset={[0, -6]}>
                    <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                      <div style={{ fontWeight: 600 }}>{pt.customer_name || pt.mac_address}</div>
                      {pt.customer_name && <div style={{ color: '#94a3b8', fontSize: 10 }}>{pt.mac_address}</div>}
                      <div style={{ color: isOffline ? '#6b7280' : color }}>
                        {isOffline ? 'Offline' : formatDbm(pt.rx_power_dbm)}
                      </div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>
                        {pt.pon_port} {(pt.location_tier ?? 3) === 1 ? '• GPS exact' : (pt.location_tier ?? 3) === 2 ? '• area ~300m' : '• cluster ~600m'}
                      </div>
                    </div>
                  </LeafletTooltip>
                  <Popup>
                    <div style={{ background: '#1e293b', color: '#f1f5f9', padding: 12, borderRadius: 8, minWidth: 220, fontSize: 12 }}>
                      {pt.customer_name ? (
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{pt.customer_name}</div>
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#94a3b8' }}>Unknown Customer</div>
                      )}
                      <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b', marginBottom: 8 }}>{pt.mac_address}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12 }}>
                        <span style={{ color: '#94a3b8' }}>Status</span>
                        <span style={{ color: isOffline ? '#ef4444' : '#22c55e' }}>{pt.status || 'unknown'}</span>
                        <span style={{ color: '#94a3b8' }}>Rx Power</span>
                        <span style={{ color: isOffline ? '#6b7280' : color }}>{formatDbm(pt.rx_power_dbm)}</span>
                        <span style={{ color: '#94a3b8' }}>PON Port</span><span>{pt.pon_port}</span>
                        {isPg && <><span style={{ color: '#94a3b8' }}>PG Building</span><span>{pt.pg_building_name || pt.pg_building_id}</span></>}
                        {isPg && <><span style={{ color: '#94a3b8' }}>Room</span><span>{pt.pg_room_number || '-'}</span></>}
                        {pt.customer_phone && <><span style={{ color: '#94a3b8' }}>Phone</span><span>{pt.customer_phone}</span></>}
                        {pt.customer_plan && <><span style={{ color: '#94a3b8' }}>Plan</span><span>{pt.customer_plan}</span></>}
                      </div>
                      {!pt.has_exact_location && (
                        <div style={{ marginTop: 8, fontSize: 10, color: '#475569', fontStyle: 'italic' }}>
                          * Approximate cluster location
                        </div>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
