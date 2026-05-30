"""Data-quality classifier.

For every customer, compute one of 10 mutually-exclusive pipeline states and a
human-readable diagnosis. Stores the result on customer_dna so the UI can show
a stacked breakdown and the operator can act on each bucket separately.

States (matching the user's mental model):

  complete                 — MAC scraped + bound to OLT + recent ONU poll
  mac_scrape_pending       — Never attempted
  mac_scrape_failed        — Attempted, failed, < 3 attempts; retry will happen
  mac_persistent_failure   — Attempted ≥ 3 times, still failing — manual review needed
  no_mac_in_portal         — Scraper reached the page but Railwire has no MAC
  unbound_offline          — MAC present, on our OLT, but ONU offline
  unbound_mac_drift        — MAC near-match (off-by-N) found — auto-bind as 'probable'
  olt4_likely              — MAC scraped but not on any registered OLT — probably on OLT #4
  unbound_unknown          — MAC scraped but not on any OLT and we don't suspect OLT #4
  draft                    — Removed from Railwire (preserved)

The classifier is read-only against the actual data — it only writes
data_pipeline_status / last_diagnosis / classified_at on customer_dna.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("rico_net.data_quality")


# Order matters — first matching state wins.
PIPELINE_STATES: List[str] = [
    "draft",
    "subscriber_expired",
    "subscriber_inactive",
    "mac_scrape_pending",
    "mac_persistent_failure",
    "mac_scrape_failed",
    "no_mac_in_portal",
    "olt4_likely",
    "unbound_mac_drift",
    "unbound_offline",
    "unbound_unknown",
    "complete",
]


MAC_FAILURE_RETRY_LIMIT = 3   # ≥ this many failed attempts → persistent_failure


def _norm_mac(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    out = s.upper().replace("-", ":").replace(".", ":").strip()
    return out if len(out) == 17 and out.count(":") == 5 else None


def _classify_one(row: dict, all_olt_macs: set[str]) -> tuple[str, str]:
    """Return (state, diagnosis) for one customer row.

    `all_olt_macs` is the union of MACs seen on any registered OLT — used to
    decide unbound_unknown vs olt4_likely."""
    rw_status = (row.get("railwire_status") or "active").lower()
    mac = (row.get("mac_address") or "").strip()
    attempts = int(row.get("mac_scrape_attempts") or 0)
    last_err = (row.get("mac_last_error") or "").strip() or None
    link_status = (row.get("link_status") or "").lower()
    binding_source = (row.get("binding_source") or "").lower()
    polled_at = row.get("polled_at")
    onu_status = (row.get("onu_status") or "").lower()
    acc_status = (row.get("acc_status") or "").lower()   # 'active' | 'inactive' | ''

    # --- Lifecycle ---
    if rw_status == "not_found":
        return "draft", "Customer no longer in Railwire portal — preserved locally."

    # --- MAC-side states ---
    if not mac:
        # 1) Railwire's "This Subscriber Expired more than X days — contact MSP" page.
        #    Operator action: contact customer to reactivate.
        if last_err == "subscriber_expired":
            return (
                "subscriber_expired",
                "Railwire shows: 'Subscriber expired — contact MSP to reactivate'. "
                "Customer's plan lapsed long ago. Reach out to renew.",
            )

        # 2) Customer is Inactive in Railwire CSV (status='Inactive'). The detail
        #    page exists but they have no data session → scraper records
        #    no_mac_on_page or data_usage_link_missing. Distinguish from truly
        #    Active customers who have no MAC: Inactive ones need a billing fix,
        #    Active ones need a survey/sticker scan.
        if acc_status == "inactive" and last_err in ("no_mac_on_page", "data_usage_link_missing"):
            return (
                "subscriber_inactive",
                f"Customer is Inactive in Railwire CSV (status='Inactive'); detail page exists but "
                f"no recent data session so no MAC visible ({last_err}). "
                f"Different from a genuine MAC gap — customer needs billing action, not survey.",
            )

        # 3) Active customer, page reached, no MAC. Real "Railwire has no MAC"
        #    case — needs survey / sticker scan / customer callback.
        if last_err in ("no_mac_on_page", "data_usage_link_missing"):
            reason = "Data usage page has no MAC" if last_err == "no_mac_on_page" else "No data-usage link on subscription page (no session history)"
            return (
                "no_mac_in_portal",
                f"Active customer in Railwire but no MAC available — {reason}. "
                f"Needs survey / sticker scan / customer callback.",
            )
        if attempts >= MAC_FAILURE_RETRY_LIMIT:
            return (
                "mac_persistent_failure",
                f"MAC scrape failed {attempts} times. Last error: {last_err or 'unknown'}. "
                f"Manual investigation needed.",
            )
        if attempts > 0:
            return (
                "mac_scrape_failed",
                f"MAC scrape failed {attempts}/{MAC_FAILURE_RETRY_LIMIT}. "
                f"Last error: {last_err or 'unknown'}. Will retry at next MAC batch.",
            )
        return (
            "mac_scrape_pending",
            "MAC has not been attempted yet (new customer or fresh DB). "
            "Scheduler will pick this up at next MAC batch.",
        )

    # --- Binding-side states (we have a MAC) ---
    norm = _norm_mac(mac)

    if link_status == "linked":
        # We have a binding. Is the ONU actually polling fresh?
        if onu_status == "online" or (binding_source in ("pon_mac_table", "sticker_scan")):
            return "complete", (
                f"Bound to OLT via {binding_source or 'unknown source'} "
                f"(ONU status={onu_status or 'unknown'})."
            )
        if polled_at:
            return "complete", (
                f"Bound to OLT via {binding_source or 'unknown source'}, last poll {polled_at}."
            )
        return "complete", f"Bound via {binding_source or 'unknown source'}."

    # link_status != 'linked' — we have a MAC but no OLT position.
    # Is the MAC visible anywhere in our OLT data?
    if norm and norm in all_olt_macs:
        return (
            "unbound_mac_drift",
            f"MAC {norm} IS visible on a registered OLT but the reconcile hasn't bound it yet — "
            f"likely off-by-N drift between Railwire MAC and ONU optical MAC. "
            f"Expected to resolve at next reconcile cycle.",
        )

    if onu_status == "offline" or binding_source == "stale_pon_mac":
        return (
            "unbound_offline",
            f"Customer was bound previously but ONU is offline now ({binding_source or '-'}). "
            f"Self-recovers when customer powers on.",
        )

    # MAC not on any of our 3 OLTs. Two possibilities:
    #   - belongs to OLT #4 (not connected)
    #   - genuinely unknown (stale MAC, customer swapped device, etc.)
    # Without OLT #4 in the registry, default to olt4_likely; admin will reclassify
    # if/when we add OLT #4 and the customer doesn't appear there.
    return (
        "olt4_likely",
        f"MAC {norm or mac} not found on any registered OLT (.100, .200, .210). "
        f"Probably belongs to OLT #4 which is not connected yet — or device was swapped.",
    )


def classify_all(db: Session) -> Dict[str, int]:
    """Recompute data_pipeline_status for every customer. Returns counts per state.

    Cheap — runs against existing data, no SNMP, no scraper. Safe to call every
    reconcile cycle."""
    # 1) Build the union of OLT-visible MACs from the orphan_onus table
    #    (orphans = MACs on OLT but no customer claimed). Plus any MAC currently
    #    bound in customer_dna optical_mac.
    all_olt_macs: set[str] = set()
    for (m,) in db.execute(text("SELECT UPPER(mac_address) FROM orphan_onus WHERE last_seen_at >= NOW() - INTERVAL '24 hours'")).all():
        if m:
            all_olt_macs.add(m)
    for (m,) in db.execute(text("SELECT UPPER(optical_mac) FROM customer_dna WHERE optical_mac IS NOT NULL")).all():
        if m:
            all_olt_macs.add(m)
    for (m,) in db.execute(text("SELECT UPPER(mac_address) FROM onu_latest WHERE polled_at >= NOW() - INTERVAL '24 hours'")).all():
        if m:
            all_olt_macs.add(m)

    # 2) Pull every customer with the data we need
    rows = db.execute(text("""
        SELECT c.username,
               c.mac_address,
               c.railwire_status,
               c.status AS acc_status,
               c.mac_scrape_attempts,
               c.mac_last_error,
               d.link_status,
               d.binding_source,
               d.polled_at,
               d.status AS onu_status
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
    """)).mappings().all()

    counts: Dict[str, int] = {s: 0 for s in PIPELINE_STATES}
    now = datetime.now(timezone.utc)
    upserts: List[Dict[str, object]] = []
    for r in rows:
        state, diagnosis = _classify_one(dict(r), all_olt_macs)
        counts[state] = counts.get(state, 0) + 1
        upserts.append({"u": r["username"], "s": state, "d": diagnosis, "now": now})

    # 3) UPSERT classification into customer_dna in chunks
    if upserts:
        CHUNK = 200
        for i in range(0, len(upserts), CHUNK):
            chunk = upserts[i:i+CHUNK]
            db.execute(text("""
                INSERT INTO customer_dna (username, data_pipeline_status, last_diagnosis, classified_at,
                                          last_reconciled_at, updated_at)
                VALUES (:u, :s, :d, :now, :now, :now)
                ON CONFLICT (username) DO UPDATE SET
                    data_pipeline_status = EXCLUDED.data_pipeline_status,
                    last_diagnosis       = EXCLUDED.last_diagnosis,
                    classified_at        = EXCLUDED.classified_at,
                    updated_at           = EXCLUDED.updated_at
            """), chunk)
        db.commit()

    logger.info("data_quality.classify_all: %s", counts)
    return counts


def get_state_breakdown(db: Session) -> Dict[str, object]:
    """For the UI — overall + per-account counts of each state."""
    overall = db.execute(text("""
        SELECT COALESCE(data_pipeline_status, '(unclassified)') AS state, COUNT(*) AS cnt
        FROM customer_dna GROUP BY 1
    """)).mappings().all()
    per_account = db.execute(text("""
        SELECT COALESCE(c.railwire_admin, '(untagged)') AS account,
               COALESCE(d.data_pipeline_status, '(unclassified)') AS state,
               COUNT(*) AS cnt
        FROM customers c
        LEFT JOIN customer_dna d ON d.username = c.username
        GROUP BY 1, 2
    """)).mappings().all()
    return {
        "overall":      {r["state"]: r["cnt"] for r in overall},
        "per_account":  [dict(r) for r in per_account],
        "states_order": PIPELINE_STATES,
    }
