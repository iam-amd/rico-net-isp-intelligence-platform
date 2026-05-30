# OLT Engine â€” Architecture & Build Plan

> A dedicated, isolated, monitored data engine for all OLT/ONT data.
> Single source of truth. Other systems read from it. Nothing writes to OLT data outside the engine.
> Status: PROPOSED â€” awaiting approval before implementation.

---

## 2026-05-12 Safety Rule

The OLT Engine is now treated as hardware-critical infrastructure.

- Starting the engine must never contact an OLT.
- `/healthz` is local-process health only; it must not open Telnet, SNMP, HTTP, or any OLT socket.
- OLT read collection requires `ALLOW_OLT_HARDWARE_ACCESS=true` on the approved engine host.
- Reboot/control commands require both `ALLOW_OLT_HARDWARE_ACCESS=true` and `ALLOW_OLT_REBOOT_COMMANDS=true`.
- Normal trial/testing mode keeps both flags false.
- NOC, Admin, Mobile, scraper, and backend services must read OLT-derived data through backend/database APIs. They must not contact OLTs directly.
- Any future SNMP OID exploration must run as an explicit operator-approved job, never as part of a dashboard health check or app startup.

This rule exists because these are real customer devices. A software health check cannot be allowed to become a hardware probe.

---

## Why This Exists

The current poller has 3 jobs glued together: **collect â†’ parse â†’ write to prod DB**. One change in any layer breaks the others. Today proved it: a MAC-case fix in the parser created 700+ duplicate rows in production, and parallel diagnostic walks during business hours desynced one OLT for hours.

The OLT Engine fixes this by **separating concerns into layers** and **isolating per-OLT collectors** so a problem on one OLT cannot cascade to others. It is the **last mile** between hardware and the rest of the platform â€” every ONT and OLT lives here, and every consumer (NOC, mobile, predictions) reads from here.

---

## Design Goals (in priority order)

1. **Data integrity** â€” no duplicates, no ghosts, no silent corruption
2. **Isolation** â€” one OLT going sick cannot poison data for the other two
3. **Observability** â€” you always know what each OLT is doing, when, and why
4. **Latency** â€” current state visible within 60s of change for SNMP-capable, â‰¤5 min for Telnet-only
5. **Reversibility** â€” every change is rollback-able; no in-place mutations of prod data
6. **Simplicity over scale** â€” works for 3 OLTs today, can grow to 30 later, but not designed for 300

---

## Architecture â€” 5 Layers

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚   CONSUMERS                          â”‚
                    â”‚   (NOC dashboard, mobile, predictionsâ”‚
                    â”‚    customer portal, alarms)          â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                   â”‚ READ-ONLY API
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       Layer 5      â”‚   ENGINE API                         â”‚
                    â”‚   REST + WebSocket                   â”‚
                    â”‚   ports 9100-9101                    â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                   â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       Layer 4      â”‚   STATE STORE (PostgreSQL)           â”‚
                    â”‚   - olts                             â”‚
                    â”‚   - pon_ports                        â”‚
                    â”‚   - onts (lifetime identity)         â”‚
                    â”‚   - ont_state (current snapshot)     â”‚
                    â”‚   - ont_snapshots (time-series)      â”‚
                    â”‚   - ont_events (transitions)         â”‚
                    â”‚   - collector_runs (audit)           â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–²â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                   â”‚ canonical writes
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       Layer 3      â”‚   NORMALIZER + STATE MACHINE         â”‚
                    â”‚   - canonicalize MAC                 â”‚
                    â”‚   - merge SNMP+Telnet per ONT        â”‚
                    â”‚   - validate value ranges            â”‚
                    â”‚   - apply hysteresis (3-poll rule)   â”‚
                    â”‚   - reject mass-offline cycles       â”‚
                    â”‚   - emit events on transitions       â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–²â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                   â”‚ raw records via Redis Stream
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       Layer 2      â”‚   COLLECTORS (one process per OLT)   â”‚
                    â”‚                                      â”‚
                    â”‚   olt-collector@.100-snmp            â”‚
                    â”‚   olt-collector@.100-telnet          â”‚
                    â”‚   olt-collector@.200-telnet          â”‚
                    â”‚   olt-collector@.210-telnet          â”‚
                    â”‚   olt-trap-receiver (UDP 162)        â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–²â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                   â”‚ raw bytes / CLI / SNMP
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       Layer 1      â”‚   HARDWARE                           â”‚
                    â”‚   EPON .100, GPON .200, GPON .210    â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Strict rules:**
- Layers communicate ONE WAY: bottom up.
- A collector NEVER touches the database directly.
- The normalizer NEVER queries the OLT directly.
- Consumers NEVER bypass the API.

---

## Layer 1 â€” Hardware

3 OLTs, capabilities documented in code:

| OLT | Type | SNMP iftable | SNMP enterprise | Telnet | Traps |
|-----|------|-------------|-----------------|--------|-------|
| 10.10.10.100 | EPON V1600D | âœ… 391 ifs | âœ… 32K OIDs | âœ… | configured |
| 10.10.10.200 | GPON V1600G1 | âœ… 275 ifs (unused) | âœ… 52K OIDs | âœ… | configured |
| 10.10.10.210 | GPON V1600G1B | âŒ rejects | âœ… 49K OIDs | âœ… (sensitive) | unknown |

OLT capability is **declared in a YAML config file**, not hardcoded:

```yaml
olts:
  - host: 10.10.10.100
    name: EPON-Booto-Main
    type: epon
    snmp:
      port: 162
      iftable: true
      enterprise_root: 1.3.6.1.4.1.37950
    telnet:
      port: 23
      cli_dialect: epon_v2
    traps:
      send_to: 10.10.10.50:162
```

Adding a new OLT = add a YAML entry. No code change.

---

## Layer 2 â€” Collectors (the most critical layer)

**One systemd service per (OLT, transport) pair.** Six services total at start:

| Service | Purpose | Frequency | Owner OLT |
|---------|---------|-----------|-----------|
| `olt-collector@100-snmp` | SNMP iftable walk â†’ status, MAC, traffic | every 60s | .100 |
| `olt-collector@100-telnet` | Telnet OPM-diag â†’ optical, temp, voltage | every 5 min | .100 |
| `olt-collector@200-telnet` | full Telnet poll | every 5 min | .200 |
| `olt-collector@210-telnet` | full Telnet poll (with sensitive timing) | every 5 min | .210 |
| `olt-trap-receiver` | listens on UDP 162, decodes traps | continuous | all |

**Collector contract:**
- Reads YAML config + secrets
- Connects to ONE OLT
- Does ONE kind of fetch
- Writes ONE kind of record to a Redis Stream (`olt:raw:<host>:<transport>`)
- Logs structured JSON to journald
- Exits non-zero on fatal error (systemd auto-restarts with backoff)
- Never touches PostgreSQL

**Why systemd-per-OLT:**
- One OLT crashing/hanging cannot block another
- `systemctl stop olt-collector@210-telnet` pauses just .210, leaves .100 untouched
- Per-service logs (`journalctl -u olt-collector@210-telnet`) â€” no log spaghetti
- Restart policy and resource limits per-OLT

**Collector record shape (raw, written to Redis):**
```json
{
  "host": "10.10.10.100",
  "transport": "snmp_iftable",
  "polled_at": "2026-05-01T17:25:00Z",
  "duration_ms": 28000,
  "onts": [
    {"raw_mac": "14:A7:2B:E6:CA:C8", "pon_port": 1, "onu_index": 1,
     "status_code": 1, "rx_bytes": 12345, "tx_bytes": 6789, "errors": 0}
  ],
  "errors": []
}
```

Notice: collector does NOT compute deltas, NOT validate, NOT mark online/offline as boolean. It just packages what it saw.

---

## Layer 3 â€” Normalizer + State Machine

**One service**: `olt-engine-core`. Subscribes to all Redis streams, processes records, writes to Postgres.

**Pipeline per record:**

```
raw collector record
        â”‚
        â–¼
   canonicalize MAC      â† UPPER, ":"-separated, validated
        â”‚
        â–¼
   merge multi-source    â† join SNMP status + Telnet optical for same ONT
        â”‚
        â–¼
   validate ranges       â† reject Rx outside -50..0, temp outside 0..120
        â”‚
        â–¼
   apply hysteresis      â† status flip requires N consecutive same-state polls
        â”‚
        â–¼
   mass-offline guard    â† if >30% online drop in one cycle, REJECT cycle entirely
        â”‚
        â–¼
   compute deltas        â† rx_bytes_delta from cumulative counters
        â”‚
        â–¼
   write to PG           â† single transaction: ont_state + ont_snapshots + ont_events
        â”‚
        â–¼
   publish event         â† Redis pub/sub â†’ API broadcasts to WebSocket
```

**Mass-offline guard explained:**
If a poll cycle reports >30% of ONTs newly offline vs the prior known-good state, the cycle is REJECTED. The data is logged for forensics but not written to `ont_state`. Reason: it's almost always a poller bug (timeout, partial response), not a real outage. Real outages cluster by PON port; bug-driven offlines hit random ONTs.

This single rule would have prevented today's `.210` 17-online disaster.

**Hysteresis (anti-flap):**
- Going online â†’ offline: needs 3 consecutive offline polls before `ont_state.status = offline`
- Going offline â†’ online: 1 poll is enough (be optimistic)
- Each cycle still writes `ont_snapshots` (raw history) regardless

---

## Layer 4 â€” State Store (PostgreSQL schema)

The schema currently is: `onu_latest`, `onu_snapshots`, `customers`. Mac is the only key â€” no separation between identity and state. Today we saw what that costs.

**New schema (clean separation):**

```sql
-- LIFETIME IDENTITY (rarely changes)
CREATE TABLE onts (
  id              BIGSERIAL PRIMARY KEY,
  mac_canonical   VARCHAR(17) NOT NULL,
  serial_number   VARCHAR(64),                  -- GPON only
  olt_id          INT NOT NULL REFERENCES olts(id),
  pon_port        INT NOT NULL,
  onu_index       INT NOT NULL,
  vendor          VARCHAR(64),
  hw_model        VARCHAR(64),
  hw_version      VARCHAR(32),
  sw_version      VARCHAR(32),
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decommissioned_at TIMESTAMPTZ,                -- soft-delete
  CONSTRAINT mac_uppercase CHECK (mac_canonical = UPPER(mac_canonical)),
  CONSTRAINT mac_format    CHECK (mac_canonical ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  UNIQUE (olt_id, pon_port, onu_index)
);
CREATE UNIQUE INDEX onts_mac_active ON onts(mac_canonical) WHERE decommissioned_at IS NULL;

-- CURRENT STATE (1 row per active ONT, replaced every poll)
CREATE TABLE ont_state (
  ont_id          BIGINT PRIMARY KEY REFERENCES onts(id) ON DELETE CASCADE,
  status          VARCHAR(16) NOT NULL,         -- online/offline/unknown
  rx_power_dbm    NUMERIC(5,2),
  tx_power_dbm    NUMERIC(5,2),
  temperature_c   NUMERIC(5,2),
  voltage_mv      INT,
  dying_gasp      BOOLEAN NOT NULL DEFAULT FALSE,
  rx_bytes_delta  BIGINT,
  tx_bytes_delta  BIGINT,
  last_polled_at  TIMESTAMPTZ NOT NULL,
  optical_polled_at TIMESTAMPTZ,                -- separate freshness for optical
  status_source   VARCHAR(32) NOT NULL,         -- snmp_iftable, telnet_cli, trap, hysteresis_hold
  optical_source  VARCHAR(32),
  consecutive_offline_polls INT NOT NULL DEFAULT 0,
  consecutive_online_polls  INT NOT NULL DEFAULT 0
);

-- TIME-SERIES (every poll, every ONT â€” partitioned by day)
CREATE TABLE ont_snapshots (
  id              BIGSERIAL,
  ont_id          BIGINT NOT NULL REFERENCES onts(id),
  polled_at       TIMESTAMPTZ NOT NULL,
  status          VARCHAR(16),
  rx_power_dbm    NUMERIC(5,2),
  tx_power_dbm    NUMERIC(5,2),
  temperature_c   NUMERIC(5,2),
  voltage_mv      INT,
  rx_bytes_delta  BIGINT,
  tx_bytes_delta  BIGINT,
  source          VARCHAR(32) NOT NULL,
  PRIMARY KEY (ont_id, polled_at)
) PARTITION BY RANGE (polled_at);

-- TRANSITIONS (events, not deltas)
CREATE TABLE ont_events (
  id              BIGSERIAL PRIMARY KEY,
  ont_id          BIGINT NOT NULL REFERENCES onts(id),
  event_type      VARCHAR(32) NOT NULL,         -- went_online/went_offline/dying_gasp/signal_critical
  occurred_at     TIMESTAMPTZ NOT NULL,
  detail          JSONB,
  source          VARCHAR(32) NOT NULL
);

-- COLLECTOR HEALTH (per cycle)
CREATE TABLE collector_runs (
  id              BIGSERIAL PRIMARY KEY,
  collector_id    VARCHAR(64) NOT NULL,
  olt_host        INET NOT NULL,
  transport       VARCHAR(32) NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  status          VARCHAR(16) NOT NULL,         -- ok/timeout/rejected/failed
  ont_count       INT,
  error_message   TEXT,
  rejected_reason VARCHAR(64)                    -- e.g. "mass_offline_guard"
);
```

**What this fixes:**
- Lifetime identity (`onts`) is never deleted â€” soft-decommission only. Re-registration of same MAC = update `onts` row, never create a duplicate.
- `mac_canonical` enforced UPPER and format-validated at the DB level. The case bug from today is impossible by construction.
- Current state and history are different tables â€” dashboard reads `ont_state` (1 row per ONT, fast); historians read `ont_snapshots`.
- Every read knows where the data came from (`status_source`) and how fresh (`last_polled_at` + `optical_polled_at` separately).
- Rejected cycles leave a forensic trail in `collector_runs` instead of poisoning production data.

---

## Layer 5 â€” Engine API

**Read-only HTTP service** on a separate port (`9100`). The backend, mobile app, NOC dashboard, predictions all read from here. Nothing else writes.

```
GET  /v1/olts                              â†’ list all OLTs + health
GET  /v1/olts/:host                         â†’ one OLT detail
GET  /v1/olts/:host/onts                    â†’ all ONTs on this OLT (paginated)
GET  /v1/onts/:mac                          â†’ one ONT current state + history pointer
GET  /v1/onts/:mac/snapshots?from=&to=      â†’ time-series
GET  /v1/onts/:mac/events                   â†’ transition log
GET  /v1/health                             â†’ engine self-health
GET  /v1/collectors                         â†’ per-collector status + last run

WS   /v1/events                             â†’ real-time stream of ont_events
```

API serves directly from `ont_state` (current) + `ont_snapshots` (history). No business logic, no merging â€” that already happened in Layer 3.

**Backend integration**: The existing FastAPI backend keeps its routers, but `services/ingest_service.py` becomes a CLIENT of the OLT Engine instead of holding the logic itself. NOC dashboard endpoints become thin proxies.

---

## Failure Modes & Fallback Chain

For each ONT at any moment, the engine maintains a **freshness chain** with explicit degradation:

| Tier | Source | Latency | Used when |
|------|--------|---------|-----------|
| 1 | SNMP iftable poll | â‰¤60s | OLT supports SNMP iftable |
| 2 | Telnet CLI poll | â‰¤5min | SNMP unavailable or stale >120s |
| 3 | SNMP trap | event-driven | OLT pushes a trap |
| 4 | Cached last-known + age | â€” | All polling paths failed |

The API includes `confidence` and `staleness_seconds` on every read. The dashboard renders confidence as color: solid = fresh, faded = stale, gray = unknown.

**Cascading recovery:**
- OLT becomes unresponsive â†’ collector fails â†’ engine marks `ont_state.status_source = 'stale'` for that OLT after 2Ã— expected interval
- After 10 minutes stale â†’ engine marks ONTs as `confidence = 'low'`
- After 1 hour stale â†’ engine emits OLT_DOWN alarm
- When collector recovers â†’ state refreshes, confidence restored

**No silent corruption ever.** A stale field is labeled stale; it is not deleted, not zeroed, not assumed.

---

## What Goes Wrong, and the Fallback (this is the alternative-if-it-doesn't-work tree)

| Primary mechanism | If it fails | Escalate to |
|---|---|---|
| SNMP iftable on .100 | OLT SNMP agent unresponsive | Telnet collector takes over status (already running anyway) |
| Telnet on any OLT | Session pool exhausted | Engine retries with exponential backoff up to 3 attempts; on 4th, mark cycle failed and skip |
| Mass-offline detection | Real outage triggers it | Operator can override via `POST /v1/collectors/:id/accept-cycle/:run_id` |
| Hysteresis blocking real offline | Customer complains, ONT really is down | Telnet trap or manual confirm bypasses hysteresis |
| Engine itself crashes | systemd restarts, last-known state remains in PG | Collectors keep writing to Redis until engine consumes |
| Redis crashes | Collectors fail to publish | Each collector buffers locally to disk (already in current code), drains when Redis returns |
| PostgreSQL unavailable | Engine cannot write | Engine queues writes to disk; collectors keep collecting; degrade to read-only mode for API; alarm operator |
| Pi itself dies | Total OLT data outage | Build a second collector node; OLT engine is single-node-tolerant via WAL replay; dual-collector mode is a future option |

---

## Recommended Stack (concrete choices)

| Component | Choice | Why |
|-----------|--------|-----|
| Language | Python 3.13 | Existing codebase, team familiarity |
| Process management | systemd templates | Already on Pi, no new ops surface |
| Message bus | Redis Streams | Tiny, runs on Pi, survives restarts via AOF |
| Database | PostgreSQL 16 | Already deployed, native time-series via partitioning |
| API | FastAPI (separate app from existing backend) | Same toolchain, isolated deployment |
| Config | YAML files in `olt-engine/config/` | Plain text, version-controlled, no DB |
| Secrets | systemd EnvironmentFile from `/etc/olt-engine/secrets.env` | Standard practice |
| Observability | Prometheus exporter on `:9102` + Grafana | Industry standard |
| Logging | journald + `journalctl --output=json` | No log shipper needed |

**No Kubernetes, no Docker, no Kafka.** This must run on a Raspberry Pi 4 alongside the existing services.

---

## Migration Plan â€” Build Without Breaking Production

This is the safest part. The new engine runs **in parallel with the existing poller for at least 1 week** before any cutover.

### Phase 0 â€” Foundation (1 day)
1. Create `olt-engine/` directory in the monorepo
2. Set up YAML config with the 3 known OLTs
3. Write the canonical schema as Alembic migrations (don't apply yet)
4. Spin up Redis on the Pi (`apt install redis-server`)

### Phase 1 â€” Build Layer 1+2 (2-3 days)
1. Implement collector base class (`olt_engine/collectors/base.py`)
2. Port existing SNMP code into `OLTSNMPCollector`
3. Port existing Telnet code into `OLTTelnetCollector`
4. Each collector writes to its Redis stream
5. systemd templates: `/etc/systemd/system/olt-collector@.service`
6. **TEST**: collectors run, Redis fills with raw records, no PG writes yet

### Phase 2 â€” Build Layer 3+4 (2-3 days)
1. Apply schema migrations to a NEW database `rico_net_engine` (NOT touching `rico_net`)
2. Implement normalizer that consumes Redis streams
3. Implement mass-offline guard, hysteresis, validation
4. Write to `rico_net_engine` only
5. **TEST**: shadow mode for 24h. Compare engine output to existing poller output. Investigate every discrepancy.

### Phase 3 â€” Build Layer 5 (1-2 days)
1. Implement Engine API on port 9100
2. Add Prometheus exporter on 9102
3. Build a tiny health dashboard (or reuse Grafana)
4. **TEST**: API returns same ONTs as the existing dashboard for the same OLT, with matching counts Â±1%

### Phase 4 â€” Cutover, one OLT at a time (1 week)
1. Stop existing poller for ONE OLT only (start with .100 â€” best-understood)
2. Engine becomes authoritative for .100
3. Backend `services/ingest_service.py` reads from Engine API for .100
4. Watch for 48h. If green, cut over .200, then .210
5. Each cutover is reversible: restart old poller, switch backend back

### Phase 5 â€” Decommission old code (1 day)
1. Stop old poller services permanently
2. Archive `olt-proxy/olt_poller.py` and friends to `legacy/`
3. Migrate historical `onu_snapshots` data into `ont_snapshots` (one-shot script)
4. Drop old `onu_*` tables after 90-day retention period

**Total: ~2 weeks of work, but production keeps running the entire time.** Old system stays up until new system has proven itself for that specific OLT.

---

## Observability â€” How You Know It's Working

Three dashboards, all in Grafana:

### 1. Engine Health (operator view)
- Per-collector cycle time, last run, error rate
- Redis stream depth (should be near zero)
- PG write latency, queue depth
- Engine self-CPU/memory

### 2. OLT Health (NOC view)
- Per-OLT online% trend (24h)
- Per-OLT optical coverage% (alert if <80%)
- Per-OLT cycle freshness
- Per-OLT alarm count

### 3. Data Quality (audit view)
- Rejected cycles per day (mass-offline guard fires)
- Hysteresis hold counts
- Source-of-truth distribution (% from SNMP vs Telnet vs trap vs stale)
- MAC duplicates detected at write time (should be zero forever)

**Alerts that page you:**
- Any OLT data older than 5 min
- Mass-offline guard fires (always investigate, even if rejected)
- API p99 latency > 500ms
- DB connection failures
- Engine process restart count > 3/hour

---

## What This Costs

- **Build time**: ~2 weeks of dev (1 person)
- **Risk**: low (parallel build, gradual cutover, full rollback path)
- **New ops surface**: 1 Redis instance, 4 new systemd services, 1 new DB schema
- **Performance ceiling**: ~10K ONTs at current poll rates; 100K with collector parallelization
- **The benefit**: today's class of failures is **structurally impossible**

---

## Alternatives I Considered (and why I rejected them)

| Alternative | Why Not |
|---|---|
| Just patch the current poller harder | The architecture IS the problem. More patches = more cascading bugs. |
| Microservices with Kafka | Overkill for 3 OLTs. Multiplies ops surface 5Ã—. Pi can't run Kafka. |
| Replace PostgreSQL with TimescaleDB | TimescaleDB IS PostgreSQL with extensions. Worth doing later when ont_snapshots needs columnar compression. Not blocking. |
| Replace Redis with NATS | Same shape, less mature on Pi. No win. |
| Rust/Go rewrite | Existing Python skill on team is more valuable than language perf for this scale. Revisit at 30+ OLTs. |
| Use vendor-provided OLT EMS software | Booto's Netlink doesn't ship one. Even if it did, it would be closed-box â€” no integration with Railwire, mobile, predictions. |

---

## What I Need From You (decision points)

Before I start building, please confirm:

1. **Is 2 weeks of build acceptable, with parallel-running existing system?** (vs trying to fix in-place over a few days)
2. **OK to use a separate DB `rico_net_engine` initially**, then migrate? (vs same DB with new tables)
3. **OK with Redis as the message bus**? (alternative: PG LISTEN/NOTIFY, slightly simpler but slower)
4. **Should the API live on the Pi (next to collectors) or on the home server (next to backend)?** I recommend home server â€” keeps Pi focused on collection only.
5. **Are you OK if I disable the current poller for periods of testing?** I'd prefer to keep it running and read-only-shadow the engine, but staging may need brief downtime.

Once approved, I'll:
- Open a PR with Phase 0 + Phase 1 (foundation + collectors)
- Run shadow mode for 48h with metrics
- Send you a comparison report
- Move to Phase 2

If at any phase the engine produces worse data than the current poller, we don't cut over. Old system stays. New code archived. Zero risk to your operations.
