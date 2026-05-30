"""
Rico Net CMS V2 -- Auto-Diagnostics Router
=============================================
Thin HTTP wrapper — all business logic lives in services/diagnostics_service.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models, schemas
from database import get_db
from middleware.auth import get_current_user
from services import diagnostics_service, olt_service

router = APIRouter(
    prefix="/diagnostics",
    tags=["Auto-Diagnostics"],
)


@router.get("/{customer_username}", response_model=schemas.DiagnosticsResponse)
async def run_diagnostics(
    customer_username: str,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return await diagnostics_service.run_diagnostics(db, customer_username)


@router.post("/olt/reboot")
async def reboot_onu(
    customer_username: str,
    db: Session = Depends(get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    """
    Diagnostics-flow reboot — Admin/Senior Tech only.

    Three reboot endpoints exist on purpose, each scoped to a different UX entry:
      - /diagnostics/olt/reboot    (this) — invoked from the auto-diagnosis screen
      - /field-team/reboot/{user}        — invoked from the mobile app
      - /noc/reboot-onu                  — invoked from the NOC dashboard

    All three converge on `olt_service.reboot_onu(mac)` so the OLT-side
    behaviour is identical; only the role gates and request shapes differ.
    """
    # Authorization check
    if current_user.role not in ("Admin", "Senior Tech"):
        raise HTTPException(status_code=403, detail="Insufficient permissions for remote reboot")

    # Get customer
    customer = (
        db.query(models.Customer)
        .filter(models.Customer.username == customer_username)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    if not customer.mac_address:
        raise HTTPException(status_code=400, detail="Customer MAC address not configured")

    # Send reboot command
    success = await olt_service.reboot_onu(customer.mac_address)
    if not success:
        raise HTTPException(status_code=503, detail="OLT reboot failed or OLT proxy unavailable")

    return {"status": "success", "message": f"ONU {customer.mac_address} rebooting", "mac_address": customer.mac_address}
