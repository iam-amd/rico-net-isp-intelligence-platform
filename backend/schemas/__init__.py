"""
Schemas package — re-exports all schemas for backward compatibility.
Existing code using `import schemas` or `from schemas import X` continues to work.
"""
# Common
from schemas.common import ROLE_VALUES, _validate_email, _validate_phone_digits

# Customer
from schemas.customer import (
    CustomerCreate,
    CustomerListResponse,
    CustomerPhoneCreate,
    CustomerPhoneResponse,
    CustomerResponse,
    CustomerStats,
    CustomerSummary,
    CustomerUpdate,
    ConnectionStatusUpdate,
    TicketSummary,
)

# Ticket
from schemas.ticket import (
    EnrichmentData,
    TicketAuditLogResponse,
    TicketBase,
    TicketCommentCreate,
    TicketCommentResponse,
    TicketCompleteRequest,
    TicketCompleteResponse,
    TicketCreate,
    TicketListResponse,
    TicketMediaResponse,
    TicketResponse,
    TicketUpdate,
)

# Technician
from schemas.technician import (
    PushTokenRequest,
    TechnicianCreate,
    TechnicianListResponse,
    TechnicianResponse,
    TechnicianStats,
    TechnicianUpdate,
)

# Inventory
from schemas.inventory import (
    InventoryItemBase,
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryItemUpdate,
    InventoryListResponse,
)

# Diagnostics
from schemas.diagnostics import DiagnosticAlert, DiagnosticsResponse

# Phone Lookup
from schemas.phone_lookup import PhoneLookupResponse

# Network Nodes
from schemas.network_node import NetworkNodeCreate, NetworkNodeUpdate, NodeOutageCreate
