# Live SNMP + Telnet Probe Results â€” 2026-05-11

> Read-only probes run against all 3 live OLTs. Zero changes made.
> Companion to `10_SNMP_OLT_ENGINE_RESEARCH.md` and `11_SNMP_GAP_ANALYSIS_AND_PROBES.md`.

---

## Executive Summary

After exhaustive live testing, the LAN-MAC matching question is closed:

| OLT | LAN-MAC source | Status |
|---|---|---|
| **EPON .100** (V1600D, V2.03.75R) | Vendor `.5.10.3.8` (1,388 entries, ~4 MACs/ONU) **OR** BRIDGE-MIB (344 entries, 1 MAC/ONU) | âœ… Either works |
| **GPON .210** (V1600G1B, V1.4.8R) | Vendor `.5.10.3.12` (2,380 entries) | âœ… Works |
| **GPON .200** (V1600G1, V2.3.1R) | **NONE via SNMP** â€” BRIDGE returns 2 uplink MACs only; no vendor LAN-MAC table; DHCP snooping not enabled on customer VLANs; Railwire is PPPoE so snooping wouldn't help anyway | âŒ Use survey-team workflow |

The .200 is a structural firmware gap. No clean automated path exists today.

---

## What We Tested (read-only, no OLT changes)

Five probe scripts ran against the live OLTs through `olt_client.OLTTelnetClient` (existing infra) and `snmpbulkwalk`. All on the Pi (`100.x.x.x`).

### Probe 1 â€” Standard MIBs + alt vendor roots
Files: `probe_mac_table.sh`, `probe_results.txt` (30 KB)

### Probe 2 â€” BRIDGE-MIB volume + new subtree decode
Files: `probe_deep.py`, `probe_deep_results.txt`

### Probe 3 â€” Final exhaustive .200 SNMP sweep
Files: `probe_final_200.py`, `probe_final_200_results.txt`

### Probes 4-6 â€” Telnet CLI discovery
Files: `probe_telnet_fdb*.py`, `probe_telnet_fdb_results.txt`

---

## Per-OLT Detailed Results

### EPON .100 (V1600D, firmware V2.03.75R)

**BRIDGE-MIB FDB:** âœ… 344 entries, one MAC per active ONU.
```
.1.3.6.1.2.1.17.4.3.1.1.<MAC bytes> = Hex-STRING <MAC>       # the MAC
.1.3.6.1.2.1.17.4.3.1.2.<MAC bytes> = INTEGER <port>          # bridge port
.1.3.6.1.2.1.17.4.3.1.3.<MAC bytes> = INTEGER 3                # learned
.1.3.6.1.2.1.17.1.4.1.2.<port>      = INTEGER <ifIndex>        # portâ†’ifIndex
```
Combine with existing ifTable walk (ifDescr `EPON01ONU34`) to map â†’ ONU.

**Vendor LAN-MAC table:** âœ… `.5.10.3.8` already known, 1,388 entries (~4 MACs per ONU). Returns "EPON0/P:N" in col 4. Richer than BRIDGE-MIB.

**Other findings:**
- âœ… `.5.10.26` RESPONDS â€” RADIUS auth config (`radServerHost`, `radSharedKey`). Not customer data.
- âœ… `.5.10.27` RESPONDS â€” security keys / cert blob. Not useful.
- âœ… `.5.12.3` RESPONDS â€” config templates. Not data.
- âŒ Realtek/CTB/alt enterprise roots: all NOT AVAILABLE
- âŒ ENTITY-MIB, HOST-RESOURCES-MIB, IP-MIB ARP cache: all NOT AVAILABLE

### GPON .210 (V1600G1B, firmware V1.4.8R)

**BRIDGE-MIB FDB:** âŒ 0 entries. Not implemented in V1.4.8R.
**Q-BRIDGE-MIB:** âŒ Not available.

**Vendor LAN-MAC table:** âœ… `.5.10.3.12` already known, 2,380 entries â€” the only path.

**Other findings:**
- âœ… `.6.1.1.8` RESPONDS â€” but takes >10s to respond (slow V1.4.8R agent). Config bitmap, not data.
- âŒ Standard MIBs all rejected (V1.4.8R has restrictive SNMP view).

### GPON .200 (V1600G1, firmware V2.3.1R)

**BRIDGE-MIB FDB:** âš ï¸ Only 2 entries â€” both are OLT uplink-side MACs, not customer-side.
```
iso.3.6.1.2.1.17.4.3.1.1.6.144.141.120.74.210.185 = 90:8D:78:4A:D2:B9  port 8
iso.3.6.1.2.1.17.4.3.1.1.6.192.3.128.101.225.244  = C0:03:80:65:E1:F4  port 8
```
Port 8 = OLT uplink. These are not customer device MACs.

**Q-BRIDGE-MIB (VLAN-aware FDB):** Same 2 MACs only. Bridge port=8 is uplink.

**Full BRIDGE-MIB walk:** 597 OIDs total â€” most are VLAN config + base port table, only 2 actual FDB entries.

**Vendor enterprise .5.10.3.X subtree counts:**
| Subtree | Entries | Contents |
|---|---|---|
| `.5.10.3.2` | 1,235 | ONU registration (optical MAC) |
| `.5.10.3.5` | 1,550 | ONU registration extended (optical MAC + port:onu mapping) |
| `.5.10.3.8` | 1 | **EMPTY â€” not the EPON-style LAN-MAC table** |
| `.5.10.3.12` | 1 | **EMPTY â€” not the .210-style LAN-MAC table** |

Confirmed: **.200 does NOT expose customer LAN MACs in either the EPON OID (`.5.10.3.8`) or the .210 OID (`.5.10.3.12`).**

**Q-BRIDGE-MIB VLAN tables:** âœ… Reveals all configured service VLANs:
```
VLAN 1, 100, 119, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 271
```
Useful for customer service correlation.

**Telnet CLI investigation (V2.3.1R command set):**

```
> show mac-address-table     â†’ % Unknown command
> show fdb                    â†’ % Unknown command
> show mac                    â†’ % Command incomplete (no useful subcommand)
> show onu mac                â†’ not supported
> show dhcp-snooping ?        â†’ has TWO subcommands: binding, configuration
> show arp ?                  â†’ only "packet-rate-limit" (no ARP table dump)
```

**The DHCP snooping path:**
```
> show dhcp-snooping configuration
DHCP Snooping configuration information
dhcp snooping        : enable
dhcp snooping vlan   : 981
```

Critical: **snooping is enabled only on VLAN 981**, NOT on customer service VLANs (271, 100-138). Customer VLANs have no binding records to fetch.

**Why DHCP snooping wouldn't help anyway:**
Railwire authenticates via PPPoE, not DHCP. Customer routers do PPPoE to Railwire's BNG; LAN devices behind the customer router use the router's local DHCP (NAT). The OLT only ever sees the customer router's PPPoE MAC frame, never the LAN device MACs. Enabling snooping on customer VLANs would catch PPPoE control packets, not DHCP â€” wrong protocol.

**OLT alternate roots tested:** All NOT AVAILABLE â€” `.4.1.17409`, `.4.1.26149`, `.4.1.33897`.

---

## What This Means for the Customer Profile UI

The "Active Router MACs â€” N found" panel renders as:

| OLT | UI behaviour |
|---|---|
| EPON .100 | Pull from `.5.10.3.8.1.4.*` filtered to this ONU â†’ list of MACs |
| GPON .210 | Pull from `.5.10.3.12.1.1.6.*` filtered to this ONU â†’ list of MACs |
| GPON .200 | Show **only the ONT optical-side MAC** from `.5.10.3.5.1.3.<idx>` + "no LAN MACs available â€” survey required" hint |

For binding confidence:

| OLT | Confidence path |
|---|---|
| EPON .100 / GPON .210 | Match Railwire MAC âˆˆ LAN-MAC list â†’ **CONFIRMED** |
| GPON .200 | Match Railwire MAC âˆˆ {single ONT optical MAC} or survey-uploaded MAC â†’ **PROBABLE** until survey done |

**Coverage:** roughly 90% of customers (EPON + GPON .210) get CONFIRMED automatically. 10% (GPON .200) need survey backfill â€” already in the field-team plan.

---

## Paths to Close the .200 Gap (none free)

| Option | Effort | Risk | Coverage gain |
|---|---|---|---|
| Survey team collects GPS+MAC per customer | High (months) | Low | 100% of .200 customers |
| Enable DHCP snooping on customer VLANs (config change) | Medium | Medium â€” config change | 0% â€” PPPoE not DHCP |
| Vendor firmware update with extended SNMP | Lowâ€“Medium (depends on Netlink) | Low | 100% if they ship it |
| Wait for Netlink MIB reply (email sent 2026-05-02) | Already initiated | Low | Unknown |
| Live-track PPPoE on customer router via TR-069 | High (new ACS infra) | Medium | 100% but separate system |

**Pragmatic recommendation:** Continue the survey workflow for .200 customers (~230 of 1,300, the smallest OLT). EPON + GPON .210 â€” 90% of base â€” get the automated CONFIRMED path.

---

## Confirmed Side-Discoveries

These came up during probing and are worth using:

### 1. PON-port OLT-side health (all 3 OLTs)
`.5.10.13.1.1.{2..5}.{port}` â€” temperature, voltage, bias, Tx power for each of 8 PON ports on the OLT side. We confirmed values returning live. Detects OLT hardware degradation.

### 2. VLAN configuration map (.200 + .100)
`.1.3.6.1.2.1.17.7.1.4.{2,3}` â€” list of configured VLANs + names. On .200: VLANs 1, 100, 119, 128-138, 271. Useful for correlating customer service tier.

### 3. DHCP snooping IS available on V2.3.1R
Even if not useful for customer MACs here, it could be enabled later if any service is migrated to DHCP-based auth.

### 4. Standard MIBs NOT supported
ENTITY-MIB, HOST-RESOURCES-MIB, RMON, IP-MIB ARP cache â€” none are populated on the Netlink firmware. SNMP-based hardware inventory / CPU monitoring would need vendor MIB support.

---

## Updated OLT Acceptance Criteria for Future OLTs

The 2 future OLTs (not yet delivered) should be tested against this checklist at acceptance:

1. âœ… SNMPv2c on community `public` / `private` (already required)
2. âœ… Enterprise tree under `1.3.6.1.4.1.37950` for optical (already required)
3. âœ… Trap target configurable to Pi:162 (already required)
4. âœ… **BRIDGE-MIB `.1.3.6.1.2.1.17.4.3` populated with customer LAN MACs**, OR
5. âœ… **Vendor LAN-MAC table at `.5.10.3.8` (EPON-style) or `.5.10.3.12` (GPON-style)**

If #4 returns >10 entries AND #5 returns >100 entries on a populated OLT, automated MAC matching works without survey.

If BOTH return zero/sparse â€” flag the OLT as "MAC-matching gap" before procurement closes; insist on a firmware version that exposes this.

---

## All Probe Files (read-only, in `olt-proxy/`)

- `probe_mac_table.sh` â€” initial SNMP sweep
- `run_probe.py` â€” runner for probe 1
- `probe_deep.py` â€” BRIDGE-MIB depth + new subtree decode
- `probe_final_200.py` â€” exhaustive .200 SNMP sweep
- `probe_telnet_fdb{2..6}.py` â€” Telnet CLI discovery
- `fetch_probe_results.py` â€” kill + fetch helper

Result files:
- `probe_results.txt` (30 KB)
- `probe_deep_results.txt`
- `probe_final_200_results.txt` (4.5 KB partial)
- `probe_telnet_fdb_results.txt`
