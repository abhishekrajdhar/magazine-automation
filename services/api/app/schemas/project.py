from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import ID, ArticleType, CamelModel, ISODate

ProjectStatus = Literal["setup", "ingesting", "analysing", "editorial", "design", "review", "exported"]
DesignMode = Literal["exact_reference", "adapted_reference", "house_style"]
ContentStyle = Literal["news", "feature", "analytical", "conversational"]
EditorialTone = Literal["authoritative", "neutral", "celebratory", "analytical"]
ImagePreference = Literal["speakers_first", "stage_wide", "balanced", "audience"]
Language = Literal["en", "hi", "en-hi"]


class GenerationConfig(CamelModel):
    design_mode: DesignMode = "adapted_reference"
    target_page_count: int = Field(default=24, ge=1, le=500)
    content_style: ContentStyle = "feature"
    language: Language = "en"
    editorial_tone: EditorialTone = "authoritative"
    image_preference: ImagePreference = "balanced"
    article_types: list[ArticleType] = Field(
        default_factory=lambda: ["event_report", "keynote", "interview", "panel", "speaker_profiles"]
    )
    include_toc: bool = True
    include_editorial: bool = True
    include_advertisements: bool = True
    include_interviews: bool = True
    include_event_reports: bool = True
    ad_page_count: int = Field(default=4, ge=0, le=100)


class Project(CamelModel):
    id: ID
    org_id: ID
    title: str
    event_name: str
    category: str
    issue_number: str
    publication_date: ISODate
    publisher: str
    target_page_count: int
    description: str
    status: ProjectStatus
    reference_id: ID | None = None
    design_profile_id: ID | None = None
    config: GenerationConfig
    owner_id: ID
    created_at: ISODate
    updated_at: ISODate
    is_demo: bool


class ProjectCreate(CamelModel):
    title: str = Field(min_length=1, max_length=300)
    event_name: str = ""
    category: str = ""
    issue_number: str = ""
    publication_date: str = ""
    publisher: str = ""
    target_page_count: int | None = Field(default=None, ge=1, le=500)
    description: str = ""
    reference_id: ID | None = None
    design_profile_id: ID | None = None
    config: GenerationConfig | None = None


class ProjectUpdate(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    event_name: str | None = None
    category: str | None = None
    issue_number: str | None = None
    publication_date: str | None = None
    publisher: str | None = None
    target_page_count: int | None = Field(default=None, ge=1, le=500)
    description: str | None = None
    status: ProjectStatus | None = None
    reference_id: ID | None = None
    design_profile_id: ID | None = None
    config: GenerationConfig | None = None


# --------------------------------------------------------------------- media

SourceType = Literal["youtube", "google_drive", "upload_video", "upload_audio"]
ProcessingState = Literal[
    "pending",
    "queued",
    "acquiring",
    "extracting_audio",
    "transcribing",
    "analysing",
    "ready",
    "failed",
    "needs_auth",
    "unavailable",
]
TranscriptionState = Literal["none", "captions_found", "queued", "running", "complete", "failed", "unavailable"]
TranscriptionMethod = Literal["youtube_captions", "whisper", "manual", "demo_seed"]


class Processing(CamelModel):
    state: ProcessingState
    progress: float
    message: str | None = None
    updated_at: ISODate


class Transcription(CamelModel):
    state: TranscriptionState
    method: TranscriptionMethod | None = None
    language: str | None = None
    word_count: int | None = None


class VideoSource(CamelModel):
    id: ID
    project_id: ID
    source_type: SourceType
    url: str | None = None
    external_id: str | None = None
    file_name: str | None = None
    file_size_bytes: int | None = None
    title: str
    duration_sec: float | None = None
    thumbnail_url: str | None = None
    session_id: ID | None = None
    processing: Processing
    transcription: Transcription
    simulated: bool
    added_at: ISODate


class TranscriptSegment(CamelModel):
    id: ID
    video_id: ID
    start: float
    end: float
    speaker_id: ID | None = None
    speaker_label: str
    text: str


SpeakerVerification = Literal["confirmed", "unverified", "ai_suggested"]


class Speaker(CamelModel):
    id: ID
    project_id: ID
    name: str
    designation: str | None = None
    organisation: str | None = None
    verification: SpeakerVerification
    video_ids: list[ID]
    bio: str | None = None
    portrait_asset_id: ID | None = None


class SpeakerUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    designation: str | None = None
    organisation: str | None = None
    verification: SpeakerVerification | None = None
    bio: str | None = None
    portrait_asset_id: ID | None = None


SessionKind = Literal["inaugural", "keynote", "panel", "fireside", "presentation", "awards", "valedictory"]
SESSION_KINDS: tuple[str, ...] = SessionKind.__args__  # type: ignore[attr-defined]


class EventSession(CamelModel):
    id: ID
    project_id: ID
    video_id: ID
    title: str
    kind: SessionKind
    speaker_ids: list[ID]
    summary: str
    topics: list[str]
    status: Literal["draft", "approved"]


class SessionUpdate(CamelModel):
    title: str | None = None
    kind: SessionKind | None = None
    speaker_ids: list[ID] | None = None
    summary: str | None = None
    topics: list[str] | None = None
    status: Literal["draft", "approved"] | None = None


FactKind = Literal["quote", "statistic", "announcement", "discussion_point", "qa"]
FACT_KINDS: tuple[str, ...] = FactKind.__args__  # type: ignore[attr-defined]


class ExtractedFact(CamelModel):
    id: ID
    project_id: ID
    video_id: ID
    segment_id: ID | None = None
    kind: FactKind
    text: str
    speaker_id: ID | None = None
    timestamp: float
    provenance: Literal["transcript_verbatim", "ai_interpretation"]
    status: Literal["pending", "approved", "rejected"]
    confidence: float


class FactUpdate(CamelModel):
    text: str | None = Field(default=None, min_length=1)
    kind: FactKind | None = None
    speaker_id: ID | None = None
    status: Literal["pending", "approved", "rejected"] | None = None
    segment_id: ID | None = None


class ResolveRequest(CamelModel):
    url: str


class ResolveResponse(CamelModel):
    valid: bool
    source_type: SourceType | None = None
    external_id: str | None = None
    title: str | None = None
    thumbnail_url: str | None = None
    duration_sec: float | None = None
    captions: Literal["available", "none", "unknown"] = "unknown"
    error: str | None = None
    # Additive: Drive folder links enumerate files when added to a project.
    is_folder: bool = False


class AddVideoRequest(CamelModel):
    url: str
    title: str | None = None
    session_id: ID | None = None
    auto_process: bool = False


class TranscriptResponse(CamelModel):
    video_id: ID
    transcription: Transcription
    segments: list[TranscriptSegment]
