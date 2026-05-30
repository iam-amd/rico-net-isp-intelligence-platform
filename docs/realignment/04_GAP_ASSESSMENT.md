# Gap Assessment

Date: 2026-05-10
Status: current known assessment, based on repo inspection and existing docs

## Executive Summary

The system has many valuable parts, but production clarity is blocked by four main gaps:

1. The source-of-truth model is not enforced strongly enough across all modules.
2. Current docs disagree with current code and deployment reality.
3. Runtime modules contain production code mixed with experiments and stale planning notes.
4. The most important workflow, trusted customer-to-ONT binding, exists but must become the center of every NOC/ticket/field flow.

This is a realignment problem, not a full rewrite problem.

## What Looks Strong

- Backend has a real service/API structure and many production domains.
- OLT ingest, latest state, alarms, collector health, and NOC APIs already exist.
- Mobile app has serious field workflows: ticket execution, survey, PG, offline queue.
- Admin console covers core office operations.
- NOC dashboard has more implementation than its stale README/CLAUDE suggests.
- Scraper has a reasonable architecture with scheduler, dashboard, SQLite, sync daemon.
- Existing docs contain important engineering history and hardware constraints.
- Archive folder already shows a cleanup direction has started.

## Major Logical Gaps

### 1. Binding Is Not Yet Treated As The Product Spine

Evidence:

- Older docs treated MAC as the bridge; current realignment docs make `onu_bindings` the bridge because Railwire MAC and OLT MAC may not match.
- `onu_bindings` exists and has trusted-binding improvements, but older customer fields still carry `mac_address`, `olt_host`, `pon_port`, `onu_index`.
- Some UI/data flows may still fall back to legacy/fuzzy matching.

Risk:

- Wrong customer shown for a network event.
- Wrong dispatch decision.
- False confidence in predictions and customer portal later.

Correction:

- Make `onu_bindings` the only authoritative bridge.
- Keep customer network columns as compatibility/display fields only until migrated.
- Every NOC/customer/ticket view must show match source and confidence.

### 2. Documentation Drift Is Severe

Evidence:

- Root AGENTS says some phases are not started, but code and newer docs show NOC, collector health, PG NOC, predictions, and trusted binding work.
- `noc-dashboard/CLAUDE.md` says NOT STARTED, while `noc-dashboard/src` has many implemented pages.
- Backend CLAUDE says 6 migrations in one section, but migrations now go to 014.
- OLT docs disagree over Telnet/SNMP status because they were written at different moments.

Risk:

- Future work follows stale plans.
- Production debugging uses wrong assumptions.
- New code repeats old mistakes.

Correction:

- Promote this realignment pack as the current planning baseline.
- Update module CLAUDE files after the realignment decisions.
- Mark old docs as history when they are not operational truth.

### 3. OLT Runtime and Research Files Are Mixed

Evidence:

- `olt-proxy/` contains runtime files, deployment files, OID dumps, probe scripts, debug scripts, temporary files, and discovery reports.

Risk:

- Wrong file deployed to Pi.
- Harder to know what is production.
- Higher chance of breaking collector during experiments.

Correction:

- Split `olt-proxy/` into clear areas:
  - `runtime/` or root production files.
  - `tools/` for probes.
  - `research/` for OID dumps and discovery.
  - `docs/` for reports.
- Update deploy scripts to upload only production files.

### 4. Admin NOC and Standalone NOC Roles Overlap

Evidence:

- `frontend-pro` has many `/noc/*` pages.
- `noc-dashboard` also has NOC pages and appears intended as the command-room default.

Risk:

- Operators do not know which screen is the real one.
- Fixes land in one NOC but not the other.
- Duplicate UX and API assumptions.

Correction:

- Define standalone `noc-dashboard/` as the command-room product.
- Keep admin NOC pages as management/support views or redirect to the standalone dashboard where appropriate.
- Do not build new command-room features twice.

### 5. Production Readiness Is Not One Gate

Evidence:

- There are test logs, build notes, and status docs, but no single acceptance checklist tying backend, admin, NOC, mobile, scraper, OLT, DB, and backup together.

Risk:

- A module can be "working" alone while the office flow still fails.

Correction:

- Production gate must be end-to-end workflow based.
- See `05_PRODUCTION_RECOVERY_PLAN.md`.

## Data Model Gaps To Resolve

| Area | Gap | Direction |
| --- | --- | --- |
| Device identity | ONT/ONU identity is spread across `onu_latest`, `onu_bindings`, customer columns, PG room fields. | Create a clean device identity model or enforce `onu_bindings` plus latest state as the interim model. |
| Binding lifecycle | Active/inactive exists, but every flow must obey it. | Add tests and UI labels for active binding source/confidence. |
| Freshness | NOC needs field-level or at least record-level freshness clarity. | Every live state response should include age/stale status. |
| Alarms | Lifecycle exists, but NOC actions need clear acknowledge/suppress/resolve semantics. | Add explicit operator actions where missing. |
| Collector health | Exists, but production runbook must map statuses to action. | Document and test failure scenarios. |
| Scraper sync | Must not overwrite verified field data. | Keep priority rules explicit and tested. |

## Structural Gaps To Resolve

| Area | Gap | Direction |
| --- | --- | --- |
| Docs | Many source-of-truth candidates. | Keep `docs/realignment` as planning baseline and update old docs. |
| Archive | Old projects are archived but git status shows many renames. | Finish archive decision later with owner approval. |
| Root files | Many screenshots and temporary artifacts in repo root. | Move verified artifacts to docs/assets or archive after approval. |
| Tests | Module tests exist, but workflow tests are not obvious. | Add scenario tests for binding, diagnosis, and NOC/customer flows. |
| Secrets | Credentials/session artifacts appear in docs/config references. | Rotate and move secrets out of tracked files before production. |

## Production Blockers

These should be fixed before calling the system production.

1. Choose one schema authority. Current backend has `Base.metadata.create_all`, startup `ALTER TABLE` tasks, and Alembic migrations. Production must converge on Alembic-only schema changes.
2. Make customer/network read paths binding-first. Legacy customer network columns must become read-only fallback until removed.
3. Harden WebSocket auth. Query-string JWTs and missing role checks are not acceptable for NOC/alarm channels.
4. Harden ingest auth. A single shared static ingest token should be replaced by per-collector credentials or explicitly deferred with a written Tailscale-only mitigation.
5. Add alarm operator actions: acknowledge, suppress, resolve, and link to outage, with audit fields and NOC UI support.
6. Automate backups and prove restore. A production gate must include `pg_dump`, `pg_restore` into a temporary DB, media backup, retention, and RTO/RPO.
7. Guard scraper writes so Railwire data cannot overwrite field-verified identity or binding truth.
8. Add visit-proof gates for field binding and reboot actions: evidence, GPS, assigned ticket/admin privilege, and audit.
9. Add maintenance windows so planned OLT work does not create false alarm floods.
10. Confirm collector heartbeat, per-OLT freshness, scraper scheduler/sync, database status, and media storage on System Health with operator actions.
11. Run a git-history secret audit for `.env*`, `railwire_auth_*.json`, tokens, and credentials; rotate anything that was committed.
12. Update stale module docs so operators do not follow wrong instructions.

## Recommended Product Focus

Do not prioritize customer portal or AI until these are true:

- At least most active customers have verified or admin-confirmed bindings.
- NOC can clearly show stale vs fresh data.
- Field ticket completion consistently captures evidence.
- Scraper and collector health are visible without reading logs.
- Backup/restore is proven.

## Measurable Gate Rule

Every blocker must have evidence. "Verify backups" is not enough. The gate must say what command was run, what file or screen proves it, and what result is acceptable.
