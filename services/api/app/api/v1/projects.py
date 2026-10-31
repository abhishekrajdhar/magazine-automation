"""Projects CRUD, workspace aggregate, assets."""

from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import RedirectResponse, StreamingResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import delete, select

from app.config import get_settings
from app.deps import DB, CurrentAuth, ensure, not_found, require
from app.ids import new_id
from app.models import (
    Activity,
    Article,
    Asset,
    DesignProfile,
    EventSession,
    Export,
    ExtractedFact,
    MagazinePage,
    Project,
    ReferenceMagazine,
    Speaker,
    TranscriptSegment,
    VideoSource,
)
from app.schemas.base import OkResponse
from app.schemas.pages import ActivityItem, Asset as AssetSchema, AssetUpdate, GenerateImageRequest
from app.schemas.project import Project as ProjectSchema
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.schemas.workspace import ProjectWorkspace
from app.services import images
from app.services import serializers as ser
from app.services.activity import record_activity
from app.services.project_defaults import default_config
from app.services.storage import get_storage

from .common import PFRoute, get_project, safe_filename, save_upload_to_temp

router = APIRouter(tags=["projects"], route_class=PFRoute)

IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/tiff": ".tif"}


def _check_refs(db, ctx, reference_id: str | None, profile_id: str | None) -> None:
    if reference_id:
        r = db.get(ReferenceMagazine, reference_id)
        if r is None or r.org_id != ctx.org_id:
            raise HTTPException(status_code=422, detail="referenceId does not exist in this organisation")
    if profile_id:
        d = db.get(DesignProfile, profile_id)
        if d is None or d.org_id != ctx.org_id:
            raise HTTPException(status_code=422, detail="designProfileId does not exist in this organisation")


@router.get("/projects", response_model=list[ProjectSchema])
def list_projects(ctx: CurrentAuth, db: DB) -> list[ProjectSchema]:
    rows = db.scalars(select(Project).where(Project.org_id == ctx.org_id).order_by(Project.updated_at.desc())).all()
    return [ser.project(p) for p in rows]


@router.post("/projects", response_model=ProjectSchema, status_code=201)
def create_project(body: ProjectCreate, db: DB, ctx=require("project.create")) -> ProjectSchema:
    _check_refs(db, ctx, body.reference_id, body.design_profile_id)
    cfg = body.config or default_config(body.target_page_count)
    target = body.target_page_count or cfg.target_page_count
    cfg.target_page_count = target
    profile_id = body.design_profile_id
    if body.reference_id and not profile_id:
        profile_id = db.get(ReferenceMagazine, body.reference_id).design_profile_id
    p = Project(id=new_id("prj"), org_id=ctx.org_id, title=body.title.strip(), event_name=body.event_name,
                category=body.category, issue_number=body.issue_number, publication_date=body.publication_date,
                publisher=body.publisher, target_page_count=target, description=body.description, status="setup",
                reference_id=body.reference_id, design_profile_id=profile_id,
                config=cfg.model_dump(by_alias=True), owner_id=ctx.user_id)
    db.add(p)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="created project", target=p.title,
                    kind="project", project_id=p.id)
    db.commit()
    return ser.project(p)


@router.get("/projects/{project_id}", response_model=ProjectSchema)
def get_project_route(project_id: str, ctx: CurrentAuth, db: DB) -> ProjectSchema:
    return ser.project(get_project(db, ctx, project_id))


@router.patch("/projects/{project_id}", response_model=ProjectSchema)
def update_project(project_id: str, body: ProjectUpdate, db: DB, ctx=require("project.update")) -> ProjectSchema:
    p = get_project(db, ctx, project_id)
    data = body.model_dump(exclude_unset=True, by_alias=False)
    _check_refs(db, ctx, data.get("reference_id"), data.get("design_profile_id"))
    if "config" in data and body.config is not None:
        p.config = body.config.model_dump(by_alias=True)
        if "target_page_count" not in data:
            p.target_page_count = body.config.target_page_count
    for k, v in data.items():
        if k != "config":
            setattr(p, k, v)
    if "target_page_count" in data and data["target_page_count"]:
        p.config = {**(p.config or {}), "targetPageCount": data["target_page_count"]}
    if data.get("reference_id") and "design_profile_id" not in data:
        ref = db.get(ReferenceMagazine, data["reference_id"])
        p.design_profile_id = ref.design_profile_id or p.design_profile_id
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="updated project", target=p.title,
                    kind="project", project_id=p.id)
    db.commit()
    return ser.project(p)


@router.delete("/projects/{project_id}", response_model=OkResponse)
def delete_project(project_id: str, db: DB, ctx=require("project.delete")) -> OkResponse:
    p = get_project(db, ctx, project_id)
    vids = [v.id for v in db.scalars(select(VideoSource).where(VideoSource.project_id == p.id))]
    if vids:
        db.execute(delete(TranscriptSegment).where(TranscriptSegment.video_id.in_(vids)))
    for model in (ExtractedFact, EventSession, Speaker, Article, MagazinePage, Asset, VideoSource):
        db.execute(delete(model).where(model.project_id == p.id))
    db.execute(delete(Export).where(Export.project_id == p.id))
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="deleted project", target=p.title, kind="project")
    db.delete(p)
    db.commit()
    return OkResponse(message="Project deleted")


@router.get("/projects/{project_id}/workspace", response_model=ProjectWorkspace)
def workspace(project_id: str, ctx: CurrentAuth, db: DB) -> ProjectWorkspace:
    p = get_project(db, ctx, project_id)
    videos = list(db.scalars(select(VideoSource).where(VideoSource.project_id == p.id).order_by(VideoSource.created_at)))
    segs = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.project_id == p.id)
                           .order_by(TranscriptSegment.video_id, TranscriptSegment.idx)))
    return ProjectWorkspace(
        project=ser.project(p),
        videos=[ser.video(v) for v in videos],
        segments=[ser.segment(s) for s in segs],
        speakers=[ser.speaker(s) for s in db.scalars(select(Speaker).where(Speaker.project_id == p.id).order_by(Speaker.name))],
        sessions=[ser.session(s) for s in db.scalars(select(EventSession).where(EventSession.project_id == p.id)
                                                     .order_by(EventSession.start_sec))],
        facts=[ser.fact(f) for f in db.scalars(select(ExtractedFact).where(ExtractedFact.project_id == p.id)
                                               .order_by(ExtractedFact.video_id, ExtractedFact.timestamp))],
        articles=[ser.article(a) for a in db.scalars(select(Article).where(Article.project_id == p.id)
                                                     .order_by(Article.created_at))],
        assets=[ser.asset(a) for a in db.scalars(select(Asset).where(Asset.project_id == p.id).order_by(Asset.created_at))],
        pages=[ser.page(pg) for pg in db.scalars(select(MagazinePage).where(MagazinePage.project_id == p.id)
                                                .order_by(MagazinePage.position))],
        exports=[ser.export(e) for e in db.scalars(select(Export).where(Export.project_id == p.id)
                                                   .order_by(Export.created_at.desc()))],
    )


@router.get("/projects/{project_id}/activity", response_model=list[ActivityItem])
def project_activity(project_id: str, ctx: CurrentAuth, db: DB, limit: int = 50) -> list[ActivityItem]:
    p = get_project(db, ctx, project_id)
    rows = db.scalars(select(Activity).where(Activity.project_id == p.id).order_by(Activity.created_at.desc())
                      .limit(max(1, min(limit, 200))))
    return [ser.activity(a) for a in rows]


# ------------------------------------------------------------------ assets

@router.get("/projects/{project_id}/assets", response_model=list[AssetSchema])
def list_assets(project_id: str, ctx: CurrentAuth, db: DB) -> list[AssetSchema]:
    p = get_project(db, ctx, project_id)
    return [ser.asset(a) for a in db.scalars(select(Asset).where(Asset.project_id == p.id).order_by(Asset.created_at))]


@router.post("/projects/{project_id}/assets", response_model=AssetSchema, status_code=201)
async def upload_asset(project_id: str, ctx: CurrentAuth, db: DB, file: UploadFile = File(...),
                       kind: str = Form("photo"), caption: str | None = Form(None), credit: str | None = Form(None),
                       session_id: str | None = Form(None, alias="sessionId"),
                       speaker_id: str | None = Form(None, alias="speakerId")) -> AssetSchema:
    if not (ctx.can("content.write") or ctx.can("design.write")):
        ensure(ctx, "content.write")
    p = get_project(db, ctx, project_id)
    if kind not in ("photo", "portrait", "ad", "logo", "video_frame"):
        raise HTTPException(status_code=422, detail="kind must be photo|portrait|ad|logo|video_frame")
    s = get_settings()
    tmp, size, _ = await save_upload_to_temp(file, s.max_asset_upload_mb * 1024 * 1024)
    try:
        try:
            with Image.open(tmp) as im:
                im.verify()
            with Image.open(tmp) as im:
                w, h = im.size
                fmt = (im.format or "").upper()
        except (UnidentifiedImageError, OSError) as e:
            raise HTTPException(status_code=415, detail="Unsupported or corrupt image (JPEG, PNG, WebP, TIFF).") from e
        ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "TIFF": ".tif"}.get(fmt)
        if not ext:
            raise HTTPException(status_code=415, detail=f"Unsupported image format {fmt}.")
        aid = new_id("ast")
        key = f"assets/{ctx.org_id}/{p.id}/{aid}{ext}"
        ctype = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".tif": "image/tiff"}[ext]
        get_storage().put_file(key, tmp, ctype)
        seed = int(hashlib.sha256(aid.encode()).hexdigest()[:8], 16)
        a = Asset(id=aid, org_id=ctx.org_id, project_id=p.id, kind=kind, file_name=safe_filename(file.filename, f"image{ext}"),
                  content_type=ctype, size_bytes=size, width_px=w, height_px=h, session_id=session_id, speaker_id=speaker_id,
                  tags=[], caption=caption, credit=credit, seed=seed, storage_key=key, simulated=False)
        db.add(a)
        db.commit()
        return ser.asset(a)
    finally:
        Path(tmp).unlink(missing_ok=True)


@router.post("/projects/{project_id}/assets/generate", response_model=AssetSchema, status_code=201)
def generate_asset(project_id: str, body: GenerateImageRequest, ctx: CurrentAuth, db: DB) -> AssetSchema:
    """Generates an image with the configured AI image model and stores it as a photo asset labelled AI-generated."""
    if not (ctx.can("content.write") or ctx.can("design.write")):
        ensure(ctx, "content.write")
    p = get_project(db, ctx, project_id)
    try:
        png, w, h = images.generate(body.prompt, body.aspect)
    except images.ImageGenError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    s = get_settings()
    aid = new_id("ast")
    key = f"assets/{ctx.org_id}/{p.id}/{aid}.png"
    get_storage().put_bytes(key, png, "image/png")
    a = Asset(id=aid, org_id=ctx.org_id, project_id=p.id, kind="photo", file_name=f"ai-{aid[-8:]}.png",
              content_type="image/png", size_bytes=len(png), width_px=w, height_px=h, session_id=body.session_id,
              tags=[images.AI_TAG], caption=body.caption, credit=f"AI-generated image ({s.image_model})",
              seed=int(hashlib.sha256(aid.encode()).hexdigest()[:8], 16), storage_key=key, simulated=False)
    db.add(a)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="generated an AI image", target=p.title,
                    kind="project", project_id=p.id)
    db.commit()
    return ser.asset(a)


@router.patch("/assets/{asset_id}", response_model=AssetSchema)
def update_asset(asset_id: str, body: AssetUpdate, ctx: CurrentAuth, db: DB) -> AssetSchema:
    if not (ctx.can("content.write") or ctx.can("design.write")):
        ensure(ctx, "content.write")
    a = db.get(Asset, asset_id)
    if a is None or a.org_id != ctx.org_id:
        raise not_found("Asset")
    for k, v in body.model_dump(exclude_unset=True, by_alias=False).items():
        setattr(a, k, v)
    db.commit()
    return ser.asset(a)


@router.get("/assets/{asset_id}/file")
def asset_file(asset_id: str, ctx: CurrentAuth, db: DB):
    a = db.get(Asset, asset_id)
    if a is None or a.org_id != ctx.org_id or not a.storage_key:
        raise not_found("Asset file")
    storage = get_storage()
    url = storage.presigned_url(a.storage_key, a.file_name, a.content_type)
    if url:
        return RedirectResponse(url, status_code=307)
    if not storage.exists(a.storage_key):
        raise not_found("Asset file")
    return StreamingResponse(storage.iter_chunks(a.storage_key), media_type=a.content_type or "application/octet-stream",
                             headers={"Content-Length": str(storage.size(a.storage_key)),
                                      "Cache-Control": "private, max-age=3600"})

