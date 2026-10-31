"""Parse + validate YouTube and Google Drive URLs (pure functions, no network)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")
YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com",
            "www.youtube-nocookie.com"}
DRIVE_HOSTS = {"drive.google.com", "docs.google.com"}


@dataclass
class ParsedUrl:
    valid: bool
    source_type: str | None = None  # youtube | google_drive
    external_id: str | None = None
    is_folder: bool = False
    canonical_url: str | None = None
    error: str | None = None


def _normalise(url: str) -> str:
    url = (url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    return url


def parse_media_url(raw: str) -> ParsedUrl:
    url = _normalise(raw)
    if not url:
        return ParsedUrl(False, error="Enter a YouTube or Google Drive link.")
    try:
        u = urlparse(url)
    except ValueError:
        return ParsedUrl(False, error="That does not look like a valid URL.")
    if u.scheme not in ("http", "https"):
        return ParsedUrl(False, error="Only http(s) links are supported.")
    host = (u.hostname or "").lower()
    path = u.path or "/"
    qs = parse_qs(u.query)

    # ---------------- YouTube
    if host in YT_HOSTS or host == "youtu.be":
        vid: str | None = None
        if host == "youtu.be":
            vid = path.strip("/").split("/")[0] or None
        elif path in ("/watch", "/watch/"):
            vid = (qs.get("v") or [None])[0]
        else:
            m = re.match(r"^/(shorts|live|embed|v|e)/([^/?#]+)", path)
            if m:
                vid = m.group(2)
        if path.startswith("/playlist") and not vid:
            return ParsedUrl(False, source_type="youtube", error="Playlist links are not supported; paste a single video link.")
        if path.startswith(("/channel", "/c/", "/user", "/@")):
            return ParsedUrl(False, source_type="youtube", error="Channel links are not supported; paste a single video link.")
        if not vid or not YT_ID.match(vid):
            return ParsedUrl(False, source_type="youtube", error="Could not find a valid YouTube video ID in this link.")
        return ParsedUrl(True, "youtube", vid, canonical_url=f"https://www.youtube.com/watch?v={vid}")

    # ---------------- Google Drive
    if host in DRIVE_HOSTS:
        fid: str | None = None
        folder = False
        m = re.match(r"^/file/d/([^/?#]+)", path)
        if m:
            fid = m.group(1)
        m2 = re.match(r"^/drive/(?:u/\d+/)?folders/([^/?#]+)", path)
        if m2:
            fid, folder = m2.group(1), True
        if not fid and path.rstrip("/") in ("/open", "/uc", "/file/view"):
            fid = (qs.get("id") or [None])[0]
        if not fid and host == "docs.google.com":
            m3 = re.match(r"^/(?:a/[^/]+/)?(?:uc|open)", path)
            if m3:
                fid = (qs.get("id") or [None])[0]
        if not fid or not DRIVE_ID.match(fid):
            return ParsedUrl(False, source_type="google_drive", error="Could not find a Google Drive file or folder ID in this link.")
        canonical = (f"https://drive.google.com/drive/folders/{fid}" if folder
                     else f"https://drive.google.com/file/d/{fid}/view")
        return ParsedUrl(True, "google_drive", fid, is_folder=folder, canonical_url=canonical)

    return ParsedUrl(False, error="Only YouTube and Google Drive links are supported. Upload files directly instead.")
