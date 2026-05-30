"""
OLT Proxy â€” FastAPI Service
Provides REST API access to OLT hardware via Telnet (Phase 2a) or SNMP (Phase 2b).
Runs on office PC at port 9000, exposed via Cloudflare Tunnel.

Endpoints:
  GET  /healthz                 â€” Health check
  POST /olt/fetch               â€” Fetch ONU data by MAC
  POST /olt/reboot              â€” Reboot ONU by MAC
  POST /olt/scan                â€” Scan all ONUs on all OLTs
  POST /olt/port                â€” Fetch ONU data by port + index (full scan, legacy)
  POST /olt/refresh             â€” Fast single-ONU refresh, <10s (NOC on-demand use)
"""

import logging
import sys
from typing import Optional, Dict, Any, List
from datetime import datetime

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import config

# Import client (Telnet or SNMP based on config)
if config.OLT_CLIENT_MODE == "telnet":
    import olt_client as olt
elif config.OLT_CLIENT_MODE == "snmp":
    import snmp_client as olt
else:
    raise ValueError(f"Invalid OLT_CLIENT_MODE: {config.OLT_CLIENT_MODE}")

from mac_normalizer import normalize_mac, is_valid_mac

# ============================================================================
# LOGGING SETUP
# ============================================================================

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL),
    format=config.LOG_FORMAT,
    handlers=[
        logging.FileHandler("proxy.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# ============================================================================
# FASTAPI APP
# ============================================================================

app = FastAPI(
    title="Rico Net OLT Proxy",
    description="Bridges backend to OLT hardware",
    version="2.0a"
)

# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================


class FetchRequest(BaseModel):
    """Request to fetch ONU data by MAC address."""
    mac_address: str

    class Config:
        example = {"mac_address": "8C:C7:C3:D2:39:CB"}


class RebootRequest(BaseModel):
    """Request to reboot an ONU by MAC address."""
    mac_address: str

    class Config:
        example = {"mac_address": "8C:C7:C3:D2:39:CB"}


class PortRequest(BaseModel):
    """Request to fetch ONU data by port + index."""
    olt_host: str
    pon_port: str
    onu_index: int

    class Config:
        example = {
            "olt_host": "10.10.10.100",
            "pon_port": "epon0/2",
            "onu_index": 13
        }


class HealthResponse(BaseModel):
    """Response to local proxy health check."""
    status: str
    olt_reachable: bool
    onu_count: int
    mode: str
    hardware_access_enabled: bool
    reboot_commands_enabled: bool
    timestamp: str

    class Config:
        example = {
            "status": "ok",
            "olt_reachable": False,
            "onu_count": 0,
            "mode": "telnet",
            "hardware_access_enabled": False,
            "reboot_commands_enabled": False,
            "timestamp": "2026-03-26T14:00:00Z"
        }


class ONUData(BaseModel):
    """ONU data returned from proxy."""
    mac_address: str
    olt_host: str
    pon_port: str
    onu_index: Optional[int] = None
    status: str
    rx_power_dbm: Optional[float] = None
    tx_power_dbm: Optional[float] = None
    temperature_c: Optional[float] = None
    voltage_mv: Optional[int] = None
    flap_count: Optional[int] = None
    dying_gasp: bool = False
    distance_m: Optional[int] = None
    firmware: Optional[str] = None
    polled_at: str


class ErrorResponse(BaseModel):
    """Error response."""
    error: str
    detail: str


# ============================================================================
# MIDDLEWARE & SECURITY
# ============================================================================


def _proxy_token_configured() -> bool:
    return bool(config.PROXY_TOKEN.strip())


def _proxy_token_matches(token: Optional[str]) -> bool:
    return bool(token) and _proxy_token_configured() and token == config.PROXY_TOKEN


def _hardware_access_enabled() -> bool:
    return bool(config.ALLOW_OLT_HARDWARE_ACCESS)


def _reboot_commands_enabled() -> bool:
    return bool(config.ALLOW_OLT_REBOOT_COMMANDS)


def _require_hardware_access(operation: str) -> None:
    if _hardware_access_enabled():
        return
    logger.warning("Blocked OLT hardware operation while safe mode is active: %s", operation)
    raise HTTPException(
        status_code=423,
        detail=(
            "OLT hardware access is disabled. Set ALLOW_OLT_HARDWARE_ACCESS=true "
            "only on the approved OLT Engine host when the OLT network is ready."
        ),
    )


def _require_reboot_commands(operation: str) -> None:
    _require_hardware_access(operation)
    if _reboot_commands_enabled():
        return
    logger.warning("Blocked OLT reboot/control operation: %s", operation)
    raise HTTPException(
        status_code=423,
        detail=(
            "OLT reboot/control commands are disabled. Set ALLOW_OLT_REBOOT_COMMANDS=true "
            "only for an approved operator action."
        ),
    )


async def verify_token(request: Request, x_proxy_token: Optional[str] = Header(None)) -> bool:
    """Verify the proxy token from request header."""
    if request.url.path == "/healthz":
        return True  # Health check doesn't require auth
    return _proxy_token_matches(x_proxy_token)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Middleware to check authentication token."""
    token = request.headers.get("X-Proxy-Token")
    path = request.url.path

    if path == "/healthz":
        # Health check is public
        return await call_next(request)

    if not _proxy_token_configured():
        logger.error("Rejecting proxy request because PROXY_TOKEN is not configured: %s", path)
        return JSONResponse(
            status_code=503,
            content={"error": "Service Misconfigured", "detail": "PROXY_TOKEN is not configured"}
        )

    if not _proxy_token_matches(token):
        logger.warning(f"Unauthorized request from {request.client.host}: {path}")
        return JSONResponse(
            status_code=401,
            content={"error": "Unauthorized", "detail": "Invalid or missing X-Proxy-Token"}
        )

    return await call_next(request)


# ============================================================================
# ENDPOINTS
# ============================================================================


@app.get("/healthz", response_model=HealthResponse)
async def health_check():
    """
    Local health check endpoint.
    This endpoint must never open Telnet, SNMP, HTTP, or any OLT socket.
    """
    return HealthResponse(
        status="ok",
        olt_reachable=False,
        onu_count=0,
        mode=config.OLT_CLIENT_MODE.upper(),
        hardware_access_enabled=_hardware_access_enabled(),
        reboot_commands_enabled=_reboot_commands_enabled(),
        timestamp=datetime.utcnow().isoformat() + "Z"
    )


@app.post("/olt/fetch", response_model=ONUData)
async def fetch_onu(req: FetchRequest):
    """
    Fetch ONU data by MAC address.
    Searches all OLTs for the given MAC.

    Returns complete ONU data including signal strength, status, etc.
    """
    _require_hardware_access("/olt/fetch")

    try:
        # Normalize MAC
        mac = normalize_mac(req.mac_address)
    except ValueError as e:
        logger.error(f"Invalid MAC format: {req.mac_address}")
        raise HTTPException(status_code=400, detail=str(e))

    # Search all OLTs for this MAC
    for olt_host in config.OLT_HOSTS:
        try:
            onu_data = olt.get_onu_by_mac(olt_host, mac)
            if onu_data:
                logger.info(f"Found {mac} on {olt_host} {onu_data.get('pon_port')} {onu_data.get('onu_index')}")
                return ONUData(**onu_data)
        except Exception as e:
            logger.debug(f"OLT {olt_host} search failed: {e}")
            continue

    logger.warning(f"MAC {mac} not found on any OLT")
    raise HTTPException(status_code=404, detail=f"MAC address {mac} not found on OLT")


@app.post("/olt/reboot")
async def reboot_onu(req: RebootRequest):
    """
    Reboot an ONU by MAC address.
    Locates the ONU on its OLT and sends reboot command.
    """
    _require_reboot_commands("/olt/reboot")

    try:
        mac = normalize_mac(req.mac_address)
    except ValueError as e:
        logger.error(f"Invalid MAC format: {req.mac_address}")
        raise HTTPException(status_code=400, detail=str(e))

    # Search all OLTs for this MAC and reboot
    for olt_host in config.OLT_HOSTS:
        try:
            onu_data = olt.get_onu_by_mac(olt_host, mac)
            if onu_data:
                pon_port = onu_data["pon_port"]
                onu_index = onu_data["onu_index"]

                success = olt.reboot_onu(olt_host, pon_port, onu_index)
                if success:
                    logger.info(f"Rebooted ONU {mac} on {olt_host} {pon_port} {onu_index}")
                    return {"success": True, "message": f"ONU {mac} rebooted"}
                else:
                    logger.error(f"Reboot failed for {mac}")
                    return {"success": False, "message": "Reboot command failed"}
        except Exception as e:
            logger.debug(f"OLT {olt_host} reboot search failed: {e}")
            continue

    logger.warning(f"MAC {mac} not found for reboot")
    raise HTTPException(status_code=404, detail=f"MAC address {mac} not found")


@app.post("/olt/port", response_model=ONUData)
async def fetch_onu_by_port(req: PortRequest):
    """
    Fetch ONU data by OLT host, PON port, and ONU index (faster).
    Use this after MAC bridge is complete.
    """
    _require_hardware_access("/olt/port")

    try:
        onu_data = olt.get_onu_by_port(req.olt_host, req.pon_port, req.onu_index)
        if onu_data:
            logger.info(f"Fetched {req.olt_host} {req.pon_port} ONU {req.onu_index}")
            return ONUData(**onu_data)
        else:
            raise HTTPException(status_code=404, detail="ONU not found")
    except Exception as e:
        logger.error(f"Error fetching ONU by port: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/olt/refresh", response_model=ONUData)
async def refresh_onu(req: PortRequest):
    """
    Fast on-demand single-ONU refresh for NOC real-time use.
    Uses targeted per-port CLI commands. Target: <10s EPON, <15s GPON.
    Use when a customer is on the phone and you need fresh signal data now.
    """
    _require_hardware_access("/olt/refresh")

    try:
        onu_data = olt.get_onu_by_port_fast(req.olt_host, req.pon_port, req.onu_index)
        if onu_data:
            logger.info(f"Refreshed {req.olt_host} {req.pon_port}/{req.onu_index}")
            return ONUData(**onu_data)
        raise HTTPException(status_code=404, detail="ONU not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh ONU error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/olt/scan")
async def scan_all_onus() -> Dict[str, Any]:
    """
    Scan all PON ports on all OLTs.
    Returns complete list of all ONUs with MAC, port, index.
    Used once for MAC bridge population.
    WARNING: This takes 30+ seconds. Use only once during initial setup.
    """
    _require_hardware_access("/olt/scan")

    all_onus = []

    try:
        for olt_host in config.OLT_HOSTS:
            logger.info(f"Scanning {olt_host}...")
            try:
                onus = olt.get_all_onus(olt_host)
                all_onus.extend(onus)
                logger.info(f"Found {len(onus)} ONUs on {olt_host}")
            except Exception as e:
                logger.warning(f"Scan failed on {olt_host}: {e}")
                continue

        logger.info(f"Total ONUs found: {len(all_onus)}")
        return {
            "total_onus": len(all_onus),
            "onus": all_onus,
            "scanned_at": datetime.utcnow().isoformat() + "Z"
        }

    except Exception as e:
        logger.error(f"Scan operation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# ERROR HANDLERS
# ============================================================================


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "HTTP Error", "detail": exc.detail}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.error(f"Unexpected error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal Server Error", "detail": "An unexpected error occurred"}
    )


# ============================================================================
# STARTUP
# ============================================================================


@app.on_event("startup")
async def startup():
    """Log startup information."""
    logger.info("=" * 80)
    logger.info("Rico Net OLT Proxy Started")
    logger.info(f"Mode: {config.OLT_CLIENT_MODE.upper()} (Phase 2{'a' if config.OLT_CLIENT_MODE == 'telnet' else 'b'})")
    logger.info(f"Port: {config.PROXY_PORT}")
    logger.info(f"OLT Hosts: {', '.join(config.OLT_HOSTS)}")
    logger.info("Proxy token: %s", "configured" if _proxy_token_configured() else "not configured")
    logger.info(
        "Hardware access: %s",
        "enabled" if _hardware_access_enabled() else "SAFE MODE - disabled",
    )
    logger.info(
        "Reboot/control commands: %s",
        "enabled" if _reboot_commands_enabled() else "disabled",
    )
    logger.info("=" * 80)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=config.PROXY_HOST,
        port=config.PROXY_PORT,
        log_level=config.LOG_LEVEL.lower()
    )
