# External Review Decisions

Date: 2026-05-11
Reviewer: Claude, used as external architecture critic
Status: accepted/rejected decisions after Codex repo verification

## Verdict

The external review is mostly accepted. It correctly identified that the realignment pack was directionally right but too soft on measurable production gates.

The plan remains **no rebuild from zero**. The correction is to harden the existing system with explicit blockers, acceptance evidence, and source-of-truth enforcement.

## Accepted Critical Findings

| Finding | Decision |
| --- | --- |
| `create_all` + startup ALTERs + Alembic is a schema drift hazard. | Accepted. Runtime schema mutation is disabled by default, the historical no-op Alembic baseline now creates schema through Alembic, and fresh DB migration to `019` has been proven. |
| Customer network columns still act as binding fallback. | Accepted. Make `onu_bindings` authoritative and deprecate customer network columns. |
| Static shared ingest token is weak. | Accepted. Per-collector hashed credentials are implemented; production must create credentials and rotate Pi tokens. |
| WebSocket query-token and missing role checks are unsafe. | Accepted. Harden NOC/alarm WebSocket auth. |
| Alarm lifecycle needs operator actions. | Accepted. Add/verify ack, suppress, resolve, link-outage endpoints and audit. |
| Backup/restore plan was too vague. | Accepted. Add measurable backup and restore gates. |
| Scraper write precedence needs enforcement. | Accepted. Add data provenance/source precedence contract and tests. |
| PG/mobile offline conflict behavior needs explicit review flow. | Accepted. Add to future implementation and tests. |
| Field binding/reboot actions need proof and audit gates. | Accepted. Add visit-proof and role/assignment gates. |
| Runtime/research files in `olt-proxy/` are mixed. | Accepted. Separate production deploy list from tools/research. |

## Partially Accepted Or Corrected Findings

| Finding | Decision |
| --- | --- |
| Mobile JWT storage risk. | Partially accepted. Native uses Expo SecureStore; web fallback uses localStorage. Production mobile native path is acceptable, but web/mobile admin exposure must still be documented. |
| Collector identity conflated with OLT host. | Partially accepted. Current code has `collector_health` keyed by collector ID, but OLT health is still separate by host. The doc must ensure System Health distinguishes Pi/collector failure from OLT failure. |
| Watermark missing. | Accepted. Scraper still keeps the daemon watermark, and production now has `customer_sync_state` for per-customer CSV/detail/MAC timestamps and error status. |
| 1-3 days impossible for any production result. | Clarified. Full trustworthy production core is not a 1-3 day job; a supervised production trial or first hardening slice can be done in that window. |

## Rejected Or Deferred Findings

| Finding | Decision |
| --- | --- |
| Delete customer network columns immediately. | Deferred. They should become read-only fallback first, then removed after compatibility is proven. |
| Migrate frontend-pro NOC pages immediately. | Deferred. Freeze new NOC command-room features there, but do not migrate before data-layer cleanup. |
| Split backend services immediately. | Deferred. Monolith is acceptable for production core if schema/security/workflow gates are fixed. OCR worker split can be scheduled if memory or latency proves problematic. |

## Updated Execution Principle

Before adding product features:

1. Fix schema discipline.
2. Fix security gates.
3. Fix binding-first read/write paths.
4. Fix alarm operator lifecycle.
5. Prove backup/restore.
6. Then run end-to-end operating flows.

## Secret Audit Result - 2026-05-11

Private repository history contained prior scraper session files and an old shared ingest token string. Treat both as exposed in the private environment and rotate them outside this public showcase.

Required production action:

- Re-login Railwire scraper and replace the saved Playwright session file.
- Create per-collector backend credentials with `backend/scripts/upsert_collector_credential.py`.
- Rotate Pi `OLT_PROXY_TOKEN` and set `COLLECTOR_ID`.
- Keep `ALLOW_LEGACY_INGEST_TOKEN=false`.
