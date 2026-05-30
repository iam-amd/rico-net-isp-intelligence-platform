# Department System Design

Date: 2026-05-10
Status: realignment baseline

This document defines the operating departments inside Rico Net. A department is not always a company department; it is a product area with a clear job, owner, input, output, and system boundary.

## 1. Business Admin Department

### Purpose

Manage the business side of the ISP: customers, technicians, tickets, inventory, PG data, and corrections.

### Primary UI

`frontend-pro/`

### Backend Areas

- `customers`
- `tickets`
- `technicians`
- `inventory`
- `collection`
- `pg`
- `pole_groups`
- `audit`

### Owns

- Customer profile correction.
- Ticket and dispatch management.
- Technician roster.
- Inventory/spares.
- PG/building management.
- Survey review and correction.
- Manual verified binding approval.

### Must Not Own

- Raw OLT polling logic.
- Direct database edits outside backend APIs.
- Hidden network diagnosis rules in UI.

### Success Criteria

- Admin can correct wrong customer/network data with audit trail.
- Admin can see which customers are verified, probable, or unbound.
- Admin can review field survey evidence before trusting it.

## 2. NOC Operations Department

### Purpose

Make fast real-time decisions about network faults.

### Primary UI

`noc-dashboard/`

### Backend Areas

- `noc`
- `ws`
- `ingest`
- `alarm_service`
- `noc_service`
- `diagnosis_service`
- `onu_binding_service`
- system health endpoints

### Owns

- Live OLT/ONU view.
- Alarm feed.
- Outage triage.
- Customer DNA during calls.
- Weak/critical signal view.
- System freshness and collector health view.
- NOC global search and focus state.

### Must Not Own

- Customer master data editing beyond allowed operational actions.
- Long-form admin management.
- Scraper operations except health visibility.

### Success Criteria

- Operator can search a customer, phone, MAC, serial, OLT, PON, or room and immediately see operational context.
- Operator can tell whether data is fresh or stale.
- Operator can tell whether customer match is trusted or fallback.
- Operator can create or avoid a ticket based on diagnosis confidence.

## 3. Field Technician Department

### Purpose

Execute field work and collect trusted physical truth.

### Primary UI

`mobile/`

### Backend Areas

- `field_team`
- `tickets`
- `collection`
- `pg`
- `customers`
- media uploads

### Owns

- Assigned job execution.
- On-site status updates.
- Sticker photo capture.
- OCR/manual correction for serial, MAC, model.
- GPS capture.
- PG room/customer mapping.
- Resolution notes, materials, photos, audio.
- Binding evidence collection.

### Must Not Own

- Silent binding overwrite without evidence.
- Hidden business billing updates.
- Mass customer edits.

### Success Criteria

- Technician can work in poor network conditions.
- Ticket closure produces usable evidence.
- ONT identity capture becomes trusted data, not just notes.
- Survey updates do not destroy existing verified data.

## 4. Customer and Billing Data Department

### Purpose

Keep customer/account data fresh from Railwire.

### Primary Module

`scraper/`

### Backend Areas

- `customers`
- `customer_audit_log`
- `onu_bindings` with low/probable confidence only
- scraper health in NOC system health

### Owns

- Customer list import.
- Name, address, phone, email where available.
- Plan, expiry, balance, Railwire status.
- Framed IP and session/billing details where available.
- Scraper audit and run status.

### Must Not Own

- Field-verified binding overwrite.
- Live online/offline truth.
- Fault diagnosis.

### Success Criteria

- Nightly customer and billing data is fresh.
- Scraper failures are visible to operators.
- Railwire data improves profiles without corrupting verified network identity.

## 5. Network Collection Department

### Purpose

Collect live network state from OLTs safely and consistently.

### Primary Module

`olt-proxy/`

### Backend Areas

- `ingest`
- `onu_latest`
- `onu_snapshots`
- `alarm_events`
- `olt_health`
- `collector_health`

### Owns

- SNMP/Telnet/web transport selection.
- Poll cycles.
- Trap receiver.
- Local buffering.
- Collector heartbeat.
- OLT-specific parsing.
- On-demand proxy calls.

### Must Not Own

- Customer business logic.
- Ticket assignment.
- Final customer matching decisions.

### Success Criteria

- Each OLT reports latest data and heartbeat.
- Collector failure is distinguishable from OLT failure.
- Runtime files are separated from research/probe files.
- Duplicate or contradictory OLT writes are prevented.

## 6. Support and Ticketing Department

### Purpose

Turn complaints and faults into tracked work.

### Primary UIs

- Admin console ticket board.
- Mobile ticket workflow.
- NOC ticket/triage panels.

### Backend Areas

- `tickets`
- `diagnostics`
- `diagnosis_service`
- `field_tech_intel_service`
- `alarm_service`

### Owns

- Ticket state machine.
- Comments, media, audit.
- Duplicate complaint detection.
- Auto-diagnosis suggestions.
- Assignment and completion.

### Must Not Own

- Direct raw OLT parser logic.
- Billing source-of-truth.

### Success Criteria

- A customer complaint creates one clear work item or is linked to an existing outage.
- Ticket has customer, binding, live state, diagnosis, recommended action, and history.
- Closure updates operational knowledge.

## 7. Infrastructure and PG Department

### Purpose

Map physical customer locations and shared buildings.

### Primary UIs

- Admin PG pages.
- Mobile PG module.
- NOC PG building view.

### Backend Areas

- `pg`
- `pole_groups`
- `network_nodes`
- `node_outages`

### Owns

- Buildings, floors, rooms, router groups.
- PG owner/contact info.
- Room connection type.
- Room-to-customer/ONT mapping.
- Photos and change events.

### Must Not Own

- Network live state calculation.
- Customer billing state.

### Success Criteria

- NOC can see building/room impact during outages.
- Mobile can update PG data offline and sync safely.
- Room conflicts are visible and resolvable.

## 8. Prediction and Intelligence Department

### Purpose

Use history to recommend maintenance and customer-risk actions.

### Current Location

Backend workers and `prediction_service.py`

### Owns

- Health score.
- Fiber risk.
- Rx slope.
- Alarm/offline counts.
- Maintenance recommendations.

### Must Not Own

- Immediate production actions.
- Automatic dispatch without human approval.

### Success Criteria

- Predictions are labeled as recommendations, not truth.
- NOC/Admin can see why a device is risky.
- Prediction quality improves only after binding and history are trustworthy.

## 9. Platform Operations Department

### Purpose

Keep the system running.

### Owns

- Startup, environment, deployment.
- Database migrations.
- Backups and restore.
- Secrets handling.
- System health.
- Tests and build gates.

### Success Criteria

- One command/runbook can start each production service.
- Build and test gates are green.
- Database can be restored.
- Operators can see subsystem health without reading logs.

