"""LLM provider factory: LLM_PROVIDER=auto|anthropic|openai_compatible|none."""

from __future__ import annotations

from fastapi import HTTPException

from app.config import get_settings
from app.services.llm.base import LLMError, LLMNotConfigured, LLMProvider, LLMRefused, NoneProvider, nullable, strict_object

__all__ = ["LLMError", "LLMNotConfigured", "LLMProvider", "LLMRefused", "get_llm", "require_llm", "nullable",
           "strict_object"]


def get_llm() -> LLMProvider:
    s = get_settings()
    provider = s.effective_llm_provider
    if provider == "anthropic":
        from app.services.llm.anthropic_provider import from_settings

        return from_settings()
    if provider == "openai_compatible":
        from app.services.llm.openai_compatible import from_settings as oai

        return oai()
    if s.llm_provider == "auto":
        return NoneProvider("LLM_PROVIDER=auto, but neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is set")
    return NoneProvider()


def require_llm() -> LLMProvider:
    """For API routes: 503 with a helpful message when AI is not configured (never fake output)."""
    llm = get_llm()
    ok, detail = llm.configured()
    if not ok:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_not_configured",
                "message": "AI features are unavailable because no LLM provider is configured.",
                "detail": detail,
                "hint": "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in services/api/.env, then restart the API.",
            },
        )
    return llm
