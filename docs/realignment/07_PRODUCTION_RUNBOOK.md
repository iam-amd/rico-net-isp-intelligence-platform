# Production Runbook

Date: 2026-05-11
Status: initial operator runbook

This runbook defines what operators should check when Rico Net is unhealthy. It must be kept practical and measurable.

## Operator Entry Point

Use the existing control panel as the local service launcher:

1. Run `run.bat` or `start_all.bat` from the repo root.
2. Open `http://localhost:9090`.
3. Use the service cards to start, stop, restart, and view logs.
4. Use the NOC Dashboard quick links for `System Health`, `Alarms`, `Maintenance`, `Shift Brief`, and `Media Audit`.
5. Use `stop.bat` or the panel `Stop All` button when ending a local run.

## Health States

| State | Meaning | Operator Action |
| --- | --- | --- |
| Green | Fresh data and subsystem responding. | No action. |
| Amber | Stale or degraded, but not fully down. | Watch, refresh, or restart the named service if stale beyond threshold. |
| Red | Down, unreachable, or no recent heartbeat. | Follow the recovery command for that component and create an incident note. |

## Required System Health Components

| Component | Green Condition | Red Condition |
| --- | --- | --- |
| Backend API | `/healthz` responds OK. | API unreachable or 5xx. |
| PostgreSQL | DB query succeeds. | Connection/query fails. |
| Collector heartbeat | Each collector heartbeat fresh within configured threshold. | Missing/stale heartbeat. |
| OLT freshness | Each active OLT has recent `last_snapshot_at`. | No fresh snapshot beyond threshold. |
| Scraper scheduler | Scheduler heartbeat fresh. | Heartbeat stale/missing. |
| Scraper sync | Last sync recent, no error, and `customer_sync_state` has no current error rows. | Sync stale/failed or per-customer sync errors exist. |
| Prediction worker | Last prediction run available if predictions enabled. | Stale run or failed worker. |
| Media storage | Upload directory exists, is writable, and media audit has no missing referenced files, duplicate references, or orphan files requiring review. | Missing/unwritable path, referenced media missing from disk, or audit cannot run. |
| WebSocket | Connection count visible and channels accept authenticated clients. | Channel errors or rejected valid clients. |

## Recovery: Backend Down

1. Check process/service running.
2. Check `.env` and `DATABASE_URL`.
3. Check PostgreSQL availability.
4. Restart backend.
5. Verify `/healthz`.
6. Verify NOC System Health turns green/amber.

Acceptance evidence: `/healthz` response and System Health screenshot/log.

## Recovery: PostgreSQL Down

1. Check PostgreSQL service.
2. Check disk space.
3. Restart PostgreSQL only if safe.
4. Run a simple `SELECT 1`.
5. Confirm backend reconnects.

Acceptance evidence: query succeeds and backend health is OK.

## Recovery: Collector Stale

1. Identify collector ID and affected OLTs from System Health.
2. SSH to the Raspberry Pi over Tailscale.
3. Check collector service status.
4. Check collector logs.
5. Restart collector only after confirming it is not mid-critical operation.
6. Run `python olt_poller.py --preflight` before leaving the collector running.
7. Run `sudo python trap_receiver.py --preflight` if trap receiver is part of the affected collector.
8. Confirm heartbeat updates.

Acceptance evidence: fresh `collector_health.last_heartbeat_at` and new OLT snapshot.

## Recovery: OLT Stale But Collector Alive

1. Check whether only one OLT is stale.
2. Check OLT power/network reachability from Pi.
3. Check SNMP/Telnet transport health.
4. Check planned maintenance window before treating as incident.
5. Restart only the affected collector path if collector isolation exists.

Acceptance evidence: OLT freshness returns or incident is logged as OLT-side fault.

## Recovery: Scraper Stale

1. Check scraper dashboard.
2. Check scheduler heartbeat.
3. Check session validity.
4. Regenerate Railwire session if expired.
5. Run sync daemon once.
6. Check `customer_sync_state` for rows where `last_status = 'error'`.

Acceptance evidence: fresh scraper run, PostgreSQL customer update/audit row, and no unexplained `customer_sync_state` error rows.

## Recovery: Billing Renewed But Ticket Still Open

1. Confirm Railwire account status and expiry are active/current.
2. Run scraper sync once if the latest sync is stale.
3. Check the customer ticket history for billing/account issue type, sub-issue, tags, or description.
4. Confirm the billing ticket is `Resolved` with an `auto_resolved` audit row.
5. Confirm any alarm tied to that ticket is `resolved` with `resolution_reason = billing_restored`.

Acceptance evidence: customer status/expiry current, ticket audit source is `railwire_sync`, and no stale billing alarm remains open.

## Orphan ONU Audit

1. Open NOC `Orphan ONUs`.
2. Review `No Customer`, `Inactive Customer`, and `Expired Billing` groups.
3. For no-customer ONUs, link to the correct customer only after confirming field/Railwire evidence.
4. For inactive/expired customers, confirm renewal or schedule disconnect.
5. Record the outcome in customer/ticket notes when the action changes service state.

Acceptance evidence: orphan count reduces or each remaining orphan has an assigned follow-up.

## PG Room Review Queue

1. Open NOC `PG Reviews`.
2. Compare current room identity against proposed offline identity.
3. Apply only when field evidence confirms the proposed username/MAC/serial/sticker is correct.
4. Dismiss when the server's current room identity is still correct.
5. Check the room history after action; it should show `review_applied` or `review_dismissed`.

Acceptance evidence: no stale offline PG identity change reaches customer profile or `onu_bindings` without a review event.

## Shift Handoff

1. Open NOC `Shift Brief` at shift change.
2. Read handoff actions first.
3. Review latest open alarms, overdue tickets, maintenance windows, orphan ONU count, and unhealthy system components.
4. Acknowledge/suppress/resolve alarms before leaving the shift when ownership is clear.
5. Pass unresolved blockers verbally or in the shift note with ticket/alarm IDs.

Acceptance evidence: next operator can identify current blockers from Shift Brief without reading raw logs.

## Recovery: Backup Failure

1. Run backup script manually.
2. Confirm `pg_dump` archive exists.
3. Run `pg_restore --list`.
4. Confirm `uploads/` mirror or manifest.
5. Record failure reason if restore cannot be tested.

Acceptance evidence: backup manifest with dump path, restore-list count, media count.

## Recovery: Media Storage Warning

1. Open NOC System Health and inspect `Media Storage`.
2. Open `GET /noc/media-audit` as an admin if sample paths are not enough.
3. For missing referenced files, restore the file from the latest backup before changing database rows.
4. For orphan files, confirm no active customer, ticket, binding, PG room, or technician references the file before cleanup.
5. For duplicate references, confirm whether shared proof media is intentional; otherwise move one owner to its own upload.

Acceptance evidence: System Health media status returns green or each remaining file is recorded with an owner decision.

## Minimum Backup Policy

- RPO target: 24 hours.
- RTO target: 2 hours for core database restore.
- Local retention: 7 daily backups.
- Off-host copy: weekly minimum, daily preferred.
- Restore drill: monthly.
- Current local schedule: Windows task `RicoNet Daily Backup` runs daily at 02:30 with `-RestoreToTempDb` and keeps 7 days locally. Manual scheduled-task run succeeded on 2026-05-11 with result `0`. Restore-proof backup `20260511-194747` passed with `temp_restore=passed` and `uploads_copied=true`; off-host copy is still required.

## OLT Proxy Deploy Safety

1. Before Pi deploy, run `python -m pytest -q test_deploy_manifest.py` inside `olt-proxy/`.
2. Use `quick_deploy.py` for normal production pushes; it reads `deploy_manifest.py`.
3. Do not add `_debug_*`, `probe_*`, `run_probe*`, result logs, `.tmp*`, or OID dump files to `RUNTIME_FILES`.
4. Run research probes explicitly, never through normal deploy.

Acceptance evidence: deploy manifest test passes and printed runtime file list contains only production runtime files.
