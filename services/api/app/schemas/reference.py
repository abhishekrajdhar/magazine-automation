from __future__ import annotations

from typing import Any, Literal

from pydantic import Field

from app.schemas.base import ID, CamelModel, ISODate, PageType, TextRole


class ReferenceAnalysis(CamelModel):
    progress: float
    message: str | None = None
    analyser: Literal["pymupdf", "pymupdf+vision", "demo_seed"]
    completed_at: ISODate | None = None


class ReferenceMagazine(CamelModel):
    id: ID
    org_id: ID
    title: str
    file_name: str
    file_size_bytes: int
    page_count: int
    uploaded_at: ISODate
    status: Literal["uploaded", "analysing", "analysed", "approved", "failed"]
    analysis: ReferenceAnalysis
    design_profile_id: ID | None = None
    has_source_pdf: bool
    has_indd_source: bool
    is_demo: bool


class LayoutBlock(CamelModel):
    id: ID
    kind: Literal["text", "image", "shape", "rule"]
    role: TextRole | Literal["image", "background"] | None = None
    x: float
    y: float
    w: float
    h: float
    font_name: str | None = None
    font_size: float | None = None
    color: str | None = None
    sample: str | None = None


class PageProperties(CamelModel):
    columns: int
    dominant_colors: list[str]
    text_coverage: float
    image_coverage: float
    fonts: list[str]


class ReferencePage(CamelModel):
    id: ID
    reference_id: ID
    page_number: int
    layout_type: PageType
    confidence: float
    width_pt: float
    height_pt: float
    image_url: str | None = None
    blocks: list[LayoutBlock]
    properties: PageProperties
    corrected: bool


class ReferencePageUpdate(CamelModel):
    layout_type: PageType


class TextStyle(CamelModel):
    role: TextRole
    detected_font: str | None = None
    classification: Literal["serif", "sans", "display", "mono"]
    preview_font: str
    size: float
    leading: float
    weight: int
    tracking: float
    color: str
    uppercase: bool | None = None
    italic: bool | None = None
    confidence: float


class ProfilePage(CamelModel):
    width_pt: float
    height_pt: float
    orientation: Literal["portrait", "landscape"]
    bleed_pt: float


class Margins(CamelModel):
    top: float
    bottom: float
    inside: float
    outside: float


class Grid(CamelModel):
    columns: int
    gutter_pt: float
    baseline_pt: float


class Colors(CamelModel):
    ink: str
    paper: str
    accent: str
    accent_alt: str
    muted: str
    rule: str
    palette: list[str]


class Folio(CamelModel):
    position: Literal["bottom_outside", "bottom_center", "top_outside"]
    show_magazine_name: bool
    show_section: bool


class Images(CamelModel):
    caption_placement: Literal["below", "overlay", "side"]
    corner_radius: float
    full_bleed_cover: bool


class PullQuote(CamelModel):
    style: Literal["rule_above", "quote_mark", "boxed"]


class DesignProfile(CamelModel):
    id: ID
    reference_id: ID
    name: str
    status: Literal["draft", "approved"]
    version: int
    page: ProfilePage
    margins: Margins
    grid: Grid
    typography: dict[TextRole, TextStyle]
    colors: Colors
    folio: Folio
    images: Images
    pull_quote: PullQuote
    page_type_counts: dict[PageType, int]
    confidence: dict[str, float]
    overrides: list[str]
    approved_at: ISODate | None = None
    approved_by: ID | None = None


class DesignProfilePatch(CamelModel):
    """Partial update. Any nested key may be supplied; changed dotted paths go into `overrides`."""

    name: str | None = None
    page: dict[str, Any] | None = None
    margins: dict[str, Any] | None = None
    grid: dict[str, Any] | None = None
    typography: dict[str, dict[str, Any]] | None = None
    colors: dict[str, Any] | None = None
    folio: dict[str, Any] | None = None
    images: dict[str, Any] | None = None
    pull_quote: dict[str, Any] | None = None


class ReferenceUploadResponse(CamelModel):
    reference: ReferenceMagazine
    job_id: ID | None = None


class AnalyseResponse(CamelModel):
    job_id: ID
    reference: ReferenceMagazine


class TemplateSlot(CamelModel):
    id: ID
    role: str
    x: float
    y: float
    w: float
    h: float
    columns: int | None = None


class Template(CamelModel):
    id: ID
    name: str
    page_type: PageType
    source: Literal["builtin", "reference"]
    reference_page_number: int | None = None
    description: str
    slots: list[TemplateSlot]
    columns: int


class DeriveTemplateRequest(CamelModel):
    reference_id: ID
    page_number: int = Field(ge=1)
    name: str | None = None
