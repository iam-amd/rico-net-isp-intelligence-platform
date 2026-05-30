# SNMP Overall Report â€” For Building the New OLT Engine

> Single comprehensive reference. Everything verified live on 2026-05-11
> against the 3 production OLTs. Read this end-to-end before writing engine code.
>
> Supersedes (but doesn't delete): `SNMP_DATA_CATALOG.md`, `SNMP_DATA_INVENTORY.md`,
> `SNMP_DISCOVERY_REPORT.md`, `OLT_ENGINE_DESIGN.md`, `ONU_DATA_FIELDS.md`.

---

## 0. TL;DR â€” What the Engine Can Be

1. **SNMP can be the realtime engine for ~95% of fields** across all 3 OLTs.
   Optical, status, identity, dying-gasp, alarms â€” all live via SNMP today.
2. **Telnet is a fallback only**, not a co-equal collector.
3. **LAN-MAC matching is automated for ~90% of customers** (EPON + GPON .210).
   GPON .200 (~230 customers, 10%) requires survey workflow â€” no SNMP path exists.
4. **Per-customer live bandwidth chart works on EPON only.** GPON shows
   per-PON-aggregate or daily totals from Railwire. Firmware limitation.
5. **Real-time (<2s) requires SNMP traps**, not polling. Polling adds 60-90s of
   latency. Traps configured on .100/.200; .210 needs verification.
6. **Speed test â‰  live bandwidth.** Speed test runs from customer device
   (Ookla/Fast.com link). OLT cannot run speed tests.

---

## 1. The 3 OLTs â€” Operational Facts

| Field | EPON .100 | GPON .200 | GPON .210 |
|---|---|---|---|
| LAN address | 10.10.10.100 | 10.10.10.200 | 10.10.10.210 |
| Model | V1600D8 | V1600G1 | V1600G1B |
| Firmware | V2.03.75R | V2.3.1R | V1.4.8R |
| Type | EPON | GPON | GPON |
| Registered ONUs | 659 (~347 active) | 230 | 1,285 |
| Customer share | 30% | 10% | 60% (the bulk) |
| SNMP port | UDP **162** (non-standard) | UDP 162 | UDP 162 |
| SNMP community | `public` / `private` | same | same |
| ACL | `0.0.0.0/0` permit | same | same |
| SNMP cycle | 15-30s | 15-30s | 30-90s (slow agent) |
| Standard MIB-II walks | âœ… work | âœ… work | âŒ blocked (only enterprise tree responds) |
| Telnet | âœ… port 23 | âœ… port 23 | âœ… port 23 (slow ~400s/cycle) |
| Trap target â†’ Pi:162 | âœ… confirmed | âœ… confirmed | âš ï¸ unverified |
| Enterprise root | `1.3.6.1.4.1.37950` | same | same |
| LAN-MAC SNMP path | âœ… `.5.10.3.8` | âŒ â€” none | âœ… `.5.10.3.12` |
| Per-ONU traffic | âœ… ifTable | âŒ sparse | âŒ blocked |
| ONU optical | âœ… `.5.12.2.1.8` | âœ… `.6.1.1.3` | âœ… `.6.1.1.3` |

Pi (collector): rico@100.x.x.x (Tailscale) / 10.10.10.50 (LAN).
Backend: home 100.x.x.x:8000.

---

## 2. Confirmed OIDs â€” Everything That Actually Works

Notation: `{N}` = global ONU index, `{P}` = PON port (1..8), `{O}` = ONU index within port.
Status legend: ðŸŸ¢ = wired up today / ðŸŸ¡ = available, not yet extracted / ðŸ”´ = not available.

### 2.1 ALL 3 OLTs share these OIDs

**Per-PON-port OLT-side health (`.5.10.13.1.1`)** â€” 8 rows per OLT, 4 health columns:

| OID | Field | Sample | Status |
|---|---|---|---|
| `.1.1.5.10.13.1.1.2.{P}` | OLT laser temperature Â°C | "50.59" | ðŸŸ¡ |
| `.1.1.5.10.13.1.1.3.{P}` | OLT laser voltage V | "3.25" | ðŸŸ¡ |
| `.1.1.5.10.13.1.1.4.{P}` | OLT laser tx bias mA | "13.95" | ðŸŸ¡ |
| `.1.1.5.10.13.1.1.5.{P}` | OLT laser tx power dBm | "7.74" | ðŸŸ¡ |

Use: detect OLT hardware degradation. If all customers on PON 4 are offline
and the port is at 70Â°C, the OLT is the fault â€” don't dispatch field tech.

**Alarm name dictionary (`.5.10.13.4.2.1.2`)** â€” 85-106 entries per OLT:

| OID | Field | Sample |
|---|---|---|
| `.1.1.5.10.13.4.2.1.2.{idx}` | Alarm-code â†’ human-readable name | `"onu-dying-gasp"`, `"fan"`, ... |

Use: walk once at startup, cache `{26: "onu-dying-gasp", ...}`. Replaces
hardcoded `_E_DG_IDX = 26` in current code. Survives firmware changes.
ðŸŸ¡ not yet extracted.

### 2.2 EPON .100 specific OIDs

```
ONU REGISTRATION + STATUS (indexed by global N)
  .1.1.5.10.3.2.1.3.{N}            Hex-STRING  MAC address                  ðŸŸ¢
  .1.1.5.10.3.2.1.4.{N}            INTEGER     1=online, 0=offline          ðŸŸ¢
  .1.1.5.10.3.2.1.5.{N}            STRING      "EPON0/1:7" (port:onu)       ðŸŸ¢
  .1.1.5.10.3.3.1.2.{N}            INTEGER     alarm code (26 = DG)         ðŸŸ¢
  .1.1.5.10.3.1.2.1.10.{N}         SET INT 1   reboot ONU                   ðŸŸ¡ (unverified)

PER-ONU OPTICAL (indexed by .{P}.{O})
  .1.1.5.12.2.1.8.1.3.{P}.{O}      STRING      temperature Â°C "33"          ðŸŸ¢
  .1.1.5.12.2.1.8.1.4.{P}.{O}      STRING      voltage V "3.29"             ðŸŸ¢
  .1.1.5.12.2.1.8.1.5.{P}.{O}      STRING      tx bias mA "12.5"            ðŸŸ¢
  .1.1.5.12.2.1.8.1.6.{P}.{O}      STRING      "1.87 mW (2.72 dBm)"         ðŸŸ¢ (parse parens)
  .1.1.5.12.2.1.8.1.7.{P}.{O}      STRING      "0.03 mW (-16.02 dBm)"       ðŸŸ¢ (parse parens)

PER-ONU IDENTITY (live status table)
  .1.1.5.12.1.12.1.7.{N}           STRING      ONT model "V2801S"           ðŸŸ¡

LAN-MAC LEARNING TABLE â€” 1,388 ENTRIES (~4 MACs/ONU)
  .1.1.5.10.3.8.1.4.<MAC dec>      STRING      "EPON0/P:O"                  ðŸŸ¡
  Use: snmpget for any Railwire MAC â†’ returns ONU-ID directly = CONFIRMED match.

BRIDGE-MIB (alternative LAN-MAC source â€” 344 entries, 1/ONU, standard MIB)
  .1.3.6.1.2.1.17.4.3.1.1.6.<MAC>  Hex-STRING  the MAC                      ðŸŸ¡
  .1.3.6.1.2.1.17.4.3.1.2.6.<MAC>  INTEGER     bridge port                  ðŸŸ¡
  .1.3.6.1.2.1.17.1.4.1.2.<port>   INTEGER     port â†’ ifIndex               ðŸŸ¡

PER-ONU TRAFFIC (ifTable â€” EPON only OLT where this works)
  .1.3.6.1.2.1.2.2.1.2.<ifIdx>     STRING      "EPON01ONU34" (parse â†’ P,O)  ðŸŸ¢
  .1.3.6.1.2.1.2.2.1.6.<ifIdx>     Hex-STRING  MAC                          ðŸŸ¢
  .1.3.6.1.2.1.2.2.1.8.<ifIdx>     INTEGER     1=up, 2=down                 ðŸŸ¢
  .1.3.6.1.2.1.2.2.1.10.<ifIdx>    Counter32   ifInOctets (RX bytes)        ðŸŸ¢
  .1.3.6.1.2.1.2.2.1.14.<ifIdx>    Counter32   ifInErrors                   ðŸŸ¢
  .1.3.6.1.2.1.2.2.1.16.<ifIdx>    Counter32   ifOutOctets (TX bytes)       ðŸŸ¢

OLT IDENTITY
  .1.3.6.1.2.1.1.3.0               Timeticks   sysUpTime                    ðŸŸ¢
  .1.1.5.10.14.1.0                 STRING      firmware "V1600D8"           ðŸŸ¡
```

### 2.3 GPON .200 specific OIDs

```
ONU REGISTRATION + STATUS
  .1.1.5.10.3.5.1.3.{N}            STRING      MAC string                   ðŸŸ¢
  .1.1.5.10.3.5.1.5.{N}            STRING      "port:onu_idx"               ðŸŸ¢
  .1.1.6.1.1.1.1.4.{P}.{O}         INTEGER     1=online, 2=offline          ðŸŸ¢
  .1.1.6.1.1.1.1.5.{P}.{O}         INTEGER     phase (4=DyingGasp)          ðŸŸ¢

PER-ONU OPTICAL
  .1.1.6.1.1.3.1.3.{P}.{O}         STRING      temperature                  ðŸŸ¢
  .1.1.6.1.1.3.1.4.{P}.{O}         STRING      voltage                      ðŸŸ¢
  .1.1.6.1.1.3.1.5.{P}.{O}         STRING      tx bias mA                   ðŸŸ¢
  .1.1.6.1.1.3.1.6.{P}.{O}         STRING      "2.294(dBm)"                 ðŸŸ¢
  .1.1.6.1.1.3.1.7.{P}.{O}         STRING      "-13.518(dBm)" ONU-side      ðŸŸ¢
  .1.1.6.1.1.3.1.8.{P}.{O}         STRING      OLT-side rx dBm              ðŸŸ¢

PER-ONU IDENTITY (rich GPON identity)
  .1.1.6.1.1.4.1.3.{P}.{O}         STRING      vendor "MONU"                ðŸŸ¡
  .1.1.6.1.1.4.1.4.{P}.{O}         STRING      HW version "V5.2"            ðŸŸ¡
  .1.1.6.1.1.4.1.5.{P}.{O}         STRING      serial "GPON30304543"        ðŸŸ¡
  .1.1.6.1.1.4.1.14.{P}.{O}        STRING      model "MONUV601"             ðŸŸ¡
  .1.1.6.1.1.4.1.20.{P}.{O}        STRING      uptime "106460.00 s"         ðŸŸ¡
  .1.1.6.1.1.4.1.24.{P}.{O}        STRING      ONU-ID "GPON0/P:O"           ðŸŸ¡
  .1.1.6.1.1.4.1.25.{P}.{O}        STRING      SW version "V1.1.9"          ðŸŸ¡

LAN-MAC LEARNING TABLE
  âŒ NOT AVAILABLE on V2.3.1R firmware.
  Proven exhaustively: not at .5.10.3.8 (empty), not at .5.10.3.12 (empty),
  not via BRIDGE-MIB (only 2 uplink MACs), not via Telnet `show mac-address-table`
  (% Unknown command), not via DHCP snooping (Railwire is PPPoE not DHCP).
  â†’ Survey workflow only for .200 customers.

PER-ONU TRAFFIC
  âš ï¸ ifTable populates only ~34/275 ONUs (sparse). Unreliable.
  â†’ Use per-PON-aggregate counters instead (see below).

OLT-LEVEL AGGREGATE TRAFFIC (per OLT port, not per ONU)
  .1.1.5.10.1.1.2.1.2.{port}       Counter32   port rx bytes counter        ðŸŸ¡
  .1.1.5.10.1.1.2.1.3.{port}       Counter32   port tx bytes counter        ðŸŸ¡
  Use: "Your PON has X Mbps load" in GPON customer UI.

VLAN CONFIGURATION
  .1.3.6.1.2.1.17.7.1.4.2.1.3.<vlan>  Gauge32   VLAN present                ðŸŸ¡
  .1.3.6.1.2.1.17.7.1.4.3.1.1.<vlan>  STRING    VLAN name                   ðŸŸ¡
  VLANs seen on .200: 1, 100, 119, 128-138, 271 (271 = customer service)

OLT IDENTITY
  .1.3.6.1.2.1.1.3.0               Timeticks   sysUpTime                    ðŸŸ¢
  .1.1.5.10.12.5.4.0               STRING      firmware "V2.3.1R"           ðŸŸ¡
```

### 2.4 GPON .210 specific OIDs (richest state info of all 3 OLTs)

```
NOTE: V1.4.8R has a SLOW SNMP agent. Use timeout=30s.
NOTE: standard MIB-II walks FAIL â€” enterprise tree only.

ONU REGISTRATION + STATUS â€” same as .200

PER-ONU OPTICAL â€” same as .200 at `.6.1.1.3.1.{3..8}`

PER-ONU IDENTITY â€” same as .200 at `.6.1.1.4.1.{3,4,5,14,20,24,25}` + extra:
  .1.1.6.1.1.4.1.27.{P}.{O}        STRING      last-activity human ts       ðŸŸ¡

EXTRA STATE COLUMNS (UNIQUE TO .210)
  .1.1.6.1.1.1.1.8.{P}.{O}         STRING      last-online "2026:04:30..."  ðŸŸ¡
  .1.1.6.1.1.1.1.9.{P}.{O}         STRING      last-offline                 ðŸŸ¡
  .1.1.6.1.1.1.1.10.{P}.{O}        STRING      offline reason               ðŸŸ¡
    Values: "Power Off" (= dying gasp), "Other" (= fiber issue)

LAN-MAC LEARNING TABLE â€” 2,380 ENTRIES (~4 MACs/ONU)
  .1.1.5.10.3.12.1.1.6.<MAC dec>   Hex-STRING  the MAC                      ðŸŸ¡

QoS POLICY (UNIQUE TO .210)
  .1.1.5.10.24.*                   mixed       policyName, classifier       ðŸŸ¡
  Use: map ONU â†’ bandwidth profile name. "Is customer getting their plan?"

PER-ONU TRAFFIC â€” âŒ ifTable rejected, no SNMP path
BRIDGE-MIB â€” âŒ 0 entries on V1.4.8R

OLT IDENTITY â€” âŒ system tree blocked. Firmware only from enterprise tree.
```

---

## 3. Per-Capability Matrix Across All OLTs

| Capability | EPON .100 | GPON .200 | GPON .210 |
|---|---|---|---|
| Online/offline status | ðŸŸ¢ | ðŸŸ¢ | ðŸŸ¢ |
| Dying gasp via SNMP poll | ðŸŸ¢ alarm code 26 | ðŸŸ¢ phase=4 | ðŸŸ¢ phase=4 + reason text |
| Dying gasp via trap (instant) | ðŸŸ¢ | ðŸŸ¢ | ðŸŸ¡ verify trap target |
| Optical Rx/Tx/Temp/V/Bias | ðŸŸ¢ | ðŸŸ¢ | ðŸŸ¢ |
| OLT-side Rx (more reliable) | ðŸ”´ | ðŸŸ¢ | ðŸŸ¢ |
| ONU MAC (optical-side) | ðŸŸ¢ | ðŸŸ¢ | ðŸŸ¢ |
| ONU serial | n/a (uses MAC) | ðŸŸ¡ | ðŸŸ¡ |
| ONU model / vendor / HW / SW | partial | ðŸŸ¡ all | ðŸŸ¡ all |
| ONU uptime | ðŸ”´ | ðŸŸ¡ | ðŸŸ¡ |
| Last online/offline timestamp | ðŸ”´ | ðŸ”´ | ðŸŸ¡ |
| Offline reason text | ðŸ”´ | ðŸ”´ | ðŸŸ¡ |
| **LAN-side MAC list per ONU** | ðŸŸ¡ `.5.10.3.8` 4/ONU | ðŸ”´ survey only | ðŸŸ¡ `.5.10.3.12` 4/ONU |
| **Per-ONU traffic counters** | ðŸŸ¢ ifTable | ðŸ”´ firmware gap | ðŸ”´ firmware gap |
| Per-PON-port aggregate traffic | ðŸ”´ | ðŸŸ¡ `.5.10.1.1.2.1` | ðŸŸ¡ likely same |
| OLT-side per-PON-port health | ðŸŸ¡ | ðŸŸ¡ | ðŸŸ¡ |
| Alarm name dictionary | ðŸŸ¡ | ðŸŸ¡ | ðŸŸ¡ |
| VLAN config map | ðŸ”´ | ðŸŸ¡ | ðŸ”´ |
| Reboot ONU (SNMP SET) | ðŸŸ¡ verify | ðŸ”´ Telnet only | ðŸ”´ Telnet only |
| Reboot ONU (Telnet) | ðŸŸ¢ fallback | ðŸŸ¢ fallback | ðŸŸ¢ fallback |
| Standard MIB-II reachable | ðŸŸ¢ | ðŸŸ¢ | ðŸ”´ enterprise only |

---

## 4. MAC-Matching Strategy (the core feature)

### 4.1 The two-MAC reality

Every ONT has TWO MACs:
- **Optical-side MAC** â€” what the OLT sees on the PON port (ONU registration)
- **LAN-side MAC** â€” what the customer router uses to talk to the ONT

**Railwire scrapes the LAN-side MAC**, not the optical one. Direct comparison
to ONU optical MAC produces PROBABLE confidence with heuristic offset. The
LAN-MAC learning tables in SNMP solve this â€” comparison becomes CONFIRMED.

### 4.2 Per-OLT matching path

| OLT | OID | Coverage |
|---|---|---|
| EPON .100 | `.1.3.6.1.4.1.37950.1.1.5.10.3.8.1.4.<MAC dec>` â†’ returns "EPON0/P:O" | ~660 customers, CONFIRMED |
| GPON .200 | none â€” survey workflow required | ~230 customers, PROBABLE until survey complete |
| GPON .210 | `.1.3.6.1.4.1.37950.1.1.5.10.3.12.1.1.6.<MAC dec>` + column join | ~1,285 customers, CONFIRMED |

### 4.3 Implementation pattern

```python
def find_onu_for_railwire_mac(railwire_mac, olt_host) -> tuple[ONU, str]:
    """Returns (onu, confidence). confidence âˆˆ {CONFIRMED, PROBABLE, UNKNOWN}."""
    mac_dec = ".".join(str(int(railwire_mac.replace(":", "")[i:i+2], 16))
                       for i in range(0, 12, 2))

    if olt_host == "10.10.10.100":
        result = snmp_get(olt_host, f".1.3.6.1.4.1.37950.1.1.5.10.3.8.1.4.{mac_dec}")
        if result:
            return (parse_epon_id(result), "CONFIRMED")

    if olt_host == "10.10.10.210":
        # Cache .5.10.3.12 walk in memory; check membership
        if railwire_mac in lan_mac_cache_210:
            return (lan_mac_cache_210[railwire_mac], "CONFIRMED")

    # Fall through: survey binding or heuristic
    return (lookup_survey_or_heuristic(railwire_mac), "PROBABLE")
```

### 4.4 "Active Router MACs â€” N found" UI panel

For each ONU, cache its LAN-MAC list in `onu_latest.lan_macs JSONB`. UI renders
list. For .200 customers, show only the optical MAC + "survey required" hint.

---

## 5. Live Bandwidth vs Speed Test (critical UI distinction)

These are DIFFERENT measurements:

| | Live Bandwidth | Speed Test |
|---|---|---|
| What it measures | Traffic flowing right now (usage) | Maximum line capacity |
| Example | â†‘ 5.2 Mbps / â†“ 21.3 Mbps | "150 Mbps available" |
| Source | OLT byte counters (`ifInOctets`) | Customer device |
| Where it runs | At OLT | At customer router/device |
| Plan-aware? | No â€” raw usage | Yes â€” compares to plan |
| Real-time delay | 60s (1 poll cycle) | Instant |

**Per-OLT live bandwidth availability:**

| OLT | Per-ONU live bandwidth | What to show in UI |
|---|---|---|
| EPON .100 | ðŸŸ¢ Yes â€” ifTable per ONU | Real per-customer chart |
| GPON .200 | ðŸ”´ No â€” firmware gap | PON-aggregate or Railwire daily totals |
| GPON .210 | ðŸ”´ No â€” ifTable blocked | PON-aggregate or Railwire daily totals |

**To offer a real speed test**, embed Ookla / fast.com link in the customer
portal page â€” runs from their device, not from us.

**For GPON customers, recommended substitute UI:**
- "PON Load: 450 Mbps of 2.5 Gbps (18%)" â€” shows shared port congestion
- "Today's usage: 12.5 GB" â€” from Railwire RADIUS aggregates
- "Plan: 150 Mbps" â€” from Railwire scraper
- "Speed Test âš¡ â€” click to test" â€” embeds Ookla

---

## 6. Real-Time Architecture (three lanes)

Realtime doesn't come from polling alone. The engine must layer three mechanisms:

```
LANE 1 â€” POLL (60s, every ONU, steady state)
  SNMP bulk-walk â†’ updates onu_latest + onu_snapshots
  Captures: status, optical, identity, traffic (EPON), LAN-MACs
  Latency: 60-90s

LANE 2 â€” TRAPS (instant, event-driven)
  OLT pushes to UDP 162 on Pi (10.10.10.50)
  Captures: link up/down, dying-gasp, alarm transitions
  trap_receiver.py decodes â†’ POST /ingest/alarm-event â†’ WebSocket push
  Latency: <2s
  Status: .100/.200 âœ…, .210 âš ï¸ verify

LANE 3 â€” ON-DEMAND SET (user-triggered)
  Backend â†’ Pi proxy â†’ SNMP SET (EPON) or Telnet (GPON) â†’ OLT
  Captures: reboot, deregister, config tweak
  Latency: seconds
```

**Latency targets:**

| Event | Today | Achievable |
|---|---|---|
| ONU offline | up to 60s | <2s (trap) |
| Dying gasp | up to 60s | <2s (trap) |
| Optical drift | 60s | 60s (poll only â€” slow drift, no trap fires) |
| Reboot ack | seconds | seconds (SET) |
| New device on customer LAN | 60s | 60s (poll LAN-MAC table) |

---

## 7. Customer Profile UI â€” Data Source Map

For each section of the customer profile UI, here's the canonical source:

### Section 1 â€” Header
- Name / phone / email â†’ `customers` DB
- Plan (150 Mbps / 3300 GB) â†’ Railwire scraper
- Balance / expiry / data usage â†’ Railwire scraper
- GPS / address â†’ `customers` DB + mobile survey

### Section 2 â€” Live Status & Health
- Online indicator â†’ SNMP poll
- "Went online N ago" â†’ derived from `onu_snapshots`; on .210 use `.6.1.1.1.1.8` directly
- "Last Offline: Power Loss (DG Â· Alarm 26)" â†’ SNMP alarm code + dictionary `.5.10.13.4.2.1.2`
- 7-day diagnostic timeline â†’ computed from `onu_snapshots` + `alarm_events`
- Alarm & Event History table â†’ `alarm_events` joined to alarm dictionary
- Total Downtime â†’ sum of Active durations in `alarm_events`
- Live Bandwidth (60s) chart â†’ ifTable deltas (EPON) / PON-aggregate (GPON) / Railwire daily (always)
- Reboot ONU button â†’ Lane-3 SET

### Section 3 â€” Optical Diagnostics
- Rx / Tx (dBm) â†’ SNMP optical (60s freshness)
- Fiber Distance â†’ Telnet only (5-min freshness OK)
- 30-day Rx trend â†’ `onu_snapshots` query

### Section 4 â€” Network Identity
- OLT / PON Port / ONU Index â†’ SNMP enterprise
- ONU MAC (optical) â†’ SNMP `.5.10.3.{2,5}.1.3`
- Serial / Vendor / HW / SW / Model â†’ SNMP `.6.1.1.4.1.{5,3,4,25,14}` (GPON)
- EPON model â†’ SNMP `.5.12.1.12.1.7`
- **Active Router MACs ("2 found")** â†’ cached `onu_latest.lan_macs`
- Live Session (VLAN / WAN IP / Session Uptime) â†’ Railwire scraper
- Binding Confidence â†’ Â§4 logic
- Topology diagram â†’ composed from above

### Section 5 â€” Support & Field History
- Ticket list â†’ `tickets` DB
- Install photos / sticker MAC â†’ `ticket_media` DB

---

## 8. Engine Design Principles

### 8.1 Five-layer architecture (strict one-way flow)

```
HARDWARE (3 OLTs)
   â†‘ SNMP / Telnet / Traps
COLLECTORS (one systemd service per OLT)
   â†‘ Redis Stream (raw records)
NORMALIZER + STATE MACHINE (one service)
   â†‘ canonical writes
STATE STORE (Postgres: ont_state + ont_snapshots + ont_events + lan_macs)
   â†‘ READ-ONLY
ENGINE API (HTTP + WebSocket on port 9100)
   â†‘ READ-ONLY
CONSUMERS (NOC, mobile, customer profile, predictions)
```

Rules:
1. Layers communicate ONE WAY: bottom up
2. Collectors NEVER touch Postgres directly
3. Normalizer NEVER queries OLT directly
4. Consumers NEVER bypass the API
5. **Page loads NEVER trigger an OLT fetch â€” always read cache**

### 8.2 Per-field freshness + source labelling

Every field has 3 companions: `{value, source, source_age_seconds, confidence}`

Source enum: `snmp_iftable | snmp_enterprise | snmp_bridge_mib | telnet_cli | trap | survey_team | hysteresis_hold | stale`

Confidence enum: `CONFIRMED | PROBABLE | STALE | UNKNOWN`

UI renders confidence as color (solid / faded / grey).

### 8.3 Mass-offline guard (anti-panic)

If a poll reports >30% of ONUs newly offline vs prior known-good state, REJECT
the cycle. Log to `collector_runs.rejected_reason = "mass_offline_guard"`.
Real outages cluster by PON port; bugs hit random ONUs. Prevented .210 data
incidents historically.

### 8.4 Hysteresis (anti-flap)

- Online â†’ offline: 3 consecutive offline polls OR 1 trap
- Offline â†’ online: 1 poll OR 1 trap (optimistic)
- `ont_snapshots` written every cycle regardless

### 8.5 Per-OLT circuit breaker

- N consecutive timeout cycles â†’ mark OLT degraded
- Fall back to Telnet for that OLT only
- Other OLTs unaffected
- Alarm operator

### 8.6 Collector matrix (revised from old design)

| Service | Frequency | Role |
|---|---|---|
| `olt-collector@100-snmp` | 60s | Primary |
| `olt-collector@200-snmp` | 60s | Primary |
| `olt-collector@210-snmp` | 60-90s | Primary |
| `olt-collector@*-telnet` | on-demand | Fallback (circuit-breaker triggered) |
| `olt-trap-receiver` | continuous | Event lane |

No standing Telnet collectors. The old "Telnet collector @ 5 min for optical"
is obsolete â€” SNMP carries optical on all 3 OLTs.

---

## 9. Database Schema (new tables for the engine)

```sql
-- LIFETIME IDENTITY (soft-delete only)
CREATE TABLE onts (
  id              BIGSERIAL PRIMARY KEY,
  mac_canonical   VARCHAR(17) NOT NULL,
  serial_number   VARCHAR(64),
  olt_host        INET NOT NULL,
  pon_port        INT NOT NULL,
  onu_index       INT NOT NULL,
  vendor          VARCHAR(64),
  hw_model        VARCHAR(64),
  hw_version      VARCHAR(32),
  sw_version      VARCHAR(32),
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decommissioned_at TIMESTAMPTZ,
  CONSTRAINT mac_upper CHECK (mac_canonical = UPPER(mac_canonical)),
  CONSTRAINT mac_fmt   CHECK (mac_canonical ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  UNIQUE (olt_host, pon_port, onu_index)
);
CREATE UNIQUE INDEX onts_mac_active ON onts(mac_canonical) WHERE decommissioned_at IS NULL;

-- CURRENT STATE (1 row per active ONT, replaced every poll)
CREATE TABLE ont_state (
  ont_id              BIGINT PRIMARY KEY REFERENCES onts(id),
  status              VARCHAR(16) NOT NULL,
  rx_power_dbm        NUMERIC(5,2),
  tx_power_dbm        NUMERIC(5,2),
  olt_rx_power_dbm    NUMERIC(5,2),
  temperature_c       NUMERIC(5,2),
  voltage_v           NUMERIC(5,3),
  tx_bias_ma          NUMERIC(6,3),
  dying_gasp          BOOLEAN NOT NULL DEFAULT FALSE,
  offline_reason      VARCHAR(32),
  rx_bytes_delta      BIGINT,    -- EPON only
  tx_bytes_delta      BIGINT,    -- EPON only
  lan_macs            JSONB,     -- [{mac, learned_at}, ...]
  onu_uptime_seconds  BIGINT,
  last_online_at      TIMESTAMPTZ,
  last_offline_at     TIMESTAMPTZ,
  last_polled_at      TIMESTAMPTZ NOT NULL,
  status_source       VARCHAR(32) NOT NULL,
  optical_source      VARCHAR(32),
  consecutive_offline_polls INT NOT NULL DEFAULT 0,
  consecutive_online_polls  INT NOT NULL DEFAULT 0
);

-- TIME-SERIES (partitioned by day, retain 90 days)
CREATE TABLE ont_snapshots (
  ont_id          BIGINT NOT NULL REFERENCES onts(id),
  polled_at       TIMESTAMPTZ NOT NULL,
  status          VARCHAR(16),
  rx_power_dbm    NUMERIC(5,2),
  tx_power_dbm    NUMERIC(5,2),
  temperature_c   NUMERIC(5,2),
  voltage_v       NUMERIC(5,3),
  rx_bytes_delta  BIGINT,
  tx_bytes_delta  BIGINT,
  source          VARCHAR(32) NOT NULL,
  PRIMARY KEY (ont_id, polled_at)
) PARTITION BY RANGE (polled_at);

-- ALARM/EVENT LOG
CREATE TABLE ont_events (
  id              BIGSERIAL PRIMARY KEY,
  ont_id          BIGINT NOT NULL REFERENCES onts(id),
  event_type      VARCHAR(32) NOT NULL,
  alarm_code      INT,
  alarm_name      VARCHAR(64),
  occurred_at     TIMESTAMPTZ NOT NULL,
  cleared_at      TIMESTAMPTZ,
  duration_sec    INT GENERATED ALWAYS AS
                    (EXTRACT(EPOCH FROM (cleared_at - occurred_at))::int) STORED,
  detail          JSONB,
  source          VARCHAR(32) NOT NULL
);

-- OLT-LEVEL HEALTH (per PON port)
CREATE TABLE olt_port_health (
  olt_host        INET NOT NULL,
  pon_port        INT NOT NULL,
  polled_at       TIMESTAMPTZ NOT NULL,
  temperature_c   NUMERIC(5,2),
  voltage_v       NUMERIC(5,3),
  tx_bias_ma      NUMERIC(6,3),
  tx_power_dbm    NUMERIC(5,2),
  PRIMARY KEY (olt_host, pon_port, polled_at)
);

-- ALARM DICTIONARY (cached from each OLT, refresh hourly)
CREATE TABLE alarm_catalog (
  olt_host        INET NOT NULL,
  alarm_code      INT NOT NULL,
  alarm_name      VARCHAR(64) NOT NULL,
  refreshed_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (olt_host, alarm_code)
);

-- COLLECTOR HEALTH (audit trail)
CREATE TABLE collector_runs (
  id              BIGSERIAL PRIMARY KEY,
  collector_id    VARCHAR(64) NOT NULL,
  olt_host        INET NOT NULL,
  transport       VARCHAR(32) NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  duration_ms     INT,
  status          VARCHAR(16) NOT NULL,
  ont_count       INT,
  error_message   TEXT,
  rejected_reason VARCHAR(64)
);
```

**Migration path:** New tables alongside existing; shadow-write for 1 week;
cut over per-OLT; drop old after 90 days.

---

## 10. Implementation Priority Order

### Phase 0 â€” Foundation (1 day)
- Set up Redis on Pi
- Write schema migration (don't apply yet)
- YAML config with 3 OLTs + capability flags

### Phase 1 â€” Collectors (2 days)
- Implement base collector class
- Port `snmp_client.py` logic into `OLTSNMPCollector`
- Port `olt_client.py` Telnet logic into `OLTTelnetCollector` (fallback)
- systemd template: `/etc/systemd/system/olt-collector@.service`
- Write raw records to Redis stream
- Test: Redis fills, no PG writes yet

### Phase 2 â€” Normalizer + state machine (3 days)
- Apply schema to NEW database `rico_net_engine`
- Implement consumer reading Redis streams
- Validation, hysteresis, mass-offline guard
- Compute deltas for traffic counters
- **Shadow mode 48h â€” compare to existing poller**

### Phase 3 â€” Engine API (1-2 days)
- FastAPI on port 9100, read-only endpoints
- WebSocket `/v1/events` for real-time updates
- Prometheus exporter on port 9102

### Phase 4 â€” Wire new fields (priority order)
1. **LAN-MAC tables** (.100 + .210) â€” unlocks CONFIRMED matching, 90% coverage
2. **OLT-port health** (all 3) â€” hardware-fault prediction
3. **Alarm dictionary** (all 3) â€” self-describing alarms
4. **GPON identity columns** (.200 + .210) â€” ONU inventory
5. **GPON .210 timestamps + offline reason** â€” UI richness
6. **VLAN map** (.100 + .200) â€” service correlation
7. **Per-PON-aggregate traffic** (.200 + .210) â€” partial GPON bandwidth

### Phase 5 â€” Cutover, one OLT at a time (1 week)
1. Stop existing poller for `.100` first
2. Engine becomes authoritative for `.100`
3. Backend reads engine API for `.100`
4. Watch 48h â†’ cut over `.200` â†’ cut over `.210`
5. Each cutover reversible

### Phase 6 â€” Decommission old (1 day)
- Stop old poller services
- Archive to `legacy/`
- Drop old tables after 90 days

---

## 11. Future OLT Acceptance Criteria

When the 2 not-yet-delivered OLTs arrive, RUN this checklist before accepting:

### Mandatory (refuse if any fail)
1. âœ… SNMPv2c on community `public` (read) / `private` (write)
2. âœ… Enterprise tree under `1.3.6.1.4.1.37950` populated
3. âœ… Per-ONU optical at `.5.12.2.1.8` (EPON) or `.6.1.1.3` (GPON)
4. âœ… Trap target configurable to Pi LAN IP:162
5. âœ… ACL permits Pi LAN IP for SNMP read

### Should-have (note gap if missing)
6. âš ï¸ BRIDGE-MIB `.1.3.6.1.2.1.17.4.3` populated with >10 entries
7. âš ï¸ Vendor LAN-MAC table at `.5.10.3.8` (EPON-style) or `.5.10.3.12` (GPON-style)
8. âš ï¸ Per-ONU ifTable counters populated for >80% of ONUs

If 6+7+8 all missing â†’ demand newer firmware OR plan for survey-only workflow.

Acceptance probe: run `olt-proxy/probe_mac_table.sh` against each new OLT,
verify responses match what Â§2 shows for the matching OLT type.

---

## 12. Engine API Contract

```
GET  /v1/olts                              â†’ list all OLTs + health
GET  /v1/olts/:host                        â†’ one OLT detail
GET  /v1/olts/:host/onts                   â†’ all ONTs on this OLT
GET  /v1/onts/:mac                         â†’ one ONT current state
GET  /v1/onts/:mac/snapshots?from=&to=     â†’ time-series
GET  /v1/onts/:mac/events                  â†’ alarm/transition log
GET  /v1/onts/:mac/lan-macs                â†’ cached Active Router MACs
POST /v1/onts/:mac/refresh                 â†’ on-demand SNMP fetch (5-15s)
POST /v1/onts/:mac/reboot                  â†’ SNMP SET or Telnet
GET  /v1/health                            â†’ engine self-health
GET  /v1/collectors                        â†’ per-collector status
WS   /v1/events                            â†’ real-time stream
```

Existing backend `routers/noc.py` and `routers/ingest.py` become THIN
clients of the engine API. Polling pipeline currently in backend moves into
the engine.

---

## 13. Critical "Don't" List

1. **Don't change OLT config** â€” engine is read-only management
2. **Don't fetch from OLT on page load** â€” always read cache
3. **Don't poll OLTs more often than 60s** â€” CPU limits on .100 and .210
4. **Don't restart the existing poller without coordinating**
5. **Don't use web portal transport** â€” retired 2026-05-03 (OLT CPU stress)
6. **Don't assume Telnet works as fast as SNMP** â€” GPON .210 Telnet ~400s vs SNMP 30-90s
7. **Don't trust the old `OLT_ENGINE_DESIGN.md` collector matrix** â€” see Â§8.6
8. **Don't enable DHCP snooping on customer VLANs on .200** â€” Railwire is PPPoE, snooping wouldn't help
9. **Don't show per-ONU live bandwidth on GPON customers** â€” no firmware support
10. **Don't promise CONFIRMED MAC matching for .200 customers** â€” no SNMP path; use survey workflow

---

## 14. Open Research Items

| Item | Why | How |
|---|---|---|
| .210 trap target verification | Realtime detection on .210 | Manual: offline an ONU, watch `journalctl -u olt-trap-receiver` |
| EPON SNMP SET reboot OID test | Closes the SET control loop | One-time test against a willing ONU |
| GPON SNMP SET reboot OID hunt | GPON reboot via SNMP | Maintenance window brute-force OR vendor MIB |
| Netlink MIB reply (email 2026-05-02) | Eliminates OID guesswork | Chase reply |
| Netlink firmware update for .200 | Could expose LAN MACs | Vendor relationship |

---

## 15. Probe Scripts (read-only, in `olt-proxy/`)

| Script | Purpose | Runtime |
|---|---|---|
| `probe_mac_table.sh` | Initial SNMP sweep (BRIDGE, alt roots, unsampled) | ~30s |
| `run_probe.py` | Push + run + fetch wrapper | wrapper |
| `probe_deep.py` | BRIDGE-MIB depth + new subtree decode | ~60s |
| `probe_final_200.py` | Exhaustive .200 SNMP sweep | ~3 min |
| `probe_telnet_fdb{2..6}.py` | Telnet CLI discovery | ~3 min each |
| `probe_gpon_traffic.py` | GPON traffic counter hunt | ~3 min |
| `fetch_probe_results.py` | Kill + fetch helper | helper |

All scripts use Pi credentials via paramiko; the password is redacted in the
file headers â€” populate from your secrets manager before running.

Result files: `olt-proxy/probe_*_results.txt`.

---

## 16. One-Glance Decision Reference

When implementing the engine, use this table for canonical decisions:

| Question | Answer |
|---|---|
| Where does status come from? | SNMP poll + trap on transition |
| Where does optical come from? | SNMP enterprise (EPON `.5.12.2.1.8`, GPON `.6.1.1.3`) |
| Where does dying-gasp come from? | Trap (instant) â†’ fallback SNMP alarm code |
| Where do LAN-MACs come from? | EPON: `.5.10.3.8`; .210: `.5.10.3.12`; .200: survey |
| Where does ONT identity come from? | SNMP `.6.1.1.4.1.*` (GPON), `.5.12.1.12.1.7` (EPON) |
| Where does reboot get sent? | SNMP SET (EPON when verified) or Telnet |
| Where does live bandwidth come from? | EPON: per-ONU ifTable; GPON: PON-aggregate `.5.10.1.1.2.1` |
| Where does plan / FUP / WAN IP / VLAN come from? | Railwire scraper |
| Where does GPS / install photo come from? | Mobile survey app + DB |
| What does the UI query on page load? | `onu_latest` PG cache (always) |
| When does UI refresh? | WebSocket push on state change OR user clicks Refresh |
| Freshness target? | 60s status/optical, <2s events (traps), 5-15s on-demand |

---

## End â€” Coverage Summary

- âœ… ~660 EPON customers: full data (LAN-MAC, traffic, optical, identity)
- âš ï¸ ~230 GPON .200 customers: full data EXCEPT LAN-MAC (survey workflow)
- âš ï¸ ~1,285 GPON .210 customers: full data EXCEPT per-ONU traffic (PON-aggregate substitute)

**SNMP is the realtime engine.** Telnet is fallback. Traps are the event lane.
The customer profile UI works on all 3 OLTs with documented per-OLT caveats.
