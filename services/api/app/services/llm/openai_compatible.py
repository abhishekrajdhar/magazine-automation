"""OpenAI-compatible chat-completions provider (any server exposing /chat/completions
with `response_format: json_schema`). Used when LLM_PROVIDER=openai_compatible, or auto with OPENAI_API_KEY set.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any

from urllib.parse import urlparse

import httpx

from app.config import get_settings
from app.services.llm.base import LLMError, LLMNotConfigured, LLMProvider

_check_cache: dict[str, tuple[float, tuple[bool, str]]] = {}
# base_url + model → the token-limit parameter that endpoint accepted.
_token_param_cache: dict[str, str] = {}


def _rejects_param(error_text: str, param: str) -> bool:
    text = error_text.lower()
    return param in text and ("unsupported" in text or "unrecognized" in text or "not supported" in text or "extra" in text)


class OpenAICompatibleProvider(LLMProvider):
    name = "openai_compatible"
    supports_vision = True

    def __init__(self, api_key: str, base_url: str, model: str, max_tokens: int, timeout: float):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.max_tokens = max_tokens
        self.timeout = timeout

    def configured(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "LLM_PROVIDER=openai_compatible but OPENAI_API_KEY is not set."
        return True, f"OpenAI-compatible endpoint {self.base_url}; model {self.model}."

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise LLMNotConfigured(self.configured()[1])
        return {"Authorization": f"Bearer {self.api_key}"}

    def check(self) -> tuple[bool, str]:
        ok, detail = self.configured()
        if not ok:
            return False, detail
        key = self.base_url + self.model
        cached = _check_cache.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return cached[1]
        try:
            r = httpx.get(f"{self.base_url}/models", headers=self._headers(), timeout=8.0)
            result = (True, "Endpoint reachable.") if r.status_code == 200 else (False, f"/models returned HTTP {r.status_code}.")
        except httpx.HTTPError as e:
            result = (False, f"Could not reach {self.base_url}: {e}")
        _check_cache[key] = (time.monotonic(), result)
        return result

    def _token_param(self) -> str:
        """`max_completion_tokens` for OpenAI (required by reasoning models, accepted by all
        current models); `max_tokens` for other OpenAI-compatible servers."""
        cached = _token_param_cache.get(self.base_url + self.model)
        if cached:
            return cached
        host = urlparse(self.base_url).hostname or ""
        return "max_completion_tokens" if host == "api.openai.com" or host.endswith(".openai.azure.com") else "max_tokens"

    def _post(self, body: dict[str, Any]) -> httpx.Response:
        try:
            return httpx.post(f"{self.base_url}/chat/completions", headers=self._headers(), json=body, timeout=self.timeout)
        except httpx.HTTPError as e:
            raise LLMError(f"Could not reach {self.base_url}: {e}", retryable=True) from e

    def complete_json(self, *, system: str, prompt: str, schema: dict[str, Any], images: list[bytes] | None = None,
                      max_tokens: int | None = None, schema_name: str = "result") -> dict[str, Any]:
        user_content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img in images or []:
            b64 = base64.b64encode(img).decode("ascii")
            user_content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_content}],
            "response_format": {"type": "json_schema", "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
        }
        limit = max_tokens or self.max_tokens
        param = self._token_param()
        r = self._post({**body, param: limit})
        # Servers disagree on the token-limit name: OpenAI's reasoning models reject
        # `max_tokens`, while some compatible servers only know `max_tokens`. Swap once.
        if r.status_code == 400 and _rejects_param(r.text, param):
            param = "max_tokens" if param == "max_completion_tokens" else "max_completion_tokens"
            r = self._post({**body, param: limit})
            if r.status_code < 400:
                _token_param_cache[self.base_url + self.model] = param
        if r.status_code == 401:
            raise LLMError("The OpenAI-compatible endpoint rejected the API key (401).")
        if r.status_code == 429 or r.status_code >= 500:
            try:
                err = r.json().get("error") or {}
            except ValueError:
                err = {}
            # An empty balance is not a rate limit: retrying won't help, and the editor needs to know why.
            if err.get("code") in ("insufficient_quota", "credit_balance_exhausted"):
                raise LLMError(f"The OpenAI account has no credits left: {err.get('message') or 'add credits'}")
            detail = f": {err['message'][:200]}" if err.get("message") else "."
            raise LLMError(f"Endpoint returned HTTP {r.status_code}{detail}", retryable=True)
        if r.status_code >= 400:
            raise LLMError(f"Endpoint returned HTTP {r.status_code}: {r.text[:300]}")
        try:
            choice = r.json()["choices"][0]
            if choice.get("finish_reason") == "length":
                raise LLMError("Model output was truncated (finish_reason=length).")
            data = json.loads(choice["message"]["content"])
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
            raise LLMError("Endpoint returned an unexpected response shape or invalid JSON.") from e
        if not isinstance(data, dict):
            raise LLMError("Model output JSON was not an object.")
        return data


def from_settings() -> OpenAICompatibleProvider:
    s = get_settings()
    return OpenAICompatibleProvider(api_key=s.openai_api_key, base_url=s.openai_base_url, model=s.effective_llm_model,
                                    max_tokens=s.llm_max_tokens, timeout=s.llm_timeout_seconds)
