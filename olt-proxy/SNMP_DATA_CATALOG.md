# SNMP Data Catalog â€” Complete Inventory

> Every OID, every type, every column from full SNMP walks of all 3 OLTs.
> Source files: `walks/<host>_<tree>.txt`. Generated: 2026-05-01.

---


## 10.10.10.100 â€” EPON V1600D â€” Booto Main

**Walk sizes**: system=8 OIDs, iftable=9130 OIDs, enterprise=32025 OIDs

### System (1.3.6.1.2.1.1)

| OID | Field | Value |
|-----|-------|-------|
| `.1.3.6.1.2.1.1.1.0` | sysDescr | `"V1600D"` |
| `.1.3.6.1.2.1.1.2.0` | sysObjectID | `.1.3.6.1.4.1.37950.1.1.5.10.14.1` |
| `.1.3.6.1.2.1.1.3.0` | sysUpTime | `(95700655) 11 days, 1:50:06.55` |
| `.1.3.6.1.2.1.1.4.0` | sysContact | `"Contact"` |
| `.1.3.6.1.2.1.1.5.0` | sysName | `"epon-olt"` |
| `.1.3.6.1.2.1.1.6.0` | sysLocation | `"Location"` |
| `.1.3.6.1.2.1.1.7.0` | sysServices | `6` |

### ifTable (1.3.6.1.2.1.2.2.1)

Standard MIB-II interface table.

| Col | OID | Field | Count | Sample | Min..Max | Unique |
|-----|-----|-------|-------|--------|----------|--------|
| 1 | `.1.3.6.1.2.1.2.2.1.1` | ifIndex | 415 | `1` | 1..415 | 415 |
| 2 | `.1.3.6.1.2.1.2.2.1.2` | ifDescr (interface name) | 415 | `" "` |  | 393 |
| 3 | `.1.3.6.1.2.1.2.2.1.3` | ifType | 415 | `6` | 1..6 | 2 |
| 4 | `.1.3.6.1.2.1.2.2.1.4` | ifMtu | 415 | `1500` | 1500..1500 | 1 |
| 5 | `.1.3.6.1.2.1.2.2.1.5` | ifSpeed | 415 | `1000000000` | 1000000000..1000000000 | 1 |
| 6 | `.1.3.6.1.2.1.2.2.1.6` | ifPhysAddress (MAC) | 415 | `80 14 A8 67 2A C2` |  | 2 |
| 7 | `.1.3.6.1.2.1.2.2.1.7` | ifAdminStatus | 415 | `1` | 1..1 | 1 |
| 8 | `.1.3.6.1.2.1.2.2.1.8` | ifOperStatus (1=up, 2=down) | 415 | `1` | 1..2 | 2 |
| 9 | `.1.3.6.1.2.1.2.2.1.9` | ifLastChange | 415 | `(2200) 0:00:22.00` |  | ? |
| 10 | `.1.3.6.1.2.1.2.2.1.10` | ifInOctets (RX bytes) | 415 | `1927273330` | 0..4273948535 | 298 |
| 11 | `.1.3.6.1.2.1.2.2.1.11` | ifInUcastPkts | 415 | `2137635886` | 0..3991819700 | 298 |
| 12 | `.1.3.6.1.2.1.2.2.1.12` | ifInNUcastPkts | 415 | `1069715` | 0..2251122 | 294 |
| 13 | `.1.3.6.1.2.1.2.2.1.13` | ifInDiscards | 415 | `0` | 0..47080 | 16 |
| 14 | `.1.3.6.1.2.1.2.2.1.14` | ifInErrors | 415 | `0` | 0..47080 | 16 |
| 15 | `.1.3.6.1.2.1.2.2.1.15` | ifInUnknownProtos | 415 | `0` | 0..0 | 1 |
| 16 | `.1.3.6.1.2.1.2.2.1.16` | ifOutOctets (TX bytes) | 415 | `396210732` | 0..4293847718 | 297 |
| 17 | `.1.3.6.1.2.1.2.2.1.17` | ifOutUcastPkts | 415 | `1793123752` | 0..3540126472 | 297 |
| 18 | `.1.3.6.1.2.1.2.2.1.18` | ifOutNUcastPkts | 415 | `11340381` | 0..11340381 | 230 |
| 19 | `.1.3.6.1.2.1.2.2.1.19` | ifOutDiscards | 415 | `0` | 0..0 | 1 |
| 20 | `.1.3.6.1.2.1.2.2.1.20` | ifOutErrors | 415 | `0` | 0..0 | 1 |
| 21 | `.1.3.6.1.2.1.2.2.1.21` | ifOutQLen | 415 | `0` | 0..0 | 1 |
| 22 | `.1.3.6.1.2.1.2.2.1.22` | ifSpecific | 415 | `.0.0` |  | ? |

**ONU virtual interfaces detected**: 391 (named like `EPON01ONU34`)


### Enterprise Tree (1.3.6.1.4.1.37950)

**Top-level subtrees:**

| Subtree | OIDs |
|---------|------|
| `.1.3.6.1.4.1.37950.1.1.5.12` (37950.1.1.5.12) | 24413 |
| `.1.3.6.1.4.1.37950.1.1.5.10` (37950.1.1.5.10) | 7611 |
| `.6.1.4.1.37950.1.1.5.12.1.25` (37950..6.1.4.1.37950.1.1.5.12.1.25) | 1 |

**ONU Registration Table (basic)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.2.1` (1741 OIDs in 5 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 349 | INTEGER(349) | `1` | 349 | _to be analyzed_ |
| 2 | 349 | INTEGER(349) | `100` | 4 | _to be analyzed_ |
| 3 | 348 | Hex-STRING(346), STRING(2) | `90 8D 78 4A D2 A1` | 2 | _to be analyzed_ |
| 4 | 348 | INTEGER(348) | `1` | 1 | _to be analyzed_ |
| 5 | 347 | STRING(347) | `"GE1"` | 288 | _to be analyzed_ |

**ONU Registration (extended, GPON only)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.5.1` (80 OIDs in 8 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 10 | INTEGER(10) | `1` | 10 | _to be analyzed_ |
| 2 | 10 | STRING(10) | `"00:13:25:00:07:00"` | 6 | _to be analyzed_ |
| 3 | 10 | INTEGER(10) | `100` | 1 | _to be analyzed_ |
| 4 | 10 | STRING(10) | `"epon 0/6"` | 5 | _to be analyzed_ |
| 5 | 10 | STRING(10) | `"epon 0/8"` | 5 | _to be analyzed_ |
| 6 | 10 | STRING(10) | `"2000/01/01 00:00:28"` | 10 | _to be analyzed_ |
| 7 | 10 | STRING(10) | `"2000/01/01 00:00:28"` | 10 | _to be analyzed_ |
| 8 | 10 | STRING(10) | `"1/0"` | 4 | _to be analyzed_ |

**ONU Per-MAC Mapping (EPON)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.8.1` (1388 OIDs in 4 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 347 | Hex-STRING(345), STRING(2) | `00 00 00 01 00 02` | 2 | _to be analyzed_ |
| 2 | 347 | INTEGER(347) | `4005` | 4 | _to be analyzed_ |
| 3 | 347 | INTEGER(347) | `1` | 1 | _to be analyzed_ |
| 4 | 347 | STRING(347) | `"EPON0/4:12"` | 288 | _to be analyzed_ |

**ONU Status Subtree** â€” `.1.3.6.1.4.1.37950.1.1.5.10.13.4.2.1` (510 OIDs in 6 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 85 | INTEGER(85) | `1` | 85 | _to be analyzed_ |
| 2 | 85 | STRING(85) | `"fan"` | 85 | _to be analyzed_ |
| 3 | 85 | INTEGER(85) | `0` | 2 | _to be analyzed_ |
| 4 | 85 | INTEGER(85) | `0` | 2 | _to be analyzed_ |
| 5 | 85 | INTEGER(85) | `0` | 2 | _to be analyzed_ |
| 6 | 85 | INTEGER(85) | `0` | 2 | _to be analyzed_ |

**ONU Live Status Table (EPON)** â€” `.1.3.6.1.4.1.37950.1.1.5.12.1.12.1` (5431 OIDs in 14 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 391 | INTEGER(391) | `0` | 391 | _to be analyzed_ |
| 2 | 391 | INTEGER(391) | `1` | 8 | _to be analyzed_ |
| 3 | 391 | INTEGER(391) | `1` | 76 | _to be analyzed_ |
| 4 | 391 | INTEGER(391) | `12` | 50 | _to be analyzed_ |
| 5 | 391 | INTEGER(391) | `1` | 2 | _to be analyzed_ |
| 6 | 391 | STRING(391) | `"14:a7:2b:e6:ca:c8"` | 373 | _to be analyzed_ |
| 7 | 391 | STRING(391) | `"V2801S"` | 17 | _to be analyzed_ |
| 8 | 391 | INTEGER(391) | `1` | 1 | _to be analyzed_ |
| 9 | 391 | INTEGER(391) | `0` | 1 | _to be analyzed_ |
| 10 | 391 | STRING(391) | `"NULL"` | 1 | _to be analyzed_ |
| 11 | 391 | Hex-STRING(322), STRING(69) | `14 A7 2B E6 CA C8 2C 01` | 1 | _to be analyzed_ |
| 12 | 391 | STRING(391) | `"NULL"` | 1 | _to be analyzed_ |
| 13 | 391 | INTEGER(391) | `1092` | 304 | _to be analyzed_ |
| 14 | 348 | STRING(348) | `"1GE"` | 37 | _to be analyzed_ |

**ONU Aggregated Stats (EPON)** â€” `.1.3.6.1.4.1.37950.1.1.5.12.1.25.1` (7385 OIDs in 19 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 391 | INTEGER(391) | `1` | 8 | _to be analyzed_ |
| 2 | 391 | INTEGER(391) | `1` | 76 | _to be analyzed_ |
| 3 | 391 | INTEGER(391) | `12` | 50 | _to be analyzed_ |
| 4 | 391 | INTEGER(391) | `1` | 2 | _to be analyzed_ |
| 5 | 391 | STRING(391) | `"14:a7:2b:e6:ca:c8"` | 373 | _to be analyzed_ |
| 6 | 391 | STRING(391) | `"V2801S"` | 17 | _to be analyzed_ |
| 7 | 391 | INTEGER(391) | `1` | 1 | _to be analyzed_ |
| 8 | 391 | INTEGER(391) | `0` | 1 | _to be analyzed_ |
| 9 | 391 | STRING(391) | `"NULL"` | 2 | _to be analyzed_ |
| 12 | 391 | INTEGER(391) | `1092` | 303 | _to be analyzed_ |
| 13 | 348 | STRING(348) | `"1GE"` | 37 | _to be analyzed_ |
| 14 | 391 | INTEGER(391) | `1` | 2 | _to be analyzed_ |
| 15 | 391 | INTEGER(391) | `0` | 3 | _to be analyzed_ |
| 16 | 391 | Gauge32(391) | `3` | 6 | _to be analyzed_ |
| 17 | 391 | Gauge32(391) | `1633` | 303 | _to be analyzed_ |
| 18 | 391 | STRING(391) | `"2000/01/23 13:13:01"` | 297 | _to be analyzed_ |
| 19 | 391 | STRING(391) | `"2000/01/23 13:13:01"` | 252 | _to be analyzed_ |
| 20 | 391 | STRING(391) | `"05:05:30"` | 301 | _to be analyzed_ |
| 21 | 390 | Gauge32(390) | `8227` | 14 | _to be analyzed_ |

## 10.10.10.200 â€” GPON V1600G1

**Walk sizes**: system=7 OIDs, iftable=6600 OIDs, enterprise=52193 OIDs

### System (1.3.6.1.2.1.1)

| OID | Field | Value |
|-----|-------|-------|
| `.1.3.6.1.2.1.1.1.0` | sysDescr | `"V1600G1"` |
| `.1.3.6.1.2.1.1.2.0` | sysObjectID | `.1.3.6.1.4.1.37950.1.1.5.10.14.1` |
| `.1.3.6.1.2.1.1.3.0` | sysUpTime | `(95700204) 11 days, 1:50:02.04` |
| `.1.3.6.1.2.1.1.4.0` | sysContact | `"Contact" .1.3.6.1.2.1.1.5.0 = ""` |
| `.1.3.6.1.2.1.1.6.0` | sysLocation | `"Location"` |
| `.1.3.6.1.2.1.1.7.0` | sysServices | `6` |

### ifTable (1.3.6.1.2.1.2.2.1)

Standard MIB-II interface table.

| Col | OID | Field | Count | Sample | Min..Max | Unique |
|-----|-----|-------|-------|--------|----------|--------|
| 1 | `.1.3.6.1.2.1.2.2.1.1` | ifIndex | 300 | `1` | 1..300 | 300 |
| 2 | `.1.3.6.1.2.1.2.2.1.2` | ifDescr (interface name) | 300 | `"GE0/1"` |  | 300 |
| 3 | `.1.3.6.1.2.1.2.2.1.3` | ifType | 300 | `6` | 1..53 | 3 |
| 4 | `.1.3.6.1.2.1.2.2.1.4` | ifMtu | 300 | `1500` | 1500..1500 | 1 |
| 5 | `.1.3.6.1.2.1.2.2.1.5` | ifSpeed | 300 | `1000000000` | 1000000000..1410065408 | 2 |
| 6 | `.1.3.6.1.2.1.2.2.1.6` | ifPhysAddress (MAC) | 300 | `14 A7 2B 06 3D 11` |  | ? |
| 7 | `.1.3.6.1.2.1.2.2.1.7` | ifAdminStatus | 300 | `1` | 1..1 | 1 |
| 8 | `.1.3.6.1.2.1.2.2.1.8` | ifOperStatus (1=up, 2=down) | 300 | `2` | 1..2 | 2 |
| 9 | `.1.3.6.1.2.1.2.2.1.9` | ifLastChange | 300 | `(1100) 0:00:11.00` |  | ? |
| 10 | `.1.3.6.1.2.1.2.2.1.10` | ifInOctets (RX bytes) | 300 | `0` | 0..2184393876 | 34 |
| 11 | `.1.3.6.1.2.1.2.2.1.11` | ifInUcastPkts | 300 | `0` | 0..3906027982 | 8 |
| 12 | `.1.3.6.1.2.1.2.2.1.12` | ifInNUcastPkts | 300 | `0` | 0..1303074 | 10 |
| 13 | `.1.3.6.1.2.1.2.2.1.13` | ifInDiscards | 300 | `0` | 0..0 | 1 |
| 14 | `.1.3.6.1.2.1.2.2.1.14` | ifInErrors | 300 | `0` | 0..80 | 6 |
| 15 | `.1.3.6.1.2.1.2.2.1.15` | ifInUnknownProtos | 300 | `0` | 0..0 | 1 |
| 16 | `.1.3.6.1.2.1.2.2.1.16` | ifOutOctets (TX bytes) | 300 | `0` | 0..3720070801 | 15 |
| 17 | `.1.3.6.1.2.1.2.2.1.17` | ifOutUcastPkts | 300 | `0` | 0..2147483647 | 6 |
| 18 | `.1.3.6.1.2.1.2.2.1.18` | ifOutNUcastPkts | 300 | `0` | 0..5240756 | 10 |
| 19 | `.1.3.6.1.2.1.2.2.1.19` | ifOutDiscards | 300 | `0` | 0..1 | 2 |
| 20 | `.1.3.6.1.2.1.2.2.1.20` | ifOutErrors | 300 | `0` | 0..0 | 1 |
| 21 | `.1.3.6.1.2.1.2.2.1.21` | ifOutQLen | 300 | `0` | 0..0 | 1 |
| 22 | `.1.3.6.1.2.1.2.2.1.22` | ifSpecific | 300 | `.0.0` |  | ? |

**ONU virtual interfaces detected**: 275 (named like `EPON01ONU34`)


### Enterprise Tree (1.3.6.1.4.1.37950)

**Top-level subtrees:**

| Subtree | OIDs |
|---------|------|
| `.1.3.6.1.4.1.37950.1.1.6.1` (37950.1.1.6.1) | 45253 |
| `.1.3.6.1.4.1.37950.1.1.5.10` (37950.1.1.5.10) | 6937 |
| `.1.3.6.1.4.1.37950.1.1.5.12` (37950.1.1.5.12) | 3 |

**ONU Registration Table (basic)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.2.1` (1250 OIDs in 5 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 250 | INTEGER(250) | `1` | 250 | _to be analyzed_ |
| 2 | 250 | INTEGER(250) | `100` | 2 | _to be analyzed_ |
| 3 | 250 | Hex-STRING(246), STRING(4) | `8C 13 E2 6A C3 93` | 4 | _to be analyzed_ |
| 4 | 250 | INTEGER(250) | `1` | 2 | _to be analyzed_ |
| 5 | 250 | STRING(250) | `"PON1"` | 3 | _to be analyzed_ |

**ONU Registration (extended, GPON only)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.5.1` (1548 OIDs in 6 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 258 | INTEGER(258) | `1` | 258 | _to be analyzed_ |
| 2 | 258 | INTEGER(258) | `100` | 1 | _to be analyzed_ |
| 3 | 258 | STRING(258) | `"8c:c7:c3:30:69:a0"` | 258 | _to be analyzed_ |
| 4 | 258 | INTEGER(258) | `1` | 1 | _to be analyzed_ |
| 5 | 258 | STRING(258) | `"2:14"` | 162 | _to be analyzed_ |
| 6 | 258 | STRING(258) | `"1:142"` | 42 | _to be analyzed_ |

**ONU Status Subtree** â€” `.1.3.6.1.4.1.37950.1.1.5.10.13.4.2.1` (540 OIDs in 6 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 90 | INTEGER(90) | `1` | 90 | _to be analyzed_ |
| 2 | 90 | STRING(90) | `"fan"` | 90 | _to be analyzed_ |
| 3 | 90 | INTEGER(90) | `0` | 2 | _to be analyzed_ |
| 4 | 90 | INTEGER(90) | `0` | 2 | _to be analyzed_ |
| 5 | 90 | INTEGER(90) | `0` | 2 | _to be analyzed_ |
| 6 | 90 | INTEGER(90) | `0` | 2 | _to be analyzed_ |

**GPON Phase State Table** â€” `.1.3.6.1.4.1.37950.1.1.6.1.1.1.1` (1375 OIDs in 5 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 275 | INTEGER(275) | `1` | 8 | _to be analyzed_ |
| 2 | 275 | INTEGER(275) | `1` | 120 | _to be analyzed_ |
| 3 | 275 | INTEGER(275) | `1` | 1 | _to be analyzed_ |
| 4 | 275 | INTEGER(275) | `1` | 2 | _to be analyzed_ |
| 5 | 275 | INTEGER(275) | `3` | 4 | _to be analyzed_ |

**GPON ONU Info Table (main)** â€” `.1.3.6.1.4.1.37950.1.1.6.1.1.4.1` (7150 OIDs in 26 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 275 | INTEGER(275) | `1` | 8 | _to be analyzed_ |
| 2 | 275 | INTEGER(275) | `1` | 120 | _to be analyzed_ |
| 3 | 275 | STRING(275) | `"MONU"` | 5 | _to be analyzed_ |
| 4 | 275 | STRING(275) | `"V5.2"` | 12 | _to be analyzed_ |
| 5 | 275 | STRING(275) | `"GPON30304543"` | 183 | _to be analyzed_ |
| 6 | 275 | INTEGER(275) | `0` | 1 | _to be analyzed_ |
| 7 | 275 | INTEGER(275) | `0` | 1 | _to be analyzed_ |
| 8 | 275 | INTEGER(275) | `1` | 1 | _to be analyzed_ |
| 9 | 275 | INTEGER(275) | `0` | 3 | _to be analyzed_ |
| 10 | 275 | INTEGER(275) | `128` | 6 | _to be analyzed_ |
| 11 | 275 | INTEGER(275) | `16` | 6 | _to be analyzed_ |
| 12 | 275 | INTEGER(275) | `2` | 3 | _to be analyzed_ |
| 13 | 275 | INTEGER(275) | `0` | 3 | _to be analyzed_ |
| 14 | 275 | STRING(275) | `"MONUV601"` | 15 | _to be analyzed_ |
| 15 | 275 | INTEGER(275) | `128` | 2 | _to be analyzed_ |
| 16 | 275 | INTEGER(275) | `1` | 1 | _to be analyzed_ |
| 17 | 275 | STRING(275) | `"MONUV601"` | 15 | _to be analyzed_ |
| 18 | 275 | STRING(275) | `"N/A"` | 1 | _to be analyzed_ |
| 19 | 275 | STRING(275) | `"64"` | 4 | _to be analyzed_ |
| 20 | 275 | STRING(275) | `"106460.00 s"` | 97 | _to be analyzed_ |
| 21 | 275 | STRING(275) | `"N/A"` | 1 | _to be analyzed_ |
| 22 | 275 | STRING(275) | `"N/A"` | 1 | _to be analyzed_ |
| 23 | 275 | INTEGER(275) | `0` | 1 | _to be analyzed_ |
| 24 | 275 | STRING(275) | `"GPON0/1:1"` | 275 | _to be analyzed_ |
| 25 | 275 | STRING(275) | `"V1.1.9          "` | 19 | _to be analyzed_ |
| 26 | 275 | STRING(275) | `"V1.1.9          "` | 20 | _to be analyzed_ |

## 10.10.10.210 â€” GPON V1600G1B

**Walk sizes**: system=0 OIDs, iftable=0 OIDs, enterprise=49574 OIDs

### System (1.3.6.1.2.1.1)

| OID | Field | Value |
|-----|-------|-------|

### Enterprise Tree (1.3.6.1.4.1.37950)

**Top-level subtrees:**

| Subtree | OIDs |
|---------|------|
| `.1.3.6.1.4.1.37950.1.1.6.1` (37950.1.1.6.1) | 34425 |
| `.1.3.6.1.4.1.37950.1.1.5.10` (37950.1.1.5.10) | 15146 |
| `.1.3.6.1.4.1.37950.1.1.5.12` (37950.1.1.5.12) | 3 |

**ONU Registration Table (basic)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.2.1` (2975 OIDs in 5 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 595 | INTEGER(595) | `1` | 595 | _to be analyzed_ |
| 2 | 595 | INTEGER(595) | `100` | 2 | _to be analyzed_ |
| 3 | 595 | Hex-STRING(595) | `B0 A7 B9 79 D6 99` | ? | _to be analyzed_ |
| 4 | 595 | INTEGER(595) | `1` | 1 | _to be analyzed_ |
| 5 | 595 | STRING(595) | `"PON4:ONU73"` | 579 | _to be analyzed_ |

**ONU Registration (extended, GPON only)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.5.1` (4144 OIDs in 7 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 592 | INTEGER(592) | `1` | 592 | _to be analyzed_ |
| 2 | 592 | INTEGER(592) | `100` | 2 | _to be analyzed_ |
| 3 | 592 | STRING(592) | `"b0:a7:b9:79:d6:99"` | 592 | _to be analyzed_ |
| 4 | 592 | INTEGER(592) | `1` | 1 | _to be analyzed_ |
| 5 | 592 | STRING(592) | `"4:73"` | 578 | _to be analyzed_ |
| 6 | 592 | STRING(592) | `"1:217"` | 115 | _to be analyzed_ |
| 7 | 592 | STRING(592) | `"MONU00e65141"` | 578 | _to be analyzed_ |

**ONU Per-MAC Mapping (EPON)** â€” `.1.3.6.1.4.1.37950.1.1.5.10.3.8.1` (232 OIDs in 8 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 29 | INTEGER(29) | `1` | 29 | _to be analyzed_ |
| 2 | 29 | STRING(29) | `"50:2B:73:65:17:F0"` | 29 | _to be analyzed_ |
| 3 | 29 | INTEGER(29) | `100` | 1 | _to be analyzed_ |
| 4 | 29 | STRING(29) | `"GPON 0/1"` | 5 | _to be analyzed_ |
| 5 | 29 | STRING(29) | `"GPON 0/1"` | 5 | _to be analyzed_ |
| 6 | 29 | STRING(29) | `"2026/04/08 21:13:18"` | 26 | _to be analyzed_ |
| 7 | 29 | STRING(29) | `"2026/04/08 21:13:18"` | 26 | _to be analyzed_ |
| 8 | 29 | STRING(29) | `"1/0"` | 1 | _to be analyzed_ |

**ONU Status Subtree** â€” `.1.3.6.1.4.1.37950.1.1.5.10.13.4.2.1` (636 OIDs in 6 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 106 | INTEGER(106) | `1` | 106 | _to be analyzed_ |
| 2 | 106 | STRING(106) | `"fan"` | 106 | _to be analyzed_ |
| 3 | 106 | INTEGER(106) | `0` | 2 | _to be analyzed_ |
| 4 | 106 | INTEGER(106) | `0` | 2 | _to be analyzed_ |
| 5 | 106 | INTEGER(106) | `0` | 2 | _to be analyzed_ |
| 6 | 106 | INTEGER(106) | `0` | 2 | _to be analyzed_ |

**GPON Phase State Table** â€” `.1.3.6.1.4.1.37950.1.1.6.1.1.1.1` (7392 OIDs in 11 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 672 | INTEGER(672) | `1` | 8 | _to be analyzed_ |
| 2 | 672 | INTEGER(672) | `1` | 128 | _to be analyzed_ |
| 3 | 672 | INTEGER(672) | `1` | 1 | _to be analyzed_ |
| 4 | 672 | INTEGER(672) | `1` | 2 | _to be analyzed_ |
| 5 | 672 | INTEGER(672) | `3` | 6 | _to be analyzed_ |
| 6 | 672 | INTEGER(672) | `1` | 1 | _to be analyzed_ |
| 7 | 672 | STRING(672) | `"N/A"` | 3 | _to be analyzed_ |
| 8 | 672 | STRING(672) | `"2026:04:30 18:11:40"` | 500 | _to be analyzed_ |
| 9 | 672 | STRING(672) | `"2026:04:30 18:10:29"` | 230 | _to be analyzed_ |
| 10 | 672 | STRING(672) | `"Power Off"` | 4 | _to be analyzed_ |
| 11 | 672 | STRING(672) | `"21:24:05"` | 500 | _to be analyzed_ |

**GPON ONU Info Table (main)** â€” `.1.3.6.1.4.1.37950.1.1.6.1.1.4.1` (17509 OIDs in 27 columns)

| Col | Count | Type | Range / Sample | Unique | Likely meaning |
|-----|-------|------|----------------|--------|----------------|
| 1 | 672 | INTEGER(672) | `1` | 8 | _to be analyzed_ |
| 2 | 672 | INTEGER(672) | `1` | 128 | _to be analyzed_ |
| 3 | 582 | STRING(582) | `"MONU"` | 73 | _to be analyzed_ |
| 4 | 582 | STRING(582) | `"V4.1"` | 83 | _to be analyzed_ |
| 5 | 582 | STRING(582) | `"GPON009ed228"` | 582 | _to be analyzed_ |
| 6 | 672 | INTEGER(672) | `0` | 1 | _to be analyzed_ |
| 7 | 672 | INTEGER(672) | `0` | 1 | _to be analyzed_ |
| 8 | 672 | INTEGER(672) | `1` | 2 | _to be analyzed_ |
| 9 | 672 | INTEGER(672) | `0` | 4 | _to be analyzed_ |
| 10 | 672 | INTEGER(672) | `127` | 10 | _to be analyzed_ |
| 11 | 672 | INTEGER(672) | `31` | 6 | _to be analyzed_ |
| 12 | 672 | INTEGER(672) | `2` | 2 | _to be analyzed_ |
| 13 | 672 | INTEGER(672) | `1` | 3 | _to be analyzed_ |
| 14 | 582 | STRING(582) | `"MONUH223"` | 85 | _to be analyzed_ |
| 15 | 672 | INTEGER(672) | `128` | 4 | _to be analyzed_ |
| 16 | 672 | INTEGER(672) | `1` | 2 | _to be analyzed_ |
| 17 | 672 | STRING(672) | `"N/A"` | 1 | _to be analyzed_ |
| 18 | 672 | STRING(672) | `"N/A"` | 1 | _to be analyzed_ |
| 19 | 672 | STRING(672) | `"127"` | 5 | _to be analyzed_ |
| 20 | 672 | STRING(672) | `"79068 s"` | 279 | _to be analyzed_ |
| 21 | 672 | STRING(672) | `"0"` | 1 | _to be analyzed_ |
| 22 | 672 | Hex-STRING(672) | `4E 2F 41 00` | ? | _to be analyzed_ |
| 23 | 672 | INTEGER(672) | `0` | 1 | _to be analyzed_ |
| 24 | 672 | STRING(672) | `"GPON0/1:1"` | 672 | _to be analyzed_ |
| 25 | 582 | STRING(581), Hex-STRING(1) | `"V2.1.07"` | 94 | _to be analyzed_ |
| 26 | 582 | STRING(582) | `"V2.1.07"` | 95 | _to be analyzed_ |
| 27 | 577 | STRING(577) | `"Thu Apr 30 18:11:03 2026"` | 284 | _to be analyzed_ |