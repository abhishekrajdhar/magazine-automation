"""Users, organisations, memberships, auth tokens, OAuth tokens."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, id_column


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str | None] = mapped_column(String(200))  # null for invited users
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Organisation(TimestampMixin, Base):
    __tablename__ = "organisations"

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(20), default="team")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Membership(TimestampMixin, Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_membership_org_user"),)

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # owner|admin|editor|designer|viewer
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|invited
    invited_by: Mapped[str | None] = mapped_column(String(64))
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasswordResetToken(TimestampMixin, Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = id_column()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OAuthToken(TimestampMixin, Base):
    """OAuth credentials, Fernet-encrypted at rest."""

    __tablename__ = "oauth_tokens"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "provider", name="uq_oauth_org_user_provider"),)

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40))  # google
    account_email: Mapped[str | None] = mapped_column(String(320))
    scopes: Mapped[str] = mapped_column(Text, default="")
    access_token_enc: Mapped[str] = mapped_column(Text)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
