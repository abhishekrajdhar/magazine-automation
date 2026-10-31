"""Provider-neutral LLM interface used by the editorial engine and video analysis.

Providers never fabricate output: when no provider/key is configured,
`complete_json` raises `LLMNotConfigured`, which API routes map to HTTP 503.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class LLMError(Exception):
    """Provider call failed (permanent unless `retryable`)."""

    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class LLMNotConfigured(LLMError):
    pass


class LLMRefused(LLMError):
    pass


class LLMProvider(ABC):
    name: str = "none"
    model: str = ""
    supports_vision: bool = False

    @abstractmethod
    def configured(self) -> tuple[bool, str]:
        """(configured, human-readable detail) — no network."""

    @abstractmethod
    def check(self) -> tuple[bool, str]:
        """(available, detail) — performs a cheap real request (e.g. model lookup)."""

    @abstractmethod
    def complete_json(
        self,
        *,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        images: list[bytes] | None = None,
        max_tokens: int | None = None,
        schema_name: str = "result",
    ) -> dict[str, Any]:
        """Return a JSON object that validates against `schema`."""


def strict_object(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    """JSON schema object suitable for structured outputs (all keys required, no extras)."""
    return {
        "type": "object",
        "properties": properties,
        "required": required if required is not None else list(properties.keys()),
        "additionalProperties": False,
    }


def nullable(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


class NoneProvider(LLMProvider):
    name = "none"

    def __init__(self, reason: str = "LLM_PROVIDER=none"):
        self.reason = reason

    def configured(self) -> tuple[bool, str]:
        return False, f"No LLM provider configured ({self.reason})."

    def check(self) -> tuple[bool, str]:
        return False, self.configured()[1]

    def complete_json(self, **_: Any) -> dict[str, Any]:
        raise LLMNotConfigured(
            "AI features are unavailable: no LLM provider is configured. Set OPENAI_API_KEY or "
            "ANTHROPIC_API_KEY in services/api/.env (LLM_PROVIDER=auto picks whichever is set)."
        )
