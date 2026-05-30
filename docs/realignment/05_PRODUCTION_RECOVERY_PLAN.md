# Production Recovery Plan

Date: 2026-05-10
Status: recommended execution plan

This is the ordered plan to turn the current codebase into a cleaner production system. It is not a rebuild. It is a controlled realignment and hardening pass.

Important: the first 1-3 days should produce a hardened production plan and the first critical fixes. A trustworthy production core is more realistically a focused multi-week effort unless the scope is narrowed to a supervised trial.

## Phase 0: Freeze The Direction

### Goal

Stop architecture drift.

### Actions

- Treat `docs/realignment/` as the current planning baseline.
- Update root `AGENTS.md` and module `CLAUDE.md` files after owner review.
- Mark older conflicting docs as historical or superseded.
- Do not start new large features until they map to an end-to-end flow.

### Exit Gate

- Everyone knows which document is the current source of truth.

## Phase 1: Production Inventory And Classification

### Goal

Know what is production, what needs repair, what is experimental, and what can wait.

### Actions

- Create a module status table in the root docs.
- Classify every top-level folder:
  - Production Core
  - Production Support
  - Repair Needed
  - Experimental
  - Future
  - Archive Candidate
- Separate runtime files from research/probe files in `olt-proxy/`.
- Review root screenshots/temp files and move them later only with owner approval.

### Exit Gate

- A developer can tell what to run, what to deploy, and what to ignore.

## Phase 2: Make Binding The Spine

### Goal

Make customer-to-ONT truth reliable.

### Actions

- Audit every place that joins customer to ONU.
- Prefer active `onu_bindings` everywhere.
- Keep legacy customer MAC/OLT fields as fallback only.
- Add response fields to NOC/customer/ticket APIs when missing:
  - `match_source`
  - `binding_confidence`
  - `binding_verified_at`
  - `binding_is_trusted`
  - `stale` / `age_seconds`
- Add tests for:
  - verified binding wins over Railwire binding
  - unlink deactivates stale binding
  - GPON serial-first identity
  - EPON MAC-first identity
  - duplicate binding conflict

### Exit Gate

- NOC and ticket views cannot silently show a customer match without source/confidence.

## Phase 3: Stabilize OLT And Scraper Operations

### Goal

Make data collection trustworthy and observable.

### Actions

- Confirm collector heartbeat for each active collector.
- Confirm all active OLTs report latest state.
- Confirm trap receiver deployment status.
- Confirm duplicate writes are controlled.
- Confirm scraper scheduler heartbeat and sync daemon.
- Add runbook links for common failures:
  - backend down
  - Pi down
  - OLT unreachable
  - collector stale
  - scraper session expired
  - DB unavailable

### Exit Gate

- NOC System Health identifies which subsystem failed and what operator should do.

## Phase 4: Complete The Core Real-World Flows

### Goal

Make the platform usable in daily operations.

### Required Flows

1. Customer calls internet down.
2. OLT alarm appears in NOC.
3. Admin creates/assigns ticket.
4. Technician executes and completes ticket.
5. Field survey verifies binding.
6. Scraper sync updates billing data.
7. Collector failure appears as stale data.
8. PG room/building mapping is visible in NOC.

### Actions

- Walk through each flow manually with real or seeded data.
- Fix broken links, missing API fields, and stale assumptions.
- Add minimal automated tests around backend decisions.
- Add UI labels where operators need confidence/freshness.

### Exit Gate

- Each flow can be demonstrated without explaining hidden manual steps.

## Phase 5: Production Hardening

### Goal

Make the system safe to run every day.

### Actions

- Run backend tests.
- Run frontend/admin build.
- Run NOC build.
- Run mobile tests/build as available.
- Run Alembic from clean DB to head.
- Test backup and restore.
- Check secrets and committed session files.
- Validate env examples.
- Create start/stop/recovery runbooks.
- Confirm media upload and backup path.

### Exit Gate

- A fresh machine can be set up from docs.
- A broken machine can be recovered from backup.
- A production checklist records command output or screenshots for each gate.

## Non-Negotiable Measurable Gates

These replace vague "verify" wording.

| Gate | Acceptance Evidence |
| --- | --- |
| Schema authority | `Base.metadata.create_all` and startup ALTER repair are disabled by default; production uses Alembic, with legacy repair flags documented. Fresh empty DB `alembic upgrade head` has been proven through revision `019`. |
| Schema equivalence | Fresh migrated DB reaches Alembic `019` and contains required runtime tables including customers, tickets, technicians, `onu_bindings`, `onu_latest`, `alarm_events`, `collector_credentials`, and `customer_sync_state`. |
| Backend tests | `python -m pytest -q` passes or failures are listed with owner-approved exceptions. |
| Admin build | `npm run build` in `frontend-pro/` passes. |
| NOC build | `npm run build` in `noc-dashboard/` passes. |
| Mobile tests/build | Available mobile tests pass; any Expo build limitations are recorded. |
| Binding-first | NOC/customer/ticket/field diagnosis APIs expose match source and confidence; verified binding wins over legacy customer columns in tests. |
| WebSocket auth | NOC/alarm WebSocket rejects missing/invalid/field-tech tokens and accepts Admin/Senior Tech tokens. |
| Ingest auth | Per-collector token rotation works with `collector_credentials`, `X-Collector-Id`, and hashed tokens; legacy shared-token fallback remains disabled unless explicitly enabled. |
| Alarm lifecycle | Operator can acknowledge, suppress, resolve, and link alarm to outage; action is audited. |
| Backup | `pg_dump --format=custom` succeeds, `pg_restore --list` succeeds, and one restore into a temp DB is tested. |
| Media backup | `uploads/` is copied or mirrored; manifest count matches source count; `/noc/media-audit` reports no missing referenced files. |
| Scraper guard | Test proves scraper sync cannot overwrite a field-verified binding or stronger customer identity field. |
| Scraper watermark | `customer_sync_state` records per-customer CSV/detail/MAC source timestamps and latest sync status; System Health shows error counts. |
| System Health | Page shows backend, DB, collectors, OLT freshness, scraper, prediction worker, media storage, and WebSocket count with red/amber/green states. |
| Secret audit | `git log --all --name-only` check is recorded for `.env*`, auth/session files, and known tokens; exposed secrets are rotated. |

## Phase 6: Production Trial

### Goal

Run real office operations in parallel with current manual process.

### Duration

7 to 14 days.

### Rules

- Do not rely on Rico Net alone for critical customer decisions during trial.
- Log every mismatch between software and real world.
- Fix binding and freshness issues before adding features.
- Record every operator confusion point.

### Exit Gate

- Office/NOC/field staff can use the system without constant developer explanation.

## Phase 7: Ship Production Core

### Goal

Declare a stable production version.

### Included

- Backend.
- Admin console.
- NOC dashboard.
- Mobile tech app.
- Scraper.
- OLT collector.
- Backup/runbook/system health.

### Excluded Or Limited

- Customer portal.
- Autonomous AI actions.
- Advanced prediction promises.
- Major cloud migration.

## First 15 Work Items

1. Update stale `noc-dashboard/CLAUDE.md` to match actual implementation.
2. Update backend docs to list migrations through current head.
3. Create a module status matrix.
4. Audit NOC/customer/ticket joins for active `onu_bindings`.
5. Add binding source/confidence to any API response that lacks it.
6. Add backend tests for binding precedence.
7. Separate OLT production deploy files from debug/probe files.
8. Verify scraper sync cannot downgrade verified bindings.
9. Add or update NOC stale/fresh display for live ONU data.
10. Keep WebSocket subprotocol auth role-gated and covered by regression tests.
11. Create production collector credentials and rotate Pi tokens.
12. Add alarm acknowledge/suppress/resolve/link-outage endpoints if missing.
13. Add backup automation and perform a restore proof.
14. Add data provenance/source precedence doc and tests for high-risk fields.
15. Run and record backend/admin/NOC/mobile verification gates.

## Production Acceptance Checklist

The system is ready for production core only when all are true:

- Backend starts cleanly and tests pass.
- DB migrations run cleanly to head.
- Admin console builds and can manage customers/tickets/technicians.
- NOC dashboard builds and shows summary, alarms, ONUs, health, search, and stale state.
- Mobile app can login, open ticket, update status, complete ticket, and submit survey.
- Scraper scheduler and sync daemon status are visible.
- OLT collector heartbeat and latest snapshot are visible.
- Active binding source/confidence is visible in NOC and ticket/customer context.
- Backups are tested.
- Secrets/session files are removed or rotated.

## Fast-Track Production Trial Scope

If the owner needs a 1-3 day outcome, the honest target is a **supervised production trial**, not full production.

Minimum trial constraints:

- Admin/NOC continue to cross-check critical decisions manually.
- No customer portal.
- No autonomous AI actions.
- No automatic destructive network actions without admin approval.
- Every mismatch is logged.
- Backup proof and secret audit are completed before trial.
- Binding confidence is visible anywhere a customer is matched to an ONU.

## Final Product Direction

After production core is stable, the next growth path should be:

1. Increase verified binding coverage.
2. Improve on-demand NOC refresh and hot customer view.
3. Improve alarm lifecycle and outage grouping.
4. Improve maintenance planning from predictions.
5. Add customer portal.
6. Add local AI assistant features only as recommendation layers.
