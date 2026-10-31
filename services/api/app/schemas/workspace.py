from __future__ import annotations

from typing import Literal

from app.schemas.base import CamelModel
from app.schemas.editorial import Article
from app.schemas.pages import Asset, ExportRecord, MagazinePage
from app.schemas.project import EventSession, ExtractedFact, Project, Speaker, TranscriptSegment, VideoSource


class ProjectWorkspace(CamelModel):
    project: Project
    videos: list[VideoSource]
    segments: list[TranscriptSegment]
    speakers: list[Speaker]
    sessions: list[EventSession]
    facts: list[ExtractedFact]
    articles: list[Article]
    assets: list[Asset]
    pages: list[MagazinePage]
    exports: list[ExportRecord]


class IntegrationStatus(CamelModel):
    key: str
    label: str
    configured: bool
    available: bool
    detail: str
    docs_hint: str


class IndesignStatus(CamelModel):
    status: Literal["online", "offline", "not_configured"]
    configured: bool
    bridges: list[dict]
    last_heartbeat_at: str | None = None
    indesign_version: str | None = None
    font_count: int = 0
    queued_jobs: int = 0
    running_jobs: int = 0
    detail: str
