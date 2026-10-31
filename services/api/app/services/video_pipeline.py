"""Video pipeline job: acquire -> extract audio -> transcribe -> LLM analysis -> write rows.

Each step updates job progress + the video's processing state; a step is only marked
complete when it actually succeeded. Steps are idempotent so re-processing resumes
(e.g. a transcript that already exists is not re-transcribed).
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import delete, func, select

from app.config import get_settings
from app.db import session_factory
from app.ids import new_id, utcnow
from app.models import Project, TranscriptSegment, VideoSource
from app.services import google, youtube
from app.services.jobs.queue import JobContext, PermanentError, RetryableError, register
from app.services.llm import LLMError, LLMNotConfigured, get_llm
from app.services.media_tools import MediaToolError, extract_audio, probe_duration, which, yt_dlp_download_audio
from app.services.storage import get_storage, temp_dir
from app.services.transcription import (
    Segment,
    TranscriptionFailed,
    TranscriptionUnavailable,
    get_transcriber,
    parse_vtt_or_srt,
)

log = logging.getLogger("pressflow.pipeline")

UNAVAILABLE_YT = ("YouTube captions could not be obtained by permitted means ({reason}). Captions are only downloaded "
                  "through the YouTube Data API by the account that owns the video. Please provide the original "
                  "recording (upload it or add it from Google Drive) for Whisper transcription.")


def _update(video_id: str, **values) -> None:
    with session_factory()() as db:
        v = db.get(VideoSource, video_id)
        if v is None:
            return
        for k, val in values.items():
            setattr(v, k, val)
        v.processing_updated_at = utcnow()
        db.commit()


def _state(ctx: JobContext, video_id: str, state: str, pct: float, message: str, **extra) -> None:
    _update(video_id, processing_state=state, processing_progress=pct, processing_message=message, **extra)
    ctx.progress(pct, message)


def _write_segments(video_id: str, project_id: str, segs: list[Segment], method: str, language: str | None) -> int:
    with session_factory()() as db:
        db.execute(delete(TranscriptSegment).where(TranscriptSegment.video_id == video_id))
        now = utcnow()
        words = 0
        for i, s in enumerate(segs):
            db.add(TranscriptSegment(id=new_id("seg"), project_id=project_id, video_id=video_id, idx=i, start=s.start,
                                     end=s.end, speaker_label=s.speaker or "Speaker", text=s.text, created_at=now,
                                     updated_at=now))
            words += len(s.text.split())
        v = db.get(VideoSource, video_id)
        v.transcription_state = "complete"
        v.transcription_method = method
        v.transcription_language = language
        v.word_count = words
        v.analysis_complete = False
        db.commit()
        return words


def _on_final_failure(ctx: JobContext, message: str) -> None:
    vid = ctx.payload.get("videoId")
    if not vid:
        return
    with session_factory()() as db:
        v = db.get(VideoSource, vid)
        if v and v.processing_state not in ("unavailable", "needs_auth", "ready"):
            v.processing_state = "failed"
            v.processing_message = message[:1000]
            v.processing_updated_at = utcnow()
            if v.transcription_state in ("queued", "running"):
                v.transcription_state = "failed"
            db.commit()


@register("video_pipeline", on_final_failure=_on_final_failure)
def run_video_pipeline(ctx: JobContext) -> None:
    s = get_settings()
    storage = get_storage()
    video_id = ctx.payload["videoId"]
    with session_factory()() as db:
        v = db.get(VideoSource, video_id)
        if v is None:
            raise PermanentError("Video no longer exists")
        project = db.get(Project, v.project_id)
        org_id, project_id = v.org_id, v.project_id
        has_transcript = v.transcription_state == "complete" and (db.scalar(
            select(func.count()).select_from(TranscriptSegment).where(TranscriptSegment.video_id == video_id)) or 0) > 0
        source_type, ext_id, url, storage_key, added_by = v.source_type, v.external_id, v.url, v.storage_key, v.added_by
        title = v.title
        if project and project.status in ("setup",):
            project.status = "ingesting"
            db.commit()

    # ------------------------------------------------------------ 1. acquire
    if not has_transcript:
        _state(ctx, video_id, "acquiring", 3, "Acquiring media")
        if source_type in ("upload_video", "upload_audio"):
            if not storage_key or not storage.exists(storage_key):
                raise PermanentError("The uploaded file is missing from storage; upload it again.")
        elif source_type == "google_drive":
            storage_key = _acquire_drive(ctx, video_id, org_id, project_id, added_by, ext_id, storage_key)
        elif source_type == "youtube":
            got = _acquire_youtube_captions(ctx, video_id, org_id, project_id, added_by, ext_id)
            if got:
                has_transcript = True
            else:
                storage_key = _acquire_youtube_download(ctx, video_id, org_id, project_id, url)
        else:
            raise PermanentError(f"Unknown source type {source_type}")

    # ------------------------------------------------------------ 2-3. audio + transcription
    if not has_transcript:
        transcriber = get_transcriber()
        ok, detail = transcriber.configured()
        if not ok:
            msg = f"Transcription unavailable: {detail}"
            _update(video_id, processing_state="unavailable", processing_message=msg, transcription_state="unavailable")
            raise PermanentError(msg)
        _state(ctx, video_id, "extracting_audio", 15, "Extracting 16 kHz mono audio with ffmpeg")
        audio_key = f"audio/{org_id}/{project_id}/{video_id}.flac"
        with temp_dir() as tmp, storage.local_path(storage_key) as src:
            try:
                out = extract_audio(src, tmp / "audio.flac")
            except MediaToolError as e:
                raise PermanentError(f"Audio extraction failed: {e}") from e
            storage.put_file(audio_key, out, "audio/flac")
            dur = probe_duration(out)
        _update(video_id, audio_key=audio_key, **({"duration_sec": dur} if dur else {}))

        _state(ctx, video_id, "transcribing", 25, f"Transcribing with {transcriber.name}", transcription_state="running")
        with temp_dir() as tmp, storage.local_path(audio_key) as audio:
            try:
                result = transcriber.transcribe(
                    Path(audio), tmp, lambda pct, msg: _state(ctx, video_id, "transcribing", 25 + 0.45 * pct, msg))
            except TranscriptionUnavailable as e:
                _update(video_id, processing_state="unavailable", processing_message=str(e),
                        transcription_state="unavailable")
                raise PermanentError(str(e)) from e
            except TranscriptionFailed as e:
                if e.retryable:
                    raise RetryableError(str(e)) from e
                _update(video_id, transcription_state="failed")
                raise PermanentError(str(e)) from e
        if not result.segments:
            _update(video_id, transcription_state="failed")
            raise PermanentError("Transcription returned no speech segments.")
        words = _write_segments(video_id, project_id, result.segments, result.method, result.language)
        _state(ctx, video_id, "transcribing", 70, f"Transcript complete ({words} words)")

    # ------------------------------------------------------------ 4. analysis
    llm = get_llm()
    ok, detail = llm.configured()
    if not ok:
        msg = f"Transcript is ready, but AI analysis is unavailable: {detail}"
        _update(video_id, processing_state="unavailable", processing_message=msg, processing_progress=70)
        raise PermanentError(msg)
    _state(ctx, video_id, "analysing", 72, "Identifying speakers, sessions and quotes")
    from app.services.video_analysis import analyse_video

    with session_factory()() as db:
        v = db.get(VideoSource, video_id)
        try:
            counts = analyse_video(db, llm, v, s.llm_analysis_window_chars,
                                   lambda pct, msg: _state(ctx, video_id, "analysing", 72 + 0.23 * pct, msg))
        except LLMNotConfigured as e:
            raise PermanentError(str(e)) from e
        except LLMError as e:
            db.rollback()
            if e.retryable:
                raise RetryableError(str(e)) from e
            raise PermanentError(f"AI analysis failed: {e}") from e
        v.analysis_complete = True
        v.processing_state = "ready"
        v.processing_progress = 100
        v.processing_message = (f"Ready: {counts.speakers} new speakers, {counts.sessions} sessions, {counts.facts} facts "
                                f"({counts.verbatim_quotes} verbatim quotes; {counts.dropped} ungrounded items dropped)")
        v.processing_updated_at = utcnow()
        project = db.get(Project, v.project_id)
        if project and project.status in ("setup", "ingesting"):
            project.status = "analysing"
        db.commit()
        ctx.progress(100, v.processing_message)
        ctx.set_result(video_id)


def _acquire_drive(ctx, video_id, org_id, project_id, user_id, file_id, storage_key) -> str:
    storage = get_storage()
    if storage_key and storage.exists(storage_key):
        return storage_key
    with session_factory()() as db:
        try:
            token = google.access_token(db, org_id, user_id, scope="drive")
        except google.GoogleNotConnected as e:
            _update(video_id, processing_state="needs_auth", processing_message=f"Connect Google Drive to continue: {e}")
            raise PermanentError(str(e)) from e
        except google.GoogleError as e:
            raise (RetryableError if e.retryable else PermanentError)(str(e)) from e
    try:
        meta = google.drive_file_meta(token, file_id)
    except google.GoogleError as e:
        raise (RetryableError if e.retryable else PermanentError)(str(e)) from e
    mime = meta.get("mimeType", "")
    if not mime.startswith(("video/", "audio/")):
        raise PermanentError(f"The Drive file is not audio/video (type {mime}).")
    name = meta.get("name") or f"{file_id}.bin"
    ext = Path(name).suffix or ".bin"
    key = f"videos/{org_id}/{project_id}/{video_id}{ext}"
    size_total = int(meta.get("size") or 0)
    with temp_dir() as tmp:
        dst = tmp / f"source{ext}"
        written = 0
        try:
            with open(dst, "wb") as f:
                for chunk in google.drive_download_stream(token, file_id):
                    f.write(chunk)
                    written += len(chunk)
                    if size_total and written % (16 * 1024 * 1024) < len(chunk):
                        _state(ctx, video_id, "acquiring", 3 + 10 * written / size_total,
                               f"Downloading from Drive ({written // (1024 * 1024)} MB)")
        except google.GoogleError as e:
            raise (RetryableError if e.retryable else PermanentError)(str(e)) from e
        storage.put_file(key, dst, mime)
        dur = None
        try:
            dur = probe_duration(dst)
        except MediaToolError:
            pass
    _update(video_id, storage_key=key, file_name=name, file_size_bytes=written, mime_type=mime,
            **({"duration_sec": dur} if dur else {}))
    return key


def _acquire_youtube_captions(ctx, video_id, org_id, project_id, user_id, yt_id) -> bool:
    """Captions via Data API captions.download (OAuth, video owner). Returns True when a transcript was written."""
    reason = None
    with session_factory()() as db:
        try:
            token = google.access_token(db, org_id, user_id, scope="youtube.force-ssl")
        except google.GoogleNotConnected as e:
            token, reason = None, str(e)
        except google.GoogleError as e:
            token, reason = None, str(e)
    if token:
        try:
            vtt, lang = youtube.download_captions_oauth(yt_id, token)
            segs = parse_vtt_or_srt(vtt)
            if segs:
                _write_segments(video_id, project_id, segs, "youtube_captions", lang)
                _state(ctx, video_id, "transcribing", 70, f"Captions downloaded ({len(segs)} segments)",
                       captions_status="available")
                return True
            reason = "the caption track was empty"
        except youtube.CaptionsUnavailable as e:
            reason = str(e)
    _update(video_id, transcription_state="unavailable" if not get_settings().youtube_allow_download else "none")
    ctx.payload["_captions_reason"] = reason or "captions unavailable"
    return False


def _acquire_youtube_download(ctx, video_id, org_id, project_id, url) -> str:
    s = get_settings()
    reason = ctx.payload.get("_captions_reason") or "captions unavailable"
    if not s.youtube_allow_download:
        msg = UNAVAILABLE_YT.format(reason=reason)
        _update(video_id, processing_state="unavailable", processing_message=msg, transcription_state="unavailable")
        raise PermanentError(msg)
    if not which(s.yt_dlp_path):
        msg = UNAVAILABLE_YT.format(reason=f"{reason}; YOUTUBE_ALLOW_DOWNLOAD is on but yt-dlp is not installed")
        _update(video_id, processing_state="unavailable", processing_message=msg, transcription_state="unavailable")
        raise PermanentError(msg)
    _state(ctx, video_id, "acquiring", 5, "Downloading audio with yt-dlp (organisation-owned media only)")
    storage = get_storage()
    with temp_dir() as tmp:
        try:
            src = yt_dlp_download_audio(url, tmp)
        except MediaToolError as e:
            raise RetryableError(str(e)) from e
        key = f"videos/{org_id}/{project_id}/{video_id}{src.suffix}"
        storage.put_file(key, src)
        size = src.stat().st_size
    _update(video_id, storage_key=key, file_size_bytes=size, transcription_state="none")
    return key
