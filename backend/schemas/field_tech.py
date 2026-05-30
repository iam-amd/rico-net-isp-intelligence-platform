"""Field technician intelligence schemas — response models for mobile app."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SignalPoint(BaseModel):
    timestamp: datetime
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    status: Optional[str] = None


class AreaOutageInfo(BaseModel):
    pon_port: str
    olt_host: str
    affected_count: int
    total_count: int
    severity: str  # MINOR / MAJOR / CRITICAL / TOTAL
    detection: str  # PORT / CONCURRENT


class TicketBriefing(BaseModel):
    """Single-call pre-visit intelligence card for a customer."""
    # ONU live state
    onu_status: Optional[str] = None  # online / offline
    rx_power: Optional[float] = None
    tx_power: Optional[float] = None
    temperature: Optional[float] = None
    voltage: Optional[int] = None
    dying_gasp: bool = False
    signal_level: Optional[str] = None  # excellent / good / weak / critical
    polled_at: Optional[datetime] = None
    mac_address: Optional[str] = None
    olt_host: Optional[str] = None
    pon_port: Optional[str] = None

    # Fault classification
    fault_type: Optional[str] = None  # POWER_CUT / FIBER_CRITICAL / ONU_OFFLINE / etc.
    recommended_action: Optional[str] = None
    recommended_tools: List[str] = []

    # Predictions
    health_score: Optional[int] = None  # 0-100
    fiber_risk: Optional[str] = None  # LOW / MEDIUM / HIGH / CRITICAL
    churn_risk: Optional[str] = None  # LOW / MEDIUM / HIGH

    # Billing
    billing_status: Optional[str] = None  # active / expiring / expired
    days_until_expiry: Optional[int] = None

    # Alarms
    alarm_count_24h: int = 0

    # Area outage
    area_outage: Optional[AreaOutageInfo] = None

    # 24h signal history (for sparkline)
    signal_history: List[SignalPoint] = []

    # Customer has no linked ONU
    no_onu_linked: bool = False


class ONULiveStatus(BaseModel):
    """Lightweight ONU metrics for auto-refresh polling."""
    mac_address: str
    status: Optional[str] = None
    rx_power: Optional[float] = None
    tx_power: Optional[float] = None
    temperature: Optional[float] = None
    voltage: Optional[int] = None
    dying_gasp: bool = False
    signal_level: Optional[str] = None
    polled_at: Optional[datetime] = None


class TroubleshootingStep(BaseModel):
    step_number: int
    instruction: str
    tool: Optional[str] = None
    expected_outcome: Optional[str] = None


class TroubleshootingGuide(BaseModel):
    fault_type: str
    title: str
    steps: List[TroubleshootingStep]
    safety_notes: List[str] = []


class SmartDispatchItem(BaseModel):
    """Enriched ticket for the smart dispatch queue."""
    ticket_id: int
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    customer_username: Optional[str] = None
    issue_type: Optional[str] = None
    priority: Optional[str] = None
    status: str
    created_at: datetime
    description: Optional[str] = None

    # Intelligence enrichment
    fault_type: Optional[str] = None
    fault_severity: Optional[int] = None  # 1-5, higher = worse
    health_score: Optional[int] = None
    recommended_action: Optional[str] = None
    recommended_tools: List[str] = []
    onu_status: Optional[str] = None
    rx_power: Optional[float] = None
    signal_level: Optional[str] = None
    has_area_outage: bool = False

    class Config:
        from_attributes = True


class RebootResponse(BaseModel):
    status: str  # success / error
    message: str
