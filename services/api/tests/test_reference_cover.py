"""A cover stored as one flattened picture is rebuilt with live text frames from vision-detected elements."""

import io

import pymupdf
from PIL import Image, ImageDraw

from app.services import reference_jobs
from app.services.llm.base import LLMProvider
from tests.conftest import run_jobs

ELEMENTS = [
    {"role": "band", "text": None, "description": "top banner", "x": 0, "y": 0, "w": 1, "h": 0.05, "color": None,
     "background": "#1E4FD8", "align": "left", "weight": "regular", "uppercase": False},
    {"role": "tagline", "text": "Asia's monthly magazine on e-Governance", "description": "banner line", "x": 0.2,
     "y": 0.01, "w": 0.6, "h": 0.03, "color": "#FFFFFF", "background": None, "align": "center", "weight": "bold",
     "uppercase": False},
    {"role": "masthead", "text": "egov", "description": "wordmark", "x": 0.05, "y": 0.07, "w": 0.45, "h": 0.12,
     "color": "#E31B23", "background": None, "align": "left", "weight": "black", "uppercase": False},
    {"role": "logo", "text": None, "description": "Summit logo", "x": 0.6, "y": 0.07, "w": 0.35, "h": 0.12,
     "color": None, "background": None, "align": "left", "weight": "regular", "uppercase": False},
    {"role": "issue_line", "text": "₹ 250 | ISSUE 1", "description": "price line", "x": 0.05, "y": 0.2, "w": 0.4,
     "h": 0.012, "color": "#FFFFFF", "background": None, "align": "left", "weight": "regular", "uppercase": True},
    {"role": "headline", "text": "INDIA'S\nAI MOMENT", "description": "headline", "x": 0.1, "y": 0.3, "w": 0.8,
     "h": 0.12, "color": "#FFFFFF", "background": None, "align": "center", "weight": "black", "uppercase": True},
    {"role": "deck", "text": "Vision · Scale · Impact", "description": "deck", "x": 0.2, "y": 0.43, "w": 0.6,
     "h": 0.03, "color": "#4DA3FF", "background": None, "align": "center", "weight": "bold", "uppercase": False},
    {"role": "cover_line", "text": "Building Intelligence", "description": "strap", "x": 0.1, "y": 0.48, "w": 0.8,
     "h": 0.02, "color": "#FFFFFF", "background": None, "align": "center", "weight": "bold", "uppercase": False},
]


class FakeVision(LLMProvider):
    name, model, supports_vision = "fake", "fake-vision", True
    calls = 0

    def configured(self):
        return True, "fake"

    def check(self):
        return True, "fake"

    def complete_json(self, *, system, prompt, schema, images=None, **kw):
        assert images, "the page image must be sent"
        FakeVision.calls += 1
        return {"elements": ELEMENTS}


def _flat_cover_pdf() -> bytes:
    """Page 1: one full-page picture (no live text). Page 2: ordinary text so the profile has type to measure."""
    im = Image.new("RGB", (595, 842), (10, 20, 60))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 595, 42), fill=(30, 79, 216))
    d.rectangle((357, 59, 565, 160), fill=(240, 240, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    doc = pymupdf.open()
    p1 = doc.new_page(width=595, height=842)
    p1.insert_image(p1.rect, stream=buf.getvalue())
    p2 = doc.new_page(width=595, height=842)
    y = 80
    p2.insert_text((50, y), "A headline about digital government", fontsize=24)
    for i in range(30):
        y += 16
        p2.insert_text((50, y), "Body copy that runs across the column for measurement purposes. " * 1, fontsize=10)
    out = doc.tobytes()
    doc.close()
    return out


def test_flattened_cover_becomes_live_frames(client, owner, monkeypatch):
    monkeypatch.setattr(reference_jobs, "get_llm", lambda: FakeVision())
    h = owner["headers"]
    ref = client.post("/api/v1/references", headers=h, files={"file": ("flat-cover.pdf", _flat_cover_pdf(), "application/pdf")},
                      data={"title": "Flat cover"}).json()["reference"]
    run_jobs()
    assert client.post(f"/api/v1/references/{ref['id']}/pages/1/reanalyse", headers=h).status_code in (200, 202)
    run_jobs()
    assert FakeVision.calls >= 1
    page = client.get(f"/api/v1/references/{ref['id']}/pages", headers=h).json()[0]
    roles = {b.get("coverRole") for b in page["blocks"]}
    assert {"masthead", "headline", "logo", "band", "tagline"} <= roles

    tpl = client.post("/api/v1/templates/derive", headers=h, json={"referenceId": ref["id"], "pageNumber": 1}).json()
    slots = {s["id"]: s for s in tpl["slots"]}
    assert {"bg", "band1", "tag1", "mast", "logo1", "issue", "headline", "deck", "lines"} <= set(slots)
    assert slots["tag1"]["fixedText"].startswith("Asia's") and slots["logo1"]["assetTag"].endswith(":logo1")
    assert slots["headline"]["style"]["color"] == "#FFFFFF" and slots["headline"]["style"]["uppercase"] is True
    assert slots["band1"]["fill"] == "#1E4FD8" and slots["bg"]["bleed"] == {"top": True, "bottom": True, "left": True, "right": True}

    proj = client.post("/api/v1/projects", headers=h, json={"title": "AI in Edtech", "referenceId": ref["id"],
                                                             "targetPageCount": 4}).json()
    client.post(f"/api/v1/projects/{proj['id']}/articles", headers=h, json={
        "type": "event_report", "headline": "Classrooms Rewired", "intro": "Intro"})
    plan = client.post(f"/api/v1/projects/{proj['id']}/plan/recommend", headers=h, json={}).json()
    cover = plan["pages"][0]
    assert cover["templateId"] == tpl["id"]
    els = {e["id"]: e for e in cover["elements"]}
    assert els["el_mast"]["kind"] == "text" and els["el_mast"]["text"] == "AI in Edtech"
    assert els["el_tag1"]["text"].startswith("Asia's") and els["el_band1"]["fill"] == "#1E4FD8"
    assert els["el_headline"]["text"] == "Classrooms Rewired" and els["el_headline"]["style"]["align"] == "center"
    assert els["el_bg"]["x"] < 0 and els["el_bg"]["y"] < 0  # full-bleed
    logo = els["el_logo1"]
    assert logo["kind"] == "image" and logo["assetId"] and logo["name"].startswith("Logo:")
    assets = {a["id"]: a for a in client.get(f"/api/v1/projects/{proj['id']}/assets", headers=h).json()}
    assert assets[logo["assetId"]]["kind"] == "logo" and assets[logo["assetId"]]["widthPx"] > 500  # 300 ppi crop

    # idempotent: planning again reuses the same crop
    again = client.post(f"/api/v1/projects/{proj['id']}/plan/recommend", headers=h, json={}).json()
    assert {e["id"]: e for e in again["pages"][0]["elements"]}["el_logo1"]["assetId"] == logo["assetId"]

    # The InDesign layout contract keeps every text element as a live, styled text frame and logos as placed images.
    client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": [cover]})
    exp = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "layout_json"}).json()
    run_jobs()
    import json

    rec = client.get(f"/api/v1/exports/{exp['id']}", headers=h).json()
    contract = json.loads(client.get(rec["downloadUrl"], headers=h).content)
    frames = {f["id"].split("_", 1)[-1] if "_" in f["id"] else f["id"]: f for f in contract["pages"][0]["frames"]}
    by_label = {f["label"]: f for f in contract["pages"][0]["frames"]}
    assert by_label["Masthead"]["kind"] == "text" and by_label["Masthead"]["content"] == "AI in Edtech"
    assert by_label["Headline"]["kind"] == "text" and by_label["Headline"]["paragraph_style"]
    assert by_label["Tagline"]["kind"] == "text"
    logo = next(f for f in contract["pages"][0]["frames"] if f["label"].startswith("Logo:"))
    assert logo["kind"] == "image" and logo["image"]["asset_id"]
    assert frames  # every frame carries an id InDesign scripts can address
