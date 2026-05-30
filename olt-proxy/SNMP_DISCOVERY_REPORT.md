# SNMP Discovery Report â€” All 3 OLTs

> Full snmpwalk on every OLT, complete OID map, optical/trap analysis, Telnet-vs-SNMP gap.
> Generated: 2026-05-01
> Walk files (reference): `walks/<host>_<tree>.txt` (local) + `/home/rico/olt-proxy/walks/` (Pi)

---

## TL;DR â€” Bottom Line

**Telnet cannot be eliminated.** Optical power (Rx/Tx dBm), temperature, and voltage are NOT exposed in any SNMP tree on any of the 3 OLTs. We walked 32Kâ€“52K enterprise OIDs per OLT and did a live cross-check â€” confirmed.

**However, SNMP coverage CAN be expanded:**
- **.100 (EPON)**: already using SNMP. âœ… working at 363 ONUs.
- **.200 (GPON)**: 275 ONU interfaces in ifTable. âš ï¸ NOT currently used. Should add it (status + traffic).
- **.210 (GPON)**: 595 ONU MACs in enterprise table. âš ï¸ NOT currently used. Standard MIB-II walks fail (rate-limited?), but enterprise tree works.

**Trap targets ALREADY configured** on .100 and .200 pointing to Pi `10.10.10.50:162`. Just need `trap_receiver.py` running. (.210 trap config not verifiable â€” snmpv2 walk timed out.)

---

## Walk Results

| OLT | Model | System | Enterprise | ifTable | snmpv2 |
|-----|-------|--------|-----------|---------|--------|
| **10.10.10.100** | EPON V1600D | 8 OIDs | 32,025 OIDs | 9,130 OIDs | 46 OIDs |
| **10.10.10.200** | GPON V1600G1 | 7 OIDs | 52,193 OIDs | 6,600 OIDs | 38 OIDs |
| **10.10.10.210** | GPON V1600G1B | timeout | 49,574 OIDs | timeout | timeout |

`.210` rejects standard MIB-II walks under any timeout/retry settings, but its enterprise tree walks fine. Likely SNMP view-policy restriction.

---

## Per-OLT OID Map

### 10.10.10.100 â€” EPON V1600D

#### Standard MIB-II
| OID Subtree | Purpose | Used By Poller |
|-------------|---------|----------------|
| `.1.3.6.1.2.1.1` | sysDescr/sysName/sysUpTime â€” system info | health checks |
| `.1.3.6.1.2.1.2.2.1.2` | ifDescr â€” 391 ONU interface names (`EPON01ONU34`) | **YES** â€” primary |
| `.1.3.6.1.2.1.2.2.1.6` | ifPhysAddress â€” 413 valid MACs | **YES** â€” primary |
| `.1.3.6.1.2.1.2.2.1.8` | ifOperStatus â€” online/offline | **YES** â€” primary |
| `.1.3.6.1.2.1.2.2.1.10` | ifInOctets â€” upstream bytes per ONU | **YES** â€” traffic |
| `.1.3.6.1.2.1.2.2.1.14` | ifInErrors â€” error counter | **YES** â€” traffic |
| `.1.3.6.1.2.1.2.2.1.16` | ifOutOctets â€” downstream bytes | **YES** â€” traffic |

#### Enterprise tree `.1.3.6.1.4.1.37950`

**Subtree `.1.1.5.10.3.2.1.*` (ONU registration, 1741 OIDs in 5 columns)**

| Column | Type | Content | Sample |
|--------|------|---------|--------|
| 1 | INTEGER | Sequential index 1-349 | 1, 2, 3 |
| 2 | INTEGER | Type code (100/4005) | 100 |
| 3 | Hex-STRING | **MAC ADDRESS** (346 entries) | `90 8D 78 4A D2 A1` |
| 4 | INTEGER | Always 1 (registered flag) | 1 |
| 5 | STRING | ONU port type | `"GE1"` |

**Subtree `.1.1.5.10.3.8.1.*` (per-MAC ONU mapping, 1388 OIDs in 4 columns)**

| Column | Type | Content | Sample |
|--------|------|---------|--------|
| 1 | Hex-STRING | Position encoding (8 bytes) | `00 00 00 01 00 02` |
| 2 | INTEGER | Type code | 100/4005 |
| 3 | INTEGER | Status flag (always 1) | 1 |
| 4 | STRING | **ONU-ID** | `"EPON0/4:12"` |

**Subtree `.1.1.5.12.1.12.1.*` (ONU live status, 5431 OIDs in 14 columns)**

| Column | Type | Content | Notes |
|--------|------|---------|-------|
| 1 | INTEGER | Global ONU index 0-390 | unique per ONU |
| 2 | INTEGER | PON port (1-8) | matches 8 EPON ports |
| 3 | INTEGER | ONU index within port (1-76) | |
| 4 | INTEGER | Range -1..50 | unknown â€” possibly distance |
| 5 | INTEGER | **STATUS** (0=offline, 1=online) | 288/391 online âœ“ |
| 6 | STRING | **MAC ADDRESS** as string | `"14:a7:2b:e6:ca:c8"` |
| 7 | STRING | **ONU MODEL** | `"V2801S"`, `"HG323DACv3"`, etc. |
| 8 | INTEGER | Always 1 | |
| 9 | INTEGER | Always 0 | |
| 10 | STRING | Always `"NULL"` | |
| 11 | Hex-STRING | 8-byte LLID/vendor ID | |
| 12 | STRING | Always `"NULL"` | |
| 13 | INTEGER | Range 0..3638 â€” **unknown metric** | tested: NOT Rx power (avg delta vs Telnet: 9.3 dBm) |
| 14 | STRING | Port speed (`"1GE"`) | only 348 entries |

**Subtree `.1.1.5.12.1.25.*` â€” 7385 OIDs**, mixed types â€” likely aggregated stats; needs deeper analysis.

#### Trap configuration (`.1.3.6.1.6.3.12.1.2.*`)

```
target = traphost.public.10.10.10.50    (decoded from OID suffix)
addr   = "10.10.10.50#162"              (= our Pi on port 162)
tag    = "trap"
storage_type = 3 (nonvolatile)
row_status = 1 (active)
notify_type = trap (1)  via .1.3.6.1.6.3.13.1.1.1.*
```

**Status: trap target IS configured. Just need trap_receiver.py running.**

---

### 10.10.10.200 â€” GPON V1600G1

#### Standard MIB-II
| OID Subtree | Purpose |
|-------------|---------|
| `.1.3.6.1.2.1.2.2.1.2` | **275 GPON ONU ifDescr** (`GPON01ONU1`..) âš ï¸ **NOT USED** |
| `.1.3.6.1.2.1.2.2.1.6` | ifPhysAddress â€” 25 valid MACs (most empty â€” GPON uses serials) |
| `.1.3.6.1.2.1.2.2.1.8` | ifOperStatus â€” usable for status |
| `.1.3.6.1.2.1.2.2.1.10` | ifInOctets â€” traffic |
| `.1.3.6.1.2.1.2.2.1.16` | ifOutOctets â€” traffic |

#### Enterprise tree

**Subtree `.1.1.5.10.3.2.1.*` (250 OIDs in 5 cols)**: same shape as EPON â€” col 3 has 246 MACs (Hex-STRING), col 5 has port name `"PON1"`.

**Subtree `.1.1.5.10.3.5.1.*` (1548 OIDs in 6 cols)**: extended ONU registration

| Column | Type | Content |
|--------|------|---------|
| 1 | INTEGER | Sequential index 1-258 |
| 2 | INTEGER | Always 100 |
| 3 | STRING | **MAC as string** (e.g. `"8c:c7:c3:30:69:a0"`) |
| 4 | INTEGER | Always 1 |
| 5 | STRING | Position `"2:14"` (port:onu-idx?) |
| 6 | STRING | Position `"1:142"` (?) |

**Subtree `.1.1.6.1.1.1.1.*` (1375 OIDs in 5 cols) â€” ONU phase state**

| Column | Type | Content | Notes |
|--------|------|---------|-------|
| 1 | INTEGER | PON port (1-8) | |
| 2 | INTEGER | ONU index (1-122) | |
| 3 | INTEGER | Always 1 | |
| 4 | INTEGER | **STATUS** (1=online, 2=offline) | 22 online + 98 offline (sample) |
| 5 | INTEGER | Phase state code (1, 3, 4, 6) | 6=working, others=transit |

**Subtree `.1.1.6.1.1.4.1.*` (7150 OIDs in 26 cols) â€” primary GPON ONU info table**

| Column | Type | Content | Sample |
|--------|------|---------|--------|
| 1 | INTEGER | PON port | 1-8 |
| 2 | INTEGER | ONU index | 1-122 |
| 3 | STRING | **Vendor ID** | `"MONU"` |
| 4 | STRING | Hardware version | `"V5.2"` |
| 5 | STRING | **SERIAL NUMBER** | `"GPON30304543"` âœ… used by Telnet |
| 6,7 | INTEGER | 0 (placeholder) | |
| 8 | INTEGER | Always 1 | |
| 9 | INTEGER | 0..23 (unknown) | |
| 10 | INTEGER | 0..128 (unknown) | |
| 11 | INTEGER | 0..31 (unknown) | |
| 12 | INTEGER | 0..65535 (LLID range) | |
| 13 | INTEGER | 0..65535 | |
| 14 | STRING | **ONT MODEL** | `"MONUV601"` |
| 15 | INTEGER | 128/160 (port mask?) | |
| 16 | INTEGER | Always 1 | |
| 17 | STRING | ONT model copy | |
| 18,21,22 | STRING | Mostly `"N/A"` | |
| 19 | STRING | `"64"` (slot count?) | |
| 20 | STRING | **UPTIME** | `"106460.00 s"` |
| 23 | INTEGER | 0 | |
| 24 | STRING | **ONU-ID** | `"GPON0/1:1"` |
| 25,26 | STRING | Software version | `"V1.1.9"` |

#### Trap configuration
Same as .100: target=`traphost.public.10.10.10.50`, addr=`10.10.10.50#162`, tag=`trap`. **Active.**

---

### 10.10.10.210 â€” GPON V1600G1B

âš ï¸ Standard MIB-II walks fail. Only enterprise tree responds.

**Subtree `.1.1.5.10.3.2.1.*` (2975 OIDs)**: 595 MACs in col 3, ONU-IDs in col 5 (`"PON4:ONU73"` format â€” different from .200!)

**Subtree `.1.1.6.1.1.1.1.*` (7392 OIDs in 11 cols) â€” phase state â€” has MORE columns than .200**

| Column | Type | Content | Sample |
|--------|------|---------|--------|
| 1 | INTEGER | PON port (1-8) | |
| 2 | INTEGER | ONU index (1-128) | |
| 3 | INTEGER | Always 1 | |
| 4 | INTEGER | **STATUS** 1/2 | 1=online, 2=offline |
| 5 | INTEGER | Phase code 2-8 | |
| 6 | INTEGER | Always 1 | |
| 7 | STRING | Mostly `"N/A"` | |
| 8 | STRING | **Last online time** | `"2026:04:30 18:11:40"` |
| 9 | STRING | **Last offline time** | `"2026:04:30 18:10:29"` |
| 10 | STRING | **Offline reason** | **`"Power Off"`** = dying_gasp! Other = various |
| 11 | STRING | Time-of-day (HH:MM:SS) | `"21:24:05"` |

ðŸŽ¯ **Col 10 "Power Off" is equivalent to Telnet `dying_gasp`!** This is the only OLT where dying_gasp can be derived from SNMP.

**Subtree `.1.1.6.1.1.4.1.*` (17,509 OIDs in 27 cols)** â€” same as .200 plus col 27 (`"Thu Apr 30 18:11:03 2026"` â€” last activity timestamp).

#### Trap configuration: snmpv2 walk timed out â€” unknown.

---

## Optical Power Search â€” Negative

I performed three independent searches for optical data:

1. **Negative-integer scan** (Rx is typically negative dBm):
   - dBm Ã— 1: range -50 to -1 â†’ 0 candidates with realistic distribution
   - dBm Ã— 10: range -500 to -50 â†’ 0 candidates
   - dBm Ã— 100: range -5000 to -500 â†’ 0 candidates

2. **Plausible-magnitude scan**:
   - One column on .100 (`.12.1.12.1.13`) had values 1000-3638. Hypothesized as `abs(Rx_dBm) Ã— 100`.
   - **Live cross-check vs Telnet OPM-diag for 25 ONUs**: avg delta +9.3 dBm, max abs delta 27.25 dBm. **Not Rx power.** Probably distance in meters (0-3.6 km).

3. **Temperature/voltage range scan**:
   - 0 candidates on any OLT with a per-ONU distribution of 30-70Â°C or 1000-3500 mV.

**Definitive conclusion: optical/temp/voltage are NOT in SNMP on any OLT.**

This matches what we already knew from the original audit (`snmp_oid_profile.json` notes: "Optical confirmed NOT in SNMP tree - 0 negative integers in 8000-OID walk").

---

## Trap Notification OIDs

| OLT | Trap Target Configured | Tag List | Domain | Status |
|-----|----------------------|----------|--------|--------|
| .100 | `10.10.10.50#162` (Pi) | `trap` | snmpUDPDomain | active |
| .200 | `10.10.10.50#162` (Pi) | `trap` | snmpUDPDomain | active |
| .210 | unknown â€” walk timed out | â€” | â€” | â€” |

OLTs SHOULD already be sending traps to Pi port 162. The `notify_type` in `.1.3.6.1.6.3.13.1.1.1.5` is set to `1` (trap, not inform).

The notification OID itself (`.0.0` placeholder) means traps are not filtered by event type â€” all events flow.

**To use traps**: bring up `trap_receiver.py` on Pi (already exists in `/home/rico/olt-proxy/trap_receiver.py`).

---

## Telnet-vs-SNMP Gap

### What ONLY Telnet can provide (per ONU)

| Field | EPON .100 | GPON .200 | GPON .210 | Source |
|-------|-----------|-----------|-----------|--------|
| **rx_power_dbm** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only | `show onu opm-diag all` / `show onu N optical` |
| **tx_power_dbm** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only | same |
| **temperature_c** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only | same |
| **voltage_mv** | âŒ Telnet only | âŒ Telnet only | âŒ Telnet only | same |
| **laser_bias_ma** | â€” | âŒ Telnet only | âŒ Telnet only | GPON optical block |

### What Telnet AND SNMP both provide

| Field | Telnet | SNMP (any OLT) |
|-------|--------|---------------|
| MAC address | âœ… `auth-info` | âœ… ifPhysAddress + enterprise col 3 |
| Status (online/offline) | âœ… phase state | âœ… ifOperStatus + enterprise col 5 |
| ONU-ID (port:idx) | âœ… derived | âœ… enterprise col 24 (GPON) / col 4 (EPON) |
| Serial number | âœ… `info all` (GPON) | âœ… enterprise col 5 (GPON) |
| ONT model | âŒ (rarely) | âœ… enterprise col 14 (GPON) / col 7 (EPON) |
| Uptime / last seen | âŒ | âœ… enterprise col 20/27 (GPON .210) |

### What ONLY SNMP can provide

| Field | SNMP source | Telnet equivalent |
|-------|-------------|-------------------|
| **Per-ONU rx/tx byte counters** | `ifInOctets` / `ifOutOctets` | not exposed in CLI |
| **Per-ONU error counter** | `ifInErrors` | not exposed |
| **dying_gasp on .210** | enterprise col 10 = `"Power Off"` | redundant â€” also from `state all` |

---

## Recommendation

### Cannot be eliminated: âŒ Telnet
Optical (Rx/Tx/temp/voltage) is the most operationally critical real-time metric (used for FIBER_CRITICAL alarms, signal degradation predictions, fault dispatch). Without it, the NOC dashboard and prediction engine break.

**Telnet stays for optical on all 3 OLTs.**

### Can be added: âœ… SNMP for .200 (GPON V1600G1)

`.200` ifTable exposes 275 ONU interfaces. Adding `iftable_available: true` to `snmp_oid_profile.json` for `.200` immediately gives:
- Status (online/offline) for 275 ONUs in <30 s vs Telnet ~280 s
- Per-ONU traffic counters (currently unavailable)
- Faster polls = more frequent updates

Note: `ifPhysAddress` returns empty on most GPON ONUs (only 25/275 valid). For MAC mapping, use enterprise col 3 (246 MACs) or fall back to `"SN:<serial>"` matching from Telnet.

### Cannot easily be added: âš ï¸ SNMP for .210 (GPON V1600G1B)

`.210` standard MIB-II walks fail under all retry settings. Possible causes:
- SNMP view restricting standard MIB to authorized OIDs only
- Rate limiting on the OLT's SNMP agent
- Firmware bug

`.210`'s enterprise tree walks fine, so an enterprise-only SNMP path could be built for it. But enterprise has no traffic counters â€” only status and identity. Not worth building unless we need the dying_gasp from col 10.

### Quick wins (no code changes)

1. **Bring up trap_receiver.py on Pi** â€” both .100 and .200 are already configured to send traps to `10.10.10.50:162`. This adds real-time event detection (link up/down, dying gasp) without any polling cost.
2. **Verify `.210` trap config** â€” once standard MIB-II walks become possible (try via direct snmpget instead of bulk walk).

### Longer-term

- Vendor firmware upgrade â€” newer OLT firmware MAY expose optical via SNMP. Check Netlink V1600D / V1600G1 / V1600G1B firmware release notes for new MIBs in releases after V2.03.75R / V2.3.1R / V1.4.8R.
- Vendor MIB request â€” if firmware has private optical OIDs that aren't in `1.3.6.1.4.1.37950`, request the MIB file from Netlink support.

---

## Files (for reference)

```
/home/rico/olt-proxy/walks/        (Pi)
<local-project-path>\olt-proxy\walks\   (local copy)

10.10.10.100_system.txt        358 bytes
10.10.10.100_iftable.txt       400 KB
10.10.10.100_enterprise.txt    1.95 MB   (32,025 OIDs)
10.10.10.100_snmpv2.txt        3.4 KB

10.10.10.200_system.txt        343 bytes
10.10.10.200_iftable.txt       280 KB
10.10.10.200_enterprise.txt    3.25 MB   (52,193 OIDs)
10.10.10.200_snmpv2.txt        3.1 KB

10.10.10.210_system.txt        timeout
10.10.10.210_iftable.txt       timeout
10.10.10.210_enterprise.txt    2.95 MB   (49,574 OIDs)
10.10.10.210_snmpv2.txt        timeout
```

Re-run with: `bash /home/rico/olt-proxy/_walks_run.sh` (parallel) or `bash /home/rico/olt-proxy/_walk_210_retry.sh` (sequential for .210).

Analysis scripts:
- `_analyze_walks.py` â€” top-level summary
- `_analyze_deep.py` â€” per-subtree column analysis
- `_drill_subtree.py` â€” drill into specific subtrees
- `_verify_optical_live.py` â€” live SNMP-vs-Telnet cross-check
