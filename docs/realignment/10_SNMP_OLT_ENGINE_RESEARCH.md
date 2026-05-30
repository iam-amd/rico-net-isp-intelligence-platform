# SNMP-as-Realtime-Engine â€” Research Report

> **Question this answers:** Can SNMP fully drive the OLT engine â€” realtime, no time
> delay, across all current and future OLTs? What data exists, what doesn't, what
> we're already using, and what's still on the table.
>
> **Scope:** Research only. No code changes. Findings derive from full SNMP walks of
> the 3 live OLTs (~136K OIDs) plus inspection of `olt-proxy/snmp_client.py`.
>
> **Date:** 2026-05-11
> **Walk source:** `<local-project-path>\olt-proxy\OLT_*_full_oid_dump.txt` and `walks/`

---

## 0. Bottom Line

1. **SNMP can be the realtime engine for ~95% of fields**, including optical, status,
   identity, and dying-gasp. Telnet is no longer the source of truth â€” it's a
   structural fallback for the slow GPON SNMP agent (.210) and a debugging tool.
2. **Per-ONU traffic counters (RX/TX bytes) are EPON-only** via SNMP. GPON exposes
   them through ifTable inconsistently (.200 sparse, .210 historically blocked).
   This is the only field that does *not* meet realtime SLA on all OLTs.
3. **Real "no time delay" requires SNMP traps (UDP 162) â€” not polling.** Traps are
   already configured on .100 + .200 â†’ Pi:162. The trap receiver is deployed but
   the .210 trap target needs verification, and the trap â†’ backend write path
   needs to be lifted out of polling cadence so events surface in <2s, not 60s.
4. **Three subtrees we're not yet using** but should be: per-PON-port OLT-side
   health (`5.10.13.1.1`), the alarm-name string table (`5.10.13.4.2`), and on
   GPON .210 the LAN-MAC learning table (`5.10.3.12`).
5. **For the 2 future OLTs** (not yet delivered): require SNMP v2c + enterprise
   tree under `1.3.6.1.4.1.37950` + trap-target support before procurement
   acceptance. Check firmware against the OID matrix in Â§3 before deploying.

---

## 1. The SNMP State Today

| Aspect | Status |
|---|---|
| Transport mode | `OLT_PRIMARY_TRANSPORT=snmp`, Telnet fallback |
| OLTs polled | 3 (10.10.10.100, .200, .210), all on UDP **162** (non-standard) |
| Enterprise root | `1.3.6.1.4.1.37950` (Netlink/CTB/VSOL shared chipset) |
| Communities | `public` (read), `private` (write); ACL `0.0.0.0/0` |
| ONUs reachable | ~2,174 across all 3 OLTs (.100=659, .200=230, .210=1,285) |
| Cycle time | EPON ~15-30s, GPON .200 ~15-30s, GPON .210 ~30-90s |
| Traps configured | .100 â†’ Pi:162 âœ…, .200 â†’ Pi:162 âœ…, .210 unverified âš ï¸ |
| Trap receiver | `olt-trap-receiver.service` deployed on Pi |
| Telnet usage | Fallback only â€” no longer a realtime source |
| Web portal | Retired (was stressing OLT CPU) |

The current `snmp_client.py` already extracts: MAC, status, port, onu_index,
`rx_power_dbm`, `tx_power_dbm`, `temperature_c`, `voltage_mv`, `tx_bias_current_ma`,
`dying_gasp`, and (EPON only) `rx_bytes`/`tx_bytes`. It does **not** yet extract:
OLT-port health, ONT model/vendor/HW/SW version, ONU uptime, last-online/last-offline
timestamps, GPON LAN-MAC learning, GPON serial number, or per-PON-port aggregate
counters.

---

## 2. Per-OLT Capability Matrix

The data point at the column is delivered by the OLT in the row. Bold = currently
extracted by `snmp_client.py`. âš  = available but unused.

| Data point | EPON .100 (V1600D) | GPON .200 (V1600G1) | GPON .210 (V1600G1B) |
|---|---|---|---|
| **MAC address** | âœ… enterprise + ifTable | âœ… enterprise (`.10.3.5.1.3`) | âœ… enterprise (`.10.3.5.1.3`) |
| **Status (online/offline)** | âœ… ifOperStatus + enterprise | âœ… phase-state `.6.1.1.1.1.4` | âœ… phase-state `.6.1.1.1.1.4` |
| **PON port + ONU index** | âœ… ifDescr parse + enterprise | âœ… phase-state cols 1,2 | âœ… phase-state cols 1,2 |
| **Rx optical (dBm)** | âœ… `.5.12.2.1.8.1.7` | âœ… `.6.1.1.3.1.7` | âœ… `.6.1.1.3.1.7` (slow agent) |
| **Tx optical (dBm)** | âœ… `.5.12.2.1.8.1.6` | âœ… `.6.1.1.3.1.6` | âœ… `.6.1.1.3.1.6` |
| **OLT-side Rx (dBm)** | âŒ not exposed | âœ… `.6.1.1.3.1.8` | âœ… `.6.1.1.3.1.8` |
| **Temperature (Â°C)** | âœ… `.5.12.2.1.8.1.3` | âœ… `.6.1.1.3.1.3` | âœ… `.6.1.1.3.1.3` |
| **Voltage (V)** | âœ… `.5.12.2.1.8.1.4` | âœ… `.6.1.1.3.1.4` | âœ… `.6.1.1.3.1.4` |
| **Tx bias (mA)** | âœ… `.5.12.2.1.8.1.5` | âœ… `.6.1.1.3.1.5` | âœ… `.6.1.1.3.1.5` |
| **Dying gasp** | âœ… alarm code 26 at `.5.10.3.3.1.2.{N}` | âœ… phase=4 at `.6.1.1.1.1.5` | âœ… phase=4 + reason `"Power Off"` at `.6.1.1.1.1.10` |
| **Phase reason** | partial | partial | âœ… rich (`Power Off`, `Other`, etc.) |
| **Last online time** | âŒ | âŒ | âœ… `.6.1.1.1.1.8` âš  unused |
| **Last offline time** | âŒ | âŒ | âœ… `.6.1.1.1.1.9` âš  unused |
| **ONU uptime (sec)** | âŒ | âœ… `.6.1.1.4.1.20` âš  | âœ… `.6.1.1.4.1.20` âš  |
| **Last-activity human ts** | âŒ | âŒ | âœ… `.6.1.1.4.1.27` âš  |
| **Per-ONU RX bytes** | âœ… ifInOctets | âš  ifTable sparse (34/275) | âŒ ifTable timeout |
| **Per-ONU TX bytes** | âœ… ifOutOctets | âš  ifTable sparse (15/275) | âŒ ifTable timeout |
| **Per-ONU errors** | âœ… ifInErrors | âš  ifTable sparse | âŒ ifTable timeout |
| **ONT vendor ID** | âŒ | âœ… `.6.1.1.4.1.3` âš  | âœ… `.6.1.1.4.1.3` âš  |
| **ONT hardware version** | âŒ | âœ… `.6.1.1.4.1.4` âš  | âœ… `.6.1.1.4.1.4` âš  |
| **ONT serial number** | n/a (EPON uses MAC) | âœ… `.6.1.1.4.1.5` âš  | âœ… `.6.1.1.4.1.5` âš  |
| **ONT model name** | âœ… `.5.12.1.12.1.7` âš  | âœ… `.6.1.1.4.1.14` âš  | âœ… `.6.1.1.4.1.14` âš  |
| **ONT software version** | âŒ | âœ… `.6.1.1.4.1.25/26` âš  | âœ… `.6.1.1.4.1.25/26` âš  |
| **ONU-ID string** | âœ… enterprise (`.10.3.2.1.5`) | âœ… `.6.1.1.4.1.24` | âœ… `.6.1.1.4.1.24` |
| **OLT-port temp (Â°C)** | âœ… `.5.10.13.1.1.2` âš  | âœ… `.5.10.13.1.1.2` âš  | âœ… `.5.10.13.1.1.2` âš  |
| **OLT-port voltage (V)** | âœ… `.5.10.13.1.1.3` âš  | âœ… `.5.10.13.1.1.3` âš  | âœ… `.5.10.13.1.1.3` âš  |
| **OLT-port Tx bias (mA)** | âœ… `.5.10.13.1.1.4` âš  | âœ… `.5.10.13.1.1.4` âš  | âœ… `.5.10.13.1.1.4` âš  |
| **OLT-port Tx power (dBm)** | âœ… `.5.10.13.1.1.5` âš  | âœ… `.5.10.13.1.1.5` âš  | âœ… `.5.10.13.1.1.5` âš  |
| **Alarm-name table** | âœ… `.5.10.13.4.2.1.2.{idx}` âš  | âœ… same OID âš  | âœ… same OID âš  |
| **Per-PON registered count** | âŒ | âœ… `.6.1.1.18.1.{2,3}` âš  | âš  unverified |
| **LAN-MAC learning** | âŒ | âŒ | âœ… `.5.10.3.12.1.1.6.<MAC bytes>` âš  |
| **OLT sysUpTime** | âœ… standard `.1.3.0` | âœ… standard `.1.3.0` | âŒ system tree blocked |
| **OLT model/firmware** | âœ… `.5.10.14.1.0` = "V1600D8" | âœ… `.5.10.12.5.4` = "V2.3.1R" | âŒ system tree blocked |
| **Trap config visible** | âœ… active | âœ… active | âŒ snmpv2 walk timeout |
| **Trap target** | âœ… Pi:162 | âœ… Pi:162 | âš  unconfirmed (set via web UI) |

**Reading this table:**
- Anything âœ… is *guaranteed retrievable now*. Anything âš  is retrievable but not yet
  in `snmp_client.py`. Anything âŒ is missing â€” go via Telnet, traps, or accept gap.
- ".210 system tree blocked" is a quirk of V1.4.8R firmware â€” standard MIB-II walks
  fail, but the enterprise tree responds. Code already handles this.

---

## 3. The Three Subtrees We Should Add

### 3.1 OLT-side per-PON-port health â€” `5.10.13.1.1`

**Available on all 3 OLTs.** 8 rows Ã— 5 columns:

| Col | Field | Sample (.100) | Sample (.210) |
|---|---|---|---|
| 1 | PON port number | 1..8 | 1..8 |
| 2 | Temperature (Â°C) | "50.56" | "45.379" |
| 3 | Voltage (V) | "3.25" | "3.261" |
| 4 | Tx bias (mA) | "13.95" | "25.344" |
| 5 | Tx power (dBm) | "7.74" | (varies) |

**Why it matters:** This is the OLT laser's own health, per port. If port 4 is
running at 65Â°C while ports 1-3 are at 48Â°C, port 4 is going to fail before it
fails â€” the OLT itself is the fault, not the customer. Feeds into:
- OLT hardware fault detection (page-on-call alarm: `OLT_PORT_HOT`,
  `OLT_PORT_LASER_DEGRADING`)
- "Why are 200 customers offline?" â€” if all of them are on PON port 4 and the
  port reports 70Â°C, the answer is now obvious without rolling a truck.
- Capacity-planning context (laser bias creeping up = port nearing end-of-life)

Total cost: 8Ã—5 = 40 OIDs per OLT per cycle. ~0.5s to walk.

### 3.2 Alarm-name string table â€” `5.10.13.4.2.1.2.{idx}`

**Available on all 3 OLTs** with 85-106 entries each. Maps numeric alarm codes
(returned by `.5.10.3.3.1.2.{N}` per ONU) to human-readable names like
`"onu-dying-gasp"`, `"fan"`, etc.

**Why it matters:** Right now the code hard-codes `_E_DG_IDX = 26` for dying
gasp. If firmware changes the index, dying gasp detection silently breaks. By
walking this table once at startup (and re-validating every hour), we get a
self-describing alarm catalog. Bonus: the same table reveals all *other* alarm
types the OLT knows about â€” fan failure, PSU failure, fiber-cut, etc. â€” that we
could surface as alarms but currently ignore.

### 3.3 LAN-MAC learning table (GPON .210 only) â€” `5.10.3.12`

**Available on .210, ~2,380 entries (~4 LAN MACs per ONU).** Format:

```
.1.3.6.1.4.1.37950.1.1.5.10.3.12.1.1.6.<dec1>.<dec2>.<dec3>.<dec4>.<dec5>.<dec6>
  = Hex-STRING: AA BB CC DD EE FF
```

Where `<dec1..dec6>` are the decimal-encoded bytes of the customer device MAC
behind the ONU. The value is the same MAC.

**Why it matters:** This is the **router's downstream learned MAC table** as
seen from the OLT. With this we know which customer devices (laptop, phone, TV)
are actually connected to each ONU's LAN. Feeds into:
- "Customer says nothing works" â€” table shows 4 devices online, including their
  phone that was connected 30 seconds ago. We know the line is up.
- Multi-device household profiling (no auth â€” but device count is a useful
  health signal: drops to 1, customer probably travelling).
- Rogue-device detection (unfamiliar MAC behind a customer's ONU).

**Caveat:** Only confirmed on .210. Re-walk .200 to test if the firmware exposes
it under the same OID; if not, this is a .210-and-newer feature.

---

## 4. Real-Time Architecture: Three Lanes

"Realtime, no delay" doesn't come from one mechanism â€” it comes from layering
three:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ LANE 1 â€” Polling (steady-state, every ONU)                      â”‚
â”‚   SNMP bulk-walk â†’ 60s cycle on EPON, 60-90s on GPON           â”‚
â”‚   Captures: status, optical, identity, traffic counters         â”‚
â”‚   Used for: dashboards, deltas, predictions                     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ LANE 2 â€” Traps (event-driven, sub-second)                       â”‚
â”‚   OLT pushes to UDP 162 on Pi (10.10.10.50) when event fires  â”‚
â”‚   Captures: link up/down, dying-gasp, alarm-on/alarm-off        â”‚
â”‚   Used for: instant NOC ticker, page-on-call, dying-gasp dispatch â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ LANE 3 â€” On-demand SET (control plane)                          â”‚
â”‚   Backend â†’ Pi â†’ SNMP SET â†’ OLT (single ONU)                   â”‚
â”‚   Captures: reboot, deregister, config change                   â”‚
â”‚   Used for: ticket auto-resolution, customer-portal "fix me"    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Lane 1 alone is not realtime.** A 60s poll cycle means a customer's ONU could
be offline for 59s before the dashboard knows. Acceptable for ticket queues, not
for "phone the customer in 30s when their power cuts."

**Lane 2 is the realtime lane.** Traps are pushed by the OLT instantly. The Pi
needs to be running `trap_receiver.py` continuously, decoding the trap, and
posting to the backend `/ingest/alarm-event` endpoint within 1s. Today that path
exists; what's needed:

1. **Verify .210 trap target.** Walk timed out â€” we don't know if `.210` is
   actually pushing traps. Action: SSH to .210 web UI, confirm trap target =
   `10.10.10.50:162`, send a manual test trap (offline an ONU) and confirm Pi
   logs it.
2. **Decouple trap path from polling cadence.** If the Pi's poller is busy with
   a 60s cycle, traps must not be queued behind it. They already aren't (separate
   service), but the **trap â†’ backend HTTP call** must use a small persistent
   connection pool with a 2s timeout, not block on the same HTTP client used by
   the poller.
3. **Add trap-debounce.** If the same ONU fires `linkDown` 6 times in 30s
   (flapping fiber), don't fire 6 NOC alerts. Suppress with an in-memory window.

**Lane 3** today is half-built: SNMP SET reboot OID for EPON is theorised
(`.5.10.3.1.2.1.10.{N}`) but unverified. GPON reboot OID is unknown. Both need
a one-time test against a willing customer ONU; if the OID is wrong, fall back
to Telnet `interface gpon 0/X / onu N reboot`.

---

## 5. What Each Field's Source Should Be

This is the per-field source-of-truth chain that `snmp_client.py` should
encode. Tier 1 is the realtime source; Tier 2/3 are degraded sources.

| Field | Tier 1 (realtime) | Tier 2 (fallback) | Tier 3 (last resort) |
|---|---|---|---|
| status | SNMP poll (`5.10.3.2.1.4` or `6.1.1.1.1.4`) + trap on transition | Telnet `state all` | last-known + age |
| dying_gasp | trap (instant) | SNMP poll alarm code 26 / phase=4 / `Power Off` | Telnet phase |
| rx_power_dbm | SNMP poll `.5.12.2.1.8.1.7` / `.6.1.1.3.1.7` | Telnet `opm-diag` | none (clear field) |
| tx_power_dbm | SNMP poll `.6` col | Telnet | none |
| temperature_c | SNMP poll `.3` col | Telnet | none |
| voltage_v | SNMP poll `.4` col | Telnet | none |
| rx_bytes (EPON) | SNMP poll ifInOctets | n/a (Telnet doesn't expose) | accept gap |
| rx_bytes (GPON) | SNMP poll ifInOctets where present | accept gap (sparse) | accept gap |
| onu_uptime_s | SNMP poll `.6.1.1.4.1.20` (GPON) | derived from state changes | unknown |
| last_online_at | SNMP poll `.6.1.1.1.1.8` (.210) | computed from state transitions | from trap log |
| last_offline_at | SNMP poll `.6.1.1.1.1.9` (.210) | computed | from trap log |
| serial_number (GPON) | SNMP poll `.6.1.1.4.1.5` | Telnet `info all` | `SN:` placeholder |
| ont_vendor (GPON) | SNMP poll `.6.1.1.4.1.3` | Telnet | unknown |
| ont_model | SNMP poll | Telnet | unknown |
| ont_sw_version | SNMP poll `.6.1.1.4.1.25` | unknown | unknown |
| reboot | SNMP SET (when verified) | Telnet `onu N reboot` | manual via OLT web UI |
| OLT-port health | SNMP poll `.5.10.13.1.1.{2-5}` | Telnet `show pon-port` (per OLT) | none |
| LAN-MAC learning | SNMP poll `.5.10.3.12` (.210 only) | none | none |
| alarm-name catalog | SNMP poll `.5.10.13.4.2.1.2` | hardcoded fallback | hardcoded fallback |

**Key design rule:** Every field stored in the DB should record `{value,
source_tier, source_freshness_seconds}`. The dashboard renders Tier-2 values
faded and Tier-3 grey, so the operator can see "what we know vs how we know it."

---

## 6. Realtime Latency Targets â€” What's Achievable

Given the data available, here's what the engine can promise:

| Event | Today | Achievable | How |
|---|---|---|---|
| ONU goes offline (link drop) | up to 60s | <2s | Trap (already configured on .100/.200; verify .210) |
| ONU dying gasp (power cut) | up to 60s | <2s | Trap |
| ONU comes online | up to 60s | <2s | Trap |
| Optical signal degrades to FIBER_CRITICAL | 60s | 60s | Polling â€” trap doesn't fire on slow drift |
| Customer device joins LAN (.210) | none | 60s | Add `5.10.3.12` to poll loop |
| OLT-port temperature spike | none | 60s | Add `5.10.13.1.1.2` to poll loop |
| OLT laser TX bias creep | none | hourly | Add `5.10.13.1.1.4` to slow-poll cycle |
| Per-ONU traffic anomaly (EPON) | 60s | 60s | Already polled |
| Per-ONU traffic anomaly (GPON) | n/a | n/a | Not exposed reliably â€” accept gap |
| Reboot acknowledged | seconds | seconds | SNMP SET (when OID verified) |

**The only gap that can't be closed via SNMP** is per-ONU traffic counters on
GPON. For that field, the OLT's own bandwidth-profile counters
(`6.1.1.18.1.{2,3}`) give per-PON-port aggregates â€” useful for capacity, useless
for per-customer analytics. To get per-ONU GPON bandwidth, we'd need either:
- Newer Netlink firmware that fixes ifTable population on GPON, or
- ONT-side polling (TR-069) of the customer router, or
- Mirror-port sampling at the OLT uplink (overkill for a 1.3K-customer ISP)

Recommendation: live with the gap. Per-customer bandwidth is nice-to-have, not
load-bearing.

---

## 7. Hardening for Production Realtime

The transport works; what fails is the *stack around it*. Items below are
sequenced from "must" to "nice."

### Must-do (closes correctness gaps)

1. **Verify .210 trap target.** Send test trap, confirm Pi receives it.
   Without this, .210's instant offline detection is via 60s poll only.
2. **Replace hardcoded alarm codes with the alarm-name table.** A startup
   walk of `.5.10.13.4.2.1.2` builds `{26: "onu-dying-gasp", ...}` and the code
   matches by name, not number. Survives firmware changes.
3. **Add OLT-port health to a slow cycle (5 min).** Detects OLT hardware
   fault before customer tickets pile up.
4. **Watchdog the SNMP agent on .210.** Per memory, V1.4.8R has a slow agent â€”
   already set to `timeout=30s`. Add a circuit breaker: if 3 consecutive cycles
   timeout, escalate to telnet fallback for that OLT only, and alarm.
5. **Trap debouncing.** A flapping fiber should fire 1 alarm not 50.

### Should-do (unlocks new value)

6. **Walk `.6.1.1.4.1` GPON identity columns** every cycle. Get vendor / HW /
   SW version / serial / model / uptime per ONU. Populates ONU inventory page
   for free.
7. **Walk `.6.1.1.1.1.{8,9,10}` on .210** for last-online, last-offline,
   offline-reason. Replace any place we currently say "we don't know why
   they're offline" with the reason string from col 10.
8. **Try LAN-MAC learning table on .200 too.** If `.5.10.3.12` exists on .200
   firmware V2.3.1R, customer-device tracking unlocks for both GPONs.
9. **Walk `.5.12.1.12.1.7` on EPON** â€” gives ONT model name for EPON ONUs (we
   have this for GPON, missing for EPON today).
10. **Confirm the SNMP SET reboot OID.** Test once on a willing ONU, then
    expose via the OLT proxy `/olt/reboot` endpoint as Tier 1.

### Could-do (research, not blocking)

11. **GPON SNMP SET reboot OID hunt.** Current best guess is the same shape
    as EPON: `.1.1.6.1.X.Y.Z.{global_index}` SET INTEGER 1. Write-only, so it
    won't appear in walks. Brute-force test on a customer ONU during a
    maintenance window, or escalate to Netlink support (email already sent
    2026-05-02).
12. **Email Netlink for the V1600D / V1600G1 / V1600G1B MIB files.** Even the
    private MIB definitions would let us validate every OID we've reverse-
    engineered from walks.
13. **Investigate `.5.12.1.10` and `.5.12.1.11`** on EPON â€” they look like
    ONU profile templates. If they expose per-ONU bandwidth limits, that's a
    free `subscribed_speed_mbps` field per customer.

---

## 8. Future OLTs (the 2 not yet delivered)

When the next OLTs arrive, **before plugging them in:**

1. **Confirm SNMPv2c is supported with custom community.** Netlink default is
   `public`/`private`; if vendor changed it to "must use SNMPv3 with auth," the
   poller stack changes.
2. **Confirm enterprise root is `1.3.6.1.4.1.37950`.** If the new OLT is
   re-OEM'd from a different chipset (e.g. `4.1.17409` Realtek), all the
   confirmed OIDs in this report are wrong and we re-walk from scratch.
3. **Run the audit:** `python snmp_audit.py --host <new-olt>`. Generates the
   full enterprise dump and writes a profile JSON. Compare against the matrix
   in Â§2; flag every column that doesn't match.
4. **Configure trap target â†’ Pi:162** via the OLT web UI. Don't accept the OLT
   without this.
5. **Add the OLT to `config.py` `OLT_HOSTS` AND to `_EPON_HOSTS` or
   `_GPON_HOSTS`** in `snmp_client.py`. Without that, the SNMP path is a no-op.
6. **Decide trap reachability:** if the new OLT is on a different subnet than
   the Pi, configure routing so trap UDP packets reach Pi LAN IP. Tailscale
   doesn't help here â€” traps don't traverse it from inside the OLT.

The matrix in Â§2 already calls out which fields require which OID. As long as
the new OLTs honour those OIDs, the realtime engine stays the same engine â€” no
code change.

---

## 9. The OLT Engine Implication

The OLT-Engine design doc (`olt-proxy/OLT_ENGINE_DESIGN.md`) was written when
SNMP was thought to lack optical and we'd need Telnet for it. **That premise is
obsolete.** Specifically:

- The "Telnet collector @ 5 min for optical" service is **no longer needed** as
  primary. It becomes a *fallback* collector, run only when SNMP for that OLT
  fails the circuit-breaker threshold.
- The collector matrix in Â§1 of that doc collapses from 4 collectors + trap
  receiver to **3 collectors (one per OLT) + trap receiver**, all SNMP-based.
- The "optical_polled_at" separate-freshness column in `ont_state` becomes
  redundant â€” optical and status are now atomic per cycle.
- Mass-offline guard logic still applies, but the underlying signal is now SNMP
  alone, so cross-source disagreement (SNMP says offline, Telnet says online)
  no longer needs a tiebreaker.

If the engine is built today, build it as `SNMP-primary, Telnet-as-circuit-
breaker-fallback, traps-on-the-side`. Don't carry forward the "two collectors
per OLT" pattern from the original design â€” it's solving a problem we've since
solved.

---

## 10. Open Research Items (no answers yet)

| Item | Why it matters | Action |
|---|---|---|
| Does `5.10.3.12` (LAN-MAC learning) exist on .200? | Unlocks .200 customer-device tracking | Walk `.5.10.3.12` on .200 directly |
| Does `5.10.13.1.1` give realistic OLT-port health on all 3 OLTs continuously? | Confirms OLT hardware-health monitoring is reliable | Poll every 5 min for 24h, check value drift |
| Is the EPON SNMP SET reboot OID `.5.10.3.1.2.1.10.{N}` correct? | Closes the reboot control loop | Test on one ONU; verify it actually reboots via state transition |
| Does .210 push traps at all? | Realtime detection on .210 | Manual offline test, watch Pi `journalctl -u olt-trap-receiver` |
| What's in the enterprise alarm-history subtree (`.5.10.13.3` on .210)? | Historical alarm log without polling | Walk all 330 OIDs of `.5.10.13.3`, decode columns |
| What does GPON `6.1.1.18.1.{2,3}` measure? | Possible per-PON-port active-ONU count | Compare values to `show interface gpon 0/N` Telnet output |
| Does newer Netlink firmware fix GPON ifTable? | Per-ONU GPON traffic via SNMP | Check Netlink release notes / ask vendor |
| Will Netlink share their MIB file? | Eliminates all OID guesswork | Email sent 2026-05-02 â€” chase reply |

---

## Appendix A â€” Confirmed OID Cheat Sheet

```
ENTERPRISE ROOT: 1.3.6.1.4.1.37950
SNMP PORT:       162 (non-standard)
COMMUNITIES:     public (read), private (write)

EPON .100 (V1600D)
  ONU registration:
    .1.1.5.10.3.2.1.3.{N}            Hex MAC
    .1.1.5.10.3.2.1.4.{N}            status (1=on, 0=off)
    .1.1.5.10.3.2.1.5.{N}            "EPON0/1:7"
    .1.1.5.10.3.3.1.2.{N}            alarm code (26=dying gasp)
    .1.1.5.10.3.1.2.1.10.{N}         REBOOT (SET=1) âš  unverified
  Per-ONU optical (col.PORT.ONU):
    .1.1.5.12.2.1.8.1.3              temperature Â°C
    .1.1.5.12.2.1.8.1.4              voltage V
    .1.1.5.12.2.1.8.1.5              tx bias mA
    .1.1.5.12.2.1.8.1.6              tx power "1.87 mW (2.72 dBm)"
    .1.1.5.12.2.1.8.1.7              rx power "0.03 mW (-16.02 dBm)"
  ONU model:
    .1.1.5.12.1.12.1.7.{N}           "V2801S" / "HG323DACv3" âš  unused
  Per-PON-port OLT health (port=1..8):
    .1.1.5.10.13.1.1.2.{P}           OLT laser temp Â°C âš  unused
    .1.1.5.10.13.1.1.3.{P}           OLT laser voltage V âš  unused
    .1.1.5.10.13.1.1.4.{P}           OLT laser bias mA âš  unused
    .1.1.5.10.13.1.1.5.{P}           OLT laser tx power dBm âš  unused
  Alarm dictionary:
    .1.1.5.10.13.4.2.1.2.{idx}       alarm string ("onu-dying-gasp" etc.) âš  unused
  Identity:
    .1.3.0                           sysUpTime
    .1.1.5.10.14.1.0                 firmware ("V1600D8")

GPON .200 (V1600G1) and .210 (V1600G1B) â€” same OIDs except where noted
  ONU registration:
    .1.1.5.10.3.5.1.3.{N}            MAC string
    .1.1.5.10.3.5.1.5.{N}            "port:onu_idx"
  Per-ONU phase state (port.onu):
    .1.1.6.1.1.1.1.4                 status (1=on, 2=off)
    .1.1.6.1.1.1.1.5                 phase (3=working, 4=DyingGasp, 5=Off, 6=AuthFail)
    .1.1.6.1.1.1.1.8                 last online time   .210 only
    .1.1.6.1.1.1.1.9                 last offline time  .210 only
    .1.1.6.1.1.1.1.10                offline reason     .210 only ("Power Off"/"Other")
  Per-ONU optical (col.PORT.ONU):
    .1.1.6.1.1.3.1.3                 temperature
    .1.1.6.1.1.3.1.4                 voltage
    .1.1.6.1.1.3.1.5                 tx bias mA
    .1.1.6.1.1.3.1.6                 tx power dBm
    .1.1.6.1.1.3.1.7                 rx power dBm (ONU-side)
    .1.1.6.1.1.3.1.8                 rx power dBm (OLT-side, more reliable)
  Per-ONU identity (col.PORT.ONU):
    .1.1.6.1.1.4.1.3                 vendor ID ("MONU")           âš  unused
    .1.1.6.1.1.4.1.4                 hardware version ("V5.2")    âš  unused
    .1.1.6.1.1.4.1.5                 serial ("GPON30304543")      âš  unused
    .1.1.6.1.1.4.1.14                model ("MONUV601")           âš  unused
    .1.1.6.1.1.4.1.20                uptime ("106460.00 s")       âš  unused
    .1.1.6.1.1.4.1.24                ONU-ID ("GPON0/1:1")
    .1.1.6.1.1.4.1.25                software version             âš  unused
    .1.1.6.1.1.4.1.27                last activity human ts       .210 only âš  unused
  Per-PON-port OLT health: same as EPON (.1.1.5.10.13.1.1.{2..5}.{P}) âš  unused
  LAN-MAC learning (.210 confirmed):
    .1.1.5.10.3.12.1.1.6.<MAC bytes decimal> = Hex-STRING <MAC>  âš  unused
  Identity (.200 only â€” .210 system tree blocked):
    .1.3.0                           sysUpTime
    .1.1.5.10.12.5.4.0               firmware ("V2.3.1R")

STANDARD MIB-II (EPON + GPON .200 only â€” .210 blocked):
  .1.3.6.1.2.1.2.2.1.2               ifDescr ("EPON01ONU34" / "GPON01ONU7")
  .1.3.6.1.2.1.2.2.1.6               ifPhysAddress (MAC, sparse on GPON)
  .1.3.6.1.2.1.2.2.1.8               ifOperStatus (1=up, 2=down)
  .1.3.6.1.2.1.2.2.1.10              ifInOctets (RX bytes)  EPON only reliable
  .1.3.6.1.2.1.2.2.1.14              ifInErrors
  .1.3.6.1.2.1.2.2.1.16              ifOutOctets (TX bytes) EPON only reliable
```

## Appendix B â€” Files Inspected

- `olt-proxy/snmp_client.py` â€” current production SNMP client, hardcoded OIDs
- `olt-proxy/snmp_oid_profile.json` â€” legacy profile (largely superseded)
- `olt-proxy/SNMP_DATA_CATALOG.md` â€” full subtree statistics, generated 2026-05-01
- `olt-proxy/SNMP_DATA_INVENTORY.md` â€” per-OLT field availability matrix
- `olt-proxy/SNMP_DISCOVERY_REPORT.md` â€” original discovery walkthrough
- `olt-proxy/ONU_DATA_FIELDS.md` â€” SNMP-vs-Telnet field comparison
- `olt-proxy/OLT_ENGINE_DESIGN.md` â€” OLT-engine architecture (predates SNMP-primary)
- `olt-proxy/CLAUDE.md` â€” current OLT-proxy operational notes
- `olt-proxy/OLT_*_full_oid_dump.txt` â€” raw walks of all 3 OLTs (~136K OIDs)
- `olt-proxy/walks/*.txt` â€” earlier walks, smaller targeted scans

Memory:
- `snmp_optical_confirmed_may03.md`
- `snmp_telnet_retired_may03.md`
- `snmp_primary_migration.md`
- `snmp_full_discovery_may01.md`
