"""Event media: URL resolve, add videos (YouTube/Drive), uploads, processing, transcripts, speakers/facts/sessions."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from app.config import get_settings
from app.deps import DB, CurrentAuth, require
from app.ids import new_id, utcnow
from app.models import Job, Speaker, TranscriptSegment, VideoSource
from app.schemas.pages import JobRef
from app.schemas.project import (
    AddVideoRequest,
    EventSession as SessionSchema,
    ExtractedFact as FactSchema,
    FactUpdate,
    ResolveRequest,
    ResolveResponse,
    SessionUpdate,
    Speaker as SpeakerSchema,
    SpeakerUpdate,
    TranscriptResponse,
    VideoSource as VideoSchema,
)
from app.services import google, serializers as ser, youtube
from app.services.activity import record_activity, record_approval
from app.services.jobs.queue import enqueue
from app.services.media_tools import MediaToolError, has_audio, probe
from app.services.storage import get_storage
from app.services.url_parsing import parse_media_url
from app.services.video_analysis import recompute_provenance

from .common import PFRoute, get_fact, get_project, get_session, get_speaker, get_video, safe_filename, save_upload_to_temp

router = APIRouter(tags=["media"], route_class=PFRoute)

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mpg", ".mpeg", ".mts", ".ts"}
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff", ".aif"}


@router.post("/media/resolve", response_model=ResolveResponse)
def resolve(body: ResolveRequest, ctx: CurrentAuth, db: DB) -> ResolveResponse:
    parsed = parse_media_url(body.url)
    if not parsed.valid:
        return ResolveResponse(valid=False, source_type=parsed.source_type, error=parsed.error, captions="unknown")
    if parsed.source_type == "youtube":
        meta = youtube.resolve(parsed.external_id)
        return ResolveResponse(valid=meta.exists, source_type="youtube", external_id=parsed.external_id,
                               title=meta.title, thumbnail_url=meta.thumbnail_url, duration_sec=meta.duration_sec,
                               captions=meta.captions, error=meta.error)
    # Google Drive
    resp = ResolveResponse(valid=True, source_type="google_drive", external_id=parsed.external_id, captions="unknown",
                           is_folder=parsed.is_folder)
    try:
        token = google.access_token(db, ctx.org_id, ctx.user_id, scope="drive")
    except google.GoogleNotConnected as e:
        resp.error = f"Link recognised. {e} Connect Google Drive to read file details."
        return resp
    except google.GoogleError as e:
        resp.error = str(e)
        return resp
    try:
        if parsed.is_folder:
            files = google.drive_list_media(token, parsed.external_id)
            resp.title = f"Drive folder ({len(files)} audio/video files)"
        else:
            meta = google.drive_file_meta(token, parsed.external_id)
            resp.title = meta.get("name")
            resp.thumbnail_url = meta.get("thumbnailLink")
            dur = (meta.get("videoMediaMetadata") or {}).get("durationMillis")
            resp.duration_sec = round(int(dur) / 1000, 1) if dur else None
            if not str(meta.get("mimeType", "")).startswith(("video/", "audio/")):
                resp.valid = False
                resp.error = f"This Drive file is not audio or video ({meta.get('mimeType')})."
    except google.GoogleError as e:
        resp.valid = False
        resp.error = str(e)
    return resp


def _new_video(ctx, project_id: str, source_type: str, **kw) -> VideoSource:
    now = utcnow()
    return VideoSource(id=new_id("vid"), org_id=ctx.org_id, project_id=project_id, source_type=source_type,
                       processing_state="pending", processing_progress=0, processing_updated_at=now,
                       transcription_state="none", added_by=ctx.user_id, simulated=False, **kw)


def _enqueue_processing(db, video: VideoSource) -> str:
    job = enqueue(db, "video_pipeline", {"videoId": video.id}, org_id=video.org_id, result_ref=video.id)
    video.processing_state = "queued"
    video.processing_message = "Queued for processing"
    video.processing_updated_at = utcnow()
    if video.transcription_state in ("none", "failed"):
        video.transcription_state = "queued"
    return job.id


@router.post("/projects/{project_id}/videos", response_model=list[VideoSchema], status_code=201)
def add_video(project_id: str, body: AddVideoRequest, db: DB, ctx=require("content.write")) -> list[VideoSchema]:
    p = get_project(db, ctx, project_id)
    parsed = parse_media_url(body.url)
    if not parsed.valid:
        raise HTTPException(status_code=422, detail=parsed.error or "Unsupported URL")
    created: list[VideoSource] = []
    if parsed.source_type == "youtube":
        meta = youtube.resolve(parsed.external_id)
        if not meta.exists:
            raise HTTPException(status_code=422, detail=meta.error or "Video not found")
        v = _new_video(ctx, p.id, "youtube", url=parsed.canonical_url, external_id=parsed.external_id,
                       title=body.title or meta.title or f"YouTube video {parsed.external_id}",
                       thumbnail_url=meta.thumbnail_url, duration_sec=meta.duration_sec, session_id=body.session_id,
                       captions_status=meta.captions)
        if meta.error:
            v.processing_message = meta.error
        created.append(v)
    elif parsed.is_folder:
        try:
            token = google.access_token(db, ctx.org_id, ctx.user_id, scope="drive")
            files = google.drive_list_media(token, parsed.external_id)
        except google.GoogleNotConnected as e:
            raise HTTPException(status_code=409, detail=f"{e} Connect Google Drive to import a folder.") from e
        except google.GoogleError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e
        if not files:
            raise HTTPException(status_code=422, detail="The Drive folder contains no audio or video files.")
        for f in files:
            dur = (f.get("videoMediaMetadata") or {}).get("durationMillis")
            created.append(_new_video(
                ctx, p.id, "google_drive", url=f"https://drive.google.com/file/d/{f['id']}/view", external_id=f["id"],
                title=f.get("name") or f["id"], file_name=f.get("name"), file_size_bytes=int(f.get("size") or 0) or None,
                mime_type=f.get("mimeType"), duration_sec=round(int(dur) / 1000, 1) if dur else None,
                session_id=body.session_id))
    else:
        title, size, mime, dur = body.title, None, None, None
        try:
            token = google.access_token(db, ctx.org_id, ctx.user_id, scope="drive")
            meta = google.drive_file_meta(token, parsed.external_id)
            title = title or meta.get("name")
            size = int(meta.get("size") or 0) or None
            mime = meta.get("mimeType")
            d = (meta.get("videoMediaMetadata") or {}).get("durationMillis")
            dur = round(int(d) / 1000, 1) if d else None
        except (google.GoogleNotConnected, google.GoogleError):
            pass  # metadata is fetched again when processing; processing reports needs_auth if still unconnected
        created.append(_new_video(ctx, p.id, "google_drive", url=parsed.canonical_url, external_id=parsed.external_id,
                                  title=title or "Google Drive recording", file_name=title, file_size_bytes=size,
                                  mime_type=mime, duration_sec=dur, session_id=body.session_id))
    for v in created:
        db.add(v)
    db.flush()
    if body.auto_process:
        for v in created:
            _enqueue_processing(db, v)
    if p.status == "setup":
        p.status = "ingesting"
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"added {len(created)} recording(s)",
                    target=created[0].title, kind="video", project_id=p.id)
    db.commit()
    return [ser.video(v) for v in created]


@router.post("/projects/{project_id}/videos/upload", response_model=VideoSchema, status_code=201)
async def upload_video(project_id: str, db: DB, ctx=require("content.write"), file: UploadFile = File(...),
                       title: str | None = Form(None), session_id: str | None = Form(None, alias="sessionId"),
                       auto_process: bool = Form(False, alias="autoProcess")) -> VideoSchema:
    p = get_project(db, ctx, project_id)
    s = get_settings()
    name = safe_filename(file.filename, "recording")
    ext = Path(name).suffix.lower()
    declared = (file.content_type or "").lower()
    guessed = mimetypes.guess_type(name)[0] or ""
    is_video = declared.startswith("video/") or ext in VIDEO_EXT
    is_audio = declared.startswith("audio/") or ext in AUDIO_EXT
    if not (is_video or is_audio) or (declared and not declared.startswith(("video/", "audio/", "application/octet-stream"))):
        raise HTTPException(status_code=415, detail=f"Unsupported file type ({declared or ext or 'unknown'}); upload video or audio.")
    tmp, size, _ = await save_upload_to_temp(file, s.max_video_upload_mb * 1024 * 1024, suffix=ext)
    try:
        try:
            info = probe(tmp)
        except MediaToolError as e:
            raise HTTPException(status_code=415, detail=f"Could not read this media file: {e}") from e
        if not has_audio(info):
            raise HTTPException(status_code=422, detail="This file has no audio track to transcribe.")
        has_video = any(st.get("codec_type") == "video" and st.get("disposition", {}).get("attached_pic") != 1
                        for st in info.get("streams", []))
        source_type = "upload_video" if has_video else "upload_audio"
        dur = (info.get("format") or {}).get("duration")
        vid = new_id("vid")
        key = f"videos/{ctx.org_id}/{p.id}/{vid}{ext or '.bin'}"
        get_storage().put_file(key, tmp, declared or guessed or None)
        v = _new_video(ctx, p.id, source_type, file_name=name, file_size_bytes=size, mime_type=declared or guessed,
                       title=title or Path(name).stem, duration_sec=round(float(dur), 2) if dur else None,
                       storage_key=key, session_id=session_id)
        v.id = vid
        db.add(v)
        db.flush()
        if auto_process:
            _enqueue_processing(db, v)
        if p.status == "setup":
            p.status = "ingesting"
        record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="uploaded a recording", target=v.title,
                        kind="video", project_id=p.id)
        db.commit()
        return ser.video(v)
    finally:
        Path(tmp).unlink(missing_ok=True)


@router.post("/videos/{video_id}/process", response_model=JobRef, status_code=202)
def process_video(video_id: str, db: DB, ctx=require("content.write")) -> JobRef:
    v = get_video(db, ctx, video_id)
    if v.processing_state in ("queued", "acquiring", "extracting_audio", "transcribing", "analysing"):
        raise HTTPException(status_code=409, detail="This recording is already being processed.")
    job_id = _enqueue_processing(db, v)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="started processing", target=v.title,
                    kind="video", project_id=v.project_id)
    db.commit()
    return JobRef(job_id=job_id, job=ser.job(db.get(Job, job_id)))


@router.get("/videos/{video_id}", response_model=VideoSchema)
def get_video_route(video_id: str, ctx: CurrentAuth, db: DB) -> VideoSchema:
    return ser.video(get_video(db, ctx, video_id))


@router.get("/videos/{video_id}/transcript", response_model=TranscriptResponse)
def transcript(video_id: str, ctx: CurrentAuth, db: DB) -> TranscriptResponse:
    v = get_video(db, ctx, video_id)
    segs = db.scalars(select(TranscriptSegment).where(TranscriptSegment.video_id == v.id).order_by(TranscriptSegment.idx))
    sv = ser.video(v)
    return TranscriptResponse(video_id=v.id, transcription=sv.transcription, segments=[ser.segment(s) for s in segs])


@router.patch("/speakers/{speaker_id}", response_model=SpeakerSchema)
def update_speaker(speaker_id: str, body: SpeakerUpdate, db: DB, ctx=require("content.write")) -> SpeakerSchema:
    sp = get_speaker(db, ctx, speaker_id)
    data = body.model_dump(exclude_unset=True, by_alias=False)
    for k, val in data.items():
        setattr(sp, k, val)
    # a human edit of identity fields without explicit verification marks the speaker as unverified-by-human
    if ({"name", "designation", "organisation"} & data.keys()) and "verification" not in data and sp.verification == "ai_suggested":
        sp.verification = "unverified"
    if "name" in data:
        for seg in db.scalars(select(TranscriptSegment).where(TranscriptSegment.speaker_id == sp.id)):
            seg.speaker_label = sp.name
    if data.get("verification") == "confirmed":
        record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="speaker", target_id=sp.id,
                        action="approved", project_id=sp.project_id)
    db.commit()
    return ser.speaker(sp)


@router.patch("/facts/{fact_id}", response_model=FactSchema)
def update_fact(fact_id: str, body: FactUpdate, db: DB, ctx=require("content.write")) -> FactSchema:
    f = get_fact(db, ctx, fact_id)
    data = body.model_dump(exclude_unset=True, by_alias=False)
    if "speaker_id" in data and data["speaker_id"]:
        sp = db.get(Speaker, data["speaker_id"])
        if sp is None or sp.project_id != f.project_id:
            raise HTTPException(status_code=422, detail="speakerId does not belong to this project")
    if "segment_id" in data and data["segment_id"]:
        seg = db.get(TranscriptSegment, data["segment_id"])
        if seg is None or seg.video_id != f.video_id:
            raise HTTPException(status_code=422, detail="segmentId does not belong to this fact's video")
        f.timestamp = seg.start
    for k, val in data.items():
        setattr(f, k, val)
    if "text" in data:
        recompute_provenance(db, f)
    if data.get("status") in ("approved", "rejected"):
        record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="fact", target_id=f.id,
                        action=data["status"], project_id=f.project_id)
    db.commit()
    return ser.fact(f)


@router.patch("/sessions/{session_id}", response_model=SessionSchema)
def update_session(session_id: str, body: SessionUpdate, db: DB, ctx=require("content.write")) -> SessionSchema:
    s = get_session(db, ctx, session_id)
    data = body.model_dump(exclude_unset=True, by_alias=False)
    if "speaker_ids" in data:
        valid = {sp.id for sp in db.scalars(select(Speaker).where(Speaker.project_id == s.project_id))}
        bad = [x for x in data["speaker_ids"] or [] if x not in valid]
        if bad:
            raise HTTPException(status_code=422, detail=f"Unknown speaker ids: {bad}")
    for k, val in data.items():
        setattr(s, k, val)
    if data.get("status") == "approved":
        record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="session", target_id=s.id,
                        action="approved", project_id=s.project_id)
    db.commit()
    return ser.session(s)

