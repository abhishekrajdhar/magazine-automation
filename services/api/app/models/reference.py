"""Reference magazines, analysed pages, design profiles, templates."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONType, TimestampMixin, id_column


class ReferenceMagazine(TimestampMixin, Base):
    __tablename__ = "reference_magazines"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    file_name: Mapped[str] = mapped_column(String(400))
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="uploaded")
    analysis_progress: Mapped[float] = mapped_column(Float, default=0.0)
    analysis_message: Mapped[str | None] = mapped_column(Text)
    analyser: Mapped[str] = mapped_column(String(30), default="pymupdf")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    design_profile_id: Mapped[str | None] = mapped_column(String(64))
    storage_key: Mapped[str | None] = mapped_column(String(600))
    indd_key: Mapped[str | None] = mapped_column(String(600))
    indd_file_name: Mapped[str | None] = mapped_column(String(400))
    uploaded_by: Mapped[str | None] = mapped_column(String(64))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class ReferencePage(TimestampMixin, Base):
    __tablename__ = "reference_pages"
    __table_args__ = (UniqueConstraint("reference_id", "page_number", name="uq_reference_page"),)

    id: Mapped[str] = id_column()
    reference_id: Mapped[str] = mapped_column(ForeignKey("reference_magazines.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer)
    layout_type: Mapped[str] = mapped_column(String(40))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    width_pt: Mapped[float] = mapped_column(Float)
    height_pt: Mapped[float] = mapped_column(Float)
    blocks: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    corrected: Mapped[bool] = mapped_column(Boolean, default=False)
    features: Mapped[dict[str, Any] | None] = mapped_column(JSONType)  # raw analyser signals (debug/explain)


class DesignProfile(TimestampMixin, Base):
    __tablename__ = "design_profiles"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    reference_id: Mapped[str] = mapped_column(ForeignKey("reference_magazines.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)
    profile: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    overrides: Mapped[list[str]] = mapped_column(JSONType, default=list)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[str | None] = mapped_column(String(64))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Template(TimestampMixin, Base):
    """Reference-derived templates (built-in templates live in code)."""

    __tablename__ = "templates"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    reference_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(300))
    page_type: Mapped[str] = mapped_column(String(40))
    source: Mapped[str] = mapped_column(String(20), default="reference")
    reference_page_number: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    slots: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    columns: Mapped[int] = mapped_column(Integer, default=1)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
