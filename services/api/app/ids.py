"""ID + time helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime


def new_id(prefix: str) -> str:
    """Opaque string IDs: `<prefix>_<32 hex>` (UUID4)."""
    return f"{prefix}_{uuid.uuid4().hex}"


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:  # SQLite drops tzinfo; we always store UTC
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def iso(dt: datetime | None) -> str | None:
    dt = as_utc(dt)
    if dt is None:
        return None
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")
