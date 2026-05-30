"""Admin endpoints for managing the OLT registry.

Adding OLT #4 = POST /admin/olts with the new host's parameters.
Disabling = PATCH /admin/olts/{host} with {"enabled": false}.

All routes Admin-only.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

import database
from middleware.auth import require_admin
from services import olt_registry

logger = logging.getLogger("rico_net.admin_olts")

router = APIRouter(prefix="/admin/olts", tags=["Admin: OLT Registry"])


# â”€â”€â”€ Schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class OltCreate(BaseModel):
    host: str = Field(..., description="OLT IP address, e.g. 10.10.10.220")
    name: str = Field(..., description="Human-readable label")
    vendor: Optional[str] = "Netlink"
    model: Optional[str] = None
    firmware: Optional[str] = None
    pon_tech: str = Field(..., description="epon | gpon")
    optical_adapter_profile: str = Field(
        ...,
        description="epon_netlink_v203 | gpon_netlink_v23 | gpon_netlink_v14",
    )

    pon_mac_table_oid: Optional[str] = None
    pon_mac_position_col: Optional[int] = None
    pon_mac_col: Optional[int] = None
    pon_mac_indexed_by_oid: bool = True

    snmp_community: str = "public"
    snmp_port: int = 162
    snmp_timeout_sec: int = 5
    snmp_chunk: int = 50
    walk_timeout_sec: int = 90
    empty_retry: bool = False

    has_lan_mac_table: bool = False
    lan_mac_oid: Optional[str] = None
    requires_survey_for_binding: bool = False
    has_customer_bandwidth: bool = False
    has_pon_bandwidth: bool = False
    has_offline_reason: bool = False
    has_traps_verified: bool = False
    customer_bandwidth_reason: Optional[str] = None
    binding_match_note: Optional[str] = None

    enabled: bool = True
    notes: Optional[str] = None


class OltUpdate(BaseModel):
    name: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    firmware: Optional[str] = None
    pon_tech: Optional[str] = None
    optical_adapter_profile: Optional[str] = None
    pon_mac_table_oid: Optional[str] = None
    pon_mac_position_col: Optional[int] = None
    pon_mac_col: Optional[int] = None
    pon_mac_indexed_by_oid: Optional[bool] = None
    snmp_community: Optional[str] = None
    snmp_port: Optional[int] = None
    snmp_timeout_sec: Optional[int] = None
    snmp_chunk: Optional[int] = None
    walk_timeout_sec: Optional[int] = None
    empty_retry: Optional[bool] = None
    has_lan_mac_table: Optional[bool] = None
    lan_mac_oid: Optional[str] = None
    requires_survey_for_binding: Optional[bool] = None
    has_customer_bandwidth: Optional[bool] = None
    has_pon_bandwidth: Optional[bool] = None
    has_offline_reason: Optional[bool] = None
    has_traps_verified: Optional[bool] = None
    customer_bandwidth_reason: Optional[str] = None
    binding_match_note: Optional[str] = None
    enabled: Optional[bool] = None
    notes: Optional[str] = None


_KNOWN_PROFILES = {"epon_netlink_v203", "gpon_netlink_v23", "gpon_netlink_v14"}


def _validate_pon_tech_and_profile(pon_tech: Optional[str], profile: Optional[str]):
    if pon_tech is not None and pon_tech not in ("epon", "gpon"):
        raise HTTPException(status_code=400, detail="pon_tech must be 'epon' or 'gpon'")
    if profile is not None and profile not in _KNOWN_PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"optical_adapter_profile must be one of {sorted(_KNOWN_PROFILES)}",
        )


# â”€â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/")
def list_olts(
    include_disabled: bool = True,
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    olts = olt_registry.list_all(db) if include_disabled else olt_registry.list_active(db)
    return {"count": len(olts), "olts": [c.__dict__ for c in olts]}


@router.get("/{host}")
def get_olt(
    host: str,
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    cfg = olt_registry.get(db, host)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"OLT {host} not in registry")
    return cfg.__dict__


@router.post("/", status_code=201)
def create_olt(
    body: OltCreate,
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    _validate_pon_tech_and_profile(body.pon_tech, body.optical_adapter_profile)
    existing = db.execute(
        text("SELECT host FROM olt_registry WHERE host = :h"), {"h": body.host}
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"OLT {body.host} already registered")

    params = body.model_dump()
    cols = ", ".join(params.keys())
    placeholders = ", ".join(f":{k}" for k in params.keys())
    db.execute(text(f"INSERT INTO olt_registry ({cols}) VALUES ({placeholders})"), params)
    db.commit()
    olt_registry.invalidate_cache()
    logger.info("Admin created OLT %s (%s, %s)", body.host, body.name, body.optical_adapter_profile)
    cfg = olt_registry.get(db, body.host)
    return cfg.__dict__ if cfg else {"host": body.host}


@router.patch("/{host}")
def update_olt(
    host: str,
    body: OltUpdate,
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    existing = db.execute(
        text("SELECT host FROM olt_registry WHERE host = :h"), {"h": host}
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail=f"OLT {host} not in registry")

    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in ("notes", "lan_mac_oid", "customer_bandwidth_reason", "binding_match_note", "model", "firmware", "vendor")}
    if not changes:
        return {"ok": True, "changed": 0}
    _validate_pon_tech_and_profile(changes.get("pon_tech"), changes.get("optical_adapter_profile"))

    set_clauses = ", ".join(f"{k} = :{k}" for k in changes.keys())
    params = {**changes, "host": host}
    db.execute(text(f"UPDATE olt_registry SET {set_clauses}, updated_at = NOW() WHERE host = :host"), params)
    db.commit()
    olt_registry.invalidate_cache()
    logger.info("Admin updated OLT %s: %s", host, list(changes.keys()))
    cfg = olt_registry.get(db, host)
    return cfg.__dict__ if cfg else {"ok": True}


@router.delete("/{host}")
def delete_olt(
    host: str,
    db: Session = Depends(database.get_db),
    _user=Depends(require_admin),
):
    res = db.execute(text("DELETE FROM olt_registry WHERE host = :h"), {"h": host})
    db.commit()
    olt_registry.invalidate_cache()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"OLT {host} not in registry")
    logger.warning("Admin DELETED OLT %s from registry", host)
    return {"ok": True, "host": host}


# â”€â”€â”€ Helper: list known profiles (for admin UI dropdowns later) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/_meta/profiles")
def list_profiles(_user=Depends(require_admin)):
    return {
        "profiles": [
            {"key": "epon_netlink_v203", "label": "Netlink EPON V2.03.75R", "pon_tech": "epon"},
            {"key": "gpon_netlink_v23",  "label": "Netlink GPON V2.3.1R",   "pon_tech": "gpon"},
            {"key": "gpon_netlink_v14",  "label": "Netlink GPON V1.4.8R",   "pon_tech": "gpon"},
        ]
    }
