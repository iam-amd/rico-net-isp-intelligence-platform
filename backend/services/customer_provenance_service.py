"""Customer field provenance helpers.

Tracks the source that last wrote important customer fields so billing,
field survey, PG survey, and admin enrichment do not become silent conflicts.
"""
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy.orm import Session

import models


SOURCE_RANKS = {
    "field_survey": 100,
    "pg_survey": 90,
    "admin": 80,
    "admin_enrichment": 70,
    "railwire_scraper": 60,
    "system": 10,
}


def source_rank(source: str) -> int:
    return SOURCE_RANKS.get(source, 0)


def record_field_write(
    db: Session,
    *,
    customer_id: str,
    field_name: str,
    source: str,
    writer: Optional[str] = None,
    evidence_ref: Optional[str] = None,
    verified_at: Optional[datetime] = None,
    notes: Optional[str] = None,
    updated_at: Optional[datetime] = None,
) -> models.CustomerFieldProvenance:
    now = updated_at or datetime.now(timezone.utc)
    row = db.get(models.CustomerFieldProvenance, (customer_id, field_name))
    if not row:
        row = models.CustomerFieldProvenance(customer_id=customer_id, field_name=field_name)
        db.add(row)

    row.source = source
    row.source_rank = source_rank(source)
    row.writer = writer
    row.evidence_ref = evidence_ref
    row.verified_at = verified_at
    row.notes = notes
    row.updated_at = now
    return row


def record_field_writes(
    db: Session,
    *,
    customer_id: str,
    field_names: Iterable[str],
    source: str,
    writer: Optional[str] = None,
    evidence_ref: Optional[str] = None,
    verified_at: Optional[datetime] = None,
    notes: Optional[str] = None,
    updated_at: Optional[datetime] = None,
) -> None:
    for field_name in sorted(set(field_names)):
        record_field_write(
            db,
            customer_id=customer_id,
            field_name=field_name,
            source=source,
            writer=writer,
            evidence_ref=evidence_ref,
            verified_at=verified_at,
            notes=notes,
            updated_at=updated_at,
        )
