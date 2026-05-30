"""
OLT Service — Backend OLT Integration
Provides high-level interface to the OLT proxy.
Never raises exceptions — returns None on failure for graceful degradation.
"""

import logging
from typing import Optional, Dict, Any
import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class OLTServiceError(Exception):
    """OLT service error — but never propagated to callers."""
    pass


async def fetch_onu_by_mac(mac_address: str) -> Optional[Dict[str, Any]]:
    """
    Fetch ONU data by MAC address.

    Returns:
        Dict with ONU data (mac_address, pon_port, onu_index, status, rx_power_dbm, etc.)
        None if: OLT_PROXY_ENABLED=False, network error, ONU not found, or any exception

    Never raises exceptions — all errors logged and None returned.
    """

    # Feature flag check
    if not settings.OLT_PROXY_ENABLED:
        logger.debug("OLT proxy disabled (OLT_PROXY_ENABLED=false)")
        return None

    if not settings.OLT_PROXY_URL:
        logger.warning("OLT_PROXY_URL not configured")
        return None

    try:
        headers = {
            "X-Proxy-Token": settings.OLT_PROXY_TOKEN,
            "Content-Type": "application/json"
        }

        payload = {"mac_address": mac_address}

        async with httpx.AsyncClient(timeout=settings.OLT_PROXY_TIMEOUT_SEC) as client:
            response = await client.post(
                f"{settings.OLT_PROXY_URL}/olt/fetch",
                json=payload,
                headers=headers
            )

        if response.status_code == 200:
            onu_data = response.json()
            logger.debug(f"Fetched ONU data for {mac_address}: {onu_data.get('pon_port')}")
            return onu_data
        elif response.status_code == 404:
            logger.debug(f"ONU {mac_address} not found on OLT")
            return None
        else:
            logger.warning(f"OLT proxy error {response.status_code}: {response.text}")
            return None

    except httpx.TimeoutException:
        logger.warning(f"OLT proxy timeout (>{settings.OLT_PROXY_TIMEOUT_SEC}s) for {mac_address}")
        return None
    except httpx.ConnectError as e:
        logger.warning(f"OLT proxy connection error: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching ONU data: {e}", exc_info=True)
        return None


async def reboot_onu(mac_address: str) -> bool:
    """
    Send remote reboot command to ONU.

    Returns:
        True if reboot command sent successfully
        False if: OLT_PROXY_ENABLED=False, error, or any exception

    Never raises exceptions.
    """

    if not settings.OLT_PROXY_ENABLED:
        logger.debug("OLT proxy disabled — reboot not sent")
        return False

    if not settings.OLT_PROXY_URL:
        logger.warning("OLT_PROXY_URL not configured")
        return False

    try:
        headers = {
            "X-Proxy-Token": settings.OLT_PROXY_TOKEN,
            "Content-Type": "application/json"
        }

        payload = {"mac_address": mac_address}

        async with httpx.AsyncClient(timeout=settings.OLT_PROXY_TIMEOUT_SEC) as client:
            response = await client.post(
                f"{settings.OLT_PROXY_URL}/olt/reboot",
                json=payload,
                headers=headers
            )

        if response.status_code == 200:
            result = response.json()
            success = result.get("success", False)
            if success:
                logger.info(f"Rebooted ONU {mac_address}")
            return success
        else:
            logger.warning(f"OLT reboot error {response.status_code}: {response.text}")
            return False

    except Exception as e:
        logger.error(f"Error sending reboot command: {e}", exc_info=True)
        return False


async def health_check() -> Optional[Dict[str, Any]]:
    """
    Check OLT proxy health.

    Returns:
        Dict with {status, olt_reachable, onu_count, mode}
        None if error
    """

    if not settings.OLT_PROXY_ENABLED:
        return None

    if not settings.OLT_PROXY_URL:
        return None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                f"{settings.OLT_PROXY_URL}/healthz",
                timeout=5
            )

        if response.status_code == 200:
            return response.json()
        else:
            logger.warning(f"Health check error {response.status_code}")
            return None

    except Exception as e:
        logger.debug(f"Health check failed: {e}")
        return None


async def refresh_onu_by_port(
    olt_host: str, pon_port: str, onu_index: int
) -> Optional[Dict[str, Any]]:
    """
    On-demand single-ONU refresh via targeted proxy commands.
    Uses /olt/refresh endpoint — much faster than /olt/fetch (full scan).
    Target: <10s EPON, <15s GPON. Timeout: 30s.

    Returns:
        Dict with fresh ONU data (status, rx_power_dbm, tx_power_dbm, etc.)
        None on failure.
    """
    if not settings.OLT_PROXY_ENABLED:
        return None

    if not settings.OLT_PROXY_URL:
        return None

    try:
        headers = {
            "X-Proxy-Token": settings.OLT_PROXY_TOKEN,
            "Content-Type": "application/json",
        }
        payload = {
            "olt_host": olt_host,
            "pon_port": pon_port,
            "onu_index": onu_index,
        }
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"{settings.OLT_PROXY_URL}/olt/refresh",
                json=payload,
                headers=headers,
            )

        if response.status_code == 200:
            data = response.json()
            logger.info("Refreshed ONU %s port %s/%d: status=%s rx=%.1f",
                        olt_host, pon_port, onu_index,
                        data.get("status"), data.get("rx_power_dbm") or 0.0)
            return data
        elif response.status_code == 404:
            logger.debug("ONU %s port %s/%d not found on proxy", olt_host, pon_port, onu_index)
            return None
        else:
            logger.warning("Refresh error %d: %s", response.status_code, response.text[:200])
            return None

    except httpx.TimeoutException:
        logger.warning("ONU refresh timeout (>90s) for %s %s/%d", olt_host, pon_port, onu_index)
        return None
    except Exception as e:
        logger.error("refresh_onu_by_port failed: %s", e, exc_info=True)
        return None


async def scan_all_onus() -> Optional[Dict[str, Any]]:
    """
    Scan all ONUs on all OLTs.
    Returns list of all ONU records (used once for MAC bridge).

    WARNING: This is slow (30+ seconds) — use only during setup.

    Returns:
        Dict with {total_onus, onus: [{mac_address, olt_host, pon_port, onu_index}]}
        None if error
    """

    if not settings.OLT_PROXY_ENABLED:
        logger.warning("OLT proxy disabled — cannot scan")
        return None

    if not settings.OLT_PROXY_URL:
        logger.warning("OLT_PROXY_URL not configured")
        return None

    try:
        headers = {
            "X-Proxy-Token": settings.OLT_PROXY_TOKEN
        }

        logger.info("Starting OLT scan (this takes 30+ seconds)...")

        async with httpx.AsyncClient(timeout=120) as client:  # Long timeout for full scan
            response = await client.post(
                f"{settings.OLT_PROXY_URL}/olt/scan",
                headers=headers,
                timeout=120
            )

        if response.status_code == 200:
            result = response.json()
            logger.info(f"OLT scan complete: {result['total_onus']} ONUs found")
            return result
        else:
            logger.error(f"OLT scan error {response.status_code}: {response.text}")
            return None

    except httpx.TimeoutException:
        logger.error("OLT scan timeout (>120s)")
        return None
    except Exception as e:
        logger.error(f"OLT scan failed: {e}", exc_info=True)
        return None
