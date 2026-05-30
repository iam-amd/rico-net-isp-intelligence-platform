import { Component, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchPGBuildingDashboard, fetchPGBuildings } from '../api/noc';
import type { PGBuildingDashboard, PGBuildingSummary, PGRoomDashboard } from '../types/noc';
import { setNocFocus } from '../state/nocFocus';
import { formatDbm, timeAgo } from '../utils/signal';

class PGBuildingsErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'PG Buildings view crashed' };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-red-700/40 bg-red-950/20 p-6 text-red-200">
          <div className="text-base font-bold text-red-100">PG Buildings could not render</div>
          <p className="mt-2 text-sm text-red-200/80">
            The API may have returned partial building, floor, or room data. The rest of the NOC is still usable.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-red-950/40 p-3 text-xs text-red-100">{this.state.error}</pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-100 hover:bg-red-900/30"
          >
            Retry PG view
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function roomTarget(room: PGRoomDashboard): string | null {
  if (room.room_onu?.match_type === 'serial' && room.ont_serial) return `SN:${room.ont_serial}`;
  return room.room_onu?.matched_value || room.mac_address || room.customer?.mac_address || null;
}

function roomState(room: PGRoomDashboard): 'online' | 'offline' | 'unlinked' | 'pending' {
  const onu = room.room_onu || room.onu;
  if (onu?.status) return onu.status.toLowerCase() === 'online' ? 'online' : 'offline';
  if (!room.username && !room.mac_address && !room.ont_serial) return 'unlinked';
  return 'pending';
}

function roomClass(room: PGRoomDashboard): string {
  const state = roomState(room);
  if (room.conflict) return 'border-red-400/60 bg-red-950/40 text-red-100';
  if (state === 'online') return 'border-green-400/50 bg-green-950/30 text-green-100';
  if (state === 'offline') return 'border-red-500/50 bg-red-950/30 text-red-100';
  if (state === 'pending') return 'border-amber-400/40 bg-amber-950/20 text-amber-100';
  return 'border-slate-700 bg-slate-900/70 text-slate-400';
}

function customerName(room: PGRoomDashboard): string {
  if (!room.customer) return room.username || 'Unlinked room';
  return [room.customer.first_name, room.customer.last_name].filter(Boolean).join(' ') || room.customer.username;
}

function FloorBlock({ floor, onOpenRoom }: { floor: PGBuildingDashboard['floors'][number]; onOpenRoom: (room: PGRoomDashboard) => void }) {
  const label = floor.floor_number === 0 ? 'Ground Floor' : `Floor ${floor.floor_number}`;
  const rooms = Array.isArray(floor.rooms) ? floor.rooms : [];
  const online = rooms.filter((room) => roomState(room) === 'online').length;
  const offline = rooms.filter((room) => roomState(room) === 'offline').length;

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-950/35 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-100">{label}</h3>
          <p className="text-[11px] text-slate-500">{rooms.length} rooms | {online} online | {offline} offline</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {rooms.length === 0 && (
          <div className="col-span-full rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-center text-xs text-slate-500">
            No rooms found on this floor.
          </div>
        )}
        {rooms.map((room) => {
          const onu = room.room_onu || room.onu;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => onOpenRoom(room)}
              className={`min-h-[92px] rounded-xl border p-2 text-left transition hover:scale-[1.02] ${roomClass(room)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-black">Room {room.room_number}</span>
                <span className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] uppercase">{roomState(room)}</span>
              </div>
              <div className="mt-2 truncate text-[11px] text-slate-200">{customerName(room)}</div>
              <div className="mt-1 font-mono text-[10px] text-slate-400">
                {room.ont_serial || room.mac_address || 'no sticker'}
              </div>
              {onu && (
                <div className="mt-2 text-[10px] text-slate-300">
                  {formatDbm(onu.rx_power_dbm)} | {timeAgo(onu.polled_at)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PGBuildingsContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedBuilding = searchParams.get('building');
  const [buildings, setBuildings] = useState<PGBuildingSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<PGBuildingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');

  const loadBuildings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchPGBuildings();
      const list = Array.isArray(data) ? data : [];
      setBuildings(list);
      const requestedExists = requestedBuilding && list.some((building) => building.id === requestedBuilding);
      setSelectedId((current) => (requestedExists ? requestedBuilding : current || list[0]?.id || null));
    } catch (err) {
      setBuildings([]);
      setSelectedId(null);
      setDashboard(null);
      setError(err instanceof Error ? err.message : 'Could not load PG buildings');
    } finally {
      setLoading(false);
    }
  }, [requestedBuilding]);

  useEffect(() => { loadBuildings(); }, [loadBuildings]);

  useEffect(() => {
    if (!selectedId) {
      setDashboard(null);
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    fetchPGBuildingDashboard(selectedId)
      .then(setDashboard)
      .catch((err) => {
        setDashboard(null);
        setDetailError(err instanceof Error ? err.message : 'Could not load PG building dashboard');
      })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const retrySelectedBuilding = () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError('');
    fetchPGBuildingDashboard(selectedId)
      .then(setDashboard)
      .catch((err) => {
        setDashboard(null);
        setDetailError(err instanceof Error ? err.message : 'Could not load PG building dashboard');
      })
      .finally(() => setDetailLoading(false));
  };

  const openRoom = (room: PGRoomDashboard) => {
    const target = roomTarget(room);
    const customerUsername = room.customer?.username || room.username;
    const targetUrl = customerUsername
      ? `/customers/${encodeURIComponent(customerUsername)}`
      : target
        ? `/onus/${encodeURIComponent(target)}`
        : `/customers?search=${encodeURIComponent(room.username || room.room_number || '')}`;
    setNocFocus({
      kind: target ? 'onu' : 'customer',
      label: `${dashboard?.name || 'PG'} Room ${room.room_number}`,
      subtitle: [customerName(room), room.customer?.phone, room.ont_serial || room.mac_address].filter(Boolean).join(' | ') || null,
      customerUsername,
      macAddress: target,
      status: (room.room_onu || room.onu)?.status || room.status,
      targetUrl,
      source: 'pg_building',
    });
    navigate(targetUrl);
  };

  const listTotals = buildings.reduce(
    (acc, building) => ({
      total_rooms: acc.total_rooms + (building.total_rooms || 0),
      done_rooms: acc.done_rooms + (building.done_rooms || 0),
      pending_rooms: acc.pending_rooms + (building.pending_rooms || 0),
      online_count: acc.online_count + (building.online_count || 0),
      offline_count: acc.offline_count + (building.offline_count || 0),
      unlinked_count: acc.unlinked_count + (building.unlinked_count || 0),
    }),
    { total_rooms: 0, done_rooms: 0, pending_rooms: 0, online_count: 0, offline_count: 0, unlinked_count: 0 },
  );
  const totals = dashboard ? {
    total_rooms: dashboard.total_rooms || 0,
    done_rooms: dashboard.done_rooms || 0,
    pending_rooms: dashboard.pending_rooms || 0,
    online_count: dashboard.online_count || 0,
    offline_count: dashboard.offline_count || 0,
    unlinked_count: dashboard.unlinked_count || 0,
  } : listTotals;
  const floors = Array.isArray(dashboard?.floors) ? dashboard.floors : [];

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">PG Building NOC</h1>
          <p className="text-[11px] text-slate-500">Floor and room view for PG customers, ONU status, sticker identity, and quick drill-down.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2"><div className="text-slate-500">Rooms</div><div className="font-bold text-white">{totals.total_rooms}</div></div>
          <div className="rounded-lg border border-green-500/25 bg-green-950/20 px-3 py-2"><div className="text-green-400">Online</div><div className="font-bold text-white">{totals.online_count || 0}</div></div>
          <div className="rounded-lg border border-red-500/25 bg-red-950/20 px-3 py-2"><div className="text-red-400">Offline</div><div className="font-bold text-white">{totals.offline_count || 0}</div></div>
          <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-2"><div className="text-amber-400">Pending</div><div className="font-bold text-white">{totals.pending_rooms || 0}</div></div>
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-950/20 px-3 py-2"><div className="text-cyan-400">Done</div><div className="font-bold text-white">{totals.done_rooms || 0}</div></div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2"><div className="text-slate-400">Unlinked</div><div className="font-bold text-white">{totals.unlinked_count || 0}</div></div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="overflow-auto rounded-2xl border border-slate-700/50 bg-slate-900/50 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Buildings</div>
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-500">Loading PG buildings...</div>
          ) : error ? (
            <div className="rounded-xl border border-red-700/40 bg-red-950/20 p-4 text-xs text-red-200">
              <div className="font-semibold">Could not load buildings</div>
              <div className="mt-1 break-all text-red-200/70">{error}</div>
              <button type="button" onClick={loadBuildings} className="mt-3 rounded border border-red-500/40 px-2 py-1 hover:bg-red-900/30">
                Retry
              </button>
            </div>
          ) : buildings.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">No PG buildings synced yet</div>
          ) : (
            <div className="space-y-2">
              {buildings.map((building) => (
                <button
                  key={building.id}
                  type="button"
                  onClick={() => setSelectedId(building.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${selectedId === building.id ? 'border-cyan-500/60 bg-cyan-950/25' : 'border-slate-700/50 bg-slate-950/35 hover:border-slate-500'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-bold text-slate-100">{building.name}</div>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">{building.pg_type}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{building.address || building.owner_name || 'No address'}</div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    {building.total_floors} floors | {building.total_rooms} rooms | {building.done_rooms} done
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="min-h-0 overflow-auto">
          {detailLoading ? (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 py-16 text-center text-sm text-slate-500">Loading building dashboard...</div>
          ) : detailError ? (
            <div className="rounded-2xl border border-red-700/40 bg-red-950/20 p-6 text-sm text-red-200">
              <div className="font-semibold">Could not load selected PG building</div>
              <div className="mt-2 break-all text-red-200/70">{detailError}</div>
              <button type="button" onClick={retrySelectedBuilding} className="mt-4 rounded border border-red-500/40 px-3 py-2 hover:bg-red-900/30">
                Retry selected building
              </button>
            </div>
          ) : !dashboard ? (
            <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 py-16 text-center text-sm text-slate-500">Select a PG building</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-wide text-slate-100">{dashboard.name}</h2>
                    <p className="mt-1 text-xs text-slate-500">{dashboard.address || 'No address'} | Owner: {dashboard.owner_name || 'unknown'} {dashboard.owner_mobile ? `| ${dashboard.owner_mobile}` : ''}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>{dashboard.total_floors} floors</div>
                    <div>{dashboard.total_rooms} rooms</div>
                  </div>
                </div>
              </div>
              {floors.length === 0 && (
                <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 py-16 text-center text-sm text-slate-500">
                  No floors found for this building.
                </div>
              )}
              {floors
                .slice()
                .sort((a, b) => a.floor_number - b.floor_number)
                .map((floor) => (
                  <FloorBlock key={floor.id} floor={floor} onOpenRoom={openRoom} />
                ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function PGBuildingsPage() {
  return (
    <PGBuildingsErrorBoundary>
      <PGBuildingsContent />
    </PGBuildingsErrorBoundary>
  );
}
