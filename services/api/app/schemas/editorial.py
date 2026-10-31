from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import ID, ArticleType, CamelModel, ISODate
from app.schemas.project import EditorialTone

ArticleStatus = Literal["draft", "in_review", "needs_revision", "approved", "rejected"]
ArticleBlockKind = Literal["paragraph", "subhead", "quote", "question", "answer", "list_item"]
BLOCK_KINDS: tuple[str, ...] = ArticleBlockKind.__args__  # type: ignore[attr-defined]


class SourceRef(CamelModel):
    video_id: ID
    start: float
    end: float | None = None
    segment_id: ID | None = None


class ArticleBlock(CamelModel):
    id: ID
    kind: ArticleBlockKind
    text: str
    speaker_id: ID | None = None
    source_refs: list[SourceRef] | None = None


class ArticleVariants(CamelModel):
    headlines: list[str] | None = None
    intros: dict[EditorialTone, str] | None = None
    short_intro: str | None = None
    summary: str | None = None


class Article(CamelModel):
    id: ID
    project_id: ID
    type: ArticleType
    kicker: str | None = None
    headline: str
    subheadline: str
    byline: str | None = None
    intro: str
    body: list[ArticleBlock]
    quote_fact_ids: list[ID]
    speaker_ids: list[ID]
    session_ids: list[ID]
    suggested_image_ids: list[ID]
    captions: dict[ID, str]
    status: ArticleStatus
    generated_by: Literal["demo_seed", "llm", "human"]
    updated_at: ISODate
    approved_by: ID | None = None
    approved_at: ISODate | None = None
    review_note: str | None = None
    variants: ArticleVariants | None = None


class ArticleCreate(CamelModel):
    type: ArticleType
    headline: str = ""
    subheadline: str = ""
    kicker: str | None = None
    byline: str | None = None
    intro: str = ""
    body: list[ArticleBlock] = Field(default_factory=list)
    speaker_ids: list[ID] = Field(default_factory=list)
    session_ids: list[ID] = Field(default_factory=list)


class ArticleUpdate(CamelModel):
    kicker: str | None = None
    headline: str | None = None
    subheadline: str | None = None
    byline: str | None = None
    intro: str | None = None
    body: list[ArticleBlock] | None = None
    quote_fact_ids: list[ID] | None = None
    speaker_ids: list[ID] | None = None
    session_ids: list[ID] | None = None
    suggested_image_ids: list[ID] | None = None
    captions: dict[ID, str] | None = None
    # Approval only via POST /articles/{id}/approve.
    status: Literal["draft", "in_review", "needs_revision"] | None = None
    review_note: str | None = None


class GenerateArticlesRequest(CamelModel):
    types: list[ArticleType] = Field(min_length=1)
    session_ids: list[ID] = Field(default_factory=list)


AssistAction = Literal["rewrite_headline", "change_tone", "expand", "shorten", "summarise", "regenerate_paragraph"]


class AssistRequest(CamelModel):
    action: AssistAction
    block_id: ID | None = None
    tone: EditorialTone | None = None


class AssistResponse(CamelModel):
    action: AssistAction
    block_id: ID | None = None
    suggestions: list[str]
    provider: str
    model: str


class VerifiedClaim(CamelModel):
    text: str
    kind: Literal["quote", "number", "percentage"]
    status: Literal["verified", "not_found", "partial"]
    source_ref: SourceRef | None = None
    location: str | None = None  # e.g. "body:blk_x", "intro", "headline"
    note: str | None = None


class VerificationResult(CamelModel):
    article_id: ID
    checked_at: ISODate
    engine: Literal["deterministic"] = "deterministic"
    segments_checked: int
    claims: list[VerifiedClaim]
    summary: dict[str, int]


class RejectRequest(CamelModel):
    note: str = Field(min_length=1, max_length=4000)
