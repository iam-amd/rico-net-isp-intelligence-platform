"""Diagnostics-related Pydantic schemas."""
from typing import List, Optional

from pydantic import BaseModel, Field


class DiagnosticAlert(BaseModel):
    alert_type: str = Field(max_length=50)
    severity: str = Field(max_length=20)
    message: str = Field(max_length=1000)
    details: Optional[dict] = None


class DiagnosticsResponse(BaseModel):
    customer_username: str = Field(max_length=50)
    customer_name: str = Field(max_length=200)
    alerts: List[DiagnosticAlert] = []
    can_create_ticket: bool = True
    summary: str = Field(default="No issues detected.", max_length=500)
    olt_data: Optional[dict] = None  # Live OLT data (Phase 2)
