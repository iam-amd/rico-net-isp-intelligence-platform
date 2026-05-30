"""
Unified file upload utilities — extracted from tickets.py and technicians.py.
"""
import logging
import os
import uuid
from typing import Optional

from fastapi import HTTPException, UploadFile

from config.constants import ALLOWED_IMAGE_EXTENSIONS, ALLOWED_MIME_TYPES, FILENAME_SAFE_RE
from config.settings import settings

logger = logging.getLogger("rico_net.uploads")

MAX_UPLOAD_SIZE_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


def sanitize_filename(filename: Optional[str]) -> str:
    """Normalize filenames to prevent path traversal and unsafe characters."""
    base = os.path.basename(filename or "upload.bin")
    cleaned = FILENAME_SAFE_RE.sub("_", base).strip("._")
    return cleaned or "upload.bin"


async def save_uploaded_file(
    file: UploadFile,
    dest_dir: str,
    *,
    allowed_mimes: set = None,
    allowed_extensions: set = None,
    max_size_bytes: int = None,
    prefix: str = None,
) -> str:
    """
    Save an uploaded file to disk with validation.

    Returns the relative path from the uploads root (e.g. "tickets/123/uuid_file.jpg").
    """
    if allowed_mimes is None:
        allowed_mimes = ALLOWED_MIME_TYPES
    if max_size_bytes is None:
        max_size_bytes = MAX_UPLOAD_SIZE_BYTES

    # Validate MIME type
    if file.content_type and file.content_type not in allowed_mimes:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{file.content_type}' is not allowed. "
            f"Allowed: {', '.join(sorted(allowed_mimes))}",
        )

    # Validate extension if specified
    if allowed_extensions:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type. Allowed: {', '.join(sorted(allowed_extensions))}",
            )

    # Build safe filename
    safe_name = sanitize_filename(file.filename)
    unique_name = f"{prefix or uuid.uuid4().hex}_{safe_name}"

    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, unique_name)

    # Stream to disk with size check
    total_size = 0
    try:
        with open(dest_path, "wb") as f:
            while chunk := await file.read(1024 * 64):  # 64KB chunks
                total_size += len(chunk)
                if total_size > max_size_bytes:
                    f.close()
                    delete_file_safe(dest_path)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size: {max_size_bytes // (1024 * 1024)} MB.",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        delete_file_safe(dest_path)
        logger.error("Error saving upload: %s", str(e))
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    return unique_name


def delete_file_safe(path: str) -> bool:
    """Delete a file, logging errors instead of raising."""
    try:
        if os.path.exists(path):
            os.remove(path)
            return True
    except OSError as e:
        logger.warning("Failed to delete file %s: %s", path, str(e))
    return False
