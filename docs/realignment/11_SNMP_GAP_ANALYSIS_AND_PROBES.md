# SNMP Gap Analysis â€” All 3 OLTs

> Complete cross-OLT comparison of what each one exposes, what's identical,
> what's missing, and the exact probes to run on the Pi to close the remaining
> gaps. Companion to `10_SNMP_OLT_ENGINE_RESEARCH.md`.
>
> **Date:** 2026-05-11
> **Status:** Research only. Read-only SNMP queries. No OLT changes.

---

## TL;DR

After re-walking all walk files plus the full enterprise dumps:

| Area | Status |
|---|---|
| Optical, status, dying-gasp | âœ… Working on all 3 via SNMP |
| Per-ONU traffic | âœ… EPON / âš ï¸ GPON .200 sparse / âŒ GPON .210 |
| **LAN-MAC matching (Railwire â†’ ONU)** | âœ… EPON `.5.10.3.8` / âŒ GPON .200 / âœ… GPON .210 `.5.10.3.12` |
| OLT-port health | âœ… All 3 (at `.5.10.13.1.1`) â€” unused |
| Alarm dictionary | âœ… All 3 â€” unused |
| ONT identity (vendor/HW/SW) | âœ… GPON .200 + .210 â€” unused |
| Last-online / offline-reason | âœ… .210 only (richest state table) |
| QoS / bandwidth profile | âœ… .210 only (`.5.10.24`) â€” unused |

**The .200 LAN-MAC gap is the single biggest open question.** Three untested paths
exist; the probe script `olt-proxy/probe_mac_table.sh` settles it in ~30 seconds.

---

## 1. What .200 is missing vs the others

After exhaustive comparison:

### Enterprise-tree subtrees present on .210 but NOT on .200
- `.5.10.24` â€” **QoS policy** (behaviorNameSet, classifierNameSet, policyName). Useful for resolving "which bandwidth profile is this ONU on?" without Telnet.
- `.5.10.25` â€” Statistics with Gauge32 counters. All zeros in our walk â€” could be feature-gated, not active by default.

### Enterprise-tree subtrees present on .200 but NOT on .210
- `.6.1.1.{8, 10, 11, 12, 13, 15, 17, 18, 19}` â€” these are config-template subtrees (`gOnuAddSn`, `gOnuCfgTcontDba`, etc.). Mostly write-only config; not customer data we need.

### Enterprise-tree subtrees present on EPON .100 but NOT either GPON
- `.5.10.3.8` â€” **LAN-MAC learning table** (1,388 entries). EPON-only at this OID.
- `.5.12.1.*` â€” EPON-only namespace for ONU live status / aggregate stats.

### Enterprise-tree subtrees present on GPON .210 but NOT on EPON .100
- `.5.10.3.12` â€” **LAN-MAC learning table** (2,380 entries). Different OID number than EPON's, same purpose.
- `.6.1.X` â€” entire GPON-specific namespace.

**Pattern:** the LAN-MAC table exists under different sub-IDs depending on firmware family. On .200's V2.3.1R it is neither at `.5.10.3.8` nor `.5.10.3.12` â€” and the dump confirms no equivalent exists in the enterprise tree at all.

---

## 2. The four untested paths for .200

| # | Path | OID | Probability |
|---|---|---|---|
| 1 | **BRIDGE-MIB FDB** | `.1.3.6.1.2.1.17.4.3.1` | **High** â€” standard L2 MIB, never walked anywhere |
| 2 | **Q-BRIDGE-MIB** (VLAN-aware) | `.1.3.6.1.2.1.17.7.2.2.1` | Medium â€” newer L2 MIB |
| 3 | **Alternate enterprise roots** | `.4.1.17409` (Realtek), `.4.1.26149` (CTB), `.4.1.33897` | Low â€” vendor varies, but cheap to test |
| 4 | **Telnet CLI** `show mac-address-table` | n/a â€” CLI not SNMP | **100% guaranteed** â€” every L2 device CLI exposes this |

### Why BRIDGE-MIB is the most likely answer

Every device that forwards Ethernet frames (which is what an OLT does at L2)
must learn MAC addresses to do its job. The IETF standard for exposing this
table is `BRIDGE-MIB` (RFC 4188), at OID `.1.3.6.1.2.1.17`. Almost every
chipset vendor implements at least the read-only parts. Walking it on the Pi
is one snmpwalk command â€” and it has **literally never been attempted** on any
of our 3 OLTs because the historical walk scripts only covered system /
iftable / 37950 / snmpv2.

The probe script (`probe_mac_table.sh`) tests this first.

### What success looks like

If BRIDGE-MIB responds on .200, you get rows like:

```
.1.3.6.1.2.1.17.4.3.1.1.<MAC bytes>  = Hex-STRING: <same MAC bytes>
.1.3.6.1.2.1.17.4.3.1.2.<MAC bytes>  = INTEGER: <bridge port number>
.1.3.6.1.2.1.17.4.3.1.3.<MAC bytes>  = INTEGER: 3   (learned)
```

Plus a port â†’ ifIndex map at `.17.1.4.1.2.<port>`. Combine:
1. For each Railwire MAC, snmpget `.17.4.3.1.2.<MAC bytes>` â†’ bridge port N.
2. snmpget `.17.1.4.1.2.<N>` â†’ ifIndex.
3. From ifTable (already walked), ifIndex â†’ ifDescr "GPON01ONU7" â†’ port=1, onu=7.
4. **Match confidence: CONFIRMED.**

Coverage would be every learned MAC on the OLT (typically several thousand per
OLT), so this also unlocks the "Active Router MACs â€” N found" UI panel for .200.

---

## 3. Other gaps worth closing (not blocking but high-value)

These are confirmed available in walks but not yet extracted by
`snmp_client.py`. All three OLTs.

### 3.1 OLT-side per-PON-port health (`.5.10.13.1.1`)
- 8 rows per OLT, 5 columns each: port#, temp Â°C, voltage V, Tx bias mA, Tx dBm
- Detects OLT hardware degrading before customers complain
- 40 OIDs per OLT, ~0.5s extra per cycle

### 3.2 Alarm dictionary (`.5.10.13.4.2.1.2`)
- 85-106 alarm name strings, indexed by code
- Already implicitly used (we hardcode `26 = dying_gasp`)
- Walking it once at startup gives a self-describing catalog â€” survives firmware changes

### 3.3 GPON ONT identity (`.6.1.1.4.1.{3,4,5,14,20,25,26}`)
- vendor / HW version / serial / model / uptime / SW version
- Populates ONU inventory page directly from SNMP
- Already in the walk data â€” just needs extraction

### 3.4 GPON .210 state details (`.6.1.1.1.1.{8,9,10}`)
- Last online time, last offline time, offline reason ("Power Off" / "Other")
- Removes the need to compute these from snapshot history

### 3.5 EPON ONU model (`.5.12.1.12.1.7`)
- "V2801S", "HG323DACv3" â€” currently missing for EPON; GPON has it via different OID

### 3.6 GPON QoS policy (.210 only, `.5.10.24`)
- Maps ONU â†’ bandwidth profile name
- Useful for "is this customer actually getting their plan speed?" diagnostics

---

## 4. What standard MIBs we never tried â€” full list

Every walk so far hit only:
- `.1.3.6.1.2.1.1` (system) â€” 7-8 OIDs
- `.1.3.6.1.2.1.2.2` (ifTable) â€” 6.6K-9.1K OIDs on .100 + .200
- `.1.3.6.1.4.1.37950` (enterprise) â€” 32K-52K OIDs each
- `.1.3.6.1.6.3.12-13` (SNMPv2-MIB trap config) â€” few OIDs

We have **never tried** these standard MIBs that might contain valuable data:

| MIB | OID | What it gives |
|---|---|---|
| BRIDGE-MIB | `.1.3.6.1.2.1.17` | L2 forwarding table, port states, STP |
| Q-BRIDGE-MIB | `.1.3.6.1.2.1.17.7` | VLAN-aware forwarding, VLAN config |
| ETHER-LIKE-MIB | `.1.3.6.1.2.1.10.7` | Per-interface Ethernet stats (deferred-frames, collisions) |
| RMON-MIB | `.1.3.6.1.2.1.16` | Remote monitoring stats (history buckets) |
| EtherStats | `.1.3.6.1.2.1.16.1.1` | Per-port packet-size histograms |
| ENTITY-MIB | `.1.3.6.1.2.1.47` | Hardware inventory (slots, PSUs, fans) |
| HOST-RESOURCES-MIB | `.1.3.6.1.2.1.25` | CPU, memory, process list, disk |
| IP-MIB | `.1.3.6.1.2.1.4` | Routing tables, ARP cache (also has MAC learning!) |
| IP-FORWARD-MIB | `.1.3.6.1.2.1.4.24` | IP forwarding table |
| TCP-MIB | `.1.3.6.1.2.1.6` | TCP connection table |

**ARP cache (`.1.3.6.1.2.1.4.22`)** is particularly interesting â€” it gives
MAC â†” IP pairs for every IP the OLT has seen. If the OLT's PPPoE service runs
through it (which it doesn't for Railwire), you'd get customer WAN-IP â†’ MAC
mapping directly. Worth one probe to confirm.

The probe script also tests these.

---

## 5. The Probe Script â€” what it does

`olt-proxy/probe_mac_table.sh` runs against all 3 OLTs and reports for each:

| Probe | OID | Purpose |
|---|---|---|
| BRIDGE-MIB FDB | `.1.3.6.1.2.1.17.4.3.1.{1,2,3}` | Standard L2 forwarding (the big hope for .200) |
| BRIDGE portâ†’ifIndex | `.1.3.6.1.2.1.17.1.4.1.2` | Maps bridge port to interface |
| Q-BRIDGE FDB | `.1.3.6.1.2.1.17.7.2.2.1.{2,3}` | VLAN-aware forwarding |
| Realtek root | `.1.3.6.1.4.1.17409` | Alternate vendor OID space |
| CTB root | `.1.3.6.1.4.1.26149` | Alternate vendor OID space |
| Alt root | `.1.3.6.1.4.1.33897` | Alternate vendor OID space |
| EPON LAN-MAC at `.5.10.3.8` | tests if EPON-style table exists on GPONs | |
| GPON .210 LAN-MAC at `.5.10.3.12` | tests if .210-style table exists on .200/.100 | |
| Unsampled enterprise subtrees | `.6.1.1.{8,9,14,16,20+}` | Catch anything we missed |
| Future namespaces | `.5.10.{26,27}`, `.5.12.3`, `.1.1.7` | Cheap "does it exist" tests |

**Total runtime:** ~30 seconds across all 3 OLTs.
**Output:** ~50 lines per OLT showing which OIDs respond.
**Action:** scp to Pi, run, scp results back, review.

```bash
# From home PC:
scp "<local-project-path>\olt-proxy\probe_mac_table.sh" rico@100.x.x.x:/home/rico/olt-proxy/
ssh rico@100.x.x.x 'bash /home/rico/olt-proxy/probe_mac_table.sh > /home/rico/olt-proxy/probe_results.txt'
scp rico@100.x.x.x:/home/rico/olt-proxy/probe_results.txt "<local-project-path>\olt-proxy\"
```

---

## 6. Decision tree based on probe results

```
                â”Œâ”€ BRIDGE-MIB responds on .200? â”€â”
                â”‚                                â”‚
              YES                              NO
               â”‚                                â”‚
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”             â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚ Use it for .200    â”‚             â”‚ Q-BRIDGE responds? â”‚
   â”‚ Re-test on .100/   â”‚             â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
   â”‚ .210 â€” maybe       â”‚                       â”‚
   â”‚ replace per-OLT    â”‚                NO     â”‚     YES
   â”‚ OIDs with one      â”‚                       â”‚
   â”‚ standard path      â”‚              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜              â”‚ Alt root responds?â”‚
                                       â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                                â”‚
                                          NO    â”‚     YES
                                                â”‚
                                  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                  â”‚ Telnet CLI fallback only â”‚
                                  â”‚ for .200:                â”‚
                                  â”‚   show mac-address-table â”‚
                                  â”‚   every 5 min            â”‚
                                  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

The worst-case (Telnet fallback) still solves the problem. It adds ~30-60s to
the .200 cycle every 5 minutes â€” well inside the existing cadence.

---

## 7. What to do with the results

After probing:

1. **If BRIDGE-MIB works on .200**: write a new `_fetch_gpon_brigde_mac()`
   function in `snmp_client.py`; combine with the existing GPON fetch. Match
   confidence becomes CONFIRMED for all .200 customers.

2. **If only Telnet works**: add a Telnet FDB-fetch step to .200's poll
   cycle, run every 5 minutes (LAN MACs change slowly). Use the existing
   `olt_client.py` Telnet plumbing.

3. **For .100 and .210** â€” even if their current per-OLT OIDs already work,
   probing BRIDGE-MIB is worthwhile. If it responds with cleaner output, we
   can consolidate to one standard path across all 3 OLTs (and any future ones).

4. **For the OLT engine design** â€” update the `Layer 2 Collectors` matrix
   in `olt-proxy/OLT_ENGINE_DESIGN.md`:
   - SNMP-collector: optical + status + identity + LAN-MAC (via BRIDGE-MIB
     where available)
   - Telnet-collector: only as a fallback when SNMP fails

---

## 8. Future OLTs â€” what to demand at acceptance

When the 2 new OLTs arrive, run `probe_mac_table.sh` against each before
accepting them. Must respond on:

- âœ… Standard MIB-II: system, ifTable
- âœ… Enterprise `.1.3.6.1.4.1.37950` (or alt root)
- âœ… Per-ONU optical (Rx, Tx, temp, V, bias)
- âœ… **BRIDGE-MIB `.1.3.6.1.2.1.17.4.3`** â† this is the new criterion
- âœ… Trap target configurable to Pi:162

If BRIDGE-MIB doesn't respond, ask the vendor to enable it via firmware
config. If they refuse, the OLT requires Telnet fallback for MAC matching â€”
acceptable but slower.

---

## Appendix â€” Files I produced this session

| File | What it is |
|---|---|
| `docs/realignment/10_SNMP_OLT_ENGINE_RESEARCH.md` | Main research: full OID matrix, capability per OLT |
| `docs/realignment/11_SNMP_GAP_ANALYSIS_AND_PROBES.md` | This file â€” gap analysis + probe plan |
| `olt-proxy/probe_mac_table.sh` | Read-only SNMP probe script for the Pi |
| `memory/snmp_lan_mac_matching_may11.md` | Findings: EPON `.5.10.3.8` + GPON .210 `.5.10.3.12` LAN-MAC OIDs |
| `memory/snmp_200_mac_table_plan_may11.md` | The 3 untested paths for .200 |
