"""Pipeline monitor router — backs the /pipeline admin page.

  GET /pipeline/health                — full snapshot: stages + coverage + gaps
  GET /pipeline/gaps/{gap_type}       — customer list for one gap bucket
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import database
from middleware.auth import require_admin, get_current_user
from services import pipeline_service, olt_engine

logger = logging.getLogger("rico_net.pipeline")

router = APIRouter(prefix="/pipeline", tags=["Pipeline Monitor"])


@router.get("/health")
def get_pipeline_health(
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    return pipeline_service.get_pipeline_health(db)


@router.get("/gaps/{gap_type}")
def get_pipeline_gaps(
    gap_type: str,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    result = pipeline_service.get_gap_customers(db, gap_type, limit=limit, offset=offset)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result)
    return result


@router.get("/logs/{log_type}")
def get_pipeline_logs(
    log_type: str,
    lines: int = Query(200, ge=1, le=5000),
    account: str | None = Query(None, description="Filter to lines containing [account]"),
    _user=Depends(require_admin),
):
    """Tail one of the scraper log files. Optional account filter."""
    result = pipeline_service.tail_log(log_type, lines=lines, account=account)
    if "error" in result and "valid" in result:
        raise HTTPException(status_code=400, detail=result)
    return result


@router.get("/runs")
def get_pipeline_runs(
    account: str | None = Query(None),
    step: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    _user=Depends(require_admin),
):
    """Recent scraper runs from the scraper SQLite, with account filter."""
    return pipeline_service.list_scraper_runs(account=account, step=step, status=status, limit=limit)


# ─── Action endpoints ────────────────────────────────────────────────────────


class ScrapeRequest(BaseModel):
    account: str | None = None     # Railwire admin username; None = both
    step: str = "mac"              # csv | details | mac | all | daily
    username: str | None = None    # for --step single


@router.post("/scrape")
def post_pipeline_scrape(
    body: ScrapeRequest,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """Kick off the scraper for an account+step. Detached subprocess; watch /pipeline/logs to follow it."""
    if user.role not in ("Admin", "Senior Tech"):
        raise HTTPException(status_code=403, detail="admin only")

    action_kind = "rescrape" if (body.step == "single" and body.username) else "scrape_account"
    action_id = pipeline_service.record_action_start(
        db, action=action_kind, customer=body.username, account=body.account,
        step=body.step, triggered_by=user.username,
    )
    pipeline_service.log_action(
        action=f"scrape:{body.step}", account=body.account, customer=body.username,
        user=user.username, status="start",
        details=f"step={body.step} account={body.account or 'both'} single_user={body.username or '-'}",
    )
    result = pipeline_service.trigger_scrape(account=body.account, step=body.step, username=body.username)
    if not result.get("ok"):
        pipeline_service.record_action_finish(
            db, action_id, status="error", error_message=str(result.get("error")),
        )
        pipeline_service.log_action(
            action=f"scrape:{body.step}", account=body.account, customer=body.username,
            user=user.username, status="error", details=str(result.get("error")),
        )
        raise HTTPException(status_code=400, detail=result)
    pipeline_service.record_action_finish(
        db, action_id, status="ok",
        result_summary=f"subprocess pid={result.get('pid')} — step={body.step} account={body.account or 'both'}",
    )
    pipeline_service.log_action(
        action=f"scrape:{body.step}", account=body.account, customer=body.username,
        user=user.username, status="ok",
        details=f"subprocess pid={result.get('pid')} — watch the relevant step log for output",
    )
    return {**result, "action_id": action_id}


@router.post("/customers/{username}/rescrape")
def post_rescrape_customer(
    username: str,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """Re-scrape one customer (kicks scraper.py --step single --username X)."""
    if user.role not in ("Admin", "Senior Tech"):
        raise HTTPException(status_code=403, detail="admin only")

    # Figure out which account this customer belongs to (for the activity row)
    acc = db.execute(text("SELECT railwire_admin FROM customers WHERE username = :u"), {"u": username}).scalar()

    action_id = pipeline_service.record_action_start(
        db, action="rescrape", customer=username, account=acc, step="single",
        triggered_by=user.username,
    )
    pipeline_service.log_action(
        action="rescrape", customer=username, user=user.username, status="start",
        details=f"scraper.py --step single --username {username}",
    )
    result = pipeline_service.trigger_scrape(account=None, step="single", username=username)
    if not result.get("ok"):
        pipeline_service.record_action_finish(
            db, action_id, status="error", error_message=str(result.get("error")),
        )
        pipeline_service.log_action(
            action="rescrape", customer=username, user=user.username, status="error",
            details=str(result.get("error")),
        )
        raise HTTPException(status_code=400, detail=result)
    pipeline_service.record_action_finish(
        db, action_id, status="ok",
        result_summary=f"subprocess pid={result.get('pid')} — watch single_scrape.log",
    )
    pipeline_service.log_action(
        action="rescrape", customer=username, user=user.username, status="ok",
        details=f"subprocess pid={result.get('pid')} — watch single_scrape log",
    )
    return {**result, "action_id": action_id}


@router.post("/customers/{username}/bind")
def post_bind_customer(
    username: str,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user),
):
    """Cache-first bind: look up the customer's MAC in the data the engine
    reconcile already gathered (customer_dna, orphan_onus, onu_bindings).
    Does NOT walk the OLT live — avoids contention with the Pi poller."""
    if user.role not in ("Admin", "Senior Tech"):
        raise HTTPException(status_code=403, detail="admin only")

    acc = db.execute(text("SELECT railwire_admin FROM customers WHERE username = :u"), {"u": username}).scalar()
    action_id = pipeline_service.record_action_start(
        db, action="bind", customer=username, account=acc, step="bind",
        triggered_by=user.username,
    )
    pipeline_service.log_action(
        action="bind", customer=username, user=user.username, status="start",
        details="cache-first lookup against customer_dna + orphan_onus + onu_bindings",
    )
    result = pipeline_service.bind_customer_cached(db, username)
    final_status = "ok" if result.get("ok") else "miss"
    pipeline_service.record_action_finish(
        db, action_id, status=final_status, result_summary=result.get("message"),
    )
    pipeline_service.log_action(
        action="bind", customer=username, user=user.username, status=final_status,
        details=result.get("message") or "",
    )
    if not result.get("ok") and result.get("status_code") and result["status_code"] >= 400:
        raise HTTPException(status_code=result["status_code"], detail=result)
    return {**result, "action_id": action_id}


@router.get("/activity")
def get_pipeline_activity(
    account: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """Merged timeline: user-clicked actions + scheduler scraper runs."""
    return pipeline_service.list_activity(db, account=account, limit=limit)


@router.get("/customers")
def get_pipeline_customers(
    account: str | None = Query(None, description="Filter by railwire_admin"),
    q: str | None = Query(None, description="Search username/name/phone/MAC"),
    has_mac: bool | None = Query(None, description="True = only with MAC, False = only missing"),
    link_status: str | None = Query(None, description="linked | unlinked"),
    pipeline_state: str | None = Query(None, description="Filter by data_pipeline_status"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """Per-account customer list with binding + ONU status. Used by the /pipeline page table."""
    return pipeline_service.list_customers(
        db,
        account=account, q=q, has_mac=has_mac, link_status=link_status,
        pipeline_state=pipeline_state,
        limit=limit, offset=offset,
    )


# ─── Binding-alert inbox + actions ─────────────────────────────────────────

@router.get("/alerts")
def get_alerts(
    status: str = Query("open", description="open | ack | resolved | auto_resolved | all"),
    category: str | None = Query(None),
    severity: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """Binding-drift inbox. Used by the /pipeline Alerts tab."""
    return pipeline_service.list_binding_alerts(
        db, status=status, category=category, severity=severity, limit=limit,
    )


@router.get("/alerts/stats")
def get_alert_stats(
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    return pipeline_service.binding_alert_stats(db)


class AlertAction(BaseModel):
    note: str | None = None


@router.post("/alerts/{alert_id}/confirm-swap")
def post_alert_confirm_swap(
    alert_id: int,
    payload: AlertAction,
    db: Session = Depends(database.get_db),
    user=Depends(require_admin),
):
    """For a device_swap_detected alert: rebind the prior customer to the new MAC.

    Writes a verified onu_bindings row (binding_source=device_swap_confirmed),
    updates customer_dna so the change is reflected immediately, emits
    activity + audit events, and marks the alert resolved.
    """
    result = pipeline_service.confirm_device_swap(
        db, alert_id=alert_id, actor=user.username, note=payload.note,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.post("/alerts/{alert_id}/ack")
def post_alert_ack(
    alert_id: int,
    payload: AlertAction,
    db: Session = Depends(database.get_db),
    user=Depends(require_admin),
):
    return pipeline_service.ack_alert(db, alert_id=alert_id, actor=user.username, note=payload.note)


@router.post("/alerts/{alert_id}/dismiss")
def post_alert_dismiss(
    alert_id: int,
    payload: AlertAction,
    db: Session = Depends(database.get_db),
    user=Depends(require_admin),
):
    if not payload.note:
        raise HTTPException(status_code=400, detail={"error": "note is required when dismissing"})
    return pipeline_service.dismiss_alert(db, alert_id=alert_id, actor=user.username, note=payload.note)


# ─── Activity event feed (categorised) ─────────────────────────────────────

@router.get("/events")
def get_activity_events(
    category: str | None = Query(None, description="exact category match"),
    category_prefix: str | None = Query(None, description="prefix match, e.g. 'binding.'"),
    customer_username: str | None = Query(None),
    severity: str | None = Query(None, description="info | warning | critical"),
    since_minutes: int | None = Query(None, ge=1, le=10080, description="last N minutes"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """The unified activity feed. Powers the /pipeline Activity tab."""
    return pipeline_service.list_activity_events(
        db,
        category=category, category_prefix=category_prefix,
        customer_username=customer_username, severity=severity,
        since_minutes=since_minutes, limit=limit,
    )


@router.get("/events/categories")
def get_activity_categories(
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """List of distinct categories with counts (for the filter dropdown)."""
    return pipeline_service.activity_categories(db)


# ─── Profile completeness (pipeline's main job: is identity data complete?) ─

@router.get("/completeness")
def get_completeness(
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """For each identity field, what % of linked customers have it populated?
    Pipeline's North Star metric."""
    return pipeline_service.get_profile_completeness(db)


@router.post("/enrich")
def post_run_enrichment(
    force: bool = Query(False, description="Overwrite non-empty fields too"),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """Manually trigger customer-profile enrichment (engine runs it automatically
    after every reconcile, but this lets you force a refresh on demand)."""
    from services import customer_profile_enricher
    r = customer_profile_enricher.enrich_all(db, force=force)
    return {
        "ok": True,
        "customers_scanned": r.customers_scanned,
        "rows_enriched": r.rows_enriched,
        "fields_filled": r.fields_filled,
        "by_field": r.by_field,
    }


@router.post("/identity-sync")
def post_identity_sync(
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """Manually trigger the Pi-proxy ONU-identity scan (gives us SN+model per
    slot via Telnet). Runs hourly automatically. Use this to refresh on demand
    after a hardware change."""
    from services.onu_identity_sync import sync_identity_from_pi
    r = sync_identity_from_pi(db, timeout=240)
    return {"ok": True, **r}


# ─── Investigation Center ─────────────────────────────────────────────────

@router.get("/investigations")
def get_investigations(
    category: str | None = Query(None, description="Filter to one category; omit for all"),
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    """List all investigation cases grouped by category — the operator's
    'what should I dig into?' inbox. Each case carries suggested_actions
    that map to admin endpoints. Extensible: add a detector to
    investigation_service.CATEGORY_DETECTORS and it shows up here."""
    from services import investigation_service
    if category:
        return investigation_service.list_cases_in_category(db, category)
    return investigation_service.list_all_cases(db)


# ─── Admin override endpoints (every action audit-logged) ────────────────

class CustomerMacEdit(BaseModel):
    mac_address: str       # new MAC (will be normalised + validated)
    note: str | None = None  # reason for the change


@router.patch("/customers/{username}/mac")
def patch_customer_mac(
    username: str,
    payload: CustomerMacEdit,
    db: Session = Depends(database.get_db),
    user=Depends(require_admin),
):
    """Admin-edit a customer's MAC. Audit-logged with old/new value + actor.
    Triggers binding_reconciler immediately so the new MAC binds to its slot
    within seconds (vs waiting for the 5-min cycle).

    Use cases:
      - Confirmed sticker scan reveals true optical MAC
      - Railwire CSR typo correction propagated here
      - MAC drift case resolved
    """
    from services import pipeline_service
    return pipeline_service.admin_edit_customer_mac(
        db, username=username, new_mac=payload.mac_address,
        actor=user.username, note=payload.note,
    )


@router.post("/customers/{username}/force-verify")
def post_force_verify(
    username: str,
    payload: AlertAction,
    db: Session = Depends(database.get_db),
    user=Depends(require_admin),
):
    """Admin physically confirms a customer's binding (e.g. sticker scan
    matched). Sets binding_source=manual, confidence=verified. Note required."""
    if not payload.note:
        raise HTTPException(status_code=400, detail={"error": "note is required"})
    from services import pipeline_service
    return pipeline_service.admin_force_verify_binding(
        db, username=username, actor=user.username, note=payload.note,
    )


@router.post("/investigations/{case_id}/dismiss")
def post_dismiss_investigation(
    case_id: str,
    payload: AlertAction,
    db: Session = Depends(database.get_db),
    user=Depends(require_admin),
):
    """Dismiss an investigation case (recorded in activity_events with note).
    Cases are detector-derived, so dismissal is just a record — the case
    re-appears if the underlying condition persists, unless filtered."""
    if not payload.note:
        raise HTTPException(status_code=400, detail={"error": "note is required"})
    from services import pipeline_service
    return pipeline_service.admin_dismiss_investigation(
        db, case_id=case_id, actor=user.username, note=payload.note,
    )
