"""Projects, event media + intelligence, editorial, assets, pages, approvals, activity."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONType, TimestampMixin, id_column


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    event_name: Mapped[str] = mapped_column(String(300), default="")
    category: Mapped[str] = mapped_column(String(120), default="")
    issue_number: Mapped[str] = mapped_column(String(120), default="")
    publication_date: Mapped[str] = mapped_column(String(40), default="")
    publisher: Mapped[str] = mapped_column(String(200), default="")
    target_page_count: Mapped[int] = mapped_column(Integer, default=24)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="setup")
    reference_id: Mapped[str | None] = mapped_column(String(64))
    design_profile_id: Mapped[str | None] = mapped_column(String(64))
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    owner_id: Mapped[str] = mapped_column(String(64))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class VideoSource(TimestampMixin, Base):
    __tablename__ = "video_sources"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(20))
    url: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(String(200))
    file_name: Mapped[str | None] = mapped_column(String(400))
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str | None] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(400), default="")
    duration_sec: Mapped[float | None] = mapped_column(Float)
    thumbnail_url: Mapped[str | None] = mapped_column(Text)
    session_id: Mapped[str | None] = mapped_column(String(64))
    storage_key: Mapped[str | None] = mapped_column(String(600))
    audio_key: Mapped[str | None] = mapped_column(String(600))
    processing_state: Mapped[str] = mapped_column(String(30), default="pending")
    processing_progress: Mapped[float] = mapped_column(Float, default=0.0)
    processing_message: Mapped[str | None] = mapped_column(Text)
    processing_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    transcription_state: Mapped[str] = mapped_column(String(30), default="none")
    transcription_method: Mapped[str | None] = mapped_column(String(30))
    transcription_language: Mapped[str | None] = mapped_column(String(20))
    word_count: Mapped[int | None] = mapped_column(Integer)
    captions_status: Mapped[str] = mapped_column(String(20), default="unknown")
    analysis_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    added_by: Mapped[str | None] = mapped_column(String(64))
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = id_column()
    project_id: Mapped[str] = mapped_column(String(64), index=True)
    video_id: Mapped[str] = mapped_column(ForeignKey("video_sources.id", ondelete="CASCADE"), index=True)
    idx: Mapped[int] = mapped_column(Integer, default=0)
    start: Mapped[float] = mapped_column(Float)
    end: Mapped[float] = mapped_column(Float)
    speaker_id: Mapped[str | None] = mapped_column(String(64))
    speaker_label: Mapped[str] = mapped_column(String(120), default="Speaker")
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Speaker(TimestampMixin, Base):
    __tablename__ = "speakers"

    id: Mapped[str] = id_column()
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    designation: Mapped[str | None] = mapped_column(String(300))
    organisation: Mapped[str | None] = mapped_column(String(300))
    verification: Mapped[str] = mapped_column(String(20), default="ai_suggested")
    video_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    labels: Mapped[list[str]] = mapped_column(JSONType, default=list)  # transcript speaker labels mapped to this speaker
    bio: Mapped[str | None] = mapped_column(Text)
    portrait_asset_id: Mapped[str | None] = mapped_column(String(64))


class EventSession(TimestampMixin, Base):
    __tablename__ = "event_sessions"

    id: Mapped[str] = id_column()
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(400))
    kind: Mapped[str] = mapped_column(String(20), default="presentation")
    speaker_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    summary: Mapped[str] = mapped_column(Text, default="")
    topics: Mapped[list[str]] = mapped_column(JSONType, default=list)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    start_sec: Mapped[float | None] = mapped_column(Float)
    end_sec: Mapped[float | None] = mapped_column(Float)


class ExtractedFact(TimestampMixin, Base):
    __tablename__ = "extracted_facts"

    id: Mapped[str] = id_column()
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(64), index=True)
    segment_id: Mapped[str | None] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    speaker_id: Mapped[str | None] = mapped_column(String(64))
    timestamp: Mapped[float] = mapped_column(Float, default=0.0)
    provenance: Mapped[str] = mapped_column(String(30), default="ai_interpretation")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    confidence: Mapped[float] = mapped_column(Float, default=0.5)


class Article(TimestampMixin, Base):
    __tablename__ = "articles"

    id: Mapped[str] = id_column()
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(40))
    kicker: Mapped[str | None] = mapped_column(String(200))
    headline: Mapped[str] = mapped_column(Text, default="")
    subheadline: Mapped[str] = mapped_column(Text, default="")
    byline: Mapped[str | None] = mapped_column(String(300))
    intro: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    quote_fact_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    speaker_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    session_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    suggested_image_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    captions: Mapped[dict[str, str]] = mapped_column(JSONType, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    generated_by: Mapped[str] = mapped_column(String(20), default="human")
    approved_by: Mapped[str | None] = mapped_column(String(64))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)
    variants: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    last_verification: Mapped[dict[str, Any] | None] = mapped_column(JSONType)


class Asset(TimestampMixin, Base):
    __tablename__ = "assets"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="photo")
    file_name: Mapped[str] = mapped_column(String(400))
    content_type: Mapped[str | None] = mapped_column(String(120))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    width_px: Mapped[int] = mapped_column(Integer, default=0)
    height_px: Mapped[int] = mapped_column(Integer, default=0)
    session_id: Mapped[str | None] = mapped_column(String(64))
    video_id: Mapped[str | None] = mapped_column(String(64))
    speaker_id: Mapped[str | None] = mapped_column(String(64))
    tags: Mapped[list[str]] = mapped_column(JSONType, default=list)
    caption: Mapped[str | None] = mapped_column(Text)
    credit: Mapped[str | None] = mapped_column(String(300))
    seed: Mapped[int] = mapped_column(Integer, default=0)
    storage_key: Mapped[str | None] = mapped_column(String(600))
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)


class MagazinePage(TimestampMixin, Base):
    __tablename__ = "magazine_pages"

    id: Mapped[str] = id_column()
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, index=True)
    page_type: Mapped[str] = mapped_column(String(40))
    template_id: Mapped[str] = mapped_column(String(120))
    label: Mapped[str] = mapped_column(String(300), default="")
    article_id: Mapped[str | None] = mapped_column(String(64))
    article_part: Mapped[int | None] = mapped_column(Integer)
    elements: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    editorial_status: Mapped[str] = mapped_column(String(20), default="pending")
    design_status: Mapped[str] = mapped_column(String(20), default="not_started")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)


class Approval(TimestampMixin, Base):
    """Audit trail of who approved (or rejected) what, and when."""

    __tablename__ = "approvals"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[str | None] = mapped_column(String(64), index=True)
    target_kind: Mapped[str] = mapped_column(String(20))  # article|profile|page|fact|session
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(20))  # approved|rejected|revoked
    actor_id: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int | None] = mapped_column(Integer)


class Activity(TimestampMixin, Base):
    __tablename__ = "activity"

    id: Mapped[str] = id_column()
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[str | None] = mapped_column(String(64), index=True)
    actor_id: Mapped[str] = mapped_column(String(64))
    verb: Mapped[str] = mapped_column(String(200))
    target: Mapped[str] = mapped_column(String(400))
    kind: Mapped[str] = mapped_column(String(20))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
