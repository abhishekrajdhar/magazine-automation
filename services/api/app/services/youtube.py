"""YouTube metadata + captions through official endpoints only.

* oEmbed (no key): title + thumbnail.
* Data API v3 `videos.list` (YOUTUBE_API_KEY): duration + whether captions exist.
* Captions text: ONLY via Data API `captions.list` + `captions.download`, which require
  Google OAuth by an account that owns the video (scope youtube.force-ssl).
  Unofficial caption endpoints are never scraped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from app.config import get_settings

OEMBED = "https://www.youtube.com/oembed"
DATA_API = "https://www.googleapis.com/youtube/v3"


@dataclass
class YouTubeMeta:
    ok: bool
    exists: bool = True
    title: str | None = None
    thumbnail_url: str | None = None
    author: str | None = None
    duration_sec: float | None = None
    captions: str = "unknown"  # available | none | unknown
    error: str | None = None


def parse_iso8601_duration(s: str) -> float | None:
    m = re.match(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$", s or "")
    if not m:
        return None
    d, h, mi, sec = m.groups()
    return float(d or 0) * 86400 + float(h or 0) * 3600 + float(mi or 0) * 60 + float(sec or 0)


def fetch_oembed(video_id: str, client: httpx.Client | None = None) -> YouTubeMeta:
    s = get_settings()
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        c = client or httpx.Client(timeout=s.http_timeout_seconds, follow_redirects=True)
        try:
            r = c.get(OEMBED, params={"url": url, "format": "json"})
        finally:
            if client is None:
                c.close()
    except httpx.HTTPError:
        return YouTubeMeta(ok=False, error="Could not reach YouTube to fetch video metadata (network error).")
    if r.status_code == 200:
        try:
            j = r.json()
        except ValueError:
            return YouTubeMeta(ok=False, error="YouTube returned an unexpected oEmbed response.")
        return YouTubeMeta(ok=True, title=j.get("title"), thumbnail_url=j.get("thumbnail_url"), author=j.get("author_name"))
    if r.status_code in (400, 404):
        return YouTubeMeta(ok=False, exists=False, error="YouTube reports that this video does not exist.")
    if r.status_code in (401, 403):
        return YouTubeMeta(ok=False, error="This video is private or embedding is disabled; title and thumbnail are unavailable.")
    return YouTubeMeta(ok=False, error=f"YouTube oEmbed returned HTTP {r.status_code}.")


def fetch_data_api(video_id: str, meta: YouTubeMeta) -> YouTubeMeta:
    s = get_settings()
    if not s.youtube_api_key:
        return meta
    try:
        r = httpx.get(f"{DATA_API}/videos", params={"part": "contentDetails,snippet", "id": video_id, "key": s.youtube_api_key},
                      timeout=s.http_timeout_seconds)
    except httpx.HTTPError:
        meta.error = meta.error or "Could not reach the YouTube Data API."
        return meta
    if r.status_code != 200:
        meta.error = meta.error or f"YouTube Data API returned HTTP {r.status_code}."
        return meta
    items = r.json().get("items") or []
    if not items:
        meta.exists = False
        meta.error = "YouTube Data API: video not found or not public."
        return meta
    item = items[0]
    cd = item.get("contentDetails") or {}
    meta.duration_sec = parse_iso8601_duration(cd.get("duration", ""))
    cap = cd.get("caption")
    meta.captions = "available" if cap == "true" else "none" if cap == "false" else "unknown"
    sn = item.get("snippet") or {}
    meta.title = meta.title or sn.get("title")
    thumbs = sn.get("thumbnails") or {}
    best = thumbs.get("high") or thumbs.get("medium") or thumbs.get("default")
    if best and not meta.thumbnail_url:
        meta.thumbnail_url = best.get("url")
    return meta


def resolve(video_id: str) -> YouTubeMeta:
    meta = fetch_oembed(video_id)
    return fetch_data_api(video_id, meta)


# ---------------------------------------------------------------- captions via OAuth (owner account)

class CaptionsUnavailable(Exception):
    pass


def download_captions_oauth(video_id: str, access_token: str, preferred_lang: str = "en") -> tuple[str, str]:
    """Returns (caption_text_vtt, language). Raises CaptionsUnavailable when not permitted/available."""
    s = get_settings()
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        r = httpx.get(f"{DATA_API}/captions", params={"part": "snippet", "videoId": video_id}, headers=headers,
                      timeout=s.http_timeout_seconds)
    except httpx.HTTPError as e:
        raise CaptionsUnavailable(f"Could not reach the YouTube Data API: {e}") from e
    if r.status_code in (401, 403):
        raise CaptionsUnavailable("The connected Google account is not allowed to list captions for this video "
                                  "(captions can only be downloaded by the video owner).")
    if r.status_code != 200:
        raise CaptionsUnavailable(f"captions.list returned HTTP {r.status_code}")
    tracks = r.json().get("items") or []
    if not tracks:
        raise CaptionsUnavailable("The video has no caption tracks.")

    def rank(t: dict) -> tuple:
        sn = t.get("snippet", {})
        return (sn.get("language", "").startswith(preferred_lang), sn.get("trackKind") != "asr", sn.get("trackKind") == "standard")

    track = sorted(tracks, key=rank, reverse=True)[0]
    try:
        d = httpx.get(f"{DATA_API}/captions/{track['id']}", params={"tfmt": "vtt"}, headers=headers,
                      timeout=60.0)
    except httpx.HTTPError as e:
        raise CaptionsUnavailable(f"captions.download failed: {e}") from e
    if d.status_code in (401, 403):
        raise CaptionsUnavailable("captions.download was refused: the connected Google account does not own this video.")
    if d.status_code != 200:
        raise CaptionsUnavailable(f"captions.download returned HTTP {d.status_code}")
    return d.text, track.get("snippet", {}).get("language") or preferred_lang
