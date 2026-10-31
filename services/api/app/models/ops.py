"""Exports, jobs (DB-backed queue), InDesign bridges."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONType, TimestampMixin, id_column


class Export(TimestampMixin, Base):
    __tablename__ = "exports"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[str] = mapped_column(String(64), index=True)
    format: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    renderer: Mapped[str] = mapped_column(String(20), default="reportlab")
    file_name: Mapped[str] = mapped_column(String(400))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    content_type: Mapped[str | None] = mapped_column(String(120))
    storage_key: Mapped[str | None] = mapped_column(String(600))
    extra_files: Mapped[dict[str, Any] | None] = mapped_column(JSONType)  # e.g. {"pdf": key} from InDesign
    contract: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    options: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    message: Mapped[str | None] = mapped_column(Text)
    job_id: Mapped[str | None] = mapped_column(String(64))
    created_by: Mapped[str] = mapped_column(String(64))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[str] = id_column()
    org_id: Mapped[str | None] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    queue: Mapped[str] = mapped_column(String(20), default="default", index=True)  # default|indesign
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    result_ref: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)
    run_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String(120))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IndesignBridge(TimestampMixin, Base):
    __tablename__ = "indesign_bridges"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)  # bridgeId supplied by the client
    hostname: Mapped[str] = mapped_column(String(300), default="")
    mode: Mapped[str] = mapped_column(String(20), default="desktop")
    indesign_version: Mapped[str] = mapped_column(String(60), default="")
    platform: Mapped[str] = mapped_column(String(60), default="")
    fonts: Mapped[list[str]] = mapped_column(JSONType, default=list)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    jobs_completed: Mapped[int] = mapped_column(Integer, default=0)
