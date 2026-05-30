"""
Phone Lookup & Customer Phones business logic — extracted from routers/phone_lookup.py.
"""
import logging

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

import models, schemas

logger = logging.getLogger("rico_net.phone_lookup")


# ------------------------------------------------------------------
# Phone Lookup (Call Pop-Up)
# ------------------------------------------------------------------

def phone_lookup(db: Session, number: str):
    """
    THE CALL POP-UP ENDPOINT.

    When a call comes in, the admin enters/scans the phone number.
    This function:
    1. Searches the customer_phones table (indexed, sub-ms)
    2. Returns the customer profile if found
    3. Includes their recent tickets and balance info
    4. Returns the phone label (e.g., "Wife", "Office")
    """
    cleaned = number.strip().replace(" ", "").replace("-", "")

    try:
        # Search in the linked phones table
        phone_record = (
            db.query(models.CustomerPhone)
            .filter(models.CustomerPhone.phone_number == cleaned)
            .first()
        )

        if not phone_record:
            # Fallback: Check the primary_phone column directly
            customer = (
                db.query(models.Customer)
                .filter(models.Customer.phone == cleaned)
                .first()
            )
            if not customer:
                return schemas.PhoneLookupResponse(
                    found=False,
                    customer=None,
                    phone_label=None,
                    recent_tickets=[],
                    has_unpaid_balance=False,
                    balance=0.0,
                )
            phone_label = "Primary"
        else:
            customer = phone_record.customer
            phone_label = phone_record.label

        # Fetch recent tickets (last 5)
        recent_tickets = (
            db.query(models.Ticket)
            .filter(models.Ticket.customer_id == customer.username)
            .order_by(models.Ticket.created_at.desc())
            .limit(5)
            .all()
        )

        balance = float(customer.balance) if customer.balance else 0.0

        return schemas.PhoneLookupResponse(
            found=True,
            customer=customer,
            phone_label=phone_label,
            recent_tickets=recent_tickets,
            has_unpaid_balance=balance > 0,
            balance=balance,
        )
    except SQLAlchemyError as e:
        logger.error("Database error in phone lookup for %s: %s", cleaned, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


# ------------------------------------------------------------------
# List linked phones
# ------------------------------------------------------------------

def list_customer_phones(db: Session, username: str):
    """List all phone numbers linked to a customer."""
    try:
        customer = db.query(models.Customer).filter(
            models.Customer.username == username
        ).first()
    except SQLAlchemyError as e:
        logger.error("Database error listing phones for %s: %s", username, str(e))
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    return customer.phones


# ------------------------------------------------------------------
# Add linked phone
# ------------------------------------------------------------------

def add_customer_phone(db: Session, username: str, phone_data: schemas.CustomerPhoneCreate, current_username: str):
    """Add a new phone number to a customer's profile."""
    customer = db.query(models.Customer).filter(
        models.Customer.username == username
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Check if this phone number is already linked to ANY customer
    existing = (
        db.query(models.CustomerPhone)
        .filter(models.CustomerPhone.phone_number == phone_data.phone_number)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Phone number {phone_data.phone_number} is already linked "
                f"to customer '{existing.customer_id}'"
            ),
        )

    # If this is marked primary, unmark any existing primary
    if phone_data.is_primary:
        db.query(models.CustomerPhone).filter(
            models.CustomerPhone.customer_id == username,
            models.CustomerPhone.is_primary == True,
        ).update({"is_primary": False})

        customer.phone = phone_data.phone_number

    new_phone = models.CustomerPhone(
        customer_id=username,
        phone_number=phone_data.phone_number,
        label=phone_data.label,
        is_primary=phone_data.is_primary,
    )
    db.add(new_phone)
    try:
        db.commit()
        db.refresh(new_phone)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Phone number {phone_data.phone_number} is already linked to another customer.",
        )
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error adding phone for %s: %s", username, str(e))
        raise HTTPException(status_code=500, detail="Failed to add phone number")

    logger.info(
        "Phone %s added to customer %s by %s",
        phone_data.phone_number,
        username,
        current_username,
    )
    return new_phone


# ------------------------------------------------------------------
# Delete linked phone
# ------------------------------------------------------------------

def delete_customer_phone(db: Session, username: str, phone_id: int, current_username: str):
    """Remove a linked phone number. Cannot remove the last/primary number."""
    phone = (
        db.query(models.CustomerPhone)
        .filter(
            models.CustomerPhone.id == phone_id,
            models.CustomerPhone.customer_id == username,
        )
        .first()
    )
    if not phone:
        raise HTTPException(status_code=404, detail="Phone number not found")

    total_phones = (
        db.query(models.CustomerPhone)
        .filter(models.CustomerPhone.customer_id == username)
        .count()
    )
    if total_phones <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the last phone number. Customer must have at least one.",
        )

    if phone.is_primary:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the primary phone number. Set another number as primary first.",
        )

    try:
        db.delete(phone)
        db.commit()
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("Database error deleting phone #%d for %s: %s", phone_id, username, str(e))
        raise HTTPException(status_code=500, detail="Failed to delete phone number")

    logger.info(
        "Phone %s removed from customer %s by %s",
        phone.phone_number,
        username,
        current_username,
    )
    return {"ok": True, "detail": f"Phone {phone.phone_number} removed"}
