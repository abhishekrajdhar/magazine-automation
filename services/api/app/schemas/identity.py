from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import ID, CamelModel, Email, ISODate, Role


class User(CamelModel):
    id: ID
    name: str
    email: str
    title: str | None = None
    initials: str


class Organisation(CamelModel):
    id: ID
    name: str
    slug: str
    plan: Literal["demo", "team", "enterprise"]


class Member(CamelModel):
    user_id: ID
    name: str
    email: str
    role: Role
    title: str | None = None
    initials: str
    last_active_at: ISODate | None = None
    # Additive (not in types.ts): "invited" until the person sets a password.
    status: Literal["active", "invited"] = "active"


class SignupRequest(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    email: Email
    password: str = Field(min_length=8, max_length=200)
    organisation_name: str = Field(min_length=1, max_length=200)
    title: str | None = None


class LoginRequest(CamelModel):
    email: Email
    password: str


class ForgotPasswordRequest(CamelModel):
    email: Email


class ResetPasswordRequest(CamelModel):
    token: str = Field(min_length=10)
    password: str = Field(min_length=8, max_length=200)


class SessionResponse(CamelModel):
    user: User
    organisation: Organisation
    role: Role
    # Also returned so non-browser clients can use `Authorization: Bearer`.
    token: str | None = None


class MeResponse(CamelModel):
    user: User
    organisation: Organisation
    role: Role


class InviteMemberRequest(CamelModel):
    email: Email
    name: str = Field(min_length=1, max_length=200)
    role: Role = "viewer"
    title: str | None = None


class UpdateMemberRequest(CamelModel):
    role: Role
