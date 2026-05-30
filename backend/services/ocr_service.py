"""
OCR service for extracting data from ONT/Router sticker photos.

Supports Netlink EPON ONT, Netlink GPON ONT, TP-Link routers, and generic labels.
Uses EasyOCR for text extraction + regex for structured field parsing.

Common failure modes and fixes applied here:
- EasyOCR reads colons as spaces → space-separated MAC pattern added
- EasyOCR reads 0 as O → normalized before matching
- Netlink stickers use "Model:" not "Model No." → pattern extended
- Serial number may have no label on some stickers → inferred from context
- Real phone photos fragment text into single chars → paragraph=True merges them
- Model "NL-E8-C" was captured as "L-E8-C" → fixed No?→No in MODEL_PATTERN
"""
import re
import logging
from typing import Optional
from PIL import Image, ImageEnhance, ImageFilter  # ImageFilter used for UnsharpMask
import io

logger = logging.getLogger(__name__)

# ── Lazy EasyOCR reader (loads model on first call, cached after) ──
_ocr_reader = None

def _get_reader():
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        logger.info("[OCR] Loading EasyOCR model (first-time, may take ~20s)...")
        _ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        logger.info("[OCR] EasyOCR model loaded.")
    return _ocr_reader


# ── Image preprocessing for better OCR accuracy ──
def _preprocess(image_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(image_bytes)).convert('RGB')

    # Upscale if image is small — phone photos from far away benefit most
    # Use 2000px minimum (was 1200) for finer sticker text
    w, h = img.size
    if max(w, h) < 2000:
        scale = 2000 / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    # Convert to grayscale for better OCR on printed stickers
    gray = img.convert('L')

    # Enhance contrast and sharpness aggressively for sticker text
    gray = ImageEnhance.Contrast(gray).enhance(2.5)    # was 2.0
    gray = ImageEnhance.Sharpness(gray).enhance(3.0)   # was 2.5

    # Unsharp mask to recover edges lost by camera focus/compression
    gray = gray.filter(ImageFilter.UnsharpMask(radius=2, percent=180, threshold=3))

    # Convert back to RGB for EasyOCR
    return gray.convert('RGB')


# ── Normalise OCR output to fix common character confusions ──
def _normalize(text: str) -> str:
    """
    Fix common EasyOCR misreads on sticker text:
    - 'O' → '0' in the context of hex strings (not in words)
    We do NOT do this globally — only inside candidate hex blocks.
    """
    return text


# ── Field extraction patterns ──

# MAC: standard separators (colon, dash, nothing)
_MAC_STD = re.compile(
    r'\b([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b'   # with separator
    r'|'
    r'\b[0-9A-Fa-f]{12}\b',                            # no separator (12 hex chars)
    re.IGNORECASE
)

# MAC: space-separated — EasyOCR often reads "8C C7 C3 30 AC 57"
_MAC_SPACE = re.compile(
    r'\b([0-9A-Fa-f]{2})\s+([0-9A-Fa-f]{2})\s+([0-9A-Fa-f]{2})\s+([0-9A-Fa-f]{2})\s+([0-9A-Fa-f]{2})\s+([0-9A-Fa-f]{2})\b',
    re.IGNORECASE
)

# MAC after an explicit label — use [ \t] not \s to prevent cross-line capture
_MAC_LABEL = re.compile(
    r'(?:MAC|MAC\s*ID|MAC\s*Addr(?:ess)?|物理地址)[ \t]*[:\-]?[ \t]*([0-9A-Fa-f:.\-](?:[0-9A-Fa-f:.\-]|[ \t]){10,22})',
    re.IGNORECASE
)

# GPON SN: ALCL12345678 / ZTEG12345678 / GPON003A3C65 (4 alpha + 8 hex)
# Also accepts O, Z, S in the hex part — common OCR misreads (O→0, Z→2, S→5).
# Normalization is applied after matching so the pattern is intentionally loose.
GPON_SN_PATTERN = re.compile(
    r'\b([A-Z]{4}[0-9A-Fa-fZzSsOo]{8})\b'
)

# Serial number after label
SN_LABEL_PATTERN = re.compile(
    r'(?:S[/\\]N|SN|Serial\s*No?\.?|Bar\s*Code)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{5,29})',
    re.IGNORECASE
)

# Model — Netlink stickers just say "Model:" not "Model No."
# Also handles "PRODUCT", "TYPE", "Type No."
# NOTE: "Item" requires "Name" or "No." (not optional) to avoid capturing
# the next random word when "Name" is misread by OCR as "Mame".
MODEL_PATTERN = re.compile(
    r'(?:Model\s*(?:No\.?|Name)?|Item\s+(?:Name|No\.?)|Product|Type\s*(?:No\.?)?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/\.]{2,29})',
    re.IGNORECASE
)

FULL_MODEL_LINE_PATTERN = re.compile(
    r'(?:Item\s+Name|Model\s*(?:No\.?|Name)?|Product|Type\s*(?:No\.?)?)'
    r'[ \t]*[:\-]?[ \t]*([A-Z0-9][A-Z0-9 \t\/\+\-\.\(\)]{2,60})',
    re.IGNORECASE
)

# Netlink-specific model detection:
# - NL-series: NL-E8-C, NL-UNI-1001, etc.
# - HUT-series: HUT routers
# - GP+digit: GP1101D, GP8142 (GP must be followed by digit to avoid "GPON", "GPONIGEPON")
# - V+4-digit: V2802, V2802DAC, V2802R — NET Link ONT models (V2802 DAC has space variant)
_NETLINK_MODEL = re.compile(
    r'\b(HG[0-9A-Z]{3,20}|NL[\-A-Z0-9]{3,20}|HUT[\-A-Z0-9]{3,20}|GP[0-9][\-A-Z0-9]{2,15}|V[0-9]{4}[A-Z0-9\-]{0,10})\b'
)

# Bare model line: a line that IS a known model code with nothing else important
_BARE_MODEL_LINE = re.compile(
    r'^\s*(HG[0-9A-Z]{3,20}|NL[\-A-Z0-9]{3,20}|HUT[\-A-Z0-9]{3,20}|GP[0-9][\-A-Z0-9]{2,15}|V[0-9]{4}[A-Z0-9\-]{0,10})\s*$',
    re.IGNORECASE,
)


# WiFi SSID 2.4GHz — matches "WiFi SSID(2.4G):", "WiFi Name:", "SSID:", "2.4G SSID:"
# Sticker format 2 (HG323DAC) uses "WiFi SSID(2.4G)" label explicitly.
WIFI_SSID_2G_PATTERN = re.compile(
    r'(?:Wi[-\s]?Fi\s+(?:SSID|Name)\s*(?:\(2\.?4\s*G(?:Hz)?\))?'
    r'|SSID\s*(?:\(2\.?4\s*G(?:Hz)?\))?'
    r'|2\.?4\s*G(?:Hz)?\s*(?:SSID|Name))'
    r'\s*[:\-]?\s*([A-Za-z0-9_@\-\.\ ]{2,32})',
    re.IGNORECASE,
)

# WiFi SSID 5GHz — matches "WiFi SSID(5G):", "5G SSID:", "5GHz SSID:"
WIFI_SSID_5G_PATTERN = re.compile(
    r'(?:Wi[-\s]?Fi\s+(?:SSID|Name)\s*\(5\s*G(?:Hz)?\)'
    r'|SSID\s*\(5\s*G(?:Hz)?\)'
    r'|5\s*G(?:Hz)?\s*(?:SSID|Name))'
    r'\s*[:\-]?\s*([A-Za-z0-9_@\-\.\ ]{2,32})',
    re.IGNORECASE,
)

# WiFi password — matches "WiFi Key(WPA):", "WiFi Password:", "WPA Key:", "Default Password:"
# Require ≥6 chars to avoid catching short garbage tokens.
WIFI_PASSWORD_PATTERN = re.compile(
    r'(?:Wi[-\s]?Fi\s+(?:Key|Password|Pass|Pwd)\s*(?:\([^)]{0,20}\))?'
    r'|WPA\s*(?:Key|Password|Pass)'
    r'|Default\s+(?:Wi[-\s]?Fi\s+)?(?:Key|Password|Pass(?:word)?)'
    r'|(?:Key|Password)\s*(?:\(WPA(?:2)?\))?)'
    r'\s*[:\-]?\s*([A-Za-z0-9!@#$%^&*()\+\-_=\[\]]{6,})',
    re.IGNORECASE,
)


def _clean_mac(raw: str) -> str:
    """Normalize MAC to no-separator uppercase: 8CC7C330AC57"""
    return re.sub(r'[:\-\s\.]', '', raw).upper()


def _looks_like_mac(s: str) -> bool:
    clean = re.sub(r'[:\-\s\.]', '', s)
    # Also handle OCR confusion of O→0 in hex context
    clean = clean.replace('O', '0').replace('o', '0')
    return bool(re.match(r'^[0-9A-Fa-f]{12}$', clean))


def _normalize_hex(s: str) -> str:
    """
    Substitute characters that EasyOCR commonly misreads in hex context.
    Only substitutes characters that are NOT valid hex digits (safe substitutions):
      Z → 2  (very similar shape in sticker fonts)
      S → 5  (similar shape)
    Does NOT substitute B→8 because B is valid hex.
    Does NOT substitute 4↔A because both are valid hex — handled by DB cross-check.
    """
    return (s.replace('Z', '2').replace('z', '2')
             .replace('S', '5').replace('s', '5'))


def _mac_entropy_ok(mac: str) -> bool:
    """
    Reject MACs that look like barcode/OCR noise:
    - Fewer than 4 unique hex characters (barcode produces mono-runs like CCCCCCCCCCCC)
    - 4+ consecutive identical characters (e.g. AAAA, CCCC from barcode stripes)
    Real 12-char MACs almost always have ≥ 4 distinct nibbles.
    """
    if len(set(mac.upper())) < 4:
        return False
    if re.search(r'(.)\1{3,}', mac, re.IGNORECASE):
        return False
    return True


def _extract_mac(raw_text: str) -> Optional[tuple]:
    """
    Try multiple strategies to find a MAC address in OCR text.
    Returns (mac, strategy) or None.
    strategy values (in confidence order):
      'explicit_format'  — colon/dash separator, unambiguous
      'explicit_label'   — after MAC: label
      'space_separated'  — space-separated hex pairs after MAC label
      'mac_line_scan'    — 12 hex chars on a line that mentions MAC (medium confidence)
      'line_scan'        — 12 hex chars on any non-SN line (low confidence)
      'fuzzy_hex'        — last-resort concatenate+strip (lowest confidence)
    """
    _sn_line = re.compile(r'(?:S[/\\]N|SN|Serial|Bar\s*Code)', re.IGNORECASE)
    _mac_line = re.compile(r'\bMAC\b', re.IGNORECASE)

    def _fix_hex(s: str) -> str:
        """Apply all safe OCR→hex corrections: O→0, Z→2, S→5, I→1, l→1."""
        return (_normalize_hex(s)
                .replace('O', '0').replace('o', '0')
                .replace('I', '1').replace('l', '1'))

    # Strategy 1: standard colon/dash/no-separator format — highest confidence
    for m in _MAC_STD.finditer(raw_text):
        candidate = _fix_hex(m.group(0))
        if _looks_like_mac(candidate):
            mac = _clean_mac(candidate)
            if _mac_entropy_ok(mac):
                return (mac, 'explicit_format')

    # Strategy 2: after explicit MAC label
    for m in _MAC_LABEL.finditer(raw_text):
        candidate = _fix_hex(m.group(1).strip())
        if _looks_like_mac(candidate):
            mac = _clean_mac(candidate)
            if _mac_entropy_ok(mac):
                return (mac, 'explicit_label')

    # Strategy 3: space-separated hex pairs (most common EasyOCR failure mode)
    for m in _MAC_SPACE.finditer(raw_text):
        candidate = _fix_hex(''.join(m.groups()))
        if _looks_like_mac(candidate):
            mac = candidate.upper()
            if _mac_entropy_ok(mac):
                return (mac, 'space_separated')

    # Strategy 4a: 12 hex chars on a MAC-labelled line — medium confidence.
    # IMPORTANT: search only the text AFTER the "MAC" keyword to avoid the
    # "M", "A", "C" letters themselves being included in the hex match.
    # e.g. "...MAC 8C13E2ZA3C65" → only scan "8C13E2ZA3C65", not "MAC8C..."
    all_lines = raw_text.splitlines()
    for line in [l for l in all_lines if _mac_line.search(l)]:
        mac_pos = _mac_line.search(line)
        after_label = line[mac_pos.end():]          # text after "MAC"
        compact = _fix_hex(re.sub(r'\s+', '', after_label))
        for m in re.finditer(r'[0-9A-Fa-f]{12}', compact):
            mac = m.group(0).upper()
            if _mac_entropy_ok(mac):
                return (mac, 'mac_line_scan')

    # Strategy 4b: 12 hex chars on non-SN, non-MAC lines — low confidence
    for line in [l for l in all_lines if not _mac_line.search(l) and not _sn_line.search(l)]:
        compact = _fix_hex(re.sub(r'\s+', '', line))
        for m in re.finditer(r'[0-9A-Fa-f]{12}', compact):
            mac = m.group(0).upper()
            if _mac_entropy_ok(mac):
                return (mac, 'line_scan')

    # Strategy 5: last resort — concatenate all non-SN text, strip non-hex chars.
    # Lowest confidence — high false positive rate from barcodes.
    non_sn_text = '\n'.join(l for l in raw_text.splitlines() if not _sn_line.search(l))
    s5 = _fix_hex(re.sub(r'\s+', '', non_sn_text))
    s5 = s5.replace('<', 'C').replace('[', '1')
    s5_hex = re.sub(r'[^0-9A-Fa-f]', '', s5)
    for m in re.finditer(r'[0-9A-Fa-f]{12}(?![0-9A-Fa-f])', s5_hex):
        mac = m.group(0).upper()
        if _mac_entropy_ok(mac):
            return (mac, 'fuzzy_hex')

    return None


def _mac_4a_candidates(mac: str) -> list:
    """
    Generate all 4↔A substitution variants of a MAC address.
    EasyOCR confuses '4' and 'A' in some sticker fonts — they look similar.
    Returns list of alternative MACs to try against the OLT database.
    Only substitutes positions where 4 or A appear (both valid hex).
    """
    positions = [i for i, c in enumerate(mac) if c in ('4', 'A')]
    candidates = []
    for pos in positions:
        alt = list(mac)
        alt[pos] = 'A' if mac[pos] == '4' else '4'
        candidates.append(''.join(alt))
    return candidates


# Keywords that only appear in correctly-oriented ISP/ONT sticker text.
# Each hit adds 5 to the score so domain-relevant orientations always win
# over garbled text that happens to have many 3-char tokens.
_DOMAIN_KEYWORDS = [
    'mac', 'gpon', 'epon', 'model', 'serial', 'password', 'admin',
    'power', 'address', 'link', 'wifi', 'router', 'ont', 'username',
    'netlink', 'net link', 'archer', 'tp-link', 'tplink', 'item',
    'default', 'ssid', 'ssid:', 'mac:', 's/n', 'sn:', 'ver:',
]


def _orientation_score(text: str) -> int:
    """
    Score OCR text for how likely it is to be correctly oriented.
    - Count alphabetic tokens ≥ 3 chars (readable words, not single chars or garbage)
    - Boost heavily for ISP/ONT domain keywords (MAC, GPON, Model, etc.)
    Garbage at wrong rotation gives word count but no keyword hits.
    """
    t_lower = text.lower()
    score = sum(1 for w in re.split(r'\s+', text) if len(w) >= 3 and w.isalpha())
    for kw in _DOMAIN_KEYWORDS:
        if kw in t_lower:
            score += 5
    return score


def _ocr_best_rotation(img: 'Image.Image', reader) -> str:
    """
    Try OCR at all 4 orientations (0°, 90°, 180°, 270°) and return the text
    from whichever orientation scores highest.

    Why all 4:
    - 0°/90°: landscape sticker on portrait phone — most common
    - 270°: device mounted upside-down sideways (common for wall boxes)
    - 180°: device photographed from behind or inverted

    Scoring uses domain keywords (MAC, GPON, Model, etc.) not just word count,
    so garbled text at wrong orientation doesn't win over correct orientation
    with a high word count but no domain relevance.
    """
    best_text = ""
    best_score = -1

    for angle in [0, 90, 270, 180]:   # 270 before 180 — more common than 180
        rotated = img if angle == 0 else img.rotate(angle, expand=True)
        buf = io.BytesIO()
        rotated.save(buf, format='JPEG', quality=95)

        results = reader.readtext(buf.getvalue(), detail=0, paragraph=True)
        text = '\n'.join(results)
        score = _orientation_score(text)

        logger.info("[OCR] Rotation %d°: domain_score=%d  lines=%d", angle, score, len(results))

        if score > best_score:
            best_score = score
            best_text = text

        # Early exit only if a clear winner — high keyword score means we definitely
        # found the right orientation (score ≥ 30 = at least 6 keyword hits)
        if score >= 30:
            logger.info("[OCR] Early exit at %d° (score=%d)", angle, score)
            break

    return best_text


def _extract_label_value_fields(raw_text: str) -> dict:
    """
    Preserve all readable sticker data as key/value evidence. This is intentionally
    broad because field stickers vary by model and vendor.
    """
    fields = {}
    aliases = [
        ("commodity", r"commodity"),
        ("model_no", r"model\s*(?:no\.?|name)?"),
        ("specification", r"specification"),
        ("power", r"power|dc"),
        ("management_ip", r"management\s*ip|ip\s*address"),
        ("username", r"username|user\s*name"),
        ("password", r"password|passw[o0]rd"),
        ("mac", r"mac(?:\s*id|\s*address)?"),
        ("pon_serial", r"pon\s*s[/\\]?\s*n|gpon\s*sn"),
        ("serial_number", r"s[/\\]?\s*n|serial\s*no?\.?"),
        ("item_name", r"item\s+name|name"),
        ("wifi_ssid_2g", r"wifi\s*ssid\s*\(?(?:2\.?4)\s*g\)?|2\.?4\s*g\s*ssid"),
        ("wifi_key_2g", r"wifi\s*(?:key|password)\s*\(?(?:wpa)?\)?\s*\(?(?:2\.?4)\s*g\)?"),
        ("wifi_ssid_5g", r"wifi\s*ssid\s*\(?5\s*g\)?|5\s*g\s*ssid"),
        ("wifi_key_5g", r"wifi\s*(?:key|password)\s*\(?(?:wpa)?\)?\s*\(?5\s*g\)?"),
        ("ssid", r"ssid"),
        ("pin", r"pin"),
        ("version", r"ver(?:sion)?"),
    ]
    for line in [ln.strip() for ln in raw_text.splitlines() if ln.strip()]:
        for key, pattern in aliases:
            m = re.search(rf"(?:{pattern})\s*[:\-]?\s*(.+)$", line, re.IGNORECASE)
            if m:
                value = m.group(1).strip(" :\t")
                if value and len(value) <= 120 and key not in fields:
                    fields[key] = value
                break
    return fields


def _redact_sticker_credentials(raw_text: str) -> str:
    """Remove WiFi/admin credential lines from OCR debug text."""
    sensitive = re.compile(r'\b(wi[-\s]?fi|ssid|wpa|key|password|pwd)\b', re.IGNORECASE)
    redacted_lines = []
    for line in raw_text.splitlines():
        if sensitive.search(line):
            redacted_lines.append("[credential line ignored]")
        else:
            redacted_lines.append(line)
    return "\n".join(redacted_lines)


def _public_sticker_fields(fields: dict) -> dict:
    """Keep sticker metadata useful for review without collecting credentials."""
    sensitive = re.compile(r'(wi[-_ ]?fi|ssid|wpa|key|password|pwd)', re.IGNORECASE)
    return {
        key: value
        for key, value in fields.items()
        if not sensitive.search(str(key)) and not sensitive.search(str(value))
    }


def _unique(items: list) -> list:
    seen = set()
    out = []
    for item in items:
        if not item:
            continue
        key = str(item).upper()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _candidate_identities(raw_text: str, *, mac_address: Optional[str], gpon_sn: Optional[str], ont_serial_number: Optional[str]) -> tuple:
    serial_candidates = [gpon_sn, ont_serial_number]
    for match in GPON_SN_PATTERN.findall(raw_text):
        raw_sn = match.upper()
        serial_candidates.append(raw_sn[:4] + _normalize_hex(raw_sn[4:]).replace("O", "0"))
    for match in SN_LABEL_PATTERN.findall(raw_text):
        serial_candidates.append(match.strip().upper())

    mac_candidates = [mac_address]
    for match in _MAC_STD.finditer(raw_text):
        candidate = _clean_mac(match.group(0))
        if _looks_like_mac(candidate) and _mac_entropy_ok(candidate):
            mac_candidates.append(candidate)
    for match in _MAC_SPACE.finditer(raw_text):
        candidate = "".join(match.groups()).upper()
        if _looks_like_mac(candidate) and _mac_entropy_ok(candidate):
            mac_candidates.append(candidate)

    return _unique(serial_candidates), _unique(mac_candidates)


def extract_sticker_data(image_bytes: bytes) -> dict:
    """
    Run OCR on a sticker photo and return structured field data.
    Automatically handles images where the sticker is rotated 90°
    (common when photographing wall-mounted ONTs in portrait mode).
    """
    try:
        img = _preprocess(image_bytes)
        reader = _get_reader()
        raw_text = _ocr_best_rotation(img, reader)
        logger.info("[OCR] Raw text (%d lines):\n%s", len(raw_text.splitlines()), raw_text)

    except Exception as e:
        logger.error("[OCR] OCR failed: %s", e)
        return {
            "mac_address": None, "gpon_sn": None, "onu_identifier": None,
            "ont_model": None, "ont_serial_number": None,
            "sticker_fields": {}, "serial_candidates": [], "mac_candidates": [],
            "device_type": "unknown", "raw_text": "", "confidence": "low",
            "error": str(e),
        }

    # ── Extract fields ──

    mac_result = _extract_mac(raw_text)
    if mac_result:
        mac_address, mac_strategy = mac_result
    else:
        mac_address, mac_strategy = None, None

    # MAC confidence based on extraction strategy
    # high: explicit format/label/space-pairs — unambiguous
    # medium: found on a MAC-labelled line — likely correct
    # low: fuzzy fallback — high false positive rate, tech must verify
    _HIGH_CONFIDENCE_STRATEGIES = {'explicit_format', 'explicit_label', 'space_separated'}
    _MEDIUM_CONFIDENCE_STRATEGIES = {'mac_line_scan'}
    if mac_strategy in _HIGH_CONFIDENCE_STRATEGIES:
        mac_confidence = 'high'
    elif mac_strategy in _MEDIUM_CONFIDENCE_STRATEGIES:
        mac_confidence = 'medium'
    elif mac_strategy is not None:
        mac_confidence = 'low'
    else:
        mac_confidence = None

    logger.info("[OCR] MAC=%s  strategy=%s  mac_confidence=%s", mac_address, mac_strategy, mac_confidence)

    # GPON SN — GPON_SN_PATTERN accepts Z/S in hex part.
    # After matching, normalize Z→2 and S→5 in the 8-char hex suffix only.
    # The 4-char vendor prefix (GPON, ALCL, ZTEG) must stay alphabetic.
    gpon_sn: Optional[str] = None
    gpon_matches = GPON_SN_PATTERN.findall(raw_text)
    if gpon_matches:
        raw_sn = gpon_matches[0].upper()
        prefix = raw_sn[:4]                          # e.g. "GPON"
        hex_part = (_normalize_hex(raw_sn[4:])       # Z→2, S→5
                    .replace('O', '0').replace('o', '0'))  # O→0
        gpon_sn = prefix + hex_part

    onu_identifier = gpon_sn or mac_address

    # Model — try label pattern first, then Netlink-specific model codes
    full_model_match = FULL_MODEL_LINE_PATTERN.search(raw_text)
    ont_model = None
    if full_model_match:
        full_model = re.sub(r'\s+', ' ', full_model_match.group(1)).strip(" :-")
        full_model = re.split(
            r'\b(?:VER(?:SION)?|S[/\\]?N|SN|MAC|POWER|IP\s+ADDRESS|DEFAULT|USERNAME|PASSWORD)\b',
            full_model,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip(" :-")
        compact_hit = _NETLINK_MODEL.search(full_model)
        if compact_hit or re.search(r'\b(ONT|ONU|ROUTER|ARCHER|TP-?LINK|GPON|GEPON)\b', full_model, re.IGNORECASE):
            ont_model = full_model[:64]

    if not ont_model:
        model_match = MODEL_PATTERN.search(raw_text)
        if model_match:
            ont_model = model_match.group(1).strip()
        else:
            # Fallback 1: scan all text for a Netlink model code
            nl_match = _NETLINK_MODEL.search(raw_text)
            if nl_match:
                ont_model = nl_match.group(1)
            else:
                # Fallback 2: a line that is ONLY a known model code (OCR reads label-less lines)
                for line in raw_text.splitlines():
                    bare = _BARE_MODEL_LINE.match(line)
                    if bare:
                        ont_model = bare.group(1).upper()
                        break

    # Extend model with ONE space-separated suffix token (e.g. "V2802"→"V2802 DAC",
    # "Archer"→"Archer C24"). Allows alphanumeric suffixes but only one word to
    # prevent grabbing the next field ("V2802 DAC DC" → stops at "DAC", not "DC").
    if ont_model and " " not in ont_model:
        suffix_pat = re.compile(
            re.escape(ont_model) + r'\s+([A-Z][A-Z0-9\-]{1,7})\b',
            re.IGNORECASE
        )
        sfx = suffix_pat.search(raw_text)
        if sfx and sfx.group(1).upper() not in ('DC', 'AC', 'MAC', 'SN', 'IP', 'ID'):
            ont_model = ont_model + ' ' + sfx.group(1).upper()

    # Serial number
    sn_match = SN_LABEL_PATTERN.search(raw_text)
    ont_serial_number = sn_match.group(1).strip() if sn_match else None

    # ── WiFi fields (extracted from sticker, not stored in OLT — for admin reference) ──

    # WiFi SSID 5GHz first (more specific pattern — run before 2.4G to avoid mismatch)
    wifi_ssid_5g: Optional[str] = None
    m_ssid_5g = WIFI_SSID_5G_PATTERN.search(raw_text)
    if m_ssid_5g:
        wifi_ssid_5g = m_ssid_5g.group(1).strip()

    # WiFi SSID 2.4GHz (generic SSID if no band hint matches 5G above)
    wifi_ssid: Optional[str] = None
    for m in WIFI_SSID_2G_PATTERN.finditer(raw_text):
        val = m.group(1).strip()
        # Skip if same value already captured as 5G, or if value looks like a field label
        if val and val != wifi_ssid_5g and not re.match(r'^(password|key|mac|serial|model|ssid|wifi)$', val, re.I):
            wifi_ssid = val
            break

    # WiFi password
    wifi_password: Optional[str] = None
    m_pwd = WIFI_PASSWORD_PATTERN.search(raw_text)
    if m_pwd:
        val = m_pwd.group(1).strip()
        # Reject if it looks like a MAC or is too long to be a password
        if val and not re.match(r'^[0-9A-Fa-f]{12}$', val) and len(val) <= 63:
            wifi_password = val

    # Sticker scanning is only used for device identity. Do not collect WiFi/admin
    # credentials even when OCR sees them on the label.
    wifi_ssid = None
    wifi_ssid_5g = None
    wifi_password = None

    # ── Detect device type ──
    text_lower = raw_text.lower()
    is_router = any(brand in text_lower for brand in ['tp-link', 'tplink', 'asus', 'd-link', 'netgear', 'archer', 'ac750', 'ac1200', 'ac1750'])
    if gpon_sn:
        # GPON SN found → definitely a GPON ONT
        device_type = 'gpon_ont'
    elif 'gpon' in text_lower:
        # "gpon" in text but SN pattern didn't match → still a GPON ONT
        device_type = 'gpon_ont'
    elif is_router:
        device_type = 'router'
    elif 'epon' in text_lower or 'gepon' in text_lower or 'netlink' in text_lower:
        device_type = 'epon_ont'
    elif mac_address and not gpon_sn:
        device_type = 'epon_ont'
    else:
        device_type = 'unknown'

    # For routers: MAC from fuzzy_hex or line_scan is unreliable (no MAC label on most
    # router sticker photos). Only keep MAC if found via explicit format/label.
    if device_type == 'router' and mac_strategy not in ('explicit_format', 'explicit_label', 'space_separated'):
        mac_address = None
        mac_strategy = None
        mac_confidence = None

    # ── Overall confidence score ──
    found_fields = sum(1 for x in [mac_address, gpon_sn, ont_model, ont_serial_number] if x)
    if found_fields >= 3:
        confidence = 'high'
    elif found_fields >= 1:
        confidence = 'medium'
    else:
        confidence = 'low'

    # If MAC itself was found only by fuzzy fallback, cap overall confidence at medium
    if mac_confidence == 'low' and confidence == 'high':
        confidence = 'medium'

    sticker_fields = _public_sticker_fields(_extract_label_value_fields(raw_text))
    serial_candidates, mac_candidates = _candidate_identities(
        raw_text,
        mac_address=mac_address,
        gpon_sn=gpon_sn,
        ont_serial_number=ont_serial_number,
    )

    return {
        "mac_address": mac_address,
        "mac_confidence": mac_confidence,   # 'high'|'medium'|'low'|None — specific to MAC field
        "mac_strategy": mac_strategy,       # which extraction strategy found it (for debugging)
        "gpon_sn": gpon_sn,
        "onu_identifier": onu_identifier,
        "ont_model": ont_model,
        "ont_serial_number": ont_serial_number,
        "serial_candidates": serial_candidates,
        "mac_candidates": mac_candidates,
        "sticker_fields": sticker_fields,
        "wifi_ssid": None,
        "wifi_ssid_5g": None,
        "wifi_password": None,
        "device_type": device_type,
        "raw_text": _redact_sticker_credentials(raw_text),
        "confidence": confidence,
    }
