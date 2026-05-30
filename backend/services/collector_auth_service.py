"""Collector ingest credential helpers."""
import hashlib
import hmac
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

import models
from config.settings import settings


def hash_ingest_token(token: str) -> str:
    """Return a keyed, stable hash for a collector ingest token."""
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_collector_token(db: Session, collector_id: str, token: str) -> bool:
    credential: Optional[models.CollectorCredential] = db.get(
        models.CollectorCredential,
        collector_id,
    )
    if not credential or not credential.is_active:
        return False
    return hmac.compare_digest(credential.token_hash, hash_ingest_token(token))


def upsert_collector_credential(
    db: Session,
    *,
    collector_id: str,
    token: str,
    is_active: bool = True,
) -> models.CollectorCredential:
    credential = db.get(models.CollectorCredential, collector_id)
    now = datetime.now(timezone.utc)
    token_hash = hash_ingest_token(token)
    token_last_four = token[-4:] if token else None

    if credential:
        credential.token_hash = token_hash
        credential.token_last_four = token_last_four
        credential.is_active = is_active
        credential.rotated_at = now
    else:
        credential = models.CollectorCredential(
            collector_id=collector_id,
            token_hash=token_hash,
            token_last_four=token_last_four,
            is_active=is_active,
            rotated_at=now,
        )
        db.add(credential)

    db.commit()
    db.refresh(credential)
    return credential
