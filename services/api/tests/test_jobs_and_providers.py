import json

import httpx2
import pytest

from app.db import session_factory
from app.models import Job
from app.services.jobs.queue import PermanentError, enqueue, register, run_pending
from app.services.llm import LLMRefused
from app.services.llm.anthropic_provider import FALLBACK_BETA, AnthropicProvider

_calls = {"flaky": 0}


@register("test_flaky")
def _flaky(ctx):
    _calls["flaky"] += 1
    ctx.progress(50, "half way")
    if _calls["flaky"] < 2:
        raise RuntimeError("transient")


@register("test_permanent")
def _permanent(ctx):
    raise PermanentError("missing configuration")


def _job(kind):
    with session_factory()() as db:
        j = enqueue(db, kind, {}, org_id=None, max_attempts=3)
        db.commit()
        return j.id


def test_retry_with_backoff_then_success():
    jid = _job("test_flaky")
    run_pending(ignore_schedule=True)
    with session_factory()() as db:
        j = db.get(Job, jid)
        assert j.status == "succeeded" and j.attempts == 2 and j.progress == 100


def test_permanent_error_fails_without_retry():
    jid = _job("test_permanent")
    run_pending(ignore_schedule=True)
    with session_factory()() as db:
        j = db.get(Job, jid)
        assert j.status == "failed" and j.attempts == 1 and "missing configuration" in j.error


def _provider(handler):
    client = httpx2.Client(transport=httpx2.MockTransport(handler))
    return AnthropicProvider(api_key="sk-test", model="claude-opus-5-5", effort="high", max_tokens=1000, timeout=10,
                             http_client=client)


def _sse(message: dict) -> bytes:
    """Minimal streaming response for a complete message (test fixture only)."""
    content = message.pop("content")
    events = [("message_start", {"type": "message_start", "message": {**message, "content": [],
                                                                       "stop_reason": None}})]
    for i, block in enumerate(content):
        events.append(("content_block_start", {"type": "content_block_start", "index": i,
                                               "content_block": {"type": "text", "text": ""}}))
        events.append(("content_block_delta", {"type": "content_block_delta", "index": i,
                                               "delta": {"type": "text_delta", "text": block["text"]}}))
        events.append(("content_block_stop", {"type": "content_block_stop", "index": i}))
    events.append(("message_delta", {"type": "message_delta", "delta": {"stop_reason": message["stop_reason"],
                                                                        "stop_sequence": None},
                                     "usage": {"output_tokens": 5}}))
    events.append(("message_stop", {"type": "message_stop"}))
    return "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events).encode()


def test_anthropic_provider_request_shape_and_parsing():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["headers"] = dict(request.headers)
        msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
               "content": [{"type": "text", "text": '{"answer": "ok"}'}], "stop_reason": "end_turn",
               "usage": {"input_tokens": 10, "output_tokens": 5}}
        return httpx2.Response(200, content=_sse(msg), headers={"content-type": "text/event-stream"})

    p = _provider(handler)
    schema = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"],
              "additionalProperties": False}
    out = p.complete_json(system="sys", prompt="hi", schema=schema, images=[b"\x89PNG fake"])
    assert out == {"answer": "ok"}
    body = seen["body"]
    assert body["model"] == "claude-opus-5-5" and body["stream"] is True
    assert body["output_config"]["format"] == {"type": "json_schema", "schema": schema}
    assert body["output_config"]["effort"] == "high"
    assert body["fallbacks"] == "default" and "thinking" not in body
    assert FALLBACK_BETA in seen["headers"].get("anthropic-beta", "")
    assert body["messages"][0]["content"][0]["type"] == "image"


def test_anthropic_provider_refusal():
    def handler(request):
        msg = {"id": "msg_2", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
               "content": [], "stop_reason": "refusal", "usage": {"input_tokens": 1, "output_tokens": 0}}
        return httpx2.Response(200, content=_sse(msg), headers={"content-type": "text/event-stream"})

    with pytest.raises(LLMRefused):
        _provider(handler).complete_json(system="s", prompt="p", schema={"type": "object"})
