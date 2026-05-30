"""Investigation Center — categorised inbox of everything worth a human look.

This is the operator's "what should I dig into today?" view. Each category
answers a specific question and offers concrete admin actions:

  CATEGORY                 QUESTION                              ACTIONS
  ────────────────────     ──────────────────────────────────    ─────────────────
  mac_drift                "Is the customer's MAC slightly off    Edit MAC / sticker scan
                            from the actual ONU MAC?"
  duplicate_mac            "Are 2+ customers sharing one MAC?"    CSR fix in Railwire
  unknown_online_onu       "ONU online but no customer record"    Enroll in Railwire
  device_swap_pending      "Slot's MAC changed unexpectedly"      Confirm swap
  customer_offline_long    "Linked customer offline 7+ days"      Call customer
  mac_admin_change_pending "Admin edited MAC — recheck binding"   Re-run reconciler
  churned_active_onu       "Customer drafted but ONU still on"    Deprovision ONU
  profile_incomplete       "Linked but missing position/model"    Run enricher

Each case has a stable case_id so admins can leave notes, dismiss with
reason, or re-open later. Future categories add cleanly by appending a new
detector function and registering it in CATEGORY_DETECTORS.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict, field
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("rico_net.investigation")


@dataclass
class InvestigationCase:
    case_id: str                    # stable: "{category}:{unique}"
    category: str                   # one of the keys in CATEGORY_DETECTORS
    severity: str                   # critical | warning | info
    summary: str
    customer_username: Optional[str] = None
    olt_host: Optional[str] = None
    pon_port: Optional[str] = None
    onu_index: Optional[int] = None
    details: Dict[str, Any] = field(default_factory=dict)
    suggested_actions: List[Dict[str, str]] = field(default_factory=list)
    # actions example: [{"label": "Edit MAC", "endpoint": "PATCH /customers/{u}/mac"}, ...]


# ─── Detectors ─────────────────────────────────────────────────────────────


def _detect_mac_drift(db: Session) -> List[InvestigationCase]:
    """Customer's Railwire MAC differs slightly (Δ ≤ 5) from a live OLT MAC."""
    cases: List[InvestigationCase] = []
    # Get all currently online ONUs paired with their closest customer MAC
    # by first-5-octets match. Filter to small last-octet difference (likely drift).
    rows = db.execute(text("""
        WITH agg AS (
            SELECT olt_host, pon_port, onu_index FROM onu_latest
            WHERE polled_at > NOW() - INTERVAL '24 hours'
            GROUP BY 1,2,3 HAVING COUNT(DISTINCT mac_address) > 5
        ),
        live AS (
            SELECT l.olt_host, l.pon_port, l.onu_index,
                   UPPER(l.mac_address) AS live_mac,
                   l.rx_power_dbm
            FROM onu_latest l
            LEFT JOIN agg a ON a.olt_host=l.olt_host AND a.pon_port=l.pon_port AND a.onu_index=l.onu_index
            WHERE l.status='online'
              AND l.polled_at > NOW() - INTERVAL '24 hours'
              AND l.mac_address NOT LIKE 'SN:%'
              AND a.olt_host IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM customers c WHERE UPPER(c.mac_address) = UPPER(l.mac_address)
              )
        )
        SELECT live.olt_host, live.pon_port, live.onu_index, live.live_mac, live.rx_power_dbm,
               c.username, c.first_name||' '||COALESCE(c.last_name,'') AS name,
               UPPER(c.mac_address) AS railwire_mac
        FROM live
        JOIN customers c
          ON UPPER(LEFT(c.mac_address, 14)) = UPPER(LEFT(live.live_mac, 14))
        WHERE c.status='Active'
    """)).mappings().all()
    for r in rows:
        try:
            diff = abs(int(r["live_mac"][-2:], 16) - int(r["railwire_mac"][-2:], 16))
        except Exception:
            continue
        if diff == 0 or diff > 5:
            continue   # not drift (0 = exact match, >5 = coincidental batch share)
        cases.append(InvestigationCase(
            case_id=f"mac_drift:{r['username']}:{r['live_mac']}",
            category="mac_drift",
            severity="warning",
            summary=(
                f"{r['username']} ({r['name'].strip()}): Railwire MAC {r['railwire_mac']} "
                f"differs by {diff} from actual ONU {r['live_mac']} at "
                f"{r['olt_host']} {r['pon_port']}/{r['onu_index']}"
            ),
            customer_username=r["username"],
            olt_host=r["olt_host"], pon_port=r["pon_port"], onu_index=r["onu_index"],
            details={"railwire_mac": r["railwire_mac"], "live_mac": r["live_mac"],
                     "delta": diff, "rx_power_dbm": r["rx_power_dbm"]},
            suggested_actions=[
                {"label": "Update Railwire MAC to live MAC", "kind": "edit_mac",
                 "endpoint": f"PATCH /customers/{r['username']}/mac",
                 "payload": {"mac_address": r["live_mac"]}},
                {"label": "Schedule sticker scan", "kind": "ticket"},
            ],
        ))
    return cases


def _detect_duplicate_mac(db: Session) -> List[InvestigationCase]:
    """Multiple active customers bound to the same MAC."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        SELECT UPPER(b.mac_address) AS mac,
               array_agg(c.username ORDER BY b.last_seen DESC) AS usernames
        FROM onu_bindings b
        JOIN customers c ON c.username=b.customer_id
        WHERE b.is_active=TRUE
          AND b.mac_address IS NOT NULL AND b.mac_address<>''
        GROUP BY UPPER(b.mac_address)
        HAVING COUNT(*) > 1
    """)).mappings().all()
    for r in rows:
        users = list(r["usernames"])
        cases.append(InvestigationCase(
            case_id=f"duplicate_mac:{r['mac']}",
            category="duplicate_mac",
            severity="critical",
            summary=f"MAC {r['mac']} is bound to {len(users)} customers: {', '.join(users[:5])}",
            details={"mac": r["mac"], "customers": users},
            suggested_actions=[
                {"label": "Open Railwire — fix wrong customer's MAC", "kind": "external"},
                {"label": f"Edit MAC of {users[0]}", "kind": "edit_mac",
                 "endpoint": f"PATCH /customers/{users[0]}/mac"},
            ],
        ))
    return cases


def _detect_unknown_online_onu(db: Session) -> List[InvestigationCase]:
    """ONU is online + healthy signal but no customer claims it."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        WITH agg AS (
            SELECT olt_host, pon_port, onu_index FROM onu_latest
            WHERE polled_at > NOW() - INTERVAL '24 hours'
            GROUP BY 1,2,3 HAVING COUNT(DISTINCT mac_address) > 5
        )
        SELECT l.olt_host, l.pon_port, l.onu_index,
               l.mac_address, l.rx_power_dbm, l.model_id, l.ont_serial_number
        FROM onu_latest l
        LEFT JOIN agg a ON a.olt_host=l.olt_host AND a.pon_port=l.pon_port AND a.onu_index=l.onu_index
        WHERE l.status='online'
          AND l.polled_at > NOW() - INTERVAL '24 hours'
          AND l.mac_address NOT LIKE 'SN:%'
          AND a.olt_host IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM customers c WHERE UPPER(c.mac_address) = UPPER(l.mac_address)
          )
          -- also exclude near-matches; those are caught by mac_drift category
          AND NOT EXISTS (
              SELECT 1 FROM customers c2
              WHERE UPPER(LEFT(c2.mac_address, 14)) = UPPER(LEFT(l.mac_address, 14))
                AND c2.status='Active'
          )
        ORDER BY l.olt_host, l.pon_port, l.onu_index
        LIMIT 200
    """)).mappings().all()
    for r in rows:
        cases.append(InvestigationCase(
            case_id=f"unknown_onu:{r['olt_host']}:{r['pon_port']}:{r['onu_index']}",
            category="unknown_online_onu",
            severity="info",
            summary=f"Online ONU at {r['olt_host']} {r['pon_port']}/{r['onu_index']} "
                    f"(MAC {r['mac_address']}) — no customer in Railwire",
            olt_host=r["olt_host"], pon_port=r["pon_port"], onu_index=r["onu_index"],
            details={"mac": r["mac_address"], "rx_power_dbm": r["rx_power_dbm"],
                     "model": r["model_id"], "serial": r["ont_serial_number"]},
            suggested_actions=[
                {"label": "Enroll in Railwire as new customer", "kind": "external"},
                {"label": "Mark as test/staff ONU (dismiss)", "kind": "dismiss"},
            ],
        ))
    return cases


def _detect_customer_offline_long(db: Session) -> List[InvestigationCase]:
    """Linked customer whose ONU has been offline for 7+ days."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        SELECT c.username, c.first_name||' '||COALESCE(c.last_name,'') AS name,
               d.olt_host, d.pon_port, d.onu_index, d.optical_mac,
               l.polled_at AS last_seen
        FROM customers c
        JOIN customer_dna d ON d.username = c.username
        LEFT JOIN onu_latest l
          ON l.olt_host=d.olt_host AND l.pon_port=d.pon_port AND l.onu_index=d.onu_index
        WHERE d.link_status='linked'
          AND c.status='Active'
          AND (l.status='offline' OR l.polled_at IS NULL OR l.polled_at < NOW() - INTERVAL '7 days')
        LIMIT 200
    """)).mappings().all()
    for r in rows:
        cases.append(InvestigationCase(
            case_id=f"offline_long:{r['username']}",
            category="customer_offline_long",
            severity="warning",
            summary=f"{r['username']} ({r['name'].strip()}) offline since {r['last_seen']}",
            customer_username=r["username"],
            olt_host=r["olt_host"], pon_port=r["pon_port"], onu_index=r["onu_index"],
            details={"last_seen": str(r["last_seen"]) if r["last_seen"] else None,
                     "optical_mac": r["optical_mac"]},
            suggested_actions=[
                {"label": "Call customer to verify power/cable", "kind": "external"},
                {"label": "Dispatch tech if no answer", "kind": "ticket"},
            ],
        ))
    return cases


def _detect_churned_active_onu(db: Session) -> List[InvestigationCase]:
    """Customer was drafted (removed from Railwire) but their ONU is still online."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        SELECT c.username, c.first_name||' '||COALESCE(c.last_name,'') AS name,
               UPPER(c.mac_address) AS mac,
               l.olt_host, l.pon_port, l.onu_index, l.rx_power_dbm
        FROM customers c
        JOIN onu_latest l ON UPPER(l.mac_address) = UPPER(c.mac_address)
        WHERE c.railwire_status='not_found'
          AND c.mac_address IS NOT NULL AND c.mac_address<>''
          AND l.status='online'
          AND l.polled_at > NOW() - INTERVAL '24 hours'
        LIMIT 100
    """)).mappings().all()
    for r in rows:
        cases.append(InvestigationCase(
            case_id=f"churned_active:{r['username']}",
            category="churned_active_onu",
            severity="warning",
            summary=f"{r['username']} ({r['name'].strip()}) is draft (removed from Railwire) "
                    f"but ONU still online at {r['olt_host']} {r['pon_port']}/{r['onu_index']}",
            customer_username=r["username"],
            olt_host=r["olt_host"], pon_port=r["pon_port"], onu_index=r["onu_index"],
            details={"mac": r["mac"], "rx_power_dbm": r["rx_power_dbm"]},
            suggested_actions=[
                {"label": "Reactivate customer in Railwire (if returned)", "kind": "external"},
                {"label": "Disable ONU port (if deprovisioning)", "kind": "external"},
            ],
        ))
    return cases


def _detect_device_swap_pending(db: Session) -> List[InvestigationCase]:
    """Outstanding device_swap_detected binding_alerts that need admin action."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        SELECT id, customer_username, olt_host, pon_port, onu_index,
               current_state, summary, opened_at
        FROM binding_alerts
        WHERE status='open' AND category='device_swap_detected'
        ORDER BY opened_at DESC
    """)).mappings().all()
    for r in rows:
        state = r["current_state"] or {}
        if isinstance(state, str):
            import json as _j
            try: state = _j.loads(state)
            except Exception: state = {}
        cases.append(InvestigationCase(
            case_id=f"device_swap:{r['id']}",
            category="device_swap_pending",
            severity="critical",
            summary=r["summary"],
            customer_username=r["customer_username"],
            olt_host=r["olt_host"], pon_port=r["pon_port"], onu_index=r["onu_index"],
            details={"alert_id": r["id"], "opened_at": str(r["opened_at"]), **state},
            suggested_actions=[
                {"label": "Confirm swap (auto-bind to new MAC)",
                 "kind": "confirm_swap",
                 "endpoint": f"POST /pipeline/alerts/{r['id']}/confirm-swap"},
                {"label": "Dismiss with reason", "kind": "dismiss",
                 "endpoint": f"POST /pipeline/alerts/{r['id']}/dismiss"},
            ],
        ))
    return cases


def _detect_admin_mac_changes(db: Session) -> List[InvestigationCase]:
    """Recent admin-initiated MAC changes — verify the new binding stuck."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        SELECT a.customer_id AS username, a.old_value, a.new_value, a.changed_by, a.changed_at,
               d.link_status, d.optical_mac
        FROM customer_audit_log a
        LEFT JOIN customer_dna d ON d.username=a.customer_id
        WHERE a.field_name='mac_address'
          AND a.changed_by NOT IN ('Railwire Scraper', 'sync_daemon', 'system:auto', '')
          AND a.changed_at > NOW() - INTERVAL '7 days'
        ORDER BY a.changed_at DESC
        LIMIT 50
    """)).mappings().all()
    for r in rows:
        binding_ok = (d := r.get("optical_mac")) and r["new_value"] and d.upper() == r["new_value"].upper()
        cases.append(InvestigationCase(
            case_id=f"admin_mac_change:{r['username']}:{r['changed_at']}",
            category="mac_admin_change_pending",
            severity="info" if binding_ok else "warning",
            summary=(
                f"{r['username']}: admin {r['changed_by']} changed MAC "
                f"{r['old_value'] or '(none)'} → {r['new_value']} at {r['changed_at']}"
                + (" — binding updated ✓" if binding_ok else " — binding not yet aligned")
            ),
            customer_username=r["username"],
            details={"old_mac": r["old_value"], "new_mac": r["new_value"],
                     "changed_by": r["changed_by"], "binding_aligned": binding_ok,
                     "current_optical_mac": r.get("optical_mac")},
            suggested_actions=[] if binding_ok else [
                {"label": "Trigger binding reconcile", "kind": "rebind",
                 "endpoint": f"POST /pipeline/customers/{r['username']}/rescrape"},
            ],
        ))
    return cases


def _detect_profile_incomplete(db: Session) -> List[InvestigationCase]:
    """Linked customer but profile fields missing — enricher likely didn't run."""
    cases: List[InvestigationCase] = []
    rows = db.execute(text("""
        SELECT c.username
        FROM customers c
        JOIN customer_dna d ON d.username=c.username
        WHERE d.link_status='linked'
          AND d.last_verified_at < NOW() - INTERVAL '1 hour'
          AND (c.olt_host IS NULL OR c.olt_host='' OR c.pon_port IS NULL OR c.pon_port=''
               OR c.onu_index IS NULL)
        LIMIT 100
    """)).mappings().all()
    for r in rows:
        cases.append(InvestigationCase(
            case_id=f"profile_incomplete:{r['username']}",
            category="profile_incomplete",
            severity="warning",
            summary=f"{r['username']} is linked on OLT but profile row missing position fields",
            customer_username=r["username"],
            suggested_actions=[
                {"label": "Run profile enricher", "kind": "enrich",
                 "endpoint": "POST /pipeline/enrich"},
            ],
        ))
    return cases


# ─── Registry — extensible by adding entries here ─────────────────────────

CATEGORY_DETECTORS: Dict[str, Callable[[Session], List[InvestigationCase]]] = {
    "mac_drift":                _detect_mac_drift,
    "duplicate_mac":            _detect_duplicate_mac,
    "unknown_online_onu":       _detect_unknown_online_onu,
    "customer_offline_long":    _detect_customer_offline_long,
    "churned_active_onu":       _detect_churned_active_onu,
    "device_swap_pending":      _detect_device_swap_pending,
    "mac_admin_change_pending": _detect_admin_mac_changes,
    "profile_incomplete":       _detect_profile_incomplete,
}

CATEGORY_LABELS: Dict[str, Dict[str, str]] = {
    "mac_drift": {
        "label": "MAC Drift",
        "why": "Customer's Railwire MAC differs slightly from the actual ONU MAC (Δ ≤ 5). "
               "Usually means the Railwire field has the router LAN MAC while the OLT sees "
               "the optical MAC, OR a typo. Either way the customer IS this ONU.",
        "action": "Update Railwire MAC OR sticker-scan to confirm.",
    },
    "duplicate_mac": {
        "label": "Duplicate MAC",
        "why": "Two Railwire records carry the same MAC. Only one customer can own one ONU. "
               "Likely a CSR typo or family sharing.",
        "action": "Fix the wrong customer's MAC in Railwire.",
    },
    "unknown_online_onu": {
        "label": "Unknown Online ONUs",
        "why": "ONU is online + healthy but no customer in Railwire claims that MAC. "
               "Test/staff hardware, missed enrollment, or a different ANP's ONU.",
        "action": "Enroll in Railwire OR dismiss with reason.",
    },
    "customer_offline_long": {
        "label": "Customer Offline 7+ days",
        "why": "We have a verified binding but the ONU stopped responding more than a week ago. "
               "Customer may have moved, lost power, or hardware failed.",
        "action": "Call to verify; dispatch tech if needed.",
    },
    "churned_active_onu": {
        "label": "Churned but Active",
        "why": "Customer was removed from Railwire (draft) but their ONU is still physically "
               "online. Either they came back or the ONU was never deprovisioned.",
        "action": "Reactivate or disable ONU port.",
    },
    "device_swap_pending": {
        "label": "Device Swap — Confirm",
        "why": "A slot's MAC changed unexpectedly. Likely the customer replaced their ONU. "
               "Confirm so we can rebind to the new device.",
        "action": "One-click confirm if the swap is expected.",
    },
    "mac_admin_change_pending": {
        "label": "Admin MAC Changes (last 7d)",
        "why": "Track every admin-initiated MAC edit and verify the new binding actually took. "
               "Holds admin accountable + catches stuck-in-flight changes.",
        "action": "Trigger reconcile if binding isn't aligned with new MAC.",
    },
    "profile_incomplete": {
        "label": "Profile Incomplete",
        "why": "Customer is linked on the OLT but the customers row hasn't been filled by the "
               "enricher. Indicates the enricher failed or hasn't run for this customer.",
        "action": "Run /pipeline/enrich manually.",
    },
}


# ─── Public API ────────────────────────────────────────────────────────────


def list_all_cases(db: Session) -> Dict[str, Any]:
    """Run all detectors, return cases grouped by category + a flat list.

    Cheap: each detector is one indexed query. Whole run < 1 sec on 1k customers.
    """
    by_category: Dict[str, List[Dict[str, Any]]] = {}
    counts: Dict[str, int] = {}
    severity_counts = {"critical": 0, "warning": 0, "info": 0}

    for cat, fn in CATEGORY_DETECTORS.items():
        try:
            cases = fn(db)
        except Exception as e:
            logger.exception("Investigation detector %s failed: %s", cat, e)
            cases = []
        by_category[cat] = [asdict(c) for c in cases]
        counts[cat] = len(cases)
        for c in cases:
            severity_counts[c.severity] = severity_counts.get(c.severity, 0) + 1

    return {
        "by_category": by_category,
        "counts": counts,
        "severity_counts": severity_counts,
        "labels": CATEGORY_LABELS,
        "total": sum(counts.values()),
    }


def list_cases_in_category(db: Session, category: str) -> Dict[str, Any]:
    fn = CATEGORY_DETECTORS.get(category)
    if not fn:
        return {"error": f"Unknown category: {category}",
                "available": list(CATEGORY_DETECTORS.keys())}
    try:
        cases = fn(db)
    except Exception as e:
        logger.exception("category %s failed: %s", category, e)
        return {"error": str(e), "cases": []}
    return {
        "category": category,
        "label": CATEGORY_LABELS.get(category, {}).get("label", category),
        "why": CATEGORY_LABELS.get(category, {}).get("why", ""),
        "action": CATEGORY_LABELS.get(category, {}).get("action", ""),
        "count": len(cases),
        "cases": [asdict(c) for c in cases],
    }
