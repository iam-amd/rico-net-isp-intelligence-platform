"""
Pole Group service — CRUD + bulk customer assignment.

Admin uploads a paste of customer usernames into a pole group.
Customers can only be in ONE pole group at a time (physical constraint).
"""
import logging
import re
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("rico_net.pole_group_service")

_USERNAME_SPLIT_RE = re.compile(r"[\s,;\r\n\t]+")


def _parse_usernames(raw: List[str]) -> List[str]:
    """Split any mixed-separator input into clean usernames."""
    out: List[str] = []
    seen = set()
    for item in raw:
        if not item:
            continue
        for part in _USERNAME_SPLIT_RE.split(item):
            u = part.strip()
            if u and u not in seen:
                seen.add(u)
                out.append(u)
    return out


def _pg_to_dict(pg: models.PoleGroup, *, customer_count: int, surveyed_count: int, bound_count: int) -> dict:
    return {
        "id": pg.id,
        "name": pg.name,
        "description": pg.description,
        "area": pg.area,
        "customer_count": customer_count,
        "surveyed_count": surveyed_count,
        "bound_count": bound_count,
        "created_at": pg.created_at,
        "updated_at": pg.updated_at,
    }


def list_pole_groups(db: Session, *, search: Optional[str] = None) -> List[dict]:
    q = db.query(models.PoleGroup)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter((models.PoleGroup.name.ilike(s)) | (models.PoleGroup.area.ilike(s)))
    groups = q.order_by(models.PoleGroup.name).all()
    if not groups:
        return []

    # Single aggregate query for counts
    pg_ids = [g.id for g in groups]
    counts = dict(
        db.query(models.Customer.pg_id, func.count(models.Customer.username))
        .filter(models.Customer.pg_id.in_(pg_ids))
        .group_by(models.Customer.pg_id)
        .all()
    )
    surveyed = dict(
        db.query(models.Customer.pg_id, func.count(models.Customer.username))
        .filter(models.Customer.pg_id.in_(pg_ids))
        .filter(models.Customer.last_surveyed_at.isnot(None))
        .group_by(models.Customer.pg_id)
        .all()
    )
    # Bound = customers in this PG with at least one ONUBinding
    bound = dict(
        db.query(models.Customer.pg_id, func.count(func.distinct(models.Customer.username)))
        .join(models.ONUBinding, models.ONUBinding.customer_id == models.Customer.username)
        .filter(models.Customer.pg_id.in_(pg_ids))
        .group_by(models.Customer.pg_id)
        .all()
    )

    return [
        _pg_to_dict(
            g,
            customer_count=counts.get(g.id, 0),
            surveyed_count=surveyed.get(g.id, 0),
            bound_count=bound.get(g.id, 0),
        )
        for g in groups
    ]


def create_pole_group(
    db: Session,
    *,
    name: str,
    description: Optional[str],
    area: Optional[str],
    created_by: Optional[int],
) -> models.PoleGroup:
    existing = db.query(models.PoleGroup).filter_by(name=name.strip()).first()
    if existing:
        raise ValueError(f"Pole group '{name}' already exists")
    pg = models.PoleGroup(
        name=name.strip(),
        description=description,
        area=area,
        created_by=created_by,
    )
    db.add(pg)
    db.commit()
    db.refresh(pg)
    logger.info("Pole group created: id=%d name=%s by=%s", pg.id, pg.name, created_by)
    return pg


def update_pole_group(
    db: Session,
    pg_id: int,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    area: Optional[str] = None,
) -> models.PoleGroup:
    pg = db.query(models.PoleGroup).filter_by(id=pg_id).first()
    if not pg:
        raise ValueError("Pole group not found")
    if name is not None:
        clash = db.query(models.PoleGroup).filter(
            models.PoleGroup.name == name.strip(),
            models.PoleGroup.id != pg_id,
        ).first()
        if clash:
            raise ValueError(f"Pole group '{name}' already exists")
        pg.name = name.strip()
    if description is not None:
        pg.description = description
    if area is not None:
        pg.area = area
    db.commit()
    db.refresh(pg)
    return pg


def delete_pole_group(db: Session, pg_id: int) -> None:
    pg = db.query(models.PoleGroup).filter_by(id=pg_id).first()
    if not pg:
        raise ValueError("Pole group not found")
    # ON DELETE SET NULL on customer.pg_id — customers detach automatically
    db.delete(pg)
    db.commit()


def get_pole_group_detail(db: Session, pg_id: int) -> dict:
    pg = db.query(models.PoleGroup).filter_by(id=pg_id).first()
    if not pg:
        raise ValueError("Pole group not found")

    customers = (
        db.query(models.Customer)
        .filter(models.Customer.pg_id == pg_id)
        .order_by(models.Customer.username)
        .all()
    )

    # Which ones have bindings?
    if customers:
        usernames = [c.username for c in customers]
        bound_set = set(
            row[0]
            for row in db.query(models.ONUBinding.customer_id)
            .filter(models.ONUBinding.customer_id.in_(usernames))
            .distinct()
            .all()
        )
    else:
        bound_set = set()

    base = _pg_to_dict(
        pg,
        customer_count=len(customers),
        surveyed_count=sum(1 for c in customers if c.last_surveyed_at),
        bound_count=len(bound_set),
    )
    base["customers"] = [
        {
            "username": c.username,
            "first_name": c.first_name,
            "last_name": c.last_name,
            "phone": c.phone,
            "rico_address": c.rico_address,
            "has_binding": c.username in bound_set,
            "last_surveyed_at": c.last_surveyed_at,
        }
        for c in customers
    ]
    return base


def add_customers_to_group(
    db: Session,
    pg_id: int,
    raw_usernames: List[str],
) -> dict:
    """
    Bulk add — accepts paste of usernames (newline/comma/space separated).
    Customers already in another PG get moved. Missing usernames are reported.
    """
    pg = db.query(models.PoleGroup).filter_by(id=pg_id).first()
    if not pg:
        raise ValueError("Pole group not found")

    usernames = _parse_usernames(raw_usernames)
    if not usernames:
        return {"added": 0, "removed": 0, "not_found": [], "already_in_group": [], "moved_from_other_group": []}

    customers = (
        db.query(models.Customer)
        .filter(models.Customer.username.in_(usernames))
        .all()
    )
    found_map = {c.username: c for c in customers}

    not_found = [u for u in usernames if u not in found_map]
    already_in_group: List[str] = []
    moved: List[str] = []
    added = 0

    for c in customers:
        if c.pg_id == pg_id:
            already_in_group.append(c.username)
            continue
        if c.pg_id is not None:
            moved.append(c.username)
        c.pg_id = pg_id
        added += 1

    db.commit()
    logger.info(
        "PG %d: added=%d moved=%d already=%d not_found=%d",
        pg_id, added, len(moved), len(already_in_group), len(not_found),
    )
    return {
        "added": added,
        "removed": 0,
        "not_found": not_found,
        "already_in_group": already_in_group,
        "moved_from_other_group": moved,
    }


def remove_customers_from_group(
    db: Session,
    pg_id: int,
    raw_usernames: List[str],
) -> dict:
    pg = db.query(models.PoleGroup).filter_by(id=pg_id).first()
    if not pg:
        raise ValueError("Pole group not found")

    usernames = _parse_usernames(raw_usernames)
    if not usernames:
        return {"added": 0, "removed": 0, "not_found": [], "already_in_group": [], "moved_from_other_group": []}

    q = (
        db.query(models.Customer)
        .filter(models.Customer.username.in_(usernames))
        .filter(models.Customer.pg_id == pg_id)
    )
    matched = q.all()
    matched_set = {c.username for c in matched}
    for c in matched:
        c.pg_id = None
    db.commit()

    not_found = [u for u in usernames if u not in matched_set]
    return {
        "added": 0,
        "removed": len(matched),
        "not_found": not_found,
        "already_in_group": [],
        "moved_from_other_group": [],
    }
