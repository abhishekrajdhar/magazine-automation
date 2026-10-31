"""Authentication + RBAC dependencies.

Session = JWT in the httpOnly `pf_session` cookie, or `Authorization: Bearer <jwt>`.
Every org-scoped query uses `ctx.org_id`; objects outside the caller's organisation
are reported as 404 (not 403) so IDs from other tenants are not disclosed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.ids import utcnow
from app.models import Membership, Organisation, User
from app.security import decode_token

ROLE_RANK = {"viewer": 0, "designer": 1, "editor": 1, "admin": 2, "owner": 3}

# permission -> roles allowed
PERMISSIONS: dict[str, set[str]] = {
    "read": {"owner", "admin", "editor", "designer", "viewer"},
    "project.create": {"owner", "admin", "editor", "designer"},
    "project.update": {"owner", "admin", "editor", "designer"},
    "project.delete": {"owner", "admin"},
    "content.write": {"owner", "admin", "editor"},  # media, transcripts, speakers, facts, sessions, articles
    "article.approve": {"owner", "admin", "editor"},
    "design.write": {"owner", "admin", "designer"},  # pages, templates, references, design profiles
    "profile.approve": {"owner", "admin", "designer"},
    "export.create": {"owner", "admin", "editor", "designer"},
    "members.manage": {"owner", "admin"},
    "integrations.manage": {"owner", "admin"},
}


@dataclass
class AuthContext:
    user: User
    org: Organisation
    membership: Membership

    @property
    def role(self) -> str:
        return self.membership.role

    @property
    def org_id(self) -> str:
        return self.org.id

    @property
    def user_id(self) -> str:
        return self.user.id

    def can(self, permission: str) -> bool:
        return self.role in PERMISSIONS.get(permission, set())


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get(get_settings().session_cookie_name)


def get_auth_context(request: Request, db: Annotated[Session, Depends(get_db)]) -> AuthContext:
    token = _extract_token(request)
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in", headers={"WWW-Authenticate": "Bearer"}
    )
    if not token:
        raise unauthorized
    payload = decode_token(token)
    if not payload:
        raise unauthorized
    user = db.get(User, payload.get("sub"))
    if user is None or user.token_version != payload.get("tv"):
        raise unauthorized
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id, Membership.org_id == payload.get("org"))
    )
    if membership is None or membership.status != "active":
        raise unauthorized
    org = db.get(Organisation, membership.org_id)
    if org is None:
        raise unauthorized
    now = utcnow()
    last = membership.last_active_at
    if last is None or (now - (last if last.tzinfo else last.replace(tzinfo=now.tzinfo))).total_seconds() > 300:
        membership.last_active_at = now
        db.commit()
    return AuthContext(user=user, org=org, membership=membership)


CurrentAuth = Annotated[AuthContext, Depends(get_auth_context)]
DB = Annotated[Session, Depends(get_db)]


def require(permission: str):
    def _dep(ctx: CurrentAuth) -> AuthContext:
        if not ctx.can(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role ({ctx.role}) does not allow this action ({permission}).",
            )
        return ctx

    return Depends(_dep)


def ensure(ctx: AuthContext, permission: str) -> None:
    if not ctx.can(permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your role ({ctx.role}) does not allow this action ({permission}).",
        )


def not_found(what: str = "Resource") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found")
