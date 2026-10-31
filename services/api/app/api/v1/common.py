"""Shared router helpers: org-scoped lookups, upload streaming, custom route class."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.deps import AuthContext, not_found
from app.models import (
    Article,
    DesignProfile,
    EventSession,
    Export,
    ExtractedFact,
    Project,
    ReferenceMagazine,
    Speaker,
    VideoSource,
)


class PFRoute(APIRoute):
    """Drop `null` fields from responses so optional TS fields are absent rather than null."""

    def __init__(self, *args, **kwargs):
        kwargs["response_model_exclude_none"] = True
        super().__init__(*args, **kwargs)


def get_project(db: Session, ctx: AuthContext, project_id: str) -> Project:
    p = db.get(Project, project_id)
    if p is None or p.org_id != ctx.org_id:
        raise not_found("Project")
    return p


def get_video(db: Session, ctx: AuthContext, video_id: str) -> VideoSource:
    v = db.get(VideoSource, video_id)
    if v is None or v.org_id != ctx.org_id:
        raise not_found("Video")
    return v


def _project_scoped(db: Session, ctx: AuthContext, model, obj_id: str, label: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise not_found(label)
    p = db.get(Project, obj.project_id)
    if p is None or p.org_id != ctx.org_id:
        raise not_found(label)
    return obj


def get_speaker(db, ctx, sid) -> Speaker:
    return _project_scoped(db, ctx, Speaker, sid, "Speaker")


def get_fact(db, ctx, fid) -> ExtractedFact:
    return _project_scoped(db, ctx, ExtractedFact, fid, "Fact")


def get_session(db, ctx, sid) -> EventSession:
    return _project_scoped(db, ctx, EventSession, sid, "Session")


def get_article(db, ctx, aid) -> Article:
    return _project_scoped(db, ctx, Article, aid, "Article")


def get_reference(db: Session, ctx: AuthContext, ref_id: str) -> ReferenceMagazine:
    r = db.get(ReferenceMagazine, ref_id)
    if r is None or r.org_id != ctx.org_id:
        raise not_found("Reference")
    return r


def get_profile(db: Session, ctx: AuthContext, pid: str) -> DesignProfile:
    d = db.get(DesignProfile, pid)
    if d is None or d.org_id != ctx.org_id:
        raise not_found("Design profile")
    return d


def get_export(db: Session, ctx: AuthContext, eid: str) -> Export:
    e = db.get(Export, eid)
    if e is None or e.org_id != ctx.org_id:
        raise not_found("Export")
    return e


async def save_upload_to_temp(upload: UploadFile, max_bytes: int, suffix: str = "") -> tuple[Path, int, bytes]:
    """Stream an upload to a temp file enforcing a size limit. Returns (path, size, first 16 bytes)."""
    fd, tmp = tempfile.mkstemp(prefix="pf-up-", suffix=suffix)
    size = 0
    head = b""
    try:
        with os.fdopen(fd, "wb") as f:
            while chunk := await upload.read(1024 * 1024):
                if not head:
                    head = chunk[:16]
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {max_bytes // (1024 * 1024)} MB limit.")
                f.write(chunk)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    if size == 0:
        Path(tmp).unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    return Path(tmp), size, head


def safe_filename(name: str | None, default: str = "file") -> str:
    base = Path(name or default).name
    cleaned = "".join(ch if ch.isalnum() or ch in "._- ()" else "_" for ch in base).strip() or default
    return cleaned[:200]
