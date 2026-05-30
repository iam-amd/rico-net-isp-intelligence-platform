# Module Status Matrix

Date: 2026-05-10
Status: initial classification

This matrix classifies each major part of the repo so future work can be aimed instead of scattered.

## Status Legend

| Status | Meaning |
| --- | --- |
| Production Core | Required for daily Rico Net operation. |
| Production Support | Useful and should stay, but not the central runtime. |
| Repair Needed | Keep and improve; logic or structure is not clean enough yet. |
| Experimental | Do not deploy as core until promoted. |
| Future | Planned, but not current priority. |
| Archive Candidate | Reference only unless owner approves restoration. |

## Top-Level Modules

| Module | Current Role | Status | Main Risk | Next Action |
| --- | --- | --- | --- | --- |
| `backend/` | FastAPI brain, DB, APIs, workers, ingest, NOC, tickets, survey, PG, prediction. | Production Core / Repair Needed | Too many responsibilities in one service layer without enough source-of-truth enforcement. | Audit binding usage, update docs, run tests/migrations, enforce confidence/freshness responses. |
| `frontend-pro/` | Admin console for CRM, tickets, technicians, collection, PG, admin NOC pages. | Production Core for admin / Production Support for NOC | Can compete with standalone NOC and duplicate command-room features. | Define it as admin/management UI; avoid new command-room-only features here. |
| `noc-dashboard/` | Standalone real-time NOC command-room dashboard. | Production Core / Repair Needed | Command-room surface is now clearer, but must keep frontend-pro from duplicating new NOC-only work. | Keep Orphan ONU Audit, Shift Brief, Maintenance, Alarms, and System Health as official NOC operator pages; continue build verification. |
| `mobile/` | Field technician app: tickets, survey, PG, offline work, live signal. | Production Core | Offline media and binding conflict handling need hardening. Native JWT storage now uses shared Expo SecureStore helper. | Test ticket-to-completion and survey-to-binding flows with real data. |
| `scraper/` | Railwire scraper, scheduler, dashboard, SQLite-to-Postgres sync. | Production Core | Railwire sync still needs careful monitoring, but runtime config/session state is outside repo and renewal recovery is implemented. | Monitor sync health, keep secrets rotated, and verify billing recovery during production trial. |
| `olt-proxy/` | Raspberry Pi OLT collector/proxy/trap receiver and OLT research tools. | Production Core / Repair Needed | Runtime files live beside research tools, but deployment now uses an explicit runtime manifest. | Keep `deploy_manifest.py` as the only production deploy file list; run manifest tests before Pi deploy. |
| `docs/` | Architecture, reports, manuals, runbooks. | Production Support / Repair Needed | Multiple documents conflict. | Promote realignment pack; mark stale docs as historical. |
| `_archive/` | Old or stale projects. | Archive Candidate | Git currently shows many renames; accidental restoration or deletion risk. | Leave alone until owner-approved cleanup pass. |
| `uploads/` | Media storage. | Production Core support | Backup/restore is now checked, and media audit reports missing referenced files, orphan files, and duplicate references. | Keep `/noc/media-audit` and System Health green before production trial. |
| `scripts/` | One-off DB/admin scripts. | Production Support / Repair Needed | Scripts may be old or unsafe if run blindly. | Inventory and label each script before use. |
| `data/`, `survey_lists/`, `logo/` | Supporting data/assets. | Production Support | Ownership unclear. | Document what is live vs reference. |

## Future Or Archived Product Modules

| Module | Current Role | Status | Direction |
| --- | --- | --- | --- |
| `prediction-engine/` | Previously planned standalone ML module, currently archived. | Future / Archive Candidate | Keep prediction in backend until core data is stable. |
| `customer-portal/` | Planned customer self-service, currently archived/future. | Future | Start only after NOC, binding, tickets, and billing data are reliable. |
| `snmp-pipeline/` | Older separate SNMP plan, archived. | Archive Candidate | Merge useful concepts into `olt-proxy/` and backend docs only. |
| `data-viewer/` | Audit/data utility, archived. | Archive Candidate | Restore only if a clear operator workflow needs it. |
| `railwire-scraper-service/` | Old scraper location, archived. | Archive Candidate | Keep `scraper/` as current scraper. |

## Production Runtime Boundary

The production runtime should be:

```text
backend
frontend-pro
noc-dashboard
mobile
scraper
olt-proxy
PostgreSQL
uploads/media storage
backup jobs
```

Everything else is support, reference, or future until explicitly promoted.

## Immediate Ownership Decisions

1. Standalone `noc-dashboard/` is the official command-room UI.
2. `frontend-pro/` is the official admin and management UI.
3. `backend/` is the only integration brain.
4. `mobile/` is the field-truth collection tool.
5. `scraper/` owns Railwire business data only.
6. `olt-proxy/` owns live OLT/ONU telemetry only.
7. `onu_bindings` is the trusted bridge between customer and network.
