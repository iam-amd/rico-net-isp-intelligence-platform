# End-to-End Operating Flows

Date: 2026-05-10
Status: realignment baseline

This document defines the real-world flows Rico Net must support. A screen or API is only production-important if it serves one of these flows.

## Flow 1: Customer Calls "Internet Down"

### Goal

NOC or office staff should quickly decide whether to dispatch, wait, reboot, or explain a known outage.

### Flow

```text
Customer calls
-> operator searches phone/username/name
-> backend loads customer profile
-> backend resolves active trusted binding
-> backend loads latest ONU state, alarms, ticket history, billing status
-> NOC shows diagnosis with freshness and confidence
-> operator chooses action
```

### Decision Rules

| Condition | Action |
| --- | --- |
| Dying gasp or power-off reason | Call customer, do not dispatch immediately. |
| Rx below critical threshold | Dispatch with fiber kit/OTDR. |
| Online and signal healthy | Check router/PPPoE/WiFi. |
| Many ONUs on same PON/area offline | Create/link area outage, avoid duplicate tickets. |
| No trusted binding | Create review task or field verification step. |
| Data stale | Show stale warning and use on-demand refresh if available. |

### Required System Pieces

- Customer search.
- Active binding lookup.
- Latest ONU state.
- Alarm history.
- Ticket history.
- NOC diagnosis panel.
- Ticket creation/linking.

## Flow 2: OLT Alarm Happens

### Goal

Convert raw network events into actionable alarms without creating noise.

### Flow

```text
OLT event or poll threshold
-> collector sends alarm/snapshot to backend
-> backend normalizes event
-> backend deduplicates or updates open alarm
-> backend resolves customer through trusted binding
-> backend broadcasts to NOC WebSocket
-> NOC shows alarm with customer/link confidence
-> operator acknowledges, suppresses, links to outage, or creates ticket
```

### Required System Pieces

- Collector alarm sender.
- Ingest auth.
- Alarm lifecycle fields.
- Binding resolver.
- WebSocket push.
- NOC alarm feed.
- Acknowledge/suppress/resolve actions.

## Flow 3: Technician Executes Ticket

### Goal

Field technician gets enough context to solve the problem and returns clean evidence.

### Flow

```text
Ticket assigned
-> mobile shows pending job
-> tech opens ticket
-> backend returns briefing: customer, billing, ONU state, fault type, history
-> tech starts job
-> mobile records GPS/time
-> tech fixes issue
-> tech captures photos, notes, materials, signal after fix
-> tech completes ticket
-> backend stores closure and audit
```

### Required System Pieces

- Smart queue or assigned ticket list.
- Field briefing.
- Live ONU card.
- Area outage banner.
- Ticket state transitions.
- Media upload.
- Completion report.
- Audit trail.

## Flow 4: Field Survey Creates Trusted Binding

### Goal

Build the real customer-to-ONT map.

### Flow

```text
Tech opens survey/customer
-> captures GPS
-> captures ONT sticker photo
-> OCR extracts serial/MAC/model/vendor
-> tech confirms/corrects extracted values
-> backend checks duplicates/conflicts
-> backend creates or updates active ONUBinding
-> old stale binding is deactivated if needed
-> admin/NOC can see trusted status and evidence
```

### Required System Pieces

- Mobile survey form.
- Sticker photo upload.
- OCR endpoint.
- Duplicate/conflict detection.
- Binding confidence/source.
- Active/inactive binding lifecycle.
- Admin review.

## Flow 5: New Customer Onboarding

### Goal

Add a new customer into business, field, and network systems without later confusion.

### Flow

```text
Railwire adds customer
-> scraper imports customer
-> admin validates profile if needed
-> field install captures ONT sticker/GPS
-> backend creates trusted binding
-> OLT collector sees ONU placement
-> NOC/customer profile becomes fully linked
```

### Required System Pieces

- Scraper import.
- Customer profile.
- Survey/install workflow.
- Binding.
- OLT latest state.
- NOC visibility.

## Flow 6: PG Building Mapping

### Goal

Understand shared buildings, rooms, and routers so faults can be traced by physical grouping.

### Flow

```text
Admin or tech creates building
-> adds floors and rooms
-> maps room to customer or router group
-> captures ONT/router sticker details
-> syncs to backend
-> NOC sees room/building status from linked ONUs
```

### Required System Pieces

- PG building CRUD.
- Mobile offline PG store.
- Room conflict handling.
- Binding integration.
- NOC PG board.
- PG review queue for stale/offline identity changes.

### Offline Conflict Rule

If a mobile PG room sync proposes a customer/MAC/serial/sticker identity change that was collected before the server's latest room update, the backend must not silently overwrite the room. It flags the room and creates a `review_required` PG change event. An operator must apply or dismiss the review from the PG Reviews queue.

## Flow 7: Railwire Sync Runs

### Goal

Keep business data fresh without damaging verified network data.

### Flow

```text
Scheduler runs CSV/details/MAC jobs
-> scraper writes SQLite
-> sync daemon upserts PostgreSQL customers
-> audit log records changes
-> low-confidence Railwire binding can be created if no verified binding exists
-> scraper health visible in NOC
```

### Required System Pieces

- Session management.
- Scheduler heartbeat.
- Sync watermark.
- Customer upsert.
- Binding priority rules.
- Health endpoint/page.

## Flow 8: Collector or OLT Fails

### Goal

Operators should know whether the problem is backend, Pi collector, OLT, network path, or stale data.

### Flow

```text
Collector heartbeat missing or stale
-> backend marks collector stale
-> OLT latest state ages out
-> NOC System Health shows affected collector/OLT
-> NOC live views show stale data markers
-> operator follows recovery runbook
```

### Required System Pieces

- Collector heartbeat endpoint.
- OLT health table.
- System health page.
- Stale data display.
- Runbook.

## Flow 9: Prediction and Maintenance Planning

### Goal

Use history to reduce future faults.

### Flow

```text
Snapshots accumulate
-> retention aggregates hourly/daily
-> prediction worker computes health and risk
-> NOC/Admin sees maintenance candidates
-> admin schedules field work
-> technician work updates history
```

### Required System Pieces

- Snapshot retention.
- Aggregates.
- Prediction worker.
- Maintenance schedule view.
- Ticket/work order creation.

## Flow 10: Customer Renews or Tops Up

### Goal

When Railwire changes a customer from inactive/expired to active, NOC should stop chasing stale billing incidents.

### Flow

```text
Railwire account becomes active/current
-> scraper sync upserts customer billing fields
-> sync detects inactive/expired to active/current transition
-> billing/account tickets for that customer are auto-resolved
-> alarm events tied to those tickets are resolved as billing_restored
-> ticket audit records source=railwire_sync
```

### Required System Pieces

- Railwire sync daemon.
- Customer status/expiry comparison.
- Billing/account ticket tags or issue type.
- Ticket audit log.
- Alarm lifecycle resolution.

## Flow 11: Orphan ONU Audit

### Goal

Detect ONUs still consuming network capacity when the customer record is missing, inactive, or expired.

### Flow

```text
OLT latest table shows ONU
-> backend resolves trusted binding first, MAC offset fallback second
-> if no customer/inactive customer/expired billing, backend flags orphan ONU
-> NOC Orphan ONU Audit shows reason, customer, signal, and operator action
-> operator links customer, confirms renewal, or schedules disconnect
```

### Required System Pieces

- Binding-first ONU resolver.
- Orphan ONU endpoint.
- NOC Orphan ONU Audit page.
- Link ONU and billing review actions.

## Flow 12: Operator Shift Handoff

### Goal

The next NOC operator should know what matters without reading every page manually.

### Flow

```text
Shift changes
-> operator opens Shift Brief
-> backend summarizes open alarms, alarm mix, active tickets, overdue tickets
-> backend includes orphan ONU count, maintenance windows, and unhealthy components
-> operator follows handoff actions
```

### Required System Pieces

- Shift brief endpoint.
- NOC Shift Brief page.
- Alarm/ticket/orphan/maintenance/system-health sources.

## Flow 13: Planned OLT Maintenance

### Goal

Planned OLT work should not create false alarm floods.

### Flow

```text
Operator schedules OLT/port maintenance window
-> alarm processor checks active window before opening lifecycle alarm
-> matching alarms are suppressed with maintenance reason
-> NOC Maintenance page shows active/upcoming windows
-> Shift Brief includes current/upcoming work
```

### Required System Pieces

- `olt_maintenance_windows`.
- Alarm suppression check.
- NOC Maintenance page.
- Shift Brief integration.
