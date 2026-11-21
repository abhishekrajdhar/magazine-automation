"""Organisation + membership management."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.config import get_settings
from app.deps import DB, CurrentAuth, require
from app.ids import new_id, utcnow
from app.models import Activity, Membership, PasswordResetToken, User
from app.security import new_reset_token
from app.services import mailer
from app.schemas.identity import InviteMemberRequest, Member, Organisation, UpdateMemberRequest
from app.schemas.pages import ActivityItem
from app.services import serializers as ser
from app.services.activity import record_activity

from .common import PFRoute

router = APIRouter(prefix="/orgs", tags=["orgs"], route_class=PFRoute)


@router.get("/current", response_model=Organisation)
def current_org(ctx: CurrentAuth) -> Organisation:
    return ser.organisation(ctx.org)


@router.get("/current/members", response_model=list[Member])
def members(ctx: CurrentAuth, db: DB) -> list[Member]:
    rows = db.execute(select(User, Membership).join(Membership, Membership.user_id == User.id)
                      .where(Membership.org_id == ctx.org_id).order_by(User.name)).all()
    return [ser.member(u, m) for u, m in rows]


@router.post("/current/members", response_model=Member, status_code=201)
def invite_member(body: InviteMemberRequest, db: DB, ctx=require("members.manage")) -> Member:
    if body.role == "owner" and ctx.role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can invite another owner.")
    email = body.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(id=new_id("usr"), name=body.name, email=email, title=body.title, password_hash=None)
        db.add(user)
        db.flush()
    if db.scalar(select(Membership).where(Membership.org_id == ctx.org_id, Membership.user_id == user.id)):
        raise HTTPException(status_code=409, detail="This person is already a member.")
    ms = Membership(id=new_id("mem"), org_id=ctx.org_id, user_id=user.id, role=body.role, status="invited",
                    invited_by=ctx.user_id)
    db.add(ms)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"invited {email} as {body.role}",
                    target=user.name, kind="project")
    out = ser.member(user, ms)
    if not user.password_hash:
        # A new person chooses their own password through a one-time link. People who already have an account
        # get no link (it would let an administrator reset someone else's password): they just sign in.
        s = get_settings()
        raw, hashed = new_reset_token()
        db.add(PasswordResetToken(id=new_id("prt"), user_id=user.id, token_hash=hashed,
                                  expires_at=utcnow() + timedelta(hours=s.invite_ttl_hours)))
        out.invite_link = f"{s.frontend_url.rstrip('/')}/reset-password?token={raw}&invite=1"
        out.invite_emailed = mailer.send(
            email, f"{ctx.user.name} invited you to {ctx.org.name} on PressFlow",
            f"Hello,\n\n{ctx.user.name} added you to {ctx.org.name} on PressFlow as {body.role}.\n\nChoose a password "
            f"to get started. The link works once and expires in {s.invite_ttl_hours // 24} days.\n\n{out.invite_link}\n")
    db.commit()
    return out


@router.patch("/current/members/{user_id}", response_model=Member)
def update_member(user_id: str, body: UpdateMemberRequest, db: DB, ctx=require("members.manage")) -> Member:
    ms = db.scalar(select(Membership).where(Membership.org_id == ctx.org_id, Membership.user_id == user_id))
    if ms is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if (ms.role == "owner" or body.role == "owner") and ctx.role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can grant or change the owner role.")
    if ms.role == "owner" and body.role != "owner":
        owners = db.scalar(select(func.count()).select_from(Membership).where(Membership.org_id == ctx.org_id,
                                                                               Membership.role == "owner")) or 0
        if owners <= 1:
            raise HTTPException(status_code=409, detail="An organisation must keep at least one owner.")
    ms.role = body.role
    user = db.get(User, user_id)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"changed role to {body.role}",
                    target=user.name if user else user_id, kind="project")
    db.commit()
    return ser.member(user, ms)


@router.get("/current/activity", response_model=list[ActivityItem])
def org_activity(ctx: CurrentAuth, db: DB, limit: int = 50) -> list[ActivityItem]:
    rows = db.scalars(select(Activity).where(Activity.org_id == ctx.org_id).order_by(Activity.created_at.desc())
                      .limit(max(1, min(limit, 200)))).all()
    return [ser.activity(a) for a in rows]
