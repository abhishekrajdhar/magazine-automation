from __future__ import annotations

from typing import Annotated, Literal

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


def _email(v: str) -> str:
    """Syntax-checked e-mail. Special-use domains (e.g. demo@pressflow.local) are allowed; no DNS lookups."""
    v = v.strip()
    local, sep, domain = v.rpartition("@")
    tld = domain.rsplit(".", 1)[-1].lower()
    # email-validator rejects special-use TLDs (.local, .test); validate syntax against a neutral domain instead.
    probe = f"{local}@{domain.rsplit('.', 1)[0]}.example" if sep and tld in ("local", "test", "localhost") else v
    try:
        validate_email(probe, check_deliverability=False)
    except EmailNotValidError as e:
        raise ValueError(str(e)) from e
    return v.lower()


Email = Annotated[str, AfterValidator(_email)]

ID = str
ISODate = str


class CamelModel(BaseModel):
    """Base for every API schema: camelCase JSON, snake_case Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)


Role = Literal["owner", "admin", "editor", "designer", "viewer"]

PageType = Literal[
    "cover",
    "editorial",
    "toc",
    "interview",
    "event_report",
    "two_column_article",
    "full_page_image",
    "photo_gallery",
    "advertisement",
    "infographic",
    "speaker_profile",
]
PAGE_TYPES: tuple[str, ...] = PageType.__args__  # type: ignore[attr-defined]

TextRole = Literal[
    "kicker", "headline", "deck", "byline", "body", "subhead", "pullquote", "caption", "folio", "question", "stat"
]
TEXT_ROLES: tuple[str, ...] = TextRole.__args__  # type: ignore[attr-defined]

SlotRole = Literal[
    "kicker",
    "headline",
    "deck",
    "byline",
    "body",
    "subhead",
    "pullquote",
    "caption",
    "folio",
    "question",
    "stat",
    "hero_image",
    "image",
    "portrait",
    "background",
    "accent_bar",
    "rule",
    "ad",
]

ArticleType = Literal[
    "event_report",
    "keynote",
    "interview",
    "government_perspective",
    "panel",
    "tech_feature",
    "speaker_profiles",
    "highlights",
    "editorial",
    "photo_captions",
]
ARTICLE_TYPES: tuple[str, ...] = ArticleType.__args__  # type: ignore[attr-defined]

Severity = Literal["error", "warning", "info"]
ExportFormat = Literal["pdf_digital", "pdf_print", "indd", "page_previews", "content_package", "asset_archive", "layout_json"]
ExportRenderer = Literal["browser", "reportlab", "indesign"]


class OkResponse(CamelModel):
    ok: bool = True
    message: str | None = None
