"""
Application-wide constants — collected from routers into one place.
"""
import re

# ------------------------------------------------------------------
# Ticket State Machine
# ------------------------------------------------------------------
VALID_TRANSITIONS = {
    "Open": ["Assigned", "Ongoing"],
    "Assigned": ["Ongoing", "Open"],
    "Ongoing": ["Resolved", "Assigned"],
    "Resolved": ["Closed", "Ongoing"],
    "Closed": ["Ongoing", "Open", "Assigned"],
}

# ------------------------------------------------------------------
# File Upload
# ------------------------------------------------------------------
ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/quicktime",
    "application/pdf",
}

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")

MAX_PHOTO_UPLOAD_SIZE = 5 * 1024 * 1024  # 5 MB (technician profile photos)
