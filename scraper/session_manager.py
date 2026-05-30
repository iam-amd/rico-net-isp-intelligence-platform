"""
Rico Net — Session Manager
============================
Handles Railwire portal authentication with automatic CAPTCHA solving.
Zero manual intervention required — auto-renews sessions as they expire.

CAPTCHA solving priority:
  1. ddddocr  — free, local, offline, no API key (recommended)
  2. Claude Vision — if ANTHROPIC_API_KEY is set (optional fallback)
  3. Manual — opens visible browser as last resort

Usage:
    from session_manager import SessionManager
    sm = SessionManager(username, password, session_file, api_key="")
    ok = await sm.ensure_valid(page, context)
"""

import asyncio
import io
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

from PIL import Image, ImageFilter, ImageOps
from playwright.async_api import Page, BrowserContext, TimeoutError as PWTimeout

from runtime_paths import captcha_debug_dir

logger = logging.getLogger("rico_scraper.session")

BASE_URL   = "https://tn.railwire.co.in"
LOGIN_URL  = f"{BASE_URL}/rlogin"
SUBS_URL   = f"{BASE_URL}/anpcntl/mysubscribers"
DEBUG_DIR  = captcha_debug_dir()


# ---------------------------------------------------------------------------
# CAPTCHA solver — ddddocr (free, local, no API key)
# ---------------------------------------------------------------------------

_ddddocr_instance = None

def _get_ocr():
    """Lazy-load ddddocr. Returns None if not installed."""
    global _ddddocr_instance
    if _ddddocr_instance is not None:
        return _ddddocr_instance
    try:
        import ddddocr
        # show_ad=False suppresses the startup banner
        _ddddocr_instance = ddddocr.DdddOcr(show_ad=False)
        logger.info("ddddocr loaded — free local CAPTCHA solver active")
        return _ddddocr_instance
    except ImportError:
        logger.warning("ddddocr not installed. Run: pip install ddddocr")
        return None


def _preprocess(img: Image.Image, strategy: int) -> bytes:
    """Apply a preprocessing strategy and return PNG bytes."""
    if strategy == 1:
        # Grayscale + autocontrast + sharpen (best general purpose)
        img = img.convert("L")
        img = ImageOps.autocontrast(img, cutoff=5)
        img = img.filter(ImageFilter.SHARPEN)
        img = img.filter(ImageFilter.SHARPEN)
    elif strategy == 2:
        # Hard binarize — good for high-contrast CAPTCHAs
        img = img.convert("L")
        img = img.point(lambda p: 255 if p > 115 else 0)
    else:
        # Keep colour — helps with colour-noise CAPTCHAs
        img = img.convert("RGB")
        img = ImageOps.autocontrast(img)

    # 2× upscale helps both ddddocr and Claude read small text
    w, h = img.size
    img = img.resize((w * 2, h * 2), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _save_debug_images(raw_bytes: bytes, processed_bytes: bytes, attempt: int, strategy: int):
    """Save raw and preprocessed CAPTCHA images for visual inspection."""
    try:
        DEBUG_DIR.mkdir(exist_ok=True)
        raw_path = DEBUG_DIR / f"attempt_{attempt:02d}_raw.png"
        proc_path = DEBUG_DIR / f"attempt_{attempt:02d}_strategy{strategy}_processed.png"
        raw_path.write_bytes(raw_bytes)
        proc_path.write_bytes(processed_bytes)
        logger.info("CAPTCHA debug images saved -> %s", DEBUG_DIR)
    except Exception as exc:
        logger.debug("Could not save debug images: %s", exc)


def solve_captcha_local(captcha_bytes: bytes, attempt: int = 1) -> Optional[str]:
    """
    Solve CAPTCHA using ddddocr (free, fully offline).
    Saves debug images to captcha_debug/ so you can see what was read.
    Returns cleaned alphanumeric string or None.
    """
    ocr = _get_ocr()
    if ocr is None:
        return None

    try:
        strategy = ((attempt - 1) % 3) + 1
        img = Image.open(io.BytesIO(captcha_bytes))
        processed = _preprocess(img, strategy)
        _save_debug_images(captcha_bytes, processed, attempt, strategy)
        raw = ocr.classification(processed)
        cleaned = re.sub(r"[^A-Za-z0-9]", "", raw).strip().upper()
        logger.info("ddddocr CAPTCHA [attempt %d, strategy %d] raw='%s' -> '%s'",
                    attempt, strategy, raw, cleaned)
        return cleaned if len(cleaned) >= 3 else None
    except Exception as exc:
        logger.warning("ddddocr CAPTCHA error (attempt %d): %s", attempt, exc)
        return None


def solve_captcha_claude(captcha_bytes: bytes, api_key: str, attempt: int = 1) -> Optional[str]:
    """
    Solve CAPTCHA using Claude Vision (requires ANTHROPIC_API_KEY).
    Used only as fallback when ddddocr is unavailable.
    """
    if not api_key:
        return None
    try:
        import base64
        import anthropic

        strategy = ((attempt - 1) % 3) + 1
        img = Image.open(io.BytesIO(captcha_bytes))
        processed = _preprocess(img, strategy)
        b64 = base64.b64encode(processed).decode()

        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=32,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                    {"type": "text",
                     "text": ("This is a CAPTCHA image from a login form. "
                              "Read the characters shown very carefully. "
                              "Reply with ONLY the letters and digits — no spaces, no explanation.")},
                ],
            }],
        )
        raw = resp.content[0].text.strip()
        cleaned = re.sub(r"[^A-Za-z0-9]", "", raw)
        logger.info("Claude CAPTCHA [attempt %d] raw='%s' -> '%s'", attempt, raw, cleaned)
        return cleaned if len(cleaned) >= 3 else None
    except Exception as exc:
        logger.warning("Claude CAPTCHA error (attempt %d): %s", attempt, exc)
        return None


def solve_captcha(captcha_bytes: bytes, api_key: str = "", attempt: int = 1) -> Optional[str]:
    """
    Unified solver: tries ddddocr first, falls back to Claude if api_key set.
    """
    # 1. Try local solver (free, no API key)
    result = solve_captcha_local(captcha_bytes, attempt)
    if result:
        return result

    # 2. Fall back to Claude Vision if API key available
    if api_key:
        logger.info("ddddocr returned nothing — trying Claude Vision fallback")
        return solve_captcha_claude(captcha_bytes, api_key, attempt)

    return None


# ---------------------------------------------------------------------------
# Session Manager
# ---------------------------------------------------------------------------

class SessionManager:
    def __init__(self, username: str, password: str, session_file: str, api_key: str = ""):
        self.username     = username
        self.password     = password
        self.session_file = session_file
        self.api_key      = api_key  # optional — only used if ddddocr fails
        self._last_check  = 0.0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def ensure_valid(self, page: Page, context: BrowserContext) -> bool:
        """
        Check session validity and auto-renew if expired.
        Returns True when a valid session is active.
        Rate-limits the check to once per 5 minutes.
        """
        now = time.monotonic()
        if now - self._last_check < 300:
            return True  # assume still valid within window

        valid = await self._check(page)
        self._last_check = now

        if valid:
            logger.debug("Session valid (checked)")
            return True

        logger.warning("Session expired — starting auto-renewal...")
        success = await self._auto_login(page)

        if success:
            await context.storage_state(path=self.session_file)
            logger.info("Session renewed and saved -> %s", Path(self.session_file).name)
            self._last_check = time.monotonic()
            return True

        logger.error("Session renewal failed after all attempts")
        return False

    async def is_valid(self, page: Page) -> bool:
        """Non-cached validity check."""
        return await self._check(page)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _check(self, page: Page) -> bool:
        try:
            await page.goto(SUBS_URL, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(1.5)
            url = page.url
            if "rlogin" in url or "login" in url.lower():
                return False
            try:
                await page.wait_for_selector("table, .dataTables_wrapper", timeout=5000)
                return True
            except PWTimeout:
                return False
        except Exception:
            return False

    async def _get_captcha_bytes(self, page: Page) -> Optional[bytes]:
        """Locate and screenshot the CAPTCHA image on the login page."""
        # Try specific selectors first
        for sel in [
            "img#captcha_code",
            "img[alt*='captcha' i]",
            "img[src*='captcha' i]",
            "img[src*='verify' i]",
            "img[src*='code' i]",
        ]:
            try:
                el = page.locator(sel).first
                await el.wait_for(state="visible", timeout=4000)
                return await el.screenshot()
            except Exception:
                pass

        # Fallback: screenshot the whole login form
        try:
            form_el = page.locator("form").first
            await form_el.wait_for(state="visible", timeout=5000)
            logger.warning("CAPTCHA element not found by selector — using form screenshot")
            return await form_el.screenshot()
        except Exception:
            return None

    async def _check_rate_limited(self, page: Page) -> bool:
        """Return True if the portal shows a rate-limit / too-many-attempts message."""
        try:
            content = await page.content()
            for phrase in ["too many failed", "try again after", "account locked",
                           "temporarily blocked", "too many attempts"]:
                if phrase.lower() in content.lower():
                    return True
        except Exception:
            pass
        return False

    async def _auto_login(self, page: Page) -> bool:
        """Try up to 6 CAPTCHA attempts (ddddocr, then Claude fallback if configured)."""
        logger.info("Auto-login starting (up to 6 attempts)...")

        for attempt in range(1, 7):
            try:
                await page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)
                await asyncio.sleep(1)

                # Detect portal rate-limit BEFORE trying anything
                if await self._check_rate_limited(page):
                    logger.warning("Portal rate-limit detected — waiting 5 minutes before retry...")
                    await asyncio.sleep(310)
                    await page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)
                    await asyncio.sleep(1)

                await page.fill("input#username", self.username)
                await page.fill("input#password", self.password)

                captcha_bytes = await self._get_captcha_bytes(page)
                if captcha_bytes is None:
                    logger.warning("Could not capture CAPTCHA image (attempt %d)", attempt)
                    await asyncio.sleep(2)
                    continue

                solved = solve_captcha(captcha_bytes, self.api_key, attempt=attempt)

                if not solved:
                    logger.warning("No CAPTCHA text resolved (attempt %d) — refreshing", attempt)
                    await self._refresh_captcha(page)
                    continue

                await page.fill("input#code", solved)
                await asyncio.sleep(0.3)

                # Debug: screenshot the filled form before submitting
                try:
                    form_shot = await page.screenshot(full_page=False)
                    (DEBUG_DIR / f"attempt_{attempt:02d}_before_submit.png").write_bytes(form_shot)
                except Exception:
                    pass

                await page.click("button#btn_rlogin, input[type='submit'], button[type='submit']")

                try:
                    await page.wait_for_url("**/anpcntl**", timeout=9000)
                    logger.info("Logged in on attempt %d (CAPTCHA: '%s')", attempt, solved)
                    return True
                except PWTimeout:
                    current_url = page.url
                    logger.warning("CAPTCHA '%s' rejected (attempt %d) — landed on: %s",
                                   solved, attempt, current_url)
                    # Screenshot the error page to see what went wrong
                    try:
                        err_shot = await page.screenshot(full_page=False)
                        (DEBUG_DIR / f"attempt_{attempt:02d}_after_submit.png").write_bytes(err_shot)
                        logger.info("Post-submit screenshot saved -> captcha_debug/attempt_%02d_after_submit.png", attempt)
                    except Exception:
                        pass
                    # Check if we hit rate-limit — if so, pause immediately
                    if await self._check_rate_limited(page):
                        logger.warning("Rate-limit hit — waiting 5 minutes before next attempt...")
                        await asyncio.sleep(310)
                    await self._refresh_captcha(page)

            except Exception as exc:
                logger.warning("Login attempt %d failed: %s", attempt, exc)

        return False

    async def _refresh_captcha(self, page: Page):
        """Reload the CAPTCHA image by clicking refresh link or the image itself."""
        for sel in [".recaptcha", "a[href*='captcha']", "a[onclick*='captcha' i]",
                    "img#captcha_code", "img[src*='captcha' i]"]:
            try:
                await page.locator(sel).first.click(timeout=2000)
                await asyncio.sleep(1)
                return
            except Exception:
                pass
        # Last resort: reload the page
        try:
            await page.reload(wait_until="networkidle", timeout=15000)
            await asyncio.sleep(1)
        except Exception:
            pass
