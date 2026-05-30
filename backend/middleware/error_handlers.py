"""
Global error handlers — extracted from main.py.
"""
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

logger = logging.getLogger("rico_net.errors")


async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Handle duplicate key / unique constraint violations."""
    logger.error("Database integrity error: %s | path=%s", str(exc.orig), request.url.path)
    detail = "A record with the given unique value already exists."
    orig_str = str(exc.orig).lower()
    if "foreign key" in orig_str or "fk_" in orig_str:
        detail = "Invalid reference: the related record does not exist."
        return JSONResponse(status_code=400, content={"detail": detail})
    return JSONResponse(status_code=409, content={"detail": detail})


async def operational_error_handler(request: Request, exc: OperationalError):
    """Handle database connection failures."""
    logger.critical("Database connection failure: %s | path=%s", str(exc.orig), request.url.path)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database is temporarily unavailable. Please try again later."},
    )


async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError):
    """Catch-all for other SQLAlchemy errors."""
    logger.error("Database error: %s | path=%s", str(exc), request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal database error occurred."},
    )


async def general_exception_handler(request: Request, exc: Exception):
    """Catch-all for unhandled exceptions — never return raw 500."""
    if isinstance(exc, HTTPException):
        raise exc
    logger.error(
        "Unhandled exception: %s | path=%s | type=%s",
        str(exc), request.url.path, type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again later."},
    )


def register_error_handlers(app: FastAPI):
    """Register all global exception handlers on the app."""
    app.exception_handler(IntegrityError)(integrity_error_handler)
    app.exception_handler(OperationalError)(operational_error_handler)
    app.exception_handler(SQLAlchemyError)(sqlalchemy_error_handler)
    app.exception_handler(Exception)(general_exception_handler)
