"""
MAC Address Normalizer
Converts any MAC address format to canonical uppercase colon-delimited format.
Examples: 8cc7c3d239cb → 8C:C7:C3:D2:39:CB
          8C-C7-C3-D2-39-CB → 8C:C7:C3:D2:39:CB
"""

import re


def normalize_mac(raw: str) -> str:
    """
    Normalize MAC address to uppercase colon-delimited format.

    Accepts multiple formats:
    - Colon-delimited: 8C:C7:C3:D2:39:CB (valid, will uppercase)
    - Dash-delimited: 8C-C7-C3-D2-39-CB
    - No separator: 8cc7c3d239cb

    Returns:
    - Normalized MAC: 8C:C7:C3:D2:39:CB
    - Raises ValueError if format is invalid
    """

    if not raw:
        raise ValueError("MAC address cannot be empty")

    # Remove all non-hex characters (colons, dashes, spaces)
    hex_only = re.sub(r'[^0-9a-fA-F]', '', raw)

    # Validate: must be exactly 12 hex characters
    if len(hex_only) != 12:
        raise ValueError(f"Invalid MAC address '{raw}': expected 12 hex characters, got {len(hex_only)}")

    # Convert to uppercase and add colons
    normalized = ':'.join(hex_only[i:i+2] for i in range(0, 12, 2)).upper()

    return normalized


def is_valid_mac(mac: str) -> bool:
    """Check if a string is a valid MAC address (any format)."""
    try:
        normalize_mac(mac)
        return True
    except (ValueError, AttributeError):
        return False


if __name__ == '__main__':
    # Test the normalizer
    test_cases = [
        "8cc7c3d239cb",
        "8C:C7:C3:D2:39:CB",
        "8C-C7-C3-D2-39-CB",
        "8c:c7:c3:d2:39:cb",
    ]

    for test in test_cases:
        normalized = normalize_mac(test)
        print(f"{test:25} → {normalized}")
