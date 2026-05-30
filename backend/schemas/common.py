"""Shared validators and types used across schema modules."""
import re
from typing import Literal

ROLE_VALUES = Literal["Admin", "Field Tech", "Senior Tech", "Supervisor"]

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _validate_email(v: str) -> str:
    """Shared email format validator."""
    if not _EMAIL_RE.match(v):
        raise ValueError("Invalid email format.")
    return v.lower().strip()


def _validate_phone_digits(v: str, *, min_digits: int = 10) -> str:
    """Shared phone validator: digits only, minimum length."""
    cleaned = v.strip().replace(" ", "").replace("-", "")
    if not cleaned.isdigit():
        raise ValueError("Phone number must contain only digits.")
    if len(cleaned) < min_digits:
        raise ValueError(f"Phone number is too short (minimum {min_digits} digits).")
    return cleaned
