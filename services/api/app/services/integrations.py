"""Integration status: `configured` from settings, `available` from an actual check (never assumed)."""

from __future__ import annotations

import time
from datetime import timedelta

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ids import as_utc, iso, utcnow
from app.models import IndesignBridge, Job
from app.services import google
from app.services.llm import get_llm
from app.services.media_tools import tool_version, which
from app.services.storage import get_storage
from app.services.transcription import get_transcriber

_cache: dict[str, tuple[float, tuple[bool, str]]] = {}


def _cached(key: str, ttl: float, fn) -> tuple[bool, str]:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.monotonic(), val)
    return val


def _item(key, label, configured, available, detail, hint, action: str | None = None) -> dict:
    return {"key": key, "label": label, "configured": bool(configured), "available": bool(available and configured),
            "detail": detail, "docsHint": hint, "action": action}


def _net_disabled() -> tuple[bool, str]:
    return False, "Network checks disabled (INTEGRATION_NETWORK_CHECKS=false); availability not verified."


def status_list(db: Session, org_id: str) -> list[dict]:
    s = get_settings()
    out: list[dict] = []

    # database
    try:
        db.execute(text("SELECT 1"))
        dialect = db.get_bind().dialect.name
        out.append(_item("database", "Database", True, True, f"Connected ({dialect}).",
                         "DATABASE_URL — SQLite for local dev, PostgreSQL (Neon/Supabase) in production."))
    except Exception as e:  # noqa: BLE001
        out.append(_item("database", "Database", True, False, f"Query failed: {e}", "Check DATABASE_URL."))

    # storage
    ok, detail = get_storage().check()
    out.append(_item("storage", "File storage", True, ok, f"{s.storage_backend}: {detail}",
                     "STORAGE_BACKEND=local|s3 (S3_BUCKET, S3_ENDPOINT_URL, credentials for S3/MinIO)."))

    # llm
    llm = get_llm()
    configured, cdetail = llm.configured()
    if configured and s.integration_network_checks:
        avail, adetail = _cached(f"llm:{llm.name}:{llm.model}", 300, llm.check)
    elif configured:
        avail, adetail = _net_disabled()
    else:
        avail, adetail = False, cdetail
    out.append(_item("llm", f"AI writing ({llm.name})", configured, avail, adetail if configured else cdetail,
                     "OPENAI_API_KEY or ANTHROPIC_API_KEY (LLM_PROVIDER=auto prefers OpenAI when both are set)."))

    # ai images
    from app.services import images

    iconf, idetail = images.configured()
    out.append(_item("images", "AI images", iconf, iconf, idetail,
                     "OPENAI_API_KEY; IMAGE_MODEL (default gpt-image-2), IMAGE_QUALITY. IMAGE_PROVIDER=none turns it off."))

    # transcription
    tr = get_transcriber()
    tconf, tdetail = tr.configured()
    if tconf and tr.name == "openai_compatible":
        tavail, tdetail2 = _cached("transcription", 300, tr.check) if s.integration_network_checks else _net_disabled()
    else:
        tavail, tdetail2 = tconf, tdetail
    out.append(_item("transcription", f"Speech-to-text ({tr.name})", tconf, tavail, tdetail2 if tconf else tdetail,
                     "TRANSCRIPTION_PROVIDER=openai_compatible (Whisper API, chunked <25 MB) or local_whisper (extra)."))

    # youtube metadata (oEmbed, no key)
    if s.integration_network_checks:
        yavail, ydetail = _cached("oembed", 600, _check_oembed)
    else:
        yavail, ydetail = _net_disabled()
    out.append(_item("youtube_metadata", "YouTube metadata (oEmbed)", True, yavail, ydetail,
                     "No key needed. Fetches title + thumbnail server-side."))

    # youtube captions (Data API)
    cap_conf = bool(s.youtube_api_key) or s.google_configured
    tok = google.token_row(db, org_id, scope="youtube.force-ssl") if s.google_configured else None
    if tok:
        cdet = (f"Google account {tok.account_email or '(unknown)'} connected with youtube.force-ssl; captions can be "
                "downloaded for videos this account owns.")
    elif s.youtube_api_key:
        cdet = ("YOUTUBE_API_KEY set: duration and caption availability are read via videos.list. Caption text needs a "
                "connected Google account that owns the video.")
    else:
        cdet = "Not configured: set YOUTUBE_API_KEY and/or Google OAuth credentials."
    cap_avail = bool(tok)
    key_ok = True
    if s.youtube_api_key and not tok and s.integration_network_checks:
        key_ok, kdet = _cached("ytkey", 600, _check_youtube_key)
        cdet = f"{cdet} API key check: {kdet}"
    # Not connected yet is a step to take, not a failure, unless the key itself is rejected.
    cap_action = "connect_google" if s.google_configured and not tok and key_ok else None
    out.append(_item("youtube_captions", "YouTube captions (Data API)", cap_conf, cap_avail, cdet,
                     "Captions are only downloaded via captions.download by the owning account. Otherwise upload the "
                     "original recording for Whisper transcription.", cap_action))

    # google drive
    drive_tok = google.token_row(db, org_id, scope="drive") if s.google_configured else None
    if not s.google_configured:
        gdet = "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set."
    elif drive_tok:
        exp = as_utc(drive_tok.expires_at)
        gdet = (f"Connected as {drive_tok.account_email or 'unknown account'}; token "
                f"{'valid' if exp and exp > utcnow() else 'expired (will refresh)' if drive_tok.refresh_token_enc else 'expired — reconnect'}.")
    else:
        gdet = "OAuth client configured; no Google account connected for this organisation yet."
    out.append(_item("google_drive", "Google Drive", s.google_configured, bool(drive_tok), gdet,
                     "Create an OAuth web client; redirect URI /api/v1/integrations/google/callback.",
                     "connect_google" if s.google_configured and not drive_tok else None))

    # ffmpeg
    ff = which(s.ffmpeg_path)
    ffv = tool_version(ff) if ff else None
    out.append(_item("ffmpeg", "ffmpeg", True, bool(ffv), ffv or "ffmpeg not found on PATH.",
                     "Install ffmpeg (brew install ffmpeg / apt-get install ffmpeg)."))

    # yt-dlp
    yd = which(s.yt_dlp_path)
    out.append(_item("yt_dlp", "yt-dlp (organisation-owned media only)", s.youtube_allow_download, bool(yd),
                     ("Enabled; " if s.youtube_allow_download else "Disabled (YOUTUBE_ALLOW_DOWNLOAD=false); ") +
                     (f"found at {yd}." if yd else "yt-dlp not installed."),
                     "Only for recordings the organisation owns or has rights to. Off by default."))

    # indesign bridge
    st = indesign_status(db)
    out.append(_item("indesign_bridge", "Adobe InDesign bridge", st["configured"], st["status"] == "online",
                     st["detail"], "Set INDESIGN_BRIDGE_TOKEN and run the bridge from services/indesign."))
    return out


def _check_oembed() -> tuple[bool, str]:
    try:
        r = httpx.get("https://www.youtube.com/oembed", params={"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
                                                                "format": "json"}, timeout=5.0)
        return (r.status_code == 200, "oEmbed endpoint reachable." if r.status_code == 200 else f"oEmbed HTTP {r.status_code}")
    except httpx.HTTPError as e:
        return False, f"oEmbed unreachable: {e}"


def _check_youtube_key() -> tuple[bool, str]:
    s = get_settings()
    try:
        r = httpx.get("https://www.googleapis.com/youtube/v3/videos",
                      params={"part": "id", "id": "jNQXAC9IVRw", "key": s.youtube_api_key}, timeout=5.0)
        return (r.status_code == 200, "key accepted" if r.status_code == 200 else f"HTTP {r.status_code}")
    except httpx.HTTPError as e:
        return False, f"unreachable: {e}"


def indesign_status(db: Session) -> dict:
    s = get_settings()
    bridges = list(db.scalars(select(IndesignBridge)).all())
    cutoff = utcnow() - timedelta(seconds=s.indesign_bridge_online_seconds)
    online = [b for b in bridges if b.last_heartbeat_at and as_utc(b.last_heartbeat_at) >= cutoff]
    latest = max(bridges, key=lambda b: as_utc(b.last_heartbeat_at) or utcnow() - timedelta(days=3650), default=None)
    queued = db.scalar(select(func.count()).select_from(Job).where(Job.queue == "indesign", Job.status == "queued")) or 0
    running = db.scalar(select(func.count()).select_from(Job).where(Job.queue == "indesign", Job.status == "running")) or 0
    configured = bool(s.indesign_bridge_token)
    if not configured:
        status, detail = "not_configured", "INDESIGN_BRIDGE_TOKEN is not set; bridges cannot authenticate."
    elif online:
        b = max(online, key=lambda b: as_utc(b.last_heartbeat_at))
        status = "online"
        detail = (f"{len(online)} bridge(s) online; last heartbeat {iso(b.last_heartbeat_at)} from {b.hostname} "
                  f"(InDesign {b.indesign_version}, {len(b.fonts or [])} fonts).")
    elif latest:
        status, detail = "offline", f"No heartbeat in the last {s.indesign_bridge_online_seconds}s (last {iso(latest.last_heartbeat_at)})."
    else:
        status, detail = "offline", "No InDesign bridge has ever connected."
    ref = max(online, key=lambda b: as_utc(b.last_heartbeat_at)) if online else latest
    return {
        "status": status, "configured": configured,
        "bridges": [{"bridgeId": b.id, "hostname": b.hostname, "mode": b.mode, "indesignVersion": b.indesign_version,
                     "platform": b.platform, "fontCount": len(b.fonts or []), "lastHeartbeatAt": iso(b.last_heartbeat_at),
                     "online": b in online, "jobsCompleted": b.jobs_completed} for b in bridges],
        "lastHeartbeatAt": iso(ref.last_heartbeat_at) if ref else None,
        "indesignVersion": ref.indesign_version if ref else None,
        "fontCount": len(ref.fonts or []) if ref else 0,
        "queuedJobs": int(queued), "runningJobs": int(running), "detail": detail,
    }
