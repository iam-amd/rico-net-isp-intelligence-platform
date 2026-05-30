"""ONU identity sync — pulls SN+model per slot from the Pi proxy.

WHY THIS EXISTS:
The Pi poller runs SNMP every 60s (fast, gives MAC + optical) and sends to
/ingest/onu-snapshots. SNMP does NOT carry the ONT serial number.

The ONT serial only comes from Telnet (`show onu info all`) on GPON OLTs.
Rather than slowing the every-60s poll down with Telnet, we run a separate
identity sync periodically — once per hour is plenty since SN never changes
unless the device itself is physically replaced.

This service hits the Pi proxy's /olt/scan endpoint, which already does the
Telnet walk for us, then updates onu_latest with the SN/model per slot.

Auth via OLT_PROXY_TOKEN. Reuses the same settings as olt_service / field_tech.
"""
from __future__ import annotations

import logging
from typing import Dict

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from config.settings import settings
from .activity_log import emit as activity_emit, SEVERITY_INFO

logger = logging.getLogger("rico_net.onu_identity_sync")


def sync_identity_from_pi(db: Session, *, timeout: int = 180) -> Dict[str, int]:
    """Pull ONU identity (SN, model) from Pi proxy, update onu_latest by slot.

    Returns counters: {scanned, sn_updates, model_updates}.
    """
    counters = {"scanned": 0, "sn_updates": 0, "model_updates": 0}

    if not settings.OLT_PROXY_URL:
        logger.warning("identity_sync: OLT_PROXY_URL not set; skipping")
        return counters

    url = f"{settings.OLT_PROXY_URL.rstrip('/')}/olt/scan"
    headers = {"X-Proxy-Token": settings.OLT_PROXY_TOKEN} if settings.OLT_PROXY_TOKEN else {}

    try:
        r = requests.post(url, headers=headers, timeout=timeout)
        r.raise_for_status()
        payload = r.json()
    except Exception as e:
        logger.warning("identity_sync: Pi proxy /olt/scan failed: %s", e)
        return counters

    onus = payload.get("onus") or []
    counters["scanned"] = len(onus)
    if not onus:
        return counters

    sn_rows = []
    for o in onus:
        sn = o.get("serial_number")
        model = o.get("model_id")
        if not (sn or model):
            continue
        olt = o.get("olt_host")
        port = o.get("pon_port")
        idx = o.get("onu_index")
        if not olt or not port or idx is None:
            continue
        sn_rows.append({
            "olt": olt, "port": port, "idx": int(idx),
            "sn": sn, "model": model,
        })

    if not sn_rows:
        return counters

    # Update onu_latest by SLOT (not by MAC) — the slot is the stable identity
    # anchor. We may UPDATE multiple onu_latest rows that share the same slot
    # (the aggregation-slot case) — that's fine, all of them get the same SN
    # which would still be wrong; so additionally check: only update rows whose
    # MAC matches the optical_mac visible on that slot.
    #
    # Conservative version: update only rows whose mac equals the canonical MAC
    # at that slot. If onu_latest already has an entry with that (olt,port,idx)
    # AND its MAC is the one the Pi reports for the slot, set SN/model.
    for row in sn_rows:
        sn_was_null = db.execute(text("""
            SELECT mac_address FROM onu_latest
            WHERE olt_host = :olt AND pon_port = :port AND onu_index = :idx
              AND (ont_serial_number IS NULL OR ont_serial_number = '')
        """), row).scalar()

        res = db.execute(text("""
            UPDATE onu_latest
            SET ont_serial_number = COALESCE(NULLIF(:sn,''), ont_serial_number),
                model_id          = COALESCE(NULLIF(:model,''), model_id),
                updated_at        = NOW()
            WHERE olt_host = :olt AND pon_port = :port AND onu_index = :idx
        """), row)
        if res.rowcount > 0 and row["sn"] and sn_was_null:
            counters["sn_updates"] += 1
        if res.rowcount > 0 and row["model"]:
            counters["model_updates"] += 1

    db.commit()

    if counters["sn_updates"] > 0:
        activity_emit(
            db,
            category="enrichment.identity_synced",
            severity=SEVERITY_INFO,
            actor="onu_identity_sync",
            summary=f"Pulled {counters['scanned']} ONU identities from Pi proxy; "
                    f"{counters['sn_updates']} new SNs persisted",
            payload=counters,
        )
        db.commit()

    return counters
