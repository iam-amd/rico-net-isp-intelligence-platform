# Data Provenance And Source Precedence

Date: 2026-05-11
Status: initial source-of-truth contract

This document turns the repeated rule "Railwire wins for billing, OLT wins for live state, field wins for identity" into enforceable field ownership.

## Source Classes

| Source | Trust Area |
| --- | --- |
| Railwire scraper | Billing/account data and imported customer details. |
| OLT collector | Live ONU/ONT state and OLT placement observed by hardware. |
| Mobile field survey | Physical identity, GPS, sticker evidence, PG/room truth. |
| Admin console | Human correction with audit trail. |
| Backend workers | Derived state, alarms, predictions, aggregates. |

## Field Ownership

| Field Group | Primary Writer | Allowed Secondary Writer | Notes |
| --- | --- | --- | --- |
| Customer username/account ID | Railwire/Admin | None after creation except admin correction. | Must be auditable. |
| Customer name/phone/email/address | Railwire | Admin/field correction | Field/admin corrections must not be silently overwritten by scraper. |
| Plan, expiry, balance, Railwire status | Railwire | Admin note only | Scraper owns these; per-customer source timestamps are tracked in `customer_sync_state`. |
| Framed IP/session details | Railwire | None | Stale if scraper stale; latest sync status is visible through System Health. |
| Live status/Rx/Tx/temp/voltage | OLT collector | Trap/event updates | Customer/admin/mobile cannot write live state. |
| OLT host/PON/ONU index | OLT collector / verified binding | Admin verified correction | Customer legacy fields are fallback only. |
| ONT serial/MAC/model/vendor | Mobile field survey | Admin verified correction, OLT where reliable | Requires source and confidence. |
| Customer-to-ONT binding | Mobile field survey/Admin verified | Railwire probable only if no stronger binding exists | Active `onu_bindings` is the authoritative bridge. |
| Ticket state/comments/media | Backend ticket service | Mobile/Admin/NOC through APIs | Must respect state machine. |
| PG building/floor/room | Admin/Mobile PG module | Backend conflict resolver | Offline sync conflicts must go to review. |
| Predictions/health score | Backend worker | Manual override only as note | Recommendation, not source truth. |

## Binding Precedence

When resolving a customer to network device:

1. Active `onu_bindings` with `confidence=verified` and evidence.
2. Active `onu_bindings` with admin verification.
3. Active `onu_bindings` with placement match and probable confidence.
4. Railwire/imported MAC binding if no stronger active binding exists.
5. Legacy `customers.mac_address`, `olt_host`, `pon_port`, `onu_index` fallback.
6. Fuzzy matching only as a clearly labeled review hint.

No UI may display a customer/device match without source and confidence once the production gate is active.

## Write Rules

| Rule | Requirement |
| --- | --- |
| Stronger source wins | Scraper cannot overwrite field/admin verified identity. |
| Weaker source creates review | A weaker conflicting update creates a review issue instead of overwriting. |
| Binding changes are lifecycle changes | Old binding is deactivated, not deleted. |
| Evidence required for verified | A verified field binding needs sticker photo/OCR/admin evidence. |
| Freshness visible | Live network values must expose age or stale status. |
| Every correction audited | Admin and field corrections must record actor, time, old value, new value, and source. |

## Required Future Schema Guard

Pick one implementation before production:

1. Add per-field provenance columns for high-risk customer fields.
2. Or split customer billing from customer identity into separate tables.
3. Or create a generic `customer_field_provenance` table.

Until then, the scraper sync code must have tests proving it does not overwrite verified identity or binding fields.
