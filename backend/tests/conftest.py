"""
Rico Net Backend — Test Fixtures
=================================
Shared fixtures for all test modules.
Uses the real PostgreSQL database (rico_net) and real FastAPI app.
"""
import sys
import os

import pytest
from starlette.testclient import TestClient

# Ensure the backend directory is on sys.path so bare imports work
# (e.g. `import models`, `import database`).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app
from database import SessionLocal
from middleware.auth import create_access_token


# ---------------------------------------------------------------------------
# Database session
# ---------------------------------------------------------------------------

@pytest.fixture()
def db():
    """Yield a SQLAlchemy session connected to the real database.
    The session is closed after the test finishes.
    """
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    """Synchronous test client wrapping the FastAPI application."""
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Auth tokens
# ---------------------------------------------------------------------------

@pytest.fixture()
def admin_token() -> str:
    """JWT token for the admin user (role=Admin)."""
    return create_access_token({"sub": "admin"})


@pytest.fixture()
def tech_token() -> str:
    """JWT token for a field technician (role=Field Tech)."""
    return create_access_token({"sub": "ricotech_mobile"})


# ---------------------------------------------------------------------------
# Auth header helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def auth_headers():
    """Factory fixture: returns an Authorization header dict for a given token.

    Usage inside a test:
        headers = auth_headers(admin_token)
        client.get("/some/endpoint", headers=headers)
    """
    def _make_headers(token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}
    return _make_headers
