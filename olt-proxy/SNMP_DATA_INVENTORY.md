# SNMP Data Inventory â€” What We Can Actually Get

> Complete list of every useful field SNMP exposes per OLT, with type, sample, and meaning.
> Source: full enterprise + ifTable walks of all 3 OLTs (134K OIDs total).
> Walk files: `walks/<host>_<tree>.txt`.
> Generated: 2026-05-01

---

## TL;DR â€” What Each OLT Gives You

| Field | EPON .100 | GPON .200 | GPON .210 |
|-------|-----------|-----------|-----------|
| **MAC address** | âœ… ifTable + 3 enterprise tables | âœ… ifTable (sparse) + 2 enterprise tables | âœ… 2 enterprise tables (no ifTable) |
| **Online/offline status** | âœ… ifOperStatus + enterprise live status | âœ… ifOperStatus + GPON phase state | âœ… GPON phase state only |
| **PON port number** | âœ… derived from interface name | âœ… derived from interface name | âœ… derived from registration table |
| **ONU index in port** | âœ… derived from interface name | âœ… enterprise table | âœ… enterprise table |
| **Per-ONU traffic (RX/TX bytes)** | âœ… ifInOctets / ifOutOctets | âš ï¸ only 34 of 275 report | âŒ ifTable rejected |
| **Per-ONU error count** | âœ… ifInErrors | âœ… ifInErrors | âŒ ifTable rejected |
| **ONU model name** | âœ… enterprise (e.g. `V2801S`) | âœ… enterprise (e.g. `MONUV601`) | âœ… enterprise (e.g. `MONUH223`) |
| **GPON serial number** | n/a | âœ… enterprise (e.g. `GPON30304543`) | âœ… enterprise (e.g. `GPON009ed228`) |
| **Vendor ID** | âŒ | âœ… enterprise (`MONU`) | âœ… enterprise (`MONU`, varies) |
| **Hardware version** | âŒ | âœ… enterprise (`V5.2`) | âœ… enterprise (`V4.1`) |
| **Software version** | âŒ | âœ… enterprise (`V1.1.9`) | âœ… enterprise (`V2.1.07`) |
| **Last online time** | âŒ | âŒ | âœ… enterprise (`2026:04:30 18:11:40`) |
| **Last offline time** | âŒ | âŒ | âœ… enterprise (`2026:04:30 18:10:29`) |
| **Offline reason (incl. dying gasp)** | âŒ | âŒ | âœ… `"Power Off"` / `"Other"` etc. |
| **ONU uptime** | âŒ | âœ… (`106460.00 s`) | âœ… (`79068 s`) |
| **PPPoE user** | âŒ | âŒ | âŒ |
| **Optical Rx dBm** | âŒ NOT in SNMP â€” Telnet only | âŒ NOT in SNMP â€” Telnet only | âŒ NOT in SNMP â€” Telnet only |
| **Optical Tx dBm** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only |
| **Temperature** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only |
| **Voltage** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only |
| **Trap target** | âœ… configured â†’ Pi:162 | âœ… configured â†’ Pi:162 | âš ï¸ walk timed out |
| **OLT system uptime** | âœ… sysUpTime | âœ… sysUpTime | âŒ system walk fails |

---

## Per-OLT Detail

# 10.10.10.100 â€” EPON V1600D

## System Info (`.1.3.6.1.2.1.1`)

| OID | Field | Sample value | What it is |
|-----|-------|--------------|------------|
| `.1.0` | sysDescr | `V1600D` | OLT model identifier |
| `.2.0` | sysObjectID | `.1.3.6.1.4.1.37950.1.1.5.10.14.1` | Vendor enterprise OID |
| `.3.0` | sysUpTime | `11 days, 1:50:06` | OLT uptime since boot |
| `.4.0` | sysContact | `Contact` | Admin contact (default) |
| `.5.0` | sysName | `epon-olt` | OLT hostname |
| `.6.0` | sysLocation | `Location` | Physical location (default) |
| `.7.0` | sysServices | `6` | Service set bitmask |

## ifTable (`.1.3.6.1.2.1.2.2.1`) â€” 391 ONU virtual interfaces named `EPON01ONU34`

This is the **primary live-data source** for EPON.

| Col | OID | Field | Per ONU | What it gives us |
|-----|-----|-------|---------|------------------|
| 1 | `.1` | ifIndex | âœ… | Internal index 1-415 |
| 2 | `.2` | ifDescr | âœ… | **Interface name** `EPON01ONU34` â†’ encodes (port=1, onu=34) |
| 3 | `.3` | ifType | âœ… | 6=ethernetCsmacd |
| 4 | `.4` | ifMtu | âœ… | 1500 |
| 5 | `.5` | ifSpeed | âœ… | 1000000000 (1 Gbps) |
| 6 | `.6` | ifPhysAddress | âœ… | **MAC address** as 6-byte Hex-STRING â€” 413/415 valid |
| 7 | `.7` | ifAdminStatus | âœ… | always 1 (admin enabled) |
| 8 | `.8` | ifOperStatus | âœ… | **Online/offline**: 1=up, 2=down (288 up + 103 down) |
| 9 | `.9` | ifLastChange | âœ… | Time since last status change (Timeticks) |
| 10 | `.10` | ifInOctets | âœ… | **RX bytes cumulative** (OLT receives from ONU) |
| 11 | `.11` | ifInUcastPkts | âœ… | Unicast packets received |
| 12 | `.12` | ifInNUcastPkts | âœ… | Multicast/broadcast packets received |
| 13 | `.13` | ifInDiscards | âœ… | Dropped inbound packets |
| 14 | `.14` | ifInErrors | âœ… | **RX errors cumulative** (CRC errors etc.) |
| 16 | `.16` | ifOutOctets | âœ… | **TX bytes cumulative** (OLT sends to ONU) |
| 17 | `.17` | ifOutUcastPkts | âœ… | Unicast packets transmitted |
| 18 | `.18` | ifOutNUcastPkts | âœ… | Multicast/broadcast packets transmitted |
| 19 | `.19` | ifOutDiscards | âœ… | Dropped outbound packets |
| 20 | `.20` | ifOutErrors | âœ… | TX errors |

## Enterprise: ONU Registration Basic (`.10.3.2.1`) â€” 5 cols Ã— 349 ONUs

The "registered ONU" table â€” what the OLT remembers about every ONU it's ever provisioned.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1 | INTEGER | `1` | Sequential index 1-349 |
| 2 | INTEGER | `100` / `4005` | Type code (100=normal, 4005=special) |
| 3 | Hex-STRING | `90 8D 78 4A D2 A1` | **MAC address** (346 valid) |
| 4 | INTEGER | `1` | Always 1 = registered |
| 5 | STRING | `GE1` | ONU Ethernet port type |

## Enterprise: ONU Per-MAC Mapping (`.10.3.8.1`) â€” 4 cols Ã— 347 ONUs

Maps a 6-byte position encoding to ONU-ID strings. Mostly redundant with above.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1 | Hex-STRING | `00 00 00 01 00 02` | 8-byte position encoding |
| 2 | INTEGER | `4005` | Type code |
| 3 | INTEGER | `1` | Always 1 |
| 4 | STRING | `EPON0/4:12` | **ONU-ID** in CLI format |

## Enterprise: ONU Live Status Table (`.12.1.12.1`) â€” 14 cols Ã— 391 ONUs â­

**The most useful EPON enterprise table** â€” one row per ONU with current state.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1 | INTEGER | `0..390` | Global ONU index |
| 2 | INTEGER | `1..8` | **PON port** |
| 3 | INTEGER | `1..76` | **ONU index within port** |
| 4 | INTEGER | `-1..50` | Unknown (possibly distance in 100m) |
| 5 | INTEGER | `0` / `1` | **Status** (0=offline, 1=online) â€” 288/391 online âœ“ |
| 6 | STRING | `14:a7:2b:e6:ca:c8` | **MAC address** as colon-string |
| 7 | STRING | `V2801S`, `HG323DACv3` | **ONU model** |
| 11 | Hex-STRING | `14 A7 2B E6 CA C8 2C 01` | 8-byte ONU vendor ID + LLID |
| 13 | INTEGER | `0..3638` | Some optical/distance metric (verified: NOT Rx power) |
| 14 | STRING | `1GE` | ONU Ethernet port speed |

## Enterprise: ONU Aggregated Stats (`.12.1.25.1`) â€” 19 cols Ã— 391 ONUs

Same shape as live status table but with timestamps and counters.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1-9 | mixed | various | duplicate of live status table cols 1-9 |
| 16 | Gauge32 | `3` | Some state code (1-6) |
| 17 | Gauge32 | `1633` | Same metric as col 13 above |
| 18 | STRING | `2000/01/23 13:13:01` | Timestamp (event 1) |
| 19 | STRING | `2000/01/23 13:13:01` | Timestamp (event 2) |
| 20 | STRING | `05:05:30` | Time of day |
| 21 | Gauge32 | `8227` | Some counter |

## Trap Target Configuration (`.1.3.6.1.6.3.12.1.2`)

| Field | Value |
|-------|-------|
| Target name | `traphost.public.10.10.10.50` |
| Address | `10.10.10.50#162` |
| Tag list | `trap` |
| Notification type | `1` (trap, not inform) |
| Status | active |

**Traps are configured to fire to your Pi.** Just need `trap_receiver.py` listening.

---

# 10.10.10.200 â€” GPON V1600G1

## System Info â€” same shape as .100, sysDescr=`V1600G1`, uptime ~11 days

## ifTable â€” 275 GPON ONU virtual interfaces named `GPON01ONU1`

| Col | Field | What it gives us |
|-----|-------|------------------|
| 2 | ifDescr | **Interface name** `GPON01ONU1` â†’ (port=1, onu=1) |
| 6 | ifPhysAddress | MAC â€” but **only 25 of 275 valid** (GPON uses serials, not MACs) |
| 8 | ifOperStatus | **Online/offline** â€” usable |
| 10 | ifInOctets | **RX bytes** â€” but only 34 ONUs report (sparse) |
| 14 | ifInErrors | RX errors |
| 16 | ifOutOctets | TX bytes â€” only 15 ONUs report |

âš ï¸ ifTable for GPON is **less reliable than EPON**: optical/serial-keyed devices don't always populate `ifPhysAddress`. Use enterprise tables instead.

## Enterprise: ONU Registration Basic (`.10.3.2.1`) â€” 5 cols Ã— 250 ONUs

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 3 | Hex-STRING | `8C 13 E2 6A C3 93` | **MAC address** (246 valid) |
| 5 | STRING | `PON1`, `PON2`, ... | PON port |

## Enterprise: ONU Registration Extended (`.10.3.5.1`) â€” 6 cols Ã— 258 ONUs

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 3 | STRING | `8c:c7:c3:30:69:a0` | **MAC** as colon-string (258 valid) |
| 5 | STRING | `2:14` | Port:ONU index |
| 6 | STRING | `1:142` | Other position encoding |

## Enterprise: GPON Phase State (`.6.1.1.1.1`) â€” 5 cols Ã— 275 ONUs

The GPON equivalent of EPON live status, simpler.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1 | INTEGER | `1..8` | **PON port** |
| 2 | INTEGER | `1..122` | **ONU index** |
| 3 | INTEGER | `1` | always 1 |
| 4 | INTEGER | `1` / `2` | **Status** (1=online, 2=offline) â€” 22 online + 98 offline (sample) |
| 5 | INTEGER | `1, 3, 4, 6` | Phase state code (6=working, others=transit/error) |

## Enterprise: GPON ONU Info Main (`.6.1.1.4.1`) â€” 26 cols Ã— 275 ONUs â­

**The most useful GPON table.** Full identity + state.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1 | INTEGER | `1..8` | **PON port** |
| 2 | INTEGER | `1..122` | **ONU index** |
| 3 | STRING | `MONU` | **Vendor ID** |
| 4 | STRING | `V5.2` | **Hardware version** |
| 5 | STRING | `GPON30304543` | **Serial number** âœ… matches Telnet |
| 8 | INTEGER | `1` | Provisioning flag |
| 9 | INTEGER | `0..23` | Unknown |
| 10 | INTEGER | `0..128` | Unknown (possibly tx_attenuation step) |
| 11 | INTEGER | `0..31` | Unknown |
| 12 | INTEGER | `0..65535` | LLID range |
| 13 | INTEGER | `0..65535` | LLID range |
| 14 | STRING | `MONUV601` | **ONU model** |
| 15 | INTEGER | `128` / `160` | Capability bitmask |
| 17 | STRING | `MONUV601` | Model (duplicate of 14) |
| 18 | STRING | `N/A` | Reserved |
| 19 | STRING | `64` | TCONT count? |
| 20 | STRING | `106460.00 s` | **ONU uptime in seconds** âœ“ |
| 21 | STRING | `N/A` | Reserved |
| 22 | STRING | `N/A` | Reserved |
| 24 | STRING | `GPON0/1:1` | **ONU-ID** (port:idx in CLI format) |
| 25 | STRING | `V1.1.9` | **Software version** (image 1) |
| 26 | STRING | `V1.1.9` | **Software version** (image 2) |

## Trap Target â€” same as .100, configured â†’ Pi:162

---

# 10.10.10.210 â€” GPON V1600G1B

âš ï¸ **Standard MIB-II walks fail** (system, ifTable, snmpv2 timeout). Only enterprise tree responds. Likely SNMP view restriction or firmware quirk.

## Enterprise: ONU Registration Basic (`.10.3.2.1`) â€” 5 cols Ã— 595 ONUs

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 3 | Hex-STRING | `B0 A7 B9 79 D6 99` | **MAC address** (595 valid) |
| 5 | STRING | `PON4:ONU73` | **Port:ONU position** in V1600G1B format (different from .200!) |

## Enterprise: ONU Registration Extended (`.10.3.5.1`) â€” 7 cols Ã— 592 ONUs

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 3 | STRING | `b0:a7:b9:79:d6:99` | **MAC** as colon-string |
| 5 | STRING | `4:73` | Port:ONU |
| 6 | STRING | `1:217` | Other position |
| 7 | STRING | `MONU00e65141` | **Vendor + serial concatenation** âœ“ |

## Enterprise: GPON Phase State (`.6.1.1.1.1`) â€” 11 cols Ã— 672 ONUs â­

**.210 has MORE state info than .200** (11 vs 5 cols). This is the gold mine for .210.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1 | INTEGER | `1..8` | **PON port** |
| 2 | INTEGER | `1..128` | **ONU index** |
| 4 | INTEGER | `1` / `2` | **Status** (1=online, 2=offline) |
| 5 | INTEGER | `2..8` | Phase state code (6=working) |
| 7 | STRING | `N/A` | Reserved |
| 8 | STRING | `2026:04:30 18:11:40` | **Last online time** âœ… unique to .210 |
| 9 | STRING | `2026:04:30 18:10:29` | **Last offline time** âœ… unique to .210 |
| 10 | STRING | `Power Off`, `Other`, ... | **Offline reason** âœ… = dying_gasp equivalent! |
| 11 | STRING | `21:24:05` | Time-of-day reference |

ðŸŽ¯ **Col 10 is huge** â€” it tells us WHY an ONU went offline:
- `"Power Off"` = power cut at customer (= Telnet's `dying_gasp`)
- `"Other"` = link issue / fiber problem
- 4 distinct values seen â€” needs full enumeration via field testing

## Enterprise: GPON ONU Info Main (`.6.1.1.4.1`) â€” 27 cols Ã— 672 ONUs â­

Same shape as .200's table, plus one extra column at the end.

| Col | Type | Sample | What it is |
|-----|------|--------|------------|
| 1-26 | (same as .200) | | (same meanings) |
| 27 | STRING | `Thu Apr 30 18:11:03 2026` | **Last activity timestamp** in human-readable format âœ“ |

## Trap config â€” UNVERIFIED (snmpv2 walk timed out)

---

# What's NOT Available Anywhere in SNMP

These you can ONLY get from Telnet CLI or from upstream systems (Railwire, manual entry):

| Field | Why missing | Workaround |
|-------|-------------|------------|
| **Rx optical power dBm** | Not in any MIB | Telnet `show onu opm-diag all` (EPON) / `show onu N optical` (GPON) |
| **Tx optical power dBm** | Not in any MIB | Same Telnet commands |
| **ONU temperature Â°C** | Not in any MIB | Same Telnet commands |
| **ONU voltage mV** | Not in any MIB | Same Telnet commands |
| **Laser bias current mA** | Not in any MIB | Telnet (GPON only) |
| **PPPoE username** | Not on OLT | Railwire scraper |
| **Customer name** | Not on OLT | Customer DB |
| **Plan / bandwidth tier** | Not on OLT | Railwire |
| **Last topup date** | Not on OLT | Railwire |
| **ONT WiFi SSID/password** | Not on OLT | Field tech survey + customer DB |

---

# Per-Field Decision Matrix â€” Which Source for Which Field?

This is what the **OLT Engine's normalizer** uses to pick the best source per field per ONU:

| Field | Priority 1 | Priority 2 | Priority 3 |
|-------|-----------|-----------|-----------|
| `mac_address` | EPON: ifPhysAddress / GPON: enterprise `.10.3.5.1.3` | enterprise `.10.3.2.1.3` (Hex) | Telnet `auth-info` |
| `pon_port` | ifDescr parse | enterprise `.6.1.1.1.1.1` (GPON) | Telnet ONU-ID parse |
| `onu_index` | ifDescr parse | enterprise `.6.1.1.1.1.2` (GPON) | Telnet ONU-ID parse |
| `status` | ifOperStatus | enterprise live status | Telnet phase state |
| `serial_number` | enterprise `.6.1.1.4.1.5` (GPON only) | Telnet info-all (GPON) | â€” |
| `model_name` | enterprise `.6.1.1.4.1.14` (GPON) / `.12.1.12.1.7` (EPON) | Telnet | â€” |
| `vendor_id` | enterprise `.6.1.1.4.1.3` (GPON only) | â€” | â€” |
| `hw_version` | enterprise `.6.1.1.4.1.4` (GPON only) | â€” | â€” |
| `sw_version` | enterprise `.6.1.1.4.1.25` (GPON only) | â€” | â€” |
| `rx_bytes_delta` | ifInOctets diff (compute in normalizer) | â€” | â€” |
| `tx_bytes_delta` | ifOutOctets diff | â€” | â€” |
| `if_errors` | ifInErrors | â€” | â€” |
| `dying_gasp` | enterprise `.6.1.1.1.1.10` = `Power Off` (.210 only) | Telnet phase=DyingGasp | â€” |
| `last_online_at` | enterprise `.6.1.1.1.1.8` (.210 only) | derived from state changes | â€” |
| `last_offline_at` | enterprise `.6.1.1.1.1.9` (.210 only) | derived from state changes | â€” |
| `uptime_seconds` | enterprise `.6.1.1.4.1.20` (GPON) | sysUpTime (OLT-level) | â€” |
| `rx_power_dbm` | **Telnet only** | trap (when fired) | â€” |
| `tx_power_dbm` | **Telnet only** | â€” | â€” |
| `temperature_c` | **Telnet only** | â€” | â€” |
| `voltage_mv` | **Telnet only** | â€” | â€” |

---

# Per-OLT Recommended Polling Strategy

| OLT | Primary (60s) | Secondary (5 min) | Trap (always) |
|-----|--------------|-------------------|---------------|
| **.100 EPON** | SNMP ifTable (status, MAC, traffic, errors) + enterprise `.12.1.12.1` (model) | Telnet `opm-diag all` (optical only) | UDP 162 |
| **.200 GPON** | SNMP enterprise `.6.1.1.1.1` (status) + `.6.1.1.4.1` (identity) | Telnet for optical | UDP 162 |
| **.210 GPON** | SNMP enterprise `.6.1.1.1.1` (status + dying_gasp + timestamps) + `.6.1.1.4.1` (identity) | Telnet for optical | UDP 162 (config unknown) |

This gives:
- **60-second updates** for status, MAC, traffic, identity (via SNMP â€” fast)
- **5-minute updates** for optical (via Telnet â€” slow but the only source)
- **Real-time event detection** via SNMP traps (when receiver is up)

Latency target: dashboard sees status changes within 60-90 seconds. Optical changes within 5-6 minutes.

---

# Summary â€” Bottom Line

**SNMP gives you 70% of what's needed at 10Ã— the speed of Telnet.** The missing 30% is optical/temp/voltage which only Telnet can provide, but those don't need 60s freshness â€” 5-min is fine.

The OLT Engine should treat each field as having its own freshness requirement and source priority, rather than treating "an ONU poll" as atomic. That's the architectural shift this inventory enables.
