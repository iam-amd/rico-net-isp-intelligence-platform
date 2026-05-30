"""Phone lookup Pydantic schemas."""
from typing import List, Optional

from pydantic import BaseModel, Field

from schemas.customer import CustomerSummary, TicketSummary


class PhoneLookupResponse(BaseModel):
    found: bool
    customer: Optional[CustomerSummary] = None
    phone_label: Optional[str] = Field(default=None, max_length=50)
    recent_tickets: List[TicketSummary] = []
    has_unpaid_balance: bool = False
    balance: float = 0.0
