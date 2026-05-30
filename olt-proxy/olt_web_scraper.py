"""
OLT Web Management Interface Scraper
=====================================
Logs into the Netlink OLT web UI, solves the CAPTCHA using ddddocr,
and extracts per-ONU optical data (Rx/Tx power, temperature, voltage).

This is fallback data collection when CLI Telnet doesn't expose signal data.

Usage:
    python olt_web_scraper.py [olt_ip:port]

Examples:
    python olt_web_scraper.py 10.10.10.200:1010   # GPON1
    python olt_web_scraper.py 10.10.10.210        # GPON2 (port 443)
    python olt_web_scraper.py 10.10.10.100:1010   # EPON
"""

import sys
import re
import time
import json
import io
import urllib3
from pathlib import Path

import requests
urllib3.disable_warnings()

# â”€â”€ Try to import ddddocr â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
try:
    import ddddocr
    _ocr = ddddocr.DdddOcr(show_ad=False)
    print("[OCR] ddddocr loaded")
except ImportError:
    _ocr = None
    print("[OCR] ddddocr not available â€” will try without CAPTCHA solving")

OLT_USER = "admin"
OLT_PASS = "replace-with-olt-password"

KNOWN_PAGES = [
    # ONU list / optical data pages â€” guessed from common Netlink URL patterns
    "/gpon_onu_list.html",
    "/gpon_opm.html",
    "/gpon_onu_optical.html",
    "/onu_optical.html",
    "/onu_opm.html",
    "/onu_list.html",
    "/onu_status.html",
    "/gpon_onu.html",
    "/onu.html",
    "/pon_onu.html",
    "/pon_status.html",
    # Action/API endpoints
    "/action/gpon_onu_optical_data",
    "/action/gpon_opm_data",
    "/action/onu_list",
    "/action/onu_optical",
    "/action/get_onu_signal",
    "/action/gpon_onu_info",
    "/action/onu_status",
    "/action/onu_opm",
    "/action/ponport_status",
    # Common vendor patterns
    "/cgi-bin/onu_optical.cgi",
    "/cgi-bin/gpon_onu.cgi",
    "/data/onu_optical.json",
    "/api/onu/optical",
    "/api/gpon/opm",
]


def _base_url(addr: str) -> str:
    if ":" in addr:
        host, port = addr.rsplit(":", 1)
        return f"https://{host}:{port}"
    else:
        return f"https://{addr}"


def _solve_captcha(sess: requests.Session, base: str) -> str:
    """Download the 5 CAPTCHA character images and OCR them."""
    chars = []
    for i in range(1, 6):
        url = f"{base}/images/vc{i}.png"
        try:
            r = sess.get(url, verify=False, timeout=8)
            if r.status_code == 200 and r.content:
                if _ocr:
                    try:
                        text = _ocr.classification(r.content)
                        # Each image is one character â€” take first char
                        ch = (text or "").strip()[:1].lower()
                        if ch:
                            chars.append(ch)
                            print(f"  vc{i}.png â†’ '{ch}'")
                        else:
                            print(f"  vc{i}.png â†’ OCR returned empty, trying raw")
                            chars.append("?")
                    except Exception as e:
                        print(f"  vc{i}.png OCR error: {e}")
                        chars.append("?")
                else:
                    # Save images for manual inspection
                    path = Path(f"captcha_vc{i}.png")
                    path.write_bytes(r.content)
                    print(f"  vc{i}.png saved to {path} â€” solve manually")
                    chars.append("?")
        except Exception as e:
            print(f"  vc{i}.png fetch error: {e}")
    return "".join(chars)


def login(addr: str) -> requests.Session | None:
    """Login to OLT web management. Returns authenticated session or None."""
    base = _base_url(addr)
    sess = requests.Session()
    sess.verify = False
    sess.headers.update({"User-Agent": "Mozilla/5.0"})

    print(f"\n[LOGIN] {base}")

    # Step 1: GET login page to establish session
    try:
        r = sess.get(f"{base}/action/login.html", verify=False, timeout=10)
        print(f"  Login page: {r.status_code}")
    except Exception as e:
        print(f"  Cannot reach OLT: {e}")
        return None

    # Extract CAPTCHA image URLs from page
    vc_urls = re.findall(r'src="[./]*images/(vc\d+\.png\?rand=\d+)"', r.text)
    print(f"  CAPTCHA images found: {vc_urls}")

    # Step 2: Download and solve CAPTCHA
    captcha = _solve_captcha(sess, base)
    print(f"  CAPTCHA solved: '{captcha}'")

    if "?" in captcha and not _ocr:
        print("  [WARN] CAPTCHA not solvable without ddddocr â€” trying blank")
        captcha = ""

    # Step 3: POST login
    data = {
        "user": OLT_USER,
        "pass": OLT_PASS,
        "verification_code": captcha,
    }
    try:
        r2 = sess.post(f"{base}/action/main.html", data=data, verify=False,
                       timeout=10, allow_redirects=True)
        print(f"  POST /action/main.html: {r2.status_code}, {len(r2.text)} bytes")
        content = r2.text[:200].replace("\n", " ")
        print(f"  Response: {content}")

        # Check if login succeeded â€” look for non-login content
        if "login.html" in r2.url or "login" in r2.text[:200].lower():
            print("  [FAIL] Still on login page â€” wrong CAPTCHA or credentials")
            # Save the CAPTCHA images for debugging
            _save_captcha_images(sess, base)
            return None

        # Check for session cookie
        cookies = dict(sess.cookies)
        print(f"  Session cookies: {cookies}")
        if cookies or r2.status_code == 200:
            print("  [OK] Login appears successful")
            return sess
    except Exception as e:
        print(f"  POST error: {e}")

    return None


def _save_captcha_images(sess: requests.Session, base: str):
    """Save CAPTCHA images to disk for debugging."""
    for i in range(1, 6):
        url = f"{base}/images/vc{i}.png"
        try:
            r = sess.get(url, verify=False, timeout=5)
            if r.status_code == 200:
                path = Path(f"C:/Users/ahame/Downloads/captcha_vc{i}_{base.split('.')[-1].split(':')[0]}.png")
                path.write_bytes(r.content)
                print(f"  Saved CAPTCHA image: {path} ({len(r.content)} bytes)")
        except Exception as e:
            print(f"  Save error vc{i}: {e}")


def discover_pages(sess: requests.Session, base: str):
    """Try all known URL patterns to discover available data pages."""
    found = []
    print(f"\n[DISCOVER] Probing {len(KNOWN_PAGES)} URLs on {base}")
    for path in KNOWN_PAGES:
        url = base + path
        try:
            r = sess.get(url, verify=False, timeout=5)
            size = len(r.text)
            if r.status_code == 200 and size > 200:
                snippet = r.text[:120].replace("\n", " ")
                print(f"  [200 {size:5d}b] {path}  {snippet[:80]}")
                found.append((path, r.text))
            elif r.status_code not in (404, 403):
                print(f"  [{r.status_code}] {path}")
        except Exception as e:
            pass  # silently skip timeouts
    return found


def extract_optical_data(html: str, url: str) -> list:
    """Try to extract Rx/Tx power values from HTML page."""
    results = []

    # Pattern 1: standard table with dBm values
    dbm_values = re.findall(r"(-?\d+\.\d+)\s*dBm", html, re.IGNORECASE)
    if dbm_values:
        print(f"  dBm values found: {dbm_values[:10]}")
        results.extend(dbm_values)

    # Pattern 2: JSON-like data
    json_blocks = re.findall(r'\{[^{}]{20,500}\}', html)
    for block in json_blocks:
        if any(k in block.lower() for k in ['rx', 'tx', 'optical', 'power', 'signal']):
            print(f"  JSON-like data: {block[:200]}")

    # Pattern 3: table rows with ONU data
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL | re.IGNORECASE)
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
        clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]
        # Look for rows that have signal-like data
        has_signal = any(re.search(r'-\d+\.\d+', c) for c in clean)
        if has_signal and len(clean) >= 3:
            print(f"  Table row: {clean}")

    return results


def probe_nav_tree(sess: requests.Session, base: str, start_html: str):
    """Parse main page to find navigation links to data pages."""
    print(f"\n[NAV] Parsing navigation tree")

    # Extract all href links
    links = re.findall(r'href=["\']([^"\'#]+)["\']', start_html, re.IGNORECASE)
    links += re.findall(r'src=["\']([^"\'?]+\.html)["\']', start_html, re.IGNORECASE)
    links = list(set(links))

    print(f"  Found {len(links)} links: {links[:20]}")

    # Filter for likely ONU/optical pages
    optical_keywords = ['onu', 'optical', 'opm', 'signal', 'gpon', 'pon', 'diag', 'stat']
    interesting = [l for l in links if any(k in l.lower() for k in optical_keywords)]
    print(f"  Interesting links: {interesting}")

    for link in interesting[:20]:
        if not link.startswith('http'):
            url = base + ('/' if not link.startswith('/') else '') + link
        else:
            url = link
        try:
            r = sess.get(url, verify=False, timeout=8)
            if r.status_code == 200 and len(r.text) > 200:
                print(f"\n  [OK] {link} ({len(r.text)}b)")
                # Save interesting pages
                fname = Path(f"C:/Users/ahame/Downloads/olt_page_{link.replace('/','_')}.html")
                fname.write_text(r.text, encoding='utf-8', errors='replace')
                extract_optical_data(r.text, url)
        except Exception as e:
            pass


def try_ajax_endpoints(sess: requests.Session, base: str):
    """Try common AJAX/API endpoint patterns for ONU optical data."""
    print(f"\n[AJAX] Probing data endpoints on {base}")

    # Common patterns for Netlink/Chinese OLT web UIs
    endpoints = [
        # GET endpoints
        ("GET", "/action/gpon_onu_optical_info", {}),
        ("GET", "/action/gpon_onu_optical_info?port=0/1", {}),
        ("GET", "/action/gpon_onu_opm", {}),
        ("GET", "/action/onu_opm_diag", {}),
        ("GET", "/action/onu_optical_info", {}),
        ("GET", "/action/get_pon_onu_info", {}),
        ("GET", "/cgi-bin/gpon_onu_optical.cgi", {}),
        # POST endpoints
        ("POST", "/action/gpon_onu_optical_info", {"port": "0/1"}),
        ("POST", "/action/onu_opm", {"port": "0/1", "onu_id": "all"}),
        ("POST", "/action/onu_optical_data", {"slotno": "0", "portno": "1"}),
        ("POST", "/action/get_onu_optical", {"port_id": "0/1"}),
        # Frame-based navigation targets
        ("GET", "/gpon_onu_optical.html?port=0&pon=1", {}),
        ("GET", "/gpon_opm.html?slot=0&port=1", {}),
    ]

    for method, path, payload in endpoints:
        url = base + path
        try:
            if method == "GET":
                r = sess.get(url, verify=False, timeout=5,
                             headers={"X-Requested-With": "XMLHttpRequest"})
            else:
                r = sess.post(url, data=payload, verify=False, timeout=5,
                              headers={"X-Requested-With": "XMLHttpRequest"})

            if r.status_code == 200 and len(r.text) > 50:
                snippet = r.text[:200].replace("\n", " ")
                # Check if it has actual data
                has_data = any(k in r.text for k in ['dBm', 'Rx', 'Tx', 'optical', 'onu', 'ONU'])
                marker = ">>> DATA" if has_data else "     "
                print(f"  {marker} [{r.status_code}] {method} {path} [{len(r.text)}b]: {snippet[:100]}")
                if has_data:
                    fname = Path(f"C:/Users/ahame/Downloads/ajax_{path.replace('/','_')}.txt")
                    fname.write_text(r.text, encoding='utf-8', errors='replace')
            elif r.status_code not in (404, 403, 302):
                print(f"         [{r.status_code}] {method} {path}")
        except Exception as e:
            pass


def scrape_olt(addr: str):
    """Main entry: login and extract all available data from one OLT."""
    base = _base_url(addr)
    print(f"\n{'='*60}")
    print(f"OLT Web Scraper: {addr}")
    print(f"{'='*60}")

    # Step 1: Login
    sess = login(addr)
    if sess is None:
        print("[FATAL] Login failed â€” saving raw login page for inspection")
        # Save raw CAPTCHA images for manual inspection
        s2 = requests.Session()
        s2.verify = False
        s2.get(f"{base}/action/login.html", verify=False, timeout=10)
        _save_captcha_images(s2, base)
        return

    # Step 2: Get main page and parse navigation
    try:
        r = sess.get(f"{base}/action/main.html", verify=False, timeout=10)
        main_html = r.text
        print(f"\n[MAIN] /action/main.html: {r.status_code}, {len(main_html)} bytes")
        # Save main page
        Path("C:/Users/ahame/Downloads/olt_main.html").write_text(
            main_html, encoding='utf-8', errors='replace')
        print("  Saved to C:/Users/ahame/Downloads/olt_main.html")
    except Exception as e:
        print(f"[MAIN] Error: {e}")
        main_html = ""

    # Step 3: Parse nav tree for ONU/optical links
    if main_html:
        probe_nav_tree(sess, base, main_html)

    # Step 4: Discover all known URL patterns
    discover_pages(sess, base)

    # Step 5: Try AJAX/API endpoints
    try_ajax_endpoints(sess, base)

    print(f"\n[DONE] Scrape complete for {addr}")
    print("Check C:/Users/ahame/Downloads/ for saved pages")


if __name__ == "__main__":
    targets = sys.argv[1:] if len(sys.argv) > 1 else []
    if not targets:
        # Default: probe all three OLTs
        targets = ["10.10.10.200:1010", "10.10.10.210", "10.10.10.100:1010"]
    for t in targets:
        scrape_olt(t)
