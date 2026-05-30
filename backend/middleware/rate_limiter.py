"""
Rate limiting — single source of truth.
Replaces the duplicated try/except slowapi import in auth.py, customers.py,
phone_lookup.py, and main.py.
"""
import logging

logger = logging.getLogger("rico_net.rate_limiter")

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded

    limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
    RATE_LIMITING_AVAILABLE = True
    logger.info("Rate limiting enabled (slowapi)")
except ImportError:
    limiter = None
    _rate_limit_exceeded_handler = None
    RateLimitExceeded = None
    RATE_LIMITING_AVAILABLE = False
    logger.warning(
        "slowapi not installed — rate limiting is DISABLED. "
        "Install with: pip install slowapi"
    )


def limit(rate: str):
    """Return a rate limit decorator if slowapi is available, else a no-op."""
    if RATE_LIMITING_AVAILABLE and limiter:
        return limiter.limit(rate)

    def _noop(func):
        return func
    return _noop


def register_rate_limiter(app):
    """Attach limiter state and exception handler to the FastAPI app."""
    if RATE_LIMITING_AVAILABLE:
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
