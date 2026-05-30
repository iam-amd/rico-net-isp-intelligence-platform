# ONU Data Fields â€” SNMP vs Telnet

> Rico Net OLT Proxy â€” what each transport provides per ONU poll cycle.
> Last updated: 2026-05-01

---

## SNMP (ifTable walk) â€” 10.10.10.100 only

Source: Standard MIB-II ifTable (`1.3.6.1.2.1.2.2.1.*`), walked as 6 targeted columns.
Speed: ~28 seconds for 363 ONUs (vs ~65s full subtree).
OLTs: EPON .100 only â€” `.200` and `.210` have `iftable_available: null`, so Telnet is primary there.

| Field | OID | MIB Column | Type | Notes |
|-------|-----|------------|------|-------|
| `mac_address` | `1.3.6.1.2.1.2.2.1.6` | ifPhysAddress | String (XX:XX:XX:XX:XX:XX) | Uppercase. Same value as Telnet `show onu auth-info all`. Used for customer DB matching. |
| `status` | `1.3.6.1.2.1.2.2.1.8` | ifOperStatus | `"online"` / `"offline"` | Raw int: 1 = online, 2 = offline |
| `pon_port` | derived from `1.3.6.1.2.1.2.2.1.2` | ifDescr | String e.g. `"1"` | Parsed from interface name `EPON01ONU34` â€” zero-padded 2-digit â†’ int |
| `onu_index` | derived from `1.3.6.1.2.1.2.2.1.2` | ifDescr | Integer | Parsed from interface name e.g. `34` |
| `rx_bytes_cumulative` | `1.3.6.1.2.1.2.2.1.10` | ifInOctets | Integer (bytes) | OLT receives from ONU (upstream). Cumulative counter â€” converted to delta by poller. |
| `tx_bytes_cumulative` | `1.3.6.1.2.1.2.2.1.16` | ifOutOctets | Integer (bytes) | OLT sends to ONU (downstream). Cumulative counter â€” converted to delta. |
| `if_errors` | `1.3.6.1.2.1.2.2.1.14` | ifInErrors | Integer | Cumulative error count on the ONU interface |
| `olt_host` | â€” | â€” | String e.g. `"10.10.10.100"` | Set by poller, not from SNMP |
| `_transport` | â€” | â€” | `"snmp_iftable"` | Internal tag â€” which path was used |

**What SNMP does NOT provide:**
- Optical power (Rx dBm, Tx dBm) â€” not exposed in this OLT's SNMP tree
- Temperature, voltage â€” not in SNMP tree
- Dying gasp â€” not in SNMP tree
- GPON serial number â€” GPON OLTs (.200, .210) have no usable ifTable

---

## Telnet CLI â€” all 3 OLTs

Source: SSH/Telnet CLI commands, parsed from terminal output.
Commands used per OLT type:

| OLT | Commands |
|-----|---------|
| EPON `.100` | `show onu auth-info all` (MAC + status) + `show onu opm-diag all` (optical) |
| GPON `.200` | `show onu state all` (status) + `show onu info all` (serial) + `show onu 1-N optical_info` (optical, per port) |
| GPON `.210` | `show onu state all` (status) + `show onu info all` (serial) + `show onu 1-N optical` (optical, per port) |

| Field | Source Command | Type | Notes |
|-------|---------------|------|-------|
| `mac_address` | `show onu auth-info all` (EPON) | String (XX:XX:XX:XX:XX:XX) | Uppercase via `normalize_mac()`. GPON uses `SN:<serial>` as placeholder. |
| `status` | `show onu auth-info all` / `show onu state all` | `"online"` / `"offline"` | EPON: parsed from auth-info; GPON: parsed from phase state |
| `dying_gasp` | `show onu state all` (GPON) | Boolean | True when ONU sent power-cut signal before going offline |
| `pon_port` | derived from ONU-ID | String e.g. `"0/1"` | Format: `EPON0/1:3` â†’ `"0/1"` for EPON; `GPON0/2:5` â†’ `"0/2"` for GPON |
| `onu_index` | derived from ONU-ID | Integer | The `:N` part of `EPON0/1:N` |
| `rx_power_dbm` | `show onu opm-diag all` / `optical_info` / `optical` | Float (dBm) | Rx optical level at OLT side. Range: -8 to -40 dBm. Signal thresholds: green >-20, yellow -20 to -24, orange -24 to -27, red <-27. |
| `tx_power_dbm` | `show onu opm-diag all` / `optical_info` / `optical` | Float (dBm) | Tx optical level from ONU laser |
| `temperature_c` | `show onu opm-diag all` / `optical_info` / `optical` | Float (Â°C) | ONU transceiver temperature |
| `voltage_mv` | `show onu opm-diag all` / `optical_info` / `optical` | Integer (millivolts) | ONU supply voltage. Raw CLI value in Volts Ã— 1000. |
| `laser_bias_ma` | `optical_info` / `optical` (GPON only) | Float (mA) | ONU laser bias current â€” GPON only, not always populated |
| `serial_number` | `show onu info all` (GPON) | String | GPON-only. Used as `mac_address = "SN:<serial>"` when no MAC |
| `model_id` | `show onu info all` (GPON) | String | GPON-only. ONU hardware model string |
| `olt_host` | â€” | String | Set by poller |
| `polled_at` | â€” | ISO 8601 timestamp | When CLI fetch ran |
| `_transport` | â€” | `"telnet"` | Internal tag |

**What Telnet does NOT provide:**
- Cumulative byte counters (rx/tx traffic) â€” only SNMP has these
- Error counters â€” only SNMP has these
- EPON dying_gasp â€” EPON auth-info doesn't expose it (GPON state output does)

---

## Combined (after SNMP + Telnet merge)

For EPON .100 only. SNMP runs first (28s), then Telnet runs for optical fields (65s), merge is by `(pon_port_num, onu_index)`.

| Field | Source | Final Format | Sent to Backend |
|-------|--------|-------------|-----------------|
| `mac_address` | SNMP ifPhysAddress | `"14:A7:2B:E6:CA:C8"` (uppercase) | Yes |
| `olt_host` | poller config | `"10.10.10.100"` | Yes |
| `status` | SNMP ifOperStatus | `"online"` / `"offline"` | Yes |
| `pon_port` | SNMP ifDescr | `"1"` (string) | Yes |
| `onu_index` | SNMP ifDescr | `34` (integer) | Yes |
| `rx_bytes_delta` | SNMP ifInOctets (delta) | Integer (bytes since last poll) | Yes â€” replaces `rx_bytes_cumulative` |
| `tx_bytes_delta` | SNMP ifOutOctets (delta) | Integer (bytes since last poll) | Yes â€” replaces `tx_bytes_cumulative` |
| `if_errors` | SNMP ifInErrors | Integer | Yes |
| `rx_power_dbm` | Telnet opm-diag | Float e.g. `-21.5` | Yes |
| `tx_power_dbm` | Telnet opm-diag | Float e.g. `-4.2` | Yes |
| `temperature_c` | Telnet opm-diag | Float e.g. `42.0` | Yes |
| `voltage_mv` | Telnet opm-diag | Integer e.g. `3320` | Yes |
| `dying_gasp` | Telnet opm-diag | Boolean | Yes |

---

## Coverage by OLT

| OLT | ONUs | Primary Transport | SNMP Fields | Telnet Fields | Traffic Counters |
|-----|------|-----------------|-------------|---------------|-----------------|
| EPON 10.10.10.100 | 363 | SNMP â†’ Telnet merge | All 8 | All 5 optical + dying_gasp | Yes (SNMP) |
| GPON 10.10.10.200 | 259 | Telnet only | None | All 5 optical + dying_gasp | No |
| GPON 10.10.10.210 | 659 | Telnet only | None | All 5 optical + dying_gasp | No |

---

## Signal Thresholds (for alarm logic)

| Rx Power Range | Label | Color | Action |
|---------------|-------|-------|--------|
| -8 to -20 dBm | Excellent | Green | None |
| -20 to -24 dBm | Good | Yellow | Monitor |
| -24 to -27 dBm | Weak | Orange | Schedule maintenance 48h |
| Below -27 dBm | Critical | Red | Dispatch immediately (FIBER_CRITICAL alarm) |

---

## What is NOT available from either source

| Data | Why Missing |
|------|------------|
| PPPoE username / IP | Railwire billing system only (scraped separately) |
| Customer name | Customer DB only |
| ONT model (EPON) | Not exposed in EPON CLI output |
| SNMP optical OIDs | Confirmed absent â€” 8000-OID enterprise walk returned no negative integers |
| SNMP trap events | Receiver not yet wired to OLT trap target (Phase 3) |
| Historical session data | Railwire scraper only |
| Bandwidth plan / speed tier | Railwire billing only |
