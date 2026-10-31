"""Integration status, Google OAuth web flow, InDesign status for the frontend."""

from __future__ import annotations

import logging
import secrets
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete

from app.config import get_settings
from app.deps import DB, CurrentAuth, require
from app.models import OAuthToken
from app.schemas.base import OkResponse
from app.schemas.workspace import IndesignStatus, IntegrationStatus
from app.security import create_signed_state, decode_token
from app.services import google
from app.services.activity import record_activity
from app.services.integrations import indesign_status, status_list

from .common import PFRoute

router = APIRouter(prefix="/integrations", tags=["integrations"], route_class=PFRoute)
log = logging.getLogger("pressflow.integrations")


@router.get("/status", response_model=list[IntegrationStatus])
def integrations_status(ctx: CurrentAuth, db: DB) -> list[IntegrationStatus]:
    return [IntegrationStatus.model_validate(i) for i in status_list(db, ctx.org_id)]


@router.get("/indesign", response_model=IndesignStatus)
def indesign(ctx: CurrentAuth, db: DB) -> IndesignStatus:
    from app.api.v1.indesign_bridge import requeue_expired_bridge_jobs

    requeue_expired_bridge_jobs(db)
    return IndesignStatus.model_validate(indesign_status(db))


@router.get("/google/authorize")
def google_authorize(request: Request, ctx=require("integrations.manage"), redirect: bool = True):
    s = get_settings()
    if not s.google_configured:
        raise HTTPException(status_code=409, detail={
            "code": "google_not_configured",
            "message": "Google integration is not configured on the server.",
            "hint": "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (OAuth web client) and add "
                    f"{google.redirect_uri()} as an authorised redirect URI, then restart the API.",
        })
    state = create_signed_state({"uid": ctx.user_id, "org": ctx.org_id, "nonce": secrets.token_hex(8)})
    url = google.authorize_url(state)
    wants_json = "application/json" in request.headers.get("accept", "") or not redirect
    if wants_json:
        return JSONResponse({"authorizeUrl": url})
    return RedirectResponse(url, status_code=302)


@router.get("/google/callback")
def google_callback(db: DB, code: str | None = None, state: str | None = None, error: str | None = None):
    s = get_settings()
    back = f"{s.frontend_url.rstrip('/')}/app/settings?tab=integrations"
    if error:
        return RedirectResponse(f"{back}&google=error&reason={quote(error[:60])}", status_code=302)
    payload = decode_token(state or "", typ="oauth_state")
    if not payload or not code:
        return RedirectResponse(f"{back}&google=error&reason=invalid_state", status_code=302)
    try:
        tok = google.exchange_code(code)
    except google.GoogleError as e:
        log.warning("Google code exchange failed: %s", e)
        return RedirectResponse(f"{back}&google=error&reason=exchange_failed", status_code=302)
    email = google.fetch_email(tok["access_token"])
    google.store_tokens(db, payload["org"], payload["uid"], tok, email)
    record_activity(db, org_id=payload["org"], actor_id=payload["uid"], verb="connected Google",
                    target=email or "Google account", kind="project")
    db.commit()
    return RedirectResponse(f"{back}&google=connected", status_code=302)


@router.delete("/google", response_model=OkResponse)
def google_disconnect(db: DB, ctx=require("integrations.manage")) -> OkResponse:
    db.execute(delete(OAuthToken).where(OAuthToken.org_id == ctx.org_id, OAuthToken.provider == "google"))
    db.commit()
    return OkResponse(message="Google disconnected (tokens deleted). Revoke access in your Google account if needed.")
