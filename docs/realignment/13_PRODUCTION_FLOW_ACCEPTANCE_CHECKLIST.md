# Production Flow Acceptance Checklist

Date: 2026-05-11
Status: working checklist after hardening pass

This checklist is the visual control sheet for the remaining production work. A flow is not fully production-ready until it has code coverage where practical and a manual operator walkthrough with real or seeded data.

## Status Legend

| Status | Meaning |
| --- | --- |
| Done | Implemented and verified by tests/build/smoke proof. |
| Partial | Core implementation exists, but one or more real-world proof steps remain. |
| Pending | Not yet proven enough for production use. |
| Deferred | Intentionally not part of current production core. |

## Current Production Gates

| Gate | Status | Evidence | Remaining Work |
| --- | --- | --- | --- |
| Schema authority | Done | Alembic fresh DB migration to `019` succeeded on temp DB; current DB is `019 (head)`. | Keep future schema changes Alembic-only. |
| Backend regression suite | Done | `python -m pytest -q` passed. | Keep suite green after every production slice. |
| NOC build | Done | `npm run build` in `noc-dashboard/` passed. | Manual browser walkthrough of NOC pages. |
| Admin build | Done | `npm run build` in `frontend-pro/` passed. | Manual admin ticket/customer flow walkthrough. |
| Mobile tests | Done | `npx jest --runInBand` passed. | Native device walkthrough for camera/GPS/media. |
| WebSocket auth | Done | Role-gated subprotocol auth covered by tests. | Verify through live NOC browser session. |
| Per-collector ingest auth | Done | Hashed `collector_credentials`, `/ingest/verify`, heartbeat tests. Local `riconet-olt` credential is active and full production smoke passes without skip flags. | Copy the rotated collector token to the real Pi env and run Pi preflight. |
| Alarm lifecycle | Done | Ack, suppress, resolve, link-outage backend/UI and seeded NOC alarm flow tests. | Browser walkthrough with real NOC UI. |
| Maintenance windows | Done | Table, alarm suppression, NOC page, tests. | Live planned-maintenance rehearsal. |
| Backup/restore | Partial | Automatic Windows task `RicoNet Daily Backup` ran on 2026-05-12 at 02:30 with result `0`. Manual backup `20260512-111149` has `temp_restore=passed`, `uploads_copied=true`, dump size 35,753,593 bytes, 351 restore-list entries, retention `7`, and off-disk copy to `G:\RicoNetBackups\20260512-111149`. Scheduled task now includes `-RestoreToTempDb -OffHostPath "G:\RicoNetBackups"`. | Configure real off-host copy to a second machine/location and run the first real off-host restore drill. |
| Media audit | Done | `/noc/media-audit` backend API, NOC `/media-audit` operator page, System Health signal, smoke check, and tests. Browser check on 2026-05-12 showed `missing=0`, `orphans=84`, `duplicates=35`. | Decide cleanup policy for old orphan files. |
| Binding-first logic | Done | Diagnosis and write-path tests pass; legacy columns are fallback. | Manual customer DNA/ticket walkthrough with mixed binding confidence. |
| Customer DNA decision fields | Done | Customer DNA exposes binding confidence/source and live ONU freshness with regression coverage. | Browser walkthrough with real customer. |
| Customer DNA audit visibility | Done | Customer DNA now includes recent customer audit rows, and the NOC customer page shows old value, new value, actor, and time for recent survey/admin changes. Backend regression and NOC build passed. | Confirm during the 10-customer field test that each survey update appears in NOC and Admin history. |
| Customer trial readiness verifier | Done | `scripts/customer_trial_readiness.ps1` checks real usernames through Railwire data, survey binding proof, fresh OLT snapshot, and NOC links, then writes `_runtime/readiness/customer_trial_readiness_latest.json`. Sample run on 2026-05-12 flagged `tn.revathi.r09` as `needs_survey_binding`, which matches the current data: Railwire fields exist, binding is only `probable`, and no live ONU snapshot is present. | Run it against the owner's 10+ real test usernames before and after survey mapping. |
| Scraper source guard | Done | Tests prove scraper does not overwrite verified binding and records `customer_sync_state`. | Rotate Railwire session and verify next real sync. |
| PG offline conflict review | Done | Backend review queue, NOC page, tests. | Manual mobile offline conflict walkthrough. |
| Normal customer vs PG building map model | Done | Mobile survey map now returns normal customer GPS pins plus one PG building GPS pin per PG building. PG room customers are excluded from normal customer pins, PG room sync no longer writes building GPS to each customer, Customer DNA can source map focus from the PG building, and NOC heatmap labels PG building-sourced locations. Regression test covers one-building-one-marker behavior. | Walk one normal customer and one PG building on the APK map. |
| OLT proxy deploy safety | Done | Manifest-based deploy and tests. | Run manifest test before real Pi deploy. |
| OLT proxy API auth | Done | `PROXY_TOKEN` is required for non-health proxy endpoints; missing/empty token is rejected and covered by tests. OLT Proxy API is listed in the control panel as an optional service. | Copy real `PROXY_TOKEN` to the Pi/private inventory before enabling proxy endpoints. |
| Collector/OLT stale visibility | Done | System Health regression test simulates stale collector and stale OLT and expects critical status. | Rehearse once with real Pi/OLT service stopped or isolated. |
| Scraper scheduler visibility | Done | System Health reports stale scheduler heartbeat age and tells the operator to start/restart Scraper Scheduler from the control panel; regression test covers the stale-message case. Scraper Scheduler was started from the control panel on 2026-05-12 and scraper dashboard reported fresh heartbeat. | Watch next scheduled Railwire job and refresh the Railwire session if it fails. |
| Secret hygiene | Partial | History audit found exposed Railwire session and old shared token; active docs/code scan is clean for the known old Pi/OLT password literals and obsolete shared-token wording. OLT collector preflight now fails when Telnet/web login credentials are required but missing. Scraper dashboard `/api/config` now masks account passwords and preserves masked passwords on save; tests and smoke cover this. | Rotate all exposed/old credentials in the real environment. |
| Production smoke script | Done | `scripts/production_smoke.ps1` checks Alembic head, control panel status/quick-link targets including OLT Proxy listing, backend/NOC read paths, media audit API, scraper secret masking, scraper scheduler freshness, backup manifest, scheduled task, per-collector ingest auth, and NOC proxy routes. Full path now passes with local `riconet-olt` credential and writes `_runtime/readiness/production_smoke_latest.json`. | Keep smoke green before every production trial and attach the latest JSON report to each trial note. |

## Live Connectivity Findings 2026-05-12

| Check | Result | Meaning |
| --- | --- | --- |
| Pi Tailscale SSH `100.x.x.x:22` | TCP reachable; SSH denied without private password/key. | Network path exists; Codex cannot run Pi commands until private access is provided locally. |
| Pi proxy `100.x.x.x:9000` | TCP reachable; `/healthz` times out. | Proxy port is open, but the service or its OLT health call is hanging. Needs Pi-side service/log check. |
| Direct OLT Telnet `.100/.200/.210:23` | TCP reachable from this PC. | OLT LAN path is available; polling is blocked by missing Telnet/web credentials, not by routing. |
| Local trap receiver preflight | Passed against `http://127.0.0.1:8000`. | Collector auth and backend ingest path are valid for traps. |
| Local OLT poller preflight | Failed only on `OLT_TELNET_USER` / `OLT_TELNET_PASSWORD`. | Do not start real polling until those credentials are added from private inventory. |

## End-To-End Flow Status

| Flow | Status | Current Evidence | Pending Proof |
| --- | --- | --- | --- |
| 1. Customer calls internet down | Partial | Customer DNA, binding-first diagnosis, OLT latest freshness, alarms, tickets, and decision fields exist. | Browser search-to-decision walkthrough with real/staged customer. |
| 2. OLT alarm happens | Partial | Ingest auth, trap receiver preflight, retry-queue preservation test, alarm lifecycle, WebSocket, NOC alarm actions, and seeded alarm API flow test exist. | Browser/live collector alarm should appear in NOC and be handled by operator. |
| 3. Technician executes ticket | Partial | Ticket state machine, mobile queue/tests, media upload, completion logic exist. | Native mobile GPS/camera/completion walkthrough. |
| 4. Field survey creates trusted binding | Partial | Collection write path creates `onu_bindings`, provenance, duplicate checks. | Native survey with photo/OCR/GPS against real customer. |
| 5. New customer onboarding | Partial | Scraper import, customer profile, binding, OLT visibility exist. | Walk one new/staged customer from Railwire import to verified binding. |
| 6. PG building mapping | Partial | PG CRUD, offline conflict review, NOC PG review queue exist. | Mobile offline PG room edit, conflict, operator apply/dismiss walkthrough. |
| 7. Railwire sync runs | Partial | Runtime state outside repo, sync daemon smoke test, `customer_sync_state`, scraper guard tests. | Real Railwire session rotation and successful sync cycle with fresh data. |
| 8. Collector or OLT fails | Partial | Collector heartbeat, OLT health, System Health, runbook, and stale simulation test exist. | Rehearse once against real Pi/OLT service. |
| 9. Prediction and maintenance planning | Deferred | Prediction tables/service exist inside backend. | Needs stable 30-day snapshot history before production use. |
| 10. Customer renews/topups | Partial | Sync daemon auto-resolves billing tickets/alarms. | Seed or real inactive-to-active renewal walkthrough. |
| 11. Orphan ONU audit | Done | Endpoint, NOC page, tests. | Operator cleanup decisions still manual. |
| 12. Operator shift handoff | Done | Endpoint, NOC page, tests. | Use during one real shift change. |
| 13. Planned OLT maintenance | Done | Maintenance windows, suppression, page, tests. | Rehearse before next real firmware/reboot window. |

## Production Trial Pending List

1. Rotate real secrets: Railwire session, Pi ingest tokens, admin/test passwords, DB password, OLT/Pi credentials.
2. Configure real off-host backup copy to a second machine/location and run monthly restore drill.
3. Copy the existing production collector token and proxy token to the real Pi/private inventory.
4. Run one live scraper sync after Railwire re-login and confirm `customer_sync_state`.
5. Run one browser/live collector alarm through NOC from open to resolution.
6. Run one native mobile ticket completion with GPS, media, and final signal proof.
7. Run one native field survey that creates a verified `onu_bindings` row.
8. Rehearse collector stale/OLT stale against the real Pi/OLT service and confirm System Health/operator actions.
9. Rehearse one planned maintenance window so alarm suppression is trusted.
10. Keep customer portal and standalone prediction expansion deferred until NOC/binding/ticket data is stable.
