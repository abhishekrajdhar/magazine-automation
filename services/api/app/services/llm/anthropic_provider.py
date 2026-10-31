"""Anthropic (Claude) provider via the official `anthropic` SDK.

* Model from LLM_MODEL (default `claude-opus-5-5`); thinking is always on for this
  model (adaptive) so the `thinking` parameter is omitted; depth via `output_config.effort`.
* Structured output via `output_config.format` (JSON schema) — the first text block is JSON.
* Streaming + `get_final_message()` so long generations don't hit HTTP timeouts.
* Server-side refusal fallback opted in (`fallbacks="default"`, beta
  `server-side-fallback-2026-07-01`); a final `stop_reason == "refusal"` is surfaced as LLMRefused.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any

import anthropic

from app.config import get_settings
from app.services.llm.base import LLMError, LLMNotConfigured, LLMProvider, LLMRefused

log = logging.getLogger("pressflow.llm.anthropic")

FALLBACK_BETA = "server-side-fallback-2026-07-01"
_check_cache: dict[str, tuple[float, tuple[bool, str]]] = {}


class AnthropicProvider(LLMProvider):
    name = "anthropic"
    supports_vision = True

    def __init__(self, api_key: str, model: str, effort: str, max_tokens: int, timeout: float,
                 base_url: str | None = None, http_client=None):
        self.api_key = api_key
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.base_url = base_url
        self.http_client = http_client  # injectable (tests use an httpx2 MockTransport)
        self._client: anthropic.Anthropic | None = None

    # ------------------------------------------------------------------ status
    def configured(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set."
        return True, f"Anthropic API key set; model {self.model}."

    @property
    def client(self) -> anthropic.Anthropic:
        if not self.api_key:
            raise LLMNotConfigured(self.configured()[1])
        if self._client is None:
            kwargs: dict[str, Any] = {"api_key": self.api_key, "timeout": self.timeout, "max_retries": 2}
            if self.base_url:
                kwargs["base_url"] = self.base_url
            if self.http_client is not None:
                kwargs["http_client"] = self.http_client
            self._client = anthropic.Anthropic(**kwargs)
        return self._client

    def check(self) -> tuple[bool, str]:
        ok, detail = self.configured()
        if not ok:
            return False, detail
        cached = _check_cache.get(self.model)
        if cached and time.monotonic() - cached[0] < 300:
            return cached[1]
        try:
            info = self.client.with_options(timeout=8.0, max_retries=0).models.retrieve(self.model)
            result = (True, f"Model {info.id} reachable.")
        except anthropic.AuthenticationError:
            result = (False, "ANTHROPIC_API_KEY was rejected (401).")
        except anthropic.NotFoundError:
            result = (False, f"Model {self.model} not found for this key.")
        except anthropic.APIConnectionError as e:
            result = (False, f"Could not reach the Anthropic API: {e}")
        except anthropic.APIStatusError as e:
            result = (False, f"Anthropic API error {e.status_code}.")
        _check_cache[self.model] = (time.monotonic(), result)
        return result

    # ------------------------------------------------------------------ call
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
        content: list[dict[str, Any]] = []
        for img in images or []:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                                        "data": base64.standard_b64encode(img).decode("ascii")}})
        content.append({"type": "text", "text": prompt})
        try:
            with self.client.beta.messages.stream(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            ) as stream:
                message = stream.get_final_message()
        except anthropic.AuthenticationError as e:
            raise LLMError("Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.") from e
        except anthropic.PermissionDeniedError as e:
            raise LLMError(f"Anthropic permission denied: {e.message}") from e
        except anthropic.NotFoundError as e:
            raise LLMError(f"Model {self.model!r} not found. Check LLM_MODEL.") from e
        except anthropic.BadRequestError as e:
            raise LLMError(f"Anthropic rejected the request: {e.message}") from e
        except anthropic.RateLimitError as e:
            raise LLMError("Anthropic rate limit reached; will retry.", retryable=True) from e
        except anthropic.APIConnectionError as e:
            raise LLMError(f"Could not reach the Anthropic API: {e}", retryable=True) from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"Anthropic API error {e.status_code}: {e.message}", retryable=e.status_code >= 500) from e

        request_id = getattr(message, "_request_id", None)
        if message.stop_reason == "refusal":
            details = getattr(message, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            raise LLMRefused(f"The model declined this request (category: {category or 'unspecified'}).")
        if message.stop_reason == "max_tokens":
            raise LLMError(f"Model output was truncated at max_tokens (request {request_id}).")
        text = next((b.text for b in message.content if getattr(b, "type", None) == "text"), None)
        if not text:
            raise LLMError(f"Model returned no text content (request {request_id}).")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise LLMError(f"Model output was not valid JSON (request {request_id}).") from e
        if not isinstance(data, dict):
            raise LLMError("Model output JSON was not an object.")
        log.info("anthropic %s ok (request %s, in=%s out=%s)", schema_name, request_id,
                 getattr(message.usage, "input_tokens", "?"), getattr(message.usage, "output_tokens", "?"))
        return data


def from_settings() -> AnthropicProvider:
    s = get_settings()
    return AnthropicProvider(api_key=s.anthropic_api_key, model=s.llm_model, effort=s.llm_effort,
                             max_tokens=s.llm_max_tokens, timeout=s.llm_timeout_seconds)
