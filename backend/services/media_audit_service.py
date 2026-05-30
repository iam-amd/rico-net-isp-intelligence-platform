"""Media ownership audit for uploads/.

This does not introduce a new media table yet. It builds a runtime ownership
map from the current schema so operators can see which files are referenced,
which references are broken, and which files are orphaned on disk.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session

import models
from config.settings import settings


UPLOAD_PREFIX = "/uploads/"


@dataclass(frozen=True)
class MediaRef:
    url: str
    owner_type: str
    owner_id: str
    field: str


def _normalize_upload_url(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    raw = str(value).strip().replace("\\", "/")
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        marker = "/uploads/"
        idx = raw.find(marker)
        if idx == -1:
            return None
        raw = raw[idx:]
    if not raw.startswith(UPLOAD_PREFIX):
        return None
    return "/" + raw.lstrip("/")


def _rel_from_url(url: str) -> str:
    return url[len(UPLOAD_PREFIX):].replace("\\", "/").lstrip("/")


def _disk_path(upload_root: str, url: str) -> str:
    rel = _rel_from_url(url)
    return os.path.abspath(os.path.join(upload_root, rel))


def _add_ref(refs: List[MediaRef], value: Optional[str], owner_type: str, owner_id: Any, field: str) -> None:
    url = _normalize_upload_url(value)
    if not url:
        return
    refs.append(MediaRef(url=url, owner_type=owner_type, owner_id=str(owner_id), field=field))


def _add_json_url_refs(refs: List[MediaRef], raw: Optional[str], owner_type: str, owner_id: Any, field: str) -> None:
    if not raw:
        return
    try:
        values = json.loads(raw)
    except Exception:
        return
    if not isinstance(values, list):
        return
    for idx, value in enumerate(values):
        _add_ref(refs, value, owner_type, owner_id, f"{field}[{idx}]")


def collect_media_refs(db: Session) -> List[MediaRef]:
    refs: List[MediaRef] = []

    for row in db.query(models.TicketMedia.id, models.TicketMedia.ticket_id, models.TicketMedia.file_path).all():
        _add_ref(refs, row.file_path, "ticket_media", row.id, f"ticket:{row.ticket_id}")

    for customer in db.query(models.Customer).all():
        owner = customer.username
        _add_ref(refs, customer.install_photo_url, "customer", owner, "install_photo_url")
        _add_ref(refs, customer.sticker_photo_url, "customer", owner, "sticker_photo_url")
        _add_ref(refs, customer.router_sticker_photo_url, "customer", owner, "router_sticker_photo_url")

    for binding in db.query(models.ONUBinding).all():
        _add_ref(refs, binding.sticker_photo_url, "onu_binding", binding.id, "sticker_photo_url")

    for tech in db.query(models.Technician).all():
        _add_ref(refs, getattr(tech, "profile_photo", None), "technician", tech.id, "profile_photo")

    for building in db.query(models.PGBuilding).all():
        _add_ref(refs, building.photo_url, "pg_building", building.id, "photo_url")

    for group in db.query(models.PGRouterGroup).all():
        _add_ref(refs, group.photo_url, "pg_router_group", group.id, "photo_url")

    for room in db.query(models.PGRoom).all():
        _add_ref(refs, room.ont_sticker_photo_url, "pg_room", room.id, "ont_sticker_photo_url")
        _add_ref(refs, room.router_sticker_photo_url, "pg_room", room.id, "router_sticker_photo_url")
        _add_json_url_refs(refs, room.photo_urls, "pg_room", room.id, "photo_urls")

    return refs


def _scan_upload_files(upload_root: str) -> List[Dict[str, Any]]:
    if not os.path.isdir(upload_root):
        return []
    files: List[Dict[str, Any]] = []
    for root, _, names in os.walk(upload_root):
        for name in names:
            path = os.path.abspath(os.path.join(root, name))
            rel = os.path.relpath(path, upload_root).replace("\\", "/")
            try:
                stat = os.stat(path)
            except OSError:
                continue
            files.append({
                "url": f"{UPLOAD_PREFIX}{rel}",
                "relative_path": rel,
                "size_bytes": stat.st_size,
                "modified_at": stat.st_mtime,
            })
    return files


def get_media_audit(db: Session, *, include_orphans: bool = True, limit: int = 500) -> Dict[str, Any]:
    upload_root = os.path.abspath(settings.UPLOAD_DIR)
    refs = collect_media_refs(db)
    refs_by_url: Dict[str, List[MediaRef]] = {}
    for ref in refs:
        refs_by_url.setdefault(ref.url, []).append(ref)

    disk_files = _scan_upload_files(upload_root)
    disk_urls: Set[str] = {item["url"] for item in disk_files}
    ref_urls: Set[str] = set(refs_by_url)

    missing = []
    for url in sorted(ref_urls - disk_urls):
        path = _disk_path(upload_root, url)
        missing.append({
            "url": url,
            "expected_path": path,
            "owners": [ref.__dict__ for ref in refs_by_url[url]],
        })

    orphans = []
    if include_orphans:
        for item in disk_files:
            if item["url"] not in ref_urls:
                orphans.append(item)

    duplicate_refs = [
        {
            "url": url,
            "owners": [ref.__dict__ for ref in owners],
        }
        for url, owners in sorted(refs_by_url.items())
        if len(owners) > 1
    ]

    referenced_size = sum(item["size_bytes"] for item in disk_files if item["url"] in ref_urls)
    orphan_size = sum(item["size_bytes"] for item in orphans)
    return {
        "upload_root": upload_root,
        "summary": {
            "referenced_urls": len(ref_urls),
            "disk_files": len(disk_files),
            "missing_files": len(missing),
            "orphan_files": len(orphans),
            "duplicate_references": len(duplicate_refs),
            "referenced_size_bytes": referenced_size,
            "orphan_size_bytes": orphan_size,
        },
        "missing_files": missing[:limit],
        "orphan_files": sorted(orphans, key=lambda x: x["relative_path"])[:limit],
        "duplicate_references": duplicate_refs[:limit],
    }
