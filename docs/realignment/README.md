# Rico Net Realignment Pack

Date: 2026-05-10
Purpose: turn the current monorepo into one production operating system, without rebuilding from zero.

This folder is the new planning baseline for the Rico Net system reset. It does not replace working code. It explains what the code is supposed to become, where each module belongs, what must be fixed, and how to move toward production in a controlled way.

## Why This Exists

Rico Net has grown by building many valuable pieces: backend, admin, mobile, scraper, OLT proxy, NOC dashboard, PG management, survey, predictions, and system health. The main problem is not lack of code. The problem is that the product center became blurry:

- Some docs describe old phases.
- Some modules are production-ready in parts and experimental in other parts.
- Some flows are built as screens but not yet complete as real office workflows.
- OLT, Railwire, mobile survey, tickets, and NOC are not yet governed by one clear operating model.

The correction is a realignment pass:

```text
Inventory current system
-> define final operating model
-> define departments and ownership
-> define real-world flows
-> identify gaps and risks
-> adjust existing code to match the model
-> test end-to-end
-> ship to production
```

## Documents

| File | Use |
| --- | --- |
| `01_MASTER_SYSTEM_BLUEPRINT.md` | The top-level product and architecture model. |
| `02_DEPARTMENT_SYSTEM_DESIGN.md` | Department-by-department responsibilities and boundaries. |
| `03_END_TO_END_FLOWS.md` | Real operating flows the system must support. |
| `04_GAP_ASSESSMENT.md` | Current logical, structural, and production risks. |
| `05_PRODUCTION_RECOVERY_PLAN.md` | The ordered plan to make the existing system production-grade. |
| `06_MODULE_STATUS_MATRIX.md` | Current module roles, risks, and next action. |
| `07_PRODUCTION_RUNBOOK.md` | Operator recovery steps and measurable health checks. |
| `08_DATA_PROVENANCE_AND_PRECEDENCE.md` | Field-level ownership, precedence, and write rules. |
| `09_EXTERNAL_REVIEW_DECISIONS.md` | Accepted/rejected decisions from external architecture review. |
| `13_PRODUCTION_FLOW_ACCEPTANCE_CHECKLIST.md` | Done/partial/pending control sheet for gates and operating flows. |

## Highest-Level Decision

Rico Net should be treated as one ISP operating system, not many separate apps.

```text
Railwire customer and billing data
+ OLT live network telemetry
+ field-verified ONT identity
+ ticket and dispatch workflow
+ NOC command-room visibility
+ PG and infrastructure mapping
= Rico Net operating system
```

## The Core System Truth

The central object is not just the customer and not just the ONU.

The central object is the trusted binding:

```text
Customer <-> ONT/ONU <-> OLT placement
```

If this binding is wrong, the rest of the system becomes unreliable. The NOC may show the wrong customer, tickets may diagnose the wrong device, predictions may become noise, and field staff may be sent with the wrong context.

## Status Labels Used In This Pack

| Label | Meaning |
| --- | --- |
| Production Core | Must work before daily office use. |
| Production Support | Useful, but can be improved after core flows work. |
| Repair Needed | Existing work is valuable but structurally or logically incomplete. |
| Experimental | Keep separate until it proves value. |
| Future | Do not prioritize now. |
| Archive Candidate | Keep in repo only for reference until owner approves removal. |

## Operating Rule

No major feature should be added until it can be placed inside one of the documented end-to-end flows.

## Production Reality Check

The current target is **production core**, not the full future system. Production core still requires hardening before daily use:

- one schema authority, preferably Alembic only;
- binding-first customer/network lookups;
- measurable backup and restore;
- WebSocket and ingest security hardening;
- alarm operator actions;
- source-of-truth guardrails for scraper, field survey, and admin edits;
- verified end-to-end flows with expected screen states and failure behavior.
