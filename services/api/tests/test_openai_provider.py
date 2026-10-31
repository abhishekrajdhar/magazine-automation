import json as jsonlib

import httpx
import pytest

from app.services.llm import openai_compatible
from app.services.llm.openai_compatible import OpenAICompatibleProvider

SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"], "additionalProperties": False}
OK = {"choices": [{"finish_reason": "stop", "message": {"content": '{"answer": "ok"}'}}]}


@pytest.fixture(autouse=True)
def _clear_cache():
    openai_compatible._token_param_cache.clear()
    yield
    openai_compatible._token_param_cache.clear()


def _capture(monkeypatch, responses):
    """Patch httpx.post to return queued responses and record request bodies."""
    bodies = []

    def fake_post(url, headers=None, json=None, timeout=None):
        bodies.append(json)
        status, payload = responses.pop(0)
        return httpx.Response(status, content=payload if isinstance(payload, bytes) else jsonlib.dumps(payload).encode(), request=httpx.Request("POST", url))

    monkeypatch.setattr(openai_compatible.httpx, "post", fake_post)
    return bodies


def _provider(base_url):
    return OpenAICompatibleProvider(api_key="sk-test", base_url=base_url, model="test-model", max_tokens=4000, timeout=10)


def test_openai_uses_max_completion_tokens(monkeypatch):
    bodies = _capture(monkeypatch, [(200, OK)])
    out = _provider("https://api.openai.com/v1").complete_json(system="s", prompt="p", schema=SCHEMA)
    assert out == {"answer": "ok"}
    assert bodies[0]["max_completion_tokens"] == 4000 and "max_tokens" not in bodies[0]
    assert bodies[0]["response_format"]["json_schema"]["strict"] is True


def test_other_compatible_servers_use_max_tokens(monkeypatch):
    bodies = _capture(monkeypatch, [(200, OK)])
    _provider("http://localhost:11434/v1").complete_json(system="s", prompt="p", schema=SCHEMA)
    assert bodies[0]["max_tokens"] == 4000 and "max_completion_tokens" not in bodies[0]


def test_swaps_parameter_once_when_endpoint_rejects_it(monkeypatch):
    rejected = {"error": {"message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}}
    bodies = _capture(monkeypatch, [(400, rejected), (200, OK), (200, OK)])
    p = _provider("https://gateway.example.com/v1")
    assert p.complete_json(system="s", prompt="p", schema=SCHEMA) == {"answer": "ok"}
    assert "max_tokens" in bodies[0] and bodies[1]["max_completion_tokens"] == 4000
    # The working parameter is remembered for the next call.
    p.complete_json(system="s", prompt="p", schema=SCHEMA)
    assert "max_completion_tokens" in bodies[2] and len(bodies) == 3


def test_other_400s_are_not_retried(monkeypatch):
    bodies = _capture(monkeypatch, [(400, {"error": {"message": "Invalid schema for response_format"}})])
    with pytest.raises(openai_compatible.LLMError, match="HTTP 400"):
        _provider("https://api.openai.com/v1").complete_json(system="s", prompt="p", schema=SCHEMA)
    assert len(bodies) == 1


def test_empty_balance_is_reported_and_not_retried(monkeypatch):
    _capture(monkeypatch, [(429, {"error": {"code": "credit_balance_exhausted", "message": "You have no credits remaining."}})])
    with pytest.raises(openai_compatible.LLMError, match="no credits left") as e:
        _provider("https://api.openai.com/v1").complete_json(system="s", prompt="p", schema=SCHEMA)
    assert e.value.retryable is False


def test_rate_limit_is_retryable_and_explains_itself(monkeypatch):
    _capture(monkeypatch, [(429, {"error": {"code": "rate_limit_exceeded", "message": "Rate limit reached for requests"}})])
    with pytest.raises(openai_compatible.LLMError, match="Rate limit reached") as e:
        _provider("https://api.openai.com/v1").complete_json(system="s", prompt="p", schema=SCHEMA)
    assert e.value.retryable is True
