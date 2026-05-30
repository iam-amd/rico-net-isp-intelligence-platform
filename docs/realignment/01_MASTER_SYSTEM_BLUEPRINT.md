# Master System Blueprint

Date: 2026-05-10
Status: realignment baseline

## 1. Product Definition

Rico Net is an ISP intelligence and operations platform for Booto Cable Network. Its purpose is to move the business from manual reaction to structured, data-driven operation.

The system should answer four daily questions:

1. Who is the customer and what is their business status?
2. What is happening to their fiber/ONT right now?
3. What action should office/NOC/field staff take?
4. What history should be stored so future issues become easier to solve?

## 2. Product Boundaries

Rico Net is not just a CRM, not just an OLT dashboard, and not just a ticketing app. It is the operating layer above all of them.

### In Scope

- Customer CRM and billing visibility.
- Railwire data sync.
- OLT/ONU live telemetry.
- Trusted customer-to-ONT binding.
- Ticket creation, assignment, field execution, and closure.
- NOC monitoring and alarm triage.
- Technician mobile workflows.
- PG/building/room mapping.
- System health for backend, database, scraper, collectors, and workers.
- Historical signal and prediction foundation.

### Not Primary Right Now

- Customer portal.
- AI automation that takes actions without human approval.
- Full ML prediction accuracy.
- Public cloud migration.
- Billing collection automation beyond visibility.

These are future work after the operating spine is stable.

## 3. System Principle

Each source has one primary job:

| Source | Owns |
| --- | --- |
| Railwire scraper | Customer identity, plan, expiry, balance, billing/session details. |
| OLT collector | Live network device state: status, Rx, Tx, temperature, voltage, alarms. |
| Mobile survey | Field truth: sticker photo, serial, MAC, model, GPS, room/building context. |
| Backend | Validation, business rules, trusted joins, audit, storage, APIs. |
| Admin console | Management and correction. |
| NOC dashboard | Real-time operations and command-room decisions. |
| Mobile app | Field execution and evidence collection. |

The backend is the only trusted integration layer. Frontends must not become parallel brains.

## 4. Canonical Data Model

The system should organize data into these domains.

| Domain | Meaning | Current Location |
| --- | --- | --- |
| Customer Identity | Name, username, phone, address, billing status, plan. | `customers`, `customer_phones` |
| Device Identity | ONT/ONU serial, MAC, model, vendor, sticker proof. | partly `customers`, `onu_bindings`, PG room fields |
| Binding | Which customer owns which ONT/ONU. | `onu_bindings` |
| OLT Placement | OLT host, PON port, ONU index, collector identity. | `onu_latest`, `onu_snapshots`, `onu_bindings` |
| Live Network State | Online/offline, Rx, Tx, temp, voltage, dying gasp. | `onu_latest` |
| Network History | Time-series and aggregates. | `onu_snapshots`, `onu_hourly`, `onu_daily` |
| Events and Alarms | Faults, state transitions, outages. | `alarm_events`, `onu_state_events`, outage tables |
| Tickets and Work | Customer complaints and field jobs. | `tickets`, comments, media, audit |
| Physical Infrastructure | PGs, poles, buildings, floors, rooms. | `pg_*`, `pole_groups`, `network_nodes` |
| Predictions | Health score and maintenance recommendations. | `predictions` |

## 5. Most Important Entity: Binding

The trusted binding links business identity to network identity.

```text
Customer(username)
  -> active ONUBinding
  -> ONU/ONT identity
  -> OLT placement
  -> latest live state
  -> alarms, tickets, history
```

Binding priority should be:

1. Field-verified sticker photo plus technician confirmation.
2. Admin-verified correction with evidence.
3. OLT placement confirmed during a ticket or survey.
4. Railwire scraped MAC as probable only.
5. Fuzzy/legacy match only as a clearly labeled fallback.

The UI must always distinguish trusted matches from fallback matches.

## 6. Target Runtime Architecture

```text
Railwire Portal
  -> scraper
  -> scraper SQLite
  -> sync_daemon
  -> PostgreSQL

OLT Hardware
  -> Raspberry Pi collector/proxy
  -> backend ingest APIs
  -> PostgreSQL latest, history, alarms, collector health

Technician Phone
  -> mobile app
  -> backend survey/ticket APIs
  -> sticker media, GPS, ONT identity, binding

Office Admin Browser
  -> admin console
  -> backend APIs

NOC Screen
  -> noc-dashboard
  -> backend NOC APIs and WebSockets

Backend Workers
  -> retention, aggregation, prediction, watchdog, health checks
```

## 7. Application Roles

| Module | Role | Status |
| --- | --- | --- |
| `backend/` | Production brain and service layer. | Production Core, repair needed around clean ownership and startup migration discipline. |
| `frontend-pro/` | Admin console. | Production Support, should stop being the main NOC surface. |
| `noc-dashboard/` | Command-room live dashboard. | Production Core for network operations, docs are stale and must be updated. |
| `mobile/` | Technician execution and field truth. | Production Core, binding and offline media edge cases need hardening. |
| `scraper/` | Railwire import and sync. | Production Core, must be monitored and secrets/session files handled safely. |
| `olt-proxy/` | Local OLT collector and proxy. | Production Core, needs runtime/discovery file separation and trap/service verification. |
| `prediction-engine/` | Future separate ML if needed. | Future/Archive Candidate; current prediction is inside backend. |
| `customer-portal/` | Customer self-service. | Future. |
| `_archive/` | Old experiments/reference. | Archive Candidate only. |

## 8. What Production Means

Production does not mean every future feature exists. It means the office can use the system daily without confusion.

Minimum production outcome:

- Admin can manage customers, tickets, technicians, PG/building data.
- Scraper keeps customer/billing data fresh and visible.
- OLT collectors send latest state, history, alarms, and heartbeats.
- NOC can identify whether a customer issue is likely power, fiber, device, area, or unknown.
- Mobile tech can execute ticket, collect evidence, and verify binding.
- Backend stores history and audit trail for every important change.
- Operators can see stale data and subsystem failures clearly.
- Backups and restore have been tested.

## 9. Non-Negotiable Architecture Rules

1. Backend owns business logic.
2. Frontends render and collect user intent; they do not decide core truth.
3. Every workflow must be auditable.
4. Every live network value must expose freshness.
5. Every customer-to-ONU match must expose confidence/source.
6. Railwire billing data must not overwrite field-verified network truth.
7. OLT data wins for live state.
8. Field survey wins for physical identity.
9. Scraper data wins for billing/account data.
10. Old experiments stay isolated until explicitly promoted.

