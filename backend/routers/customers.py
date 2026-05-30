"""
Rico Net CMS — Customer Router
================================
Thin HTTP wrapper — all business logic lives in services/customer_service.py.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional
from pydantic import BaseModel

import models, schemas, database
from middleware.auth import get_current_user
from services import customer_service

router = APIRouter(
    prefix="/customers",
    tags=["Customers"],
)

# --- Rate limiter (conditional) ---
try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    limiter = Limiter(key_func=get_remote_address)
    _RATE_LIMITING = True
except ImportError:
    limiter = None
    _RATE_LIMITING = False


def _limit(rate: str):
    if _RATE_LIMITING and limiter:
        return limiter.limit(rate)
    def _noop(func):
        return func
    return _noop


# Quick Lookup for Autocomplete
@router.get("/lookup")
@_limit("30/minute")
def get_customer_lookup(
    request: Request,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.get_customer_lookup(db)


# Stats Endpoint
@router.get("/dashboard-stats", response_model=schemas.CustomerStats)
def get_customer_stats(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.get_customer_stats(db)


# Operations Centre — single-call intelligence for dashboard
@router.get("/operations-summary")
def get_operations_summary(
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.get_operations_summary(db)


# Create Customer
@router.post("/", response_model=schemas.CustomerResponse)
def create_customer(
    customer: schemas.CustomerCreate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.create_customer(db, customer, current_user.username)


# Get single customer by numeric ID
@router.get("/by-id/{customer_id}", response_model=schemas.CustomerResponse)
def get_customer_by_id(
    customer_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.get_customer_by_id(db, customer_id)


# Update customer connection status
@router.patch("/{customer_id}/connection-status", response_model=schemas.CustomerResponse)
def update_connection_status(
    customer_id: str,
    payload: schemas.ConnectionStatusUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.update_connection_status(db, customer_id, payload, current_user.username)


# Get single customer by username
@router.get("/{username}", response_model=schemas.CustomerResponse)
def get_customer(
    username: str,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.get_customer(db, username)


# List customers with filtering and pagination
@router.get("/", response_model=schemas.CustomerListResponse)
def list_customers(
    skip: int = 0,
    limit: int = 10,
    q: Optional[str] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    expiry_filter: Optional[str] = None,
    expiry_start: Optional[date] = None,
    expiry_end: Optional[date] = None,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.list_customers(
        db,
        skip=skip,
        limit=limit,
        q=q,
        search=search,
        status=status,
        expiry_filter=expiry_filter,
        expiry_start=expiry_start,
        expiry_end=expiry_end,
    )


# Update Customer
@router.put("/{username}", response_model=schemas.CustomerResponse)
def update_customer(
    username: str,
    data: schemas.CustomerUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.update_customer(db, username, data, current_user.username)


# Delete Customer
@router.delete("/{username}")
def delete_customer(
    username: str,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    return customer_service.delete_customer(db, username, current_user)


# Update Customer GPS Location (field tech or admin)
class LocationUpdate(BaseModel):
    lat: float
    lng: float
    source: str = "field_tech"  # field_tech | admin | whatsapp


@router.patch("/{username}/location")
def update_customer_location(
    username: str,
    payload: LocationUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.Technician = Depends(get_current_user),
):
    customer = db.query(models.Customer).filter(models.Customer.username == username).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    changes = customer_service.diff_and_apply(
        customer,
        {"geo_lat": payload.lat, "geo_long": payload.lng},
    )
    if changes:
        customer_service.write_customer_audit(
            db,
            customer_id=customer.username,
            changes=changes,
            changed_by=f"{current_user.username} ({payload.source})",
            action="LOCATION_UPDATE",
        )
    db.commit()
    db.refresh(customer)
    return {
        "username": customer.username,
        "geo_lat": customer.geo_lat,
        "geo_long": customer.geo_long,
        "source": payload.source,
        "updated": True,
    }
