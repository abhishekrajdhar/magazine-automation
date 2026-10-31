"""Auth: signup, login, logout, me, forgot/reset password. Session = JWT in httpOnly cookie `pf_session`."""

from __future__ import annotations

import logging
import re
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.config import get_settings
from app.deps import DB, CurrentAuth
from app.ids import as_utc, new_id, utcnow
from app.models import Membership, Organisation, PasswordResetToken, User
from app.schemas.base import OkResponse
from app.schemas.identity import (
    ForgotPasswordRequest,
    LoginRequest,
    MeResponse,
    ResetPasswordRequest,
    SessionResponse,
    SignupRequest,
)
from app.security import create_session_token, dummy_verify, hash_password, hash_reset_token, new_reset_token, verify_password
from app.services import serializers as ser
from app.services.activity import record_activity

from .common import PFRoute

router = APIRouter(prefix="/auth", tags=["auth"], route_class=PFRoute)
log = logging.getLogger("pressflow.auth")


def _set_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(s.session_cookie_name, token, max_age=s.session_ttl_hours * 3600, httponly=True,
                        secure=s.cookie_secure, samesite="lax", path="/")


def _slug(db, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "org"
    slug, i = base, 2
    while db.scalar(select(Organisation).where(Organisation.slug == slug)) is not None:
        slug, i = f"{base}-{i}", i + 1
    return slug


@router.post("/signup", response_model=SessionResponse, status_code=201)
def signup(body: SignupRequest, response: Response, db: DB) -> SessionResponse:
    email = body.email.lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None and existing.password_hash:
        raise HTTPException(status_code=409, detail="An account with this e-mail already exists. Sign in instead.")
    if existing is not None:  # invited user completing signup: becomes owner of a new org
        user = existing
        user.name = body.name
        user.password_hash = hash_password(body.password)
    else:
        user = User(id=new_id("usr"), name=body.name.strip(), email=email, title=body.title,
                    password_hash=hash_password(body.password))
        db.add(user)
    org = Organisation(id=new_id("org"), name=body.organisation_name.strip(), slug=_slug(db, body.organisation_name),
                       plan="team")
    db.add(org)
    db.flush()
    ms = Membership(id=new_id("mem"), org_id=org.id, user_id=user.id, role="owner", status="active",
                    last_active_at=utcnow())
    db.add(ms)
    user.last_login_at = utcnow()
    record_activity(db, org_id=org.id, actor_id=user.id, verb="created the organisation", target=org.name, kind="project")
    db.commit()
    token = create_session_token(user.id, org.id, user.token_version)
    _set_cookie(response, token)
    return SessionResponse(user=ser.user(user), organisation=ser.organisation(org), role="owner", token=token)


@router.post("/login", response_model=SessionResponse)
def login(body: LoginRequest, response: Response, db: DB) -> SessionResponse:
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None:
        dummy_verify(body.password)
        raise HTTPException(status_code=401, detail="Incorrect e-mail or password.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect e-mail or password.")
    memberships = list(db.scalars(select(Membership).where(Membership.user_id == user.id)).all())
    active = [m for m in memberships if m.status == "active"]
    invited = [m for m in memberships if m.status == "invited"]
    for m in invited:  # signing in with a password accepts pending invitations
        m.status = "active"
        active.append(m)
    if not active:
        raise HTTPException(status_code=403, detail="This account is not a member of any organisation.")
    rank = {"owner": 0, "admin": 1, "editor": 2, "designer": 3, "viewer": 4}
    ms = sorted(active, key=lambda m: (rank.get(m.role, 9), m.created_at))[0]
    org = db.get(Organisation, ms.org_id)
    user.last_login_at = utcnow()
    ms.last_active_at = utcnow()
    db.commit()
    token = create_session_token(user.id, org.id, user.token_version)
    _set_cookie(response, token)
    return SessionResponse(user=ser.user(user), organisation=ser.organisation(org), role=ms.role, token=token)


@router.post("/logout", response_model=OkResponse)
def logout(response: Response) -> OkResponse:
    s = get_settings()
    response.delete_cookie(s.session_cookie_name, path="/", httponly=True, secure=s.cookie_secure, samesite="lax")
    return OkResponse(message="Signed out")


@router.get("/me", response_model=MeResponse)
def me(ctx: CurrentAuth) -> MeResponse:
    return MeResponse(user=ser.user(ctx.user), organisation=ser.organisation(ctx.org), role=ctx.role)


@router.post("/forgot-password", response_model=OkResponse, status_code=202)
def forgot_password(body: ForgotPasswordRequest, db: DB) -> OkResponse:
    s = get_settings()
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is not None:
        raw, hashed = new_reset_token()
        db.add(PasswordResetToken(id=new_id("prt"), user_id=user.id, token_hash=hashed,
                                  expires_at=utcnow() + timedelta(minutes=s.password_reset_ttl_minutes)))
        db.commit()
        link = f"{s.frontend_url.rstrip('/')}/reset-password?token={raw}"
        if s.email_backend == "log" and s.env != "production":
            # E-mail delivery is an integration boundary; in development the link is logged, never returned.
            log.warning("Password reset link for %s (dev log only): %s", user.email, link)
        else:
            log.info("Password reset requested for user %s; e-mail delivery not configured.", user.id)
    return OkResponse(message="If an account exists for that e-mail, a reset link has been sent.")


@router.post("/reset-password", response_model=OkResponse)
def reset_password(body: ResetPasswordRequest, db: DB) -> OkResponse:
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_reset_token(body.token)))
    if row is None or row.used_at is not None or as_utc(row.expires_at) < utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired.")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="This reset link is invalid or has expired.")
    user.password_hash = hash_password(body.password)
    user.token_version += 1  # signs out existing sessions
    row.used_at = utcnow()
    for m in db.scalars(select(Membership).where(Membership.user_id == user.id, Membership.status == "invited")):
        m.status = "active"
    db.commit()
    return OkResponse(message="Password updated. Sign in with your new password.")
