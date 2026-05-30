"""Pydantic schemas for OLT ingest endpoints."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# =============================================================================
# ONU SNAPSHOT INGEST
# =============================================================================

class ONUSnapshotItem(BaseModel):
    mac_address: str = Field(max_length=17, description="Normalized MAC e.g. 8c:c7:c3:ea:c7:00")
    olt_host: Optional[str] = Field(default=None, max_length=45)
    pon_port: Optional[str] = Field(default=None, max_length=20)
    onu_index: Optional[int] = None
    status: Optional[str] = Field(default=None, max_length=10)  # online / offline
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    voltage_mv: Optional[int] = None
    flap_count: Optional[int] = None
    dying_gasp: bool = False
    distance_m: Optional[int] = None
    rx_bytes_delta: Optional[int] = None
    tx_bytes_delta: Optional[int] = None
    vendor_id: Optional[str] = Field(default=None, max_length=20)
    model_id: Optional[str] = Field(default=None, max_length=20)
    hw_version: Optional[str] = Field(default=None, max_length=20)
    sw_version: Optional[str] = Field(default=None, max_length=30)
    # GPON canonical serial number from `show onu info all` (alias 'serial_number' so the
    # Pi poller's existing payload key is accepted without changing the Pi code).
    ont_serial_number: Optional[str] = Field(default=None, max_length=64, alias="serial_number")
    model_config = {"populate_by_name": True}
    # Web portal extra fields (populated when transport=web, None otherwise)
    deregister_reason: Optional[str] = Field(default=None, max_length=50)
    alive_time_sec: Optional[int] = None
    rtt_ns: Optional[int] = None
    tx_bias_current_ma: Optional[float] = None
    polled_at: Optional[datetime] = None  # ISO8601; filled in by poller, defaulted server-side if absent


class ONUSnapshotBatch(BaseModel):
    onus: List[ONUSnapshotItem]
    collector_id: Optional[str] = Field(default=None, max_length=80)
    collector_name: Optional[str] = Field(default=None, max_length=120)
    collector_hostname: Optional[str] = Field(default=None, max_length=120)
    collector_ip: Optional[str] = Field(default=None, max_length=45)
    collector_version: Optional[str] = Field(default=None, max_length=40)
    collector_started_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None


class ONUSnapshotBatchResponse(BaseModel):
    inserted: int
    polled_at: str  # ISO8601 UTC timestamp of the batch


class CollectorHeartbeat(BaseModel):
    collector_id: str = Field(max_length=80)
    collector_name: Optional[str] = Field(default=None, max_length=120)
    collector_hostname: Optional[str] = Field(default=None, max_length=120)
    collector_ip: Optional[str] = Field(default=None, max_length=45)
    collector_version: Optional[str] = Field(default=None, max_length=40)
    collector_started_at: Optional[datetime] = None
    status: str = Field(default="ok", max_length=30)
    message: Optional[str] = Field(default=None, max_length=500)
    backend_url: Optional[str] = Field(default=None, max_length=500)
    configured_olts: List[str] = Field(default_factory=list)
    last_batch_total: Optional[int] = None
    last_snapshot_at: Optional[datetime] = None
    heartbeat_at: Optional[datetime] = None


class CollectorHeartbeatResponse(BaseModel):
    status: str
    collector_id: str
    heartbeat_at: str


# =============================================================================
# ALARM EVENT INGEST
# =============================================================================

class AlarmEventCreate(BaseModel):
    mac_address: str = Field(max_length=17)
    event_type: str = Field(max_length=50, description="e.g. ONU_OFFLINE, ONU_ONLINE, DYING_GASP")
    olt_host: Optional[str] = Field(default=None, max_length=45)
    pon_port: Optional[str] = Field(default=None, max_length=20)
    onu_index: Optional[int] = None
    payload: Optional[Dict[str, Any]] = None  # raw trap varbinds or context dict
    received_at: Optional[datetime] = None    # filled by trap receiver; defaulted server-side if absent


class AlarmEventResponse(BaseModel):
    id: int

    class Config:
        from_attributes = True
