"""Organisation + membership management."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.deps import DB, CurrentAuth, require
from app.ids import new_id
from app.models import Activity, Membership, User
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
    db.commit()
    return ser.member(user, ms)


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
