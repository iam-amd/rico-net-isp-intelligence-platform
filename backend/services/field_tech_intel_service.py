"""
Rico Net — Field Tech Intelligence Service
=============================================
Composes data from noc_service, prediction table, and diagnosis_service
into mobile-friendly responses for field technicians.
No FastAPI imports — pure DB logic.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import func, text
from sqlalchemy.orm import Session

import models
from config.settings import settings
from services.noc_service import (
    _load_customer_index,
    _fuzzy_find_customer,
    _customer_name,
    get_signal_history,
    detect_outages,
)
from services.onu_binding_service import observed_lookup_values

logger = logging.getLogger("rico_net.field_tech_intel")


# ---------------------------------------------------------------------------
# Signal level classification (from CLAUDE.md thresholds)
# ---------------------------------------------------------------------------
def _signal_level(rx: Optional[float]) -> Optional[str]:
    if rx is None:
        return None
    if rx > -20:
        return "excellent"
    if rx > -24:
        return "good"
    if rx > -27:
        return "weak"
    return "critical"


# ---------------------------------------------------------------------------
# Fault type → recommended tools mapping
# ---------------------------------------------------------------------------
_FAULT_TOOLS: Dict[str, List[str]] = {
    "POWER_CUT": ["Multimeter", "Power adapter (spare)"],
    "FIBER_CRITICAL": ["OTDR", "Fiber splice kit", "Cleaning kit", "Patch cord"],
    "FIBER_WEAK": ["OTDR", "Cleaning kit", "Patch cord"],
    "FIBER_FLAP": ["OTDR", "Cleaning kit", "Splice closure kit"],
    "ONU_OFFLINE": ["Spare ONT", "Patch cord", "Power adapter"],
}

# Fault type → severity (1=low, 5=critical) for dispatch sorting
_FAULT_SEVERITY: Dict[str, int] = {
    "FIBER_CRITICAL": 5,
    "POWER_CUT": 4,
    "FIBER_FLAP": 3,
    "ONU_OFFLINE": 3,
    "FIBER_WEAK": 2,
}


def _billing_status(expiry: Optional[Any]) -> tuple:
    """Returns (status_string, days_until_expiry)."""
    if expiry is None:
        return ("unknown", None)
    now = datetime.now(timezone.utc)
    try:
        exp = expiry if hasattr(expiry, "tzinfo") else datetime.fromisoformat(str(expiry))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        days = (exp - now).days
        if days < 0:
            return ("expired", days)
        if days <= 7:
            return ("expiring", days)
        return ("active", days)
    except Exception:
        return ("unknown", None)


def _classify_onu_fault(onu: models.ONULatest) -> Optional[str]:
    """Classify the current fault type of an ONU based on live state."""
    if onu.dying_gasp:
        return "POWER_CUT"
    if onu.status != "online":
        if onu.rx_power_dbm is not None and onu.rx_power_dbm < -27:
            return "FIBER_CRITICAL"
        return "ONU_OFFLINE"
    if onu.rx_power_dbm is not None:
        if onu.rx_power_dbm < -27:
            return "FIBER_CRITICAL"
        if onu.rx_power_dbm < -24:
            return "FIBER_WEAK"
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_ticket_briefing(
    db: Session, customer_username: str
) -> Dict[str, Any]:
    """
    Single-call pre-visit intelligence card.
    Returns everything a tech needs before visiting a customer.
    """
    customer = db.query(models.Customer).filter(
        models.Customer.username == customer_username
    ).first()

    if not customer:
        return {"no_onu_linked": True, "error": "Customer not found"}

    # Find linked ONU via mac_address, olt_host+pon_port+onu_index, or fuzzy MAC match
    onu = _find_onu_for_customer(db, customer)

    if not onu:
        return {"no_onu_linked": True}

    # Fault classification from live state
    fault_type = _classify_onu_fault(onu)

    # Signal history (24h)
    history = get_signal_history(db, onu.mac_address, hours=24)

    # Prediction data
    prediction = db.query(models.Prediction).filter(
        models.Prediction.mac_address == onu.mac_address
    ).first()

    # Alarm count (24h)
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    alarm_count = db.query(func.count(models.AlarmEvent.id)).filter(
        models.AlarmEvent.mac_address == onu.mac_address,
        models.AlarmEvent.received_at >= since_24h,
    ).scalar() or 0

    # Area outage check
    area_outage = None
    if onu.pon_port and onu.olt_host:
        area_outage = check_area_outage(db, onu.pon_port, onu.olt_host)

    # Billing
    billing_st, days_exp = _billing_status(customer.expiry_date)

    # Recommended action + tools
    rec_action = prediction.recommended_action if prediction else None
    if not rec_action and fault_type:
        # Fallback action text based on fault type
        rec_action = {
            "POWER_CUT": "Call customer to confirm power — do NOT dispatch yet",
            "FIBER_CRITICAL": "Dispatch with OTDR + fiber splice kit immediately",
            "FIBER_WEAK": "Schedule maintenance within 48h",
            "FIBER_FLAP": "Check splice and connector for intermittent contact",
            "ONU_OFFLINE": "Try remote reboot first before dispatching",
        }.get(fault_type)

    return {
        "onu_status": onu.status,
        "rx_power": onu.rx_power_dbm,
        "tx_power": onu.tx_power_dbm,
        "temperature": onu.temperature_c,
        "voltage": onu.voltage_mv,
        "dying_gasp": onu.dying_gasp,
        "signal_level": _signal_level(onu.rx_power_dbm),
        "polled_at": onu.polled_at,
        "mac_address": onu.mac_address,
        "olt_host": onu.olt_host,
        "pon_port": onu.pon_port,
        "fault_type": fault_type,
        "recommended_action": rec_action,
        "recommended_tools": _FAULT_TOOLS.get(fault_type, []),
        "health_score": prediction.health_score if prediction else None,
        "fiber_risk": prediction.fiber_risk if prediction else None,
        "churn_risk": prediction.churn_risk if prediction else None,
        "billing_status": billing_st,
        "days_until_expiry": days_exp,
        "alarm_count_24h": alarm_count,
        "area_outage": area_outage,
        "signal_history": history,
        "no_onu_linked": False,
    }


def get_onu_live_status(db: Session, mac: str) -> Optional[Dict[str, Any]]:
    """Lightweight current ONU metrics for 30s auto-refresh."""
    onu = db.query(models.ONULatest).filter(
        models.ONULatest.mac_address == mac
    ).first()
    if not onu:
        return None
    return {
        "mac_address": onu.mac_address,
        "status": onu.status,
        "rx_power": onu.rx_power_dbm,
        "tx_power": onu.tx_power_dbm,
        "temperature": onu.temperature_c,
        "voltage": onu.voltage_mv,
        "dying_gasp": onu.dying_gasp,
        "signal_level": _signal_level(onu.rx_power_dbm),
        "polled_at": onu.polled_at,
    }


def get_signal_sparkline(
    db: Session, mac: str, hours: int = 24
) -> List[Dict[str, Any]]:
    """24h signal history data points for sparkline rendering."""
    return get_signal_history(db, mac, hours=hours)


def check_area_outage(
    db: Session, pon_port: str, olt_host: str
) -> Optional[Dict[str, Any]]:
    """Check if a specific port has an active outage."""
    outages = detect_outages(db)
    for outage in outages:
        if outage["olt_host"] == olt_host and pon_port in outage.get("pon_port", ""):
            return {
                "pon_port": outage["pon_port"],
                "olt_host": outage["olt_host"],
                "affected_count": outage["affected_count"],
                "total_count": outage["total_count"],
                "severity": outage["severity"],
                "detection": outage["detection"],
            }
    return None


def get_smart_dispatch_queue(
    db: Session, tech_id: int
) -> List[Dict[str, Any]]:
    """
    Enriched ticket list sorted by fault severity + health score.
    Returns tickets assigned to this tech (or unassigned), enriched with
    ONU intelligence.
    """
    tech = db.query(models.Technician).filter(
        models.Technician.id == tech_id
    ).first()
    if not tech:
        return []

    # Get open/in-progress tickets assigned to this tech or unassigned
    tickets = db.query(models.Ticket).filter(
        models.Ticket.status.in_(["Open", "In Progress"]),
        (models.Ticket.assigned_tech == tech.username) |
        (models.Ticket.assigned_tech.is_(None)),
    ).order_by(models.Ticket.created_at.desc()).limit(50).all()

    if not tickets:
        return []

    # Load customer index for MAC lookups
    cust_index = _load_customer_index(db)

    # Preload outages once
    outages = detect_outages(db)
    outage_ports = {
        (o["olt_host"], o["pon_port"]): o for o in outages
    }

    items = []
    for t in tickets:
        customer = db.query(models.Customer).filter(
            models.Customer.username == t.customer_id
        ).first() if t.customer_id else None

        # Find linked ONU
        onu = _find_onu_for_customer(db, customer) if customer else None

        # Prediction
        prediction = None
        if onu:
            prediction = db.query(models.Prediction).filter(
                models.Prediction.mac_address == onu.mac_address
            ).first()

        fault_type = _classify_onu_fault(onu) if onu else None
        fault_severity = _FAULT_SEVERITY.get(fault_type, 0) if fault_type else 0
        health_score = prediction.health_score if prediction else None

        # Check area outage
        has_outage = False
        if onu and onu.pon_port and onu.olt_host:
            has_outage = (onu.olt_host, onu.pon_port) in outage_ports

        rec_action = prediction.recommended_action if prediction else None

        items.append({
            "ticket_id": t.id,
            "customer_name": _customer_name(customer) if customer else None,
            "customer_phone": customer.phone if customer else None,
            "customer_address": customer.railwire_address if customer else None,
            "customer_username": t.customer_id,
            "issue_type": t.issue_type,
            "priority": t.priority,
            "status": t.status,
            "created_at": t.created_at,
            "description": t.description,
            "fault_type": fault_type,
            "fault_severity": fault_severity,
            "health_score": health_score,
            "recommended_action": rec_action,
            "recommended_tools": _FAULT_TOOLS.get(fault_type, []),
            "onu_status": onu.status if onu else None,
            "rx_power": onu.rx_power_dbm if onu else None,
            "signal_level": _signal_level(onu.rx_power_dbm) if onu else None,
            "has_area_outage": has_outage,
        })

    # Sort: highest fault_severity first, then lowest health_score
    items.sort(key=lambda x: (
        -(x["fault_severity"] or 0),
        x["health_score"] if x["health_score"] is not None else 999,
    ))

    return items


def get_troubleshooting_steps(fault_type: str) -> Optional[Dict[str, Any]]:
    """Step-by-step checklist per fault type. Pure function, no DB."""
    guides = {
        "POWER_CUT": {
            "fault_type": "POWER_CUT",
            "title": "Power Cut / Dying Gasp",
            "steps": [
                {"step_number": 1, "instruction": "Call customer to confirm power status", "expected_outcome": "Customer confirms power is on or off"},
                {"step_number": 2, "instruction": "Check area power status — ask neighbours or check EB supply", "expected_outcome": "Determine if area-wide power cut"},
                {"step_number": 3, "instruction": "Wait 30 minutes for auto-resolve if power cut confirmed", "expected_outcome": "ONU comes back online automatically"},
                {"step_number": 4, "instruction": "If power confirmed ON, check ONU power adapter and cable", "tool": "Multimeter", "expected_outcome": "Adapter outputs 12V / 1A"},
                {"step_number": 5, "instruction": "Replace power adapter if faulty", "tool": "Power adapter (spare)", "expected_outcome": "ONU powers on, link light active"},
            ],
            "safety_notes": [
                "Do NOT dispatch if area-wide power cut — wait for power restoration",
                "Check if UPS/inverter is available at customer premises",
            ],
        },
        "FIBER_CRITICAL": {
            "fault_type": "FIBER_CRITICAL",
            "title": "Critical Fiber Signal (Rx < -27 dBm)",
            "steps": [
                {"step_number": 1, "instruction": "Check physical fiber connector at ONT — ensure it's fully seated", "expected_outcome": "Connector clicks into place, no visible damage"},
                {"step_number": 2, "instruction": "Clean ferrule with IPA wipe and lint-free cloth", "tool": "Cleaning kit", "expected_outcome": "Ferrule clean, no dust or oil"},
                {"step_number": 3, "instruction": "Measure signal with OTDR from ONT end", "tool": "OTDR", "expected_outcome": "Identify loss points, reflections, or breaks"},
                {"step_number": 4, "instruction": "Check nearest splice point / closure for moisture or damage", "tool": "Fiber splice kit", "expected_outcome": "Splice intact, no water ingress"},
                {"step_number": 5, "instruction": "Replace patch cord if damaged or high loss", "tool": "Patch cord", "expected_outcome": "Signal improves above -24 dBm"},
            ],
            "safety_notes": [
                "Never look into fiber end — laser can damage eyes",
                "Handle fiber carefully — minimum bend radius 30mm",
                "Document OTDR trace before and after repair",
            ],
        },
        "FIBER_WEAK": {
            "fault_type": "FIBER_WEAK",
            "title": "Weak Fiber Signal (Rx -24 to -27 dBm)",
            "steps": [
                {"step_number": 1, "instruction": "Clean connector at ONT with IPA wipe", "tool": "Cleaning kit", "expected_outcome": "Signal improves 1-2 dBm"},
                {"step_number": 2, "instruction": "Check patch cord bend radius — ensure no sharp bends", "expected_outcome": "Patch cord routed with gentle curves"},
                {"step_number": 3, "instruction": "Measure with OTDR to find loss points", "tool": "OTDR", "expected_outcome": "Identify any degraded splices"},
                {"step_number": 4, "instruction": "Schedule splice rework if signal continues degrading", "tool": "Fiber splice kit", "expected_outcome": "Signal stabilises above -24 dBm"},
            ],
            "safety_notes": [
                "Monitor signal trend over 48h after cleaning",
                "If signal drops again within a week, escalate to fiber team lead",
            ],
        },
        "ONU_OFFLINE": {
            "fault_type": "ONU_OFFLINE",
            "title": "ONU Offline (No Dying Gasp)",
            "steps": [
                {"step_number": 1, "instruction": "Try remote reboot using the Reboot ONU button", "expected_outcome": "ONU reboots and comes back online within 2 minutes"},
                {"step_number": 2, "instruction": "If no recovery, check power at customer premises", "expected_outcome": "Confirm ONU has power, LEDs are on"},
                {"step_number": 3, "instruction": "Check fiber connector at ONT — clean if dusty", "tool": "Cleaning kit", "expected_outcome": "PON LED goes solid green"},
                {"step_number": 4, "instruction": "Replace ONT if hardware fault suspected", "tool": "Spare ONT", "expected_outcome": "New ONT registers and comes online"},
            ],
            "safety_notes": [
                "Always try remote reboot before dispatching",
                "If multiple ONUs offline on same port, check for area outage first",
            ],
        },
        "FIBER_FLAP": {
            "fault_type": "FIBER_FLAP",
            "title": "Fiber Flapping (Intermittent Connection)",
            "steps": [
                {"step_number": 1, "instruction": "Check all connectors for loose contact — gently push and twist", "expected_outcome": "All connectors firmly seated"},
                {"step_number": 2, "instruction": "Inspect patch cord for micro-bends or damage", "expected_outcome": "No visible damage, kinks, or sharp bends"},
                {"step_number": 3, "instruction": "Check splice closure for moisture or water ingress", "tool": "Splice closure kit", "expected_outcome": "Closure dry, gel seal intact"},
                {"step_number": 4, "instruction": "Measure with OTDR — look for reflectance spikes indicating bad splices", "tool": "OTDR", "expected_outcome": "Reflectance below -45 dB at all splice points"},
            ],
            "safety_notes": [
                "Flapping can cause service interruption for other ONUs on same splitter",
                "Document before/after OTDR traces for comparison",
            ],
        },
    }

    return guides.get(fault_type.upper()) if fault_type else None


async def reboot_onu(db: Session, customer_username: str) -> Dict[str, str]:
    """
    Remote ONU reboot via OLT proxy.
    Finds the customer's MAC, then calls the OLT proxy /olt/reboot endpoint.
    """
    if not settings.OLT_PROXY_ENABLED or not settings.OLT_PROXY_URL:
        return {"status": "error", "message": "OLT proxy not configured"}

    customer = db.query(models.Customer).filter(
        models.Customer.username == customer_username
    ).first()
    if not customer:
        return {"status": "error", "message": "Customer not found"}

    onu = _find_onu_for_customer(db, customer)
    if not onu:
        return {"status": "error", "message": "No ONU linked to this customer"}

    try:
        async with httpx.AsyncClient(timeout=settings.OLT_PROXY_TIMEOUT_SEC) as client:
            resp = await client.post(
                f"{settings.OLT_PROXY_URL}/olt/reboot",
                json={"mac_address": onu.mac_address},
                headers={"X-Proxy-Token": settings.OLT_PROXY_TOKEN},
            )
            if resp.status_code == 200:
                return {"status": "success", "message": f"Reboot command sent for ONU {onu.mac_address}"}
            return {"status": "error", "message": f"OLT proxy returned {resp.status_code}: {resp.text}"}
    except httpx.TimeoutException:
        return {"status": "error", "message": "OLT proxy timed out"}
    except Exception as e:
        logger.error("reboot_onu failed: %s", str(e))
        return {"status": "error", "message": f"Failed to reach OLT proxy: {str(e)}"}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_onu_for_customer(
    db: Session, customer: Optional[models.Customer]
) -> Optional[models.ONULatest]:
    """
    Find the ONULatest record linked to a customer.
    Strategy:
    1. Direct lookup via customer.olt_host + pon_port + onu_index
    2. Direct lookup via customer.mac_address
    3. Fuzzy MAC match (ONU MAC + offset = customer PPPoE MAC)
    """
    if not customer:
        return None

    # Strategy 0: authoritative active ONU binding from field/admin verification.
    binding = db.query(models.ONUBinding).filter(
        models.ONUBinding.customer_id == customer.username,
        models.ONUBinding.is_active.is_(True),
    ).order_by(models.ONUBinding.verified_at.desc().nullslast()).first()
    if binding:
        if binding.olt_host and binding.pon_port and binding.onu_index is not None:
            onu = db.query(models.ONULatest).filter(
                models.ONULatest.olt_host == binding.olt_host,
                models.ONULatest.pon_port == binding.pon_port,
                models.ONULatest.onu_index == binding.onu_index,
            ).first()
            if onu:
                return onu

        keys = set()
        for value in (binding.onu_identifier, binding.mac_address, binding.serial_number):
            keys.update(observed_lookup_values(value)["identifiers"])
        if keys:
            onu = db.query(models.ONULatest).filter(
                func.upper(models.ONULatest.mac_address).in_(keys)
            ).first()
            if onu:
                return onu

    # Strategy 1: OLT binding fields
    if customer.olt_host and customer.pon_port and customer.onu_index is not None:
        onu = db.query(models.ONULatest).filter(
            models.ONULatest.olt_host == customer.olt_host,
            models.ONULatest.pon_port == customer.pon_port,
            models.ONULatest.onu_index == customer.onu_index,
        ).first()
        if onu:
            return onu

    # Strategy 2: Direct MAC match
    if customer.mac_address:
        onu = db.query(models.ONULatest).filter(
            models.ONULatest.mac_address == customer.mac_address
        ).first()
        if onu:
            return onu

        # Strategy 3: Fuzzy MAC match (PPPoE MAC → ONU EPON MAC)
        # Customer has PPPoE/WAN MAC; ONU has EPON MAC (offset by known delta)
        cust_index = _load_customer_index(db)
        # Reverse search: iterate ONUs on same prefix and check if this customer matches
        prefix = customer.mac_address.upper()[:14]
        try:
            cust_last = int(customer.mac_address.upper()[-2:], 16)
        except ValueError:
            return None

        onus_on_prefix = db.query(models.ONULatest).filter(
            models.ONULatest.mac_address.like(f"{prefix[:8]}%")
        ).all()
        for candidate_onu in onus_on_prefix:
            match = _fuzzy_find_customer(cust_index, candidate_onu.mac_address)
            if match and match.id == customer.id:
                return candidate_onu

    return None
