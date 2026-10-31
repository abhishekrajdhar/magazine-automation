import base64
import io

import httpx
import pytest
from PIL import Image

from app.config import get_settings
from app.services import images


def _png(w=64, h=96) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (20, 40, 90)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def openai_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _fake_images(monkeypatch, status=200, body=None):
    sent = {}

    def post(url, json=None, **kw):
        sent.update(url=url, json=json)
        return httpx.Response(status, json=body if body is not None else {"data": [{"b64_json": _png()}]},
                              request=httpx.Request("POST", url))

    monkeypatch.setattr(images.httpx, "post", post)
    return sent


def test_generates_a_labelled_photo_asset(client, owner, openai_key, monkeypatch):
    sent = _fake_images(monkeypatch)
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Images"}).json()
    r = client.post(f"/api/v1/projects/{proj['id']}/assets/generate", headers=h,
                    json={"prompt": "A classroom with tablets at dawn", "aspect": "portrait"})
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["kind"] == "photo" and a["tags"] == ["ai-generated"] and a["credit"].startswith("AI-generated image")
    assert (a["widthPx"], a["heightPx"]) == (64, 96) and a["url"] and not a["simulated"]
    assert sent["json"]["size"] == "1024x1536" and sent["json"]["model"] == "gpt-image-2"
    assert "Do not depict real, identifiable people" in sent["json"]["prompt"]
    assert sent["json"]["prompt"].endswith("A classroom with tablets at dawn")
    assert client.get(a["url"].removeprefix("/api/v1").join(["/api/v1", ""]), headers=h).status_code == 200
    assert any(x["id"] == a["id"] for x in client.get(f"/api/v1/projects/{proj['id']}/assets", headers=h).json())


def test_provider_refusal_is_reported_to_the_editor(client, owner, openai_key, monkeypatch):
    _fake_images(monkeypatch, status=400, body={"error": {"message": "Your request was rejected by the safety system."}})
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Images"}).json()
    r = client.post(f"/api/v1/projects/{proj['id']}/assets/generate", headers=h, json={"prompt": "anything"})
    assert r.status_code == 422 and "safety system" in r.json()["detail"]


def test_unconfigured_returns_503(client, owner):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Images"}).json()
    r = client.post(f"/api/v1/projects/{proj['id']}/assets/generate", headers=h, json={"prompt": "anything"})
    assert r.status_code == 503 and "OPENAI_API_KEY" in r.json()["detail"]
    st = {i["key"]: i for i in client.get("/api/v1/integrations/status", headers=h).json()}
    assert st["images"]["configured"] is False
