"""Google OAuth 2.0 (web flow) + Drive helpers.

Tokens are Fernet-encrypted at rest (oauth_tokens). The same Google client requests
`drive.readonly` (download original recordings) and `youtube.force-ssl` (caption
download for videos the connected account owns).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ids import as_utc, new_id, utcnow
from app.models import OAuthToken
from app.security import decrypt_secret, encrypt_secret

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
DRIVE_API = "https://www.googleapis.com/drive/v3"
SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]
MEDIA_MIME_PREFIXES = ("video/", "audio/")


class GoogleNotConnected(Exception):
    pass


class GoogleError(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


def redirect_uri() -> str:
    s = get_settings()
    return s.google_redirect_uri or f"{s.api_base()}/api/v1/integrations/google/callback"


def authorize_url(state: str) -> str:
    s = get_settings()
    params = {
        "client_id": s.google_client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str) -> dict:
    s = get_settings()
    r = httpx.post(TOKEN_URL, data={"code": code, "client_id": s.google_client_id, "client_secret": s.google_client_secret,
                                     "redirect_uri": redirect_uri(), "grant_type": "authorization_code"},
                   timeout=s.http_timeout_seconds)
    if r.status_code != 200:
        raise GoogleError(f"Google token exchange failed (HTTP {r.status_code}): {r.text[:200]}")
    return r.json()


def fetch_email(access_token: str) -> str | None:
    try:
        r = httpx.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=8.0)
        return r.json().get("email") if r.status_code == 200 else None
    except httpx.HTTPError:
        return None


def store_tokens(db: Session, org_id: str, user_id: str, tok: dict, email: str | None) -> OAuthToken:
    row = db.scalar(select(OAuthToken).where(OAuthToken.org_id == org_id, OAuthToken.user_id == user_id,
                                             OAuthToken.provider == "google"))
    if row is None:
        row = OAuthToken(id=new_id("oat"), org_id=org_id, user_id=user_id, provider="google", access_token_enc="")
        db.add(row)
    row.access_token_enc = encrypt_secret(tok["access_token"])
    if tok.get("refresh_token"):  # Google only returns it on first consent
        row.refresh_token_enc = encrypt_secret(tok["refresh_token"])
    row.scopes = tok.get("scope", row.scopes or "")
    row.expires_at = utcnow() + timedelta(seconds=int(tok.get("expires_in", 3600)))
    row.account_email = email or row.account_email
    return row


def _refresh(db: Session, row: OAuthToken) -> str:
    s = get_settings()
    refresh = decrypt_secret(row.refresh_token_enc)
    if not refresh:
        raise GoogleNotConnected("Google access expired and no refresh token is stored; reconnect Google.")
    r = httpx.post(TOKEN_URL, data={"client_id": s.google_client_id, "client_secret": s.google_client_secret,
                                     "refresh_token": refresh, "grant_type": "refresh_token"},
                   timeout=s.http_timeout_seconds)
    if r.status_code in (400, 401):
        raise GoogleNotConnected("Google refresh token was revoked or expired; reconnect Google.")
    if r.status_code != 200:
        raise GoogleError(f"Google token refresh failed (HTTP {r.status_code})", retryable=True)
    tok = r.json()
    row.access_token_enc = encrypt_secret(tok["access_token"])
    row.expires_at = utcnow() + timedelta(seconds=int(tok.get("expires_in", 3600)))
    if tok.get("scope"):
        row.scopes = tok["scope"]
    db.commit()
    return tok["access_token"]


def token_row(db: Session, org_id: str, user_id: str | None = None, scope: str | None = None) -> OAuthToken | None:
    q = select(OAuthToken).where(OAuthToken.org_id == org_id, OAuthToken.provider == "google")
    rows = list(db.scalars(q).all())
    if scope:
        rows = [r for r in rows if scope in (r.scopes or "")]
    if user_id:
        mine = [r for r in rows if r.user_id == user_id]
        rows = mine or rows
    return rows[0] if rows else None


def access_token(db: Session, org_id: str, user_id: str | None = None, scope: str | None = None) -> str:
    if not get_settings().google_configured:
        raise GoogleNotConnected("Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).")
    row = token_row(db, org_id, user_id, scope)
    if row is None:
        raise GoogleNotConnected("No Google account is connected for this organisation" +
                                 (f" with scope {scope}" if scope else "") + ".")
    exp = as_utc(row.expires_at)
    if exp is None or exp - utcnow() < timedelta(seconds=60):
        return _refresh(db, row)
    tok = decrypt_secret(row.access_token_enc)
    if not tok:
        return _refresh(db, row)
    return tok


# ---------------------------------------------------------------- Drive

def drive_file_meta(token: str, file_id: str) -> dict:
    fields = "id,name,mimeType,size,videoMediaMetadata(durationMillis,width,height),thumbnailLink"
    try:
        r = httpx.get(f"{DRIVE_API}/files/{file_id}", params={"fields": fields, "supportsAllDrives": "true"},
                      headers={"Authorization": f"Bearer {token}"}, timeout=get_settings().http_timeout_seconds)
    except httpx.HTTPError as e:
        raise GoogleError(f"Could not reach Google Drive: {e}", retryable=True) from e
    if r.status_code == 404:
        raise GoogleError("Drive file not found, or the connected account has no access to it.")
    if r.status_code in (401, 403):
        raise GoogleError("The connected Google account cannot access this Drive file.")
    if r.status_code != 200:
        raise GoogleError(f"Drive API returned HTTP {r.status_code}", retryable=r.status_code >= 500)
    return r.json()


def drive_list_media(token: str, folder_id: str, limit: int = 200) -> list[dict]:
    out: list[dict] = []
    page_token = None
    q = f"'{folder_id}' in parents and trashed = false and (mimeType contains 'video/' or mimeType contains 'audio/')"
    while len(out) < limit:
        params = {"q": q, "fields": "nextPageToken, files(id,name,mimeType,size,videoMediaMetadata(durationMillis))",
                  "pageSize": 100, "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"}
        if page_token:
            params["pageToken"] = page_token
        try:
            r = httpx.get(f"{DRIVE_API}/files", params=params, headers={"Authorization": f"Bearer {token}"},
                          timeout=get_settings().http_timeout_seconds)
        except httpx.HTTPError as e:
            raise GoogleError(f"Could not reach Google Drive: {e}", retryable=True) from e
        if r.status_code != 200:
            raise GoogleError(f"Drive folder listing failed (HTTP {r.status_code}).")
        j = r.json()
        out += j.get("files", [])
        page_token = j.get("nextPageToken")
        if not page_token:
            break
    return out[:limit]


def drive_download_stream(token: str, file_id: str) -> Iterator[bytes]:
    with httpx.stream("GET", f"{DRIVE_API}/files/{file_id}", params={"alt": "media", "supportsAllDrives": "true"},
                      headers={"Authorization": f"Bearer {token}"}, timeout=httpx.Timeout(60.0, read=300.0),
                      follow_redirects=True) as r:
        if r.status_code in (401, 403, 404):
            raise GoogleError(f"Drive download refused (HTTP {r.status_code}).")
        if r.status_code != 200:
            raise GoogleError(f"Drive download failed (HTTP {r.status_code}).", retryable=r.status_code >= 500)
        yield from r.iter_bytes(1024 * 1024)
