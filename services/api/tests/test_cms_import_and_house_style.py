"""Elets CMS import (against a fake WordPress) and the deterministic house typography rules."""

import io

import httpx
import pytest
from PIL import Image

from app.services import cms_import as cms
from app.services.house_typography import complete_excerpt, normalise, normalise_article

BASE = "https://egov.eletsonline.com"
CONTENT = """
<p><strong>What changed in the last year?</strong></p>
<p>We moved 40 services online - and "nobody" queued. It's a start...</p>
<figure><img src="https://egov.eletsonline.com/wp-content/uploads/2026/10/crowd-300x200.jpg"><figcaption>skip me</figcaption></figure>
<p>Q. How was it funded</p>
<p>Through the state budget.</p>
<h3>The road ahead</h3>
<p>Three districts go live in 2026-27.</p>
<blockquote><p>Citizens should not have to travel for a certificate.</p></blockquote>
<ul><li>First item here</li></ul>
<p><img src="https://egov.eletsonline.com/wp-content/uploads/2026/10/stage.jpg"></p>
<p><img src="https://evil.example.com/wp-content/uploads/2026/10/x.jpg"></p>
<p>Also Read: something else entirely</p>
<p>Follow us on twitter.com</p>
<script>alert(1)</script>
"""
POST = {
    "id": 501, "date": "2026-10-02T09:00:00", "link": f"{BASE}/interview/asha-rao/",
    "title": {"rendered": "Services at the &#8216;doorstep&#8217;"},
    "excerpt": {"rendered": "<p>The department moved forty services online in a year, and the queues went [&hellip;]</p>"},
    "content": {"rendered": CONTENT},
    "_embedded": {"author": [{"name": "Priya Sen"}],
                  "wp:featuredmedia": [{"source_url": f"{BASE}/wp-content/uploads/2026/10/asha.jpg",
                                        "caption": {"rendered": "<p>Asha Rao, Secretary</p>"}, "alt_text": ""}]},
}


def _jpeg(w=640, h=480) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 60, 40)).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture()
def wordpress(monkeypatch):
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(str(req.url))
        if req.url.host != "egov.eletsonline.com":
            return httpx.Response(500)
        path = req.url.path
        if path == "/wp-json/wp/v2/categories":
            return httpx.Response(200, json=[{"id": 7, "name": "Interview"}, {"id": 8, "name": "Interviews Archive"}])
        if path == "/wp-json/wp/v2/posts":
            assert req.url.params["categories"] == "7"
            return httpx.Response(200, json=[POST])
        if path == "/wp-json/wp/v2/posts/501":
            return httpx.Response(200, json=POST)
        if path == "/wp-json/wp/v2/posts/999":
            return httpx.Response(404, json={"code": "rest_post_invalid_id"})
        if path.endswith("/broken.jpg"):
            return httpx.Response(200, content=b"not an image")
        if path.endswith(".jpg"):
            return httpx.Response(200, content=_jpeg())
        return httpx.Response(404)

    monkeypatch.setattr(cms, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    return calls


def test_html_becomes_typed_blocks_without_boilerplate():
    blocks = cms.html_to_blocks(CONTENT)
    assert [(b["kind"], b["text"]) for b in blocks] == [
        ("question", "What changed in the last year?"),
        ("answer", 'We moved 40 services online - and "nobody" queued. It\'s a start...'),
        ("question", "How was it funded?"),
        ("answer", "Through the state budget."),
        ("subhead", "The road ahead"),
        ("paragraph", "Three districts go live in 2026-27."),
        ("quote", "Citizens should not have to travel for a certificate."),
        ("list_item", "First item here"),
    ]
    assert len({b["id"] for b in blocks}) == len(blocks)


def test_only_elets_hosts_are_fetched():
    assert cms.allowed_image_url("https://egov.eletsonline.com/wp-content/uploads/a.jpg")
    assert cms.allowed_image_url("https://cdn.eletsonline.com/a.jpg")
    for bad in ("http://egov.eletsonline.com/a.jpg", "https://evil.example.com/a.jpg",
                "https://eletsonline.com.evil.example/a.jpg", "https://169.254.169.254/latest", "file:///etc/passwd", ""):
        assert not cms.allowed_image_url(bad)
    assert cms.download_image("https://evil.example.com/a.jpg", 10_000_000) is None


def test_draft_fields(wordpress):
    d = cms.draft_from_post(cms.fetch_post("egov", 501), "egov", "interview")
    assert d["type"] == "interview" and d["kicker"] == "Interview · eGov"
    assert d["headline"] == "Services at the ‘doorstep’" and d["byline"] == "Priya Sen"
    assert d["intro"].startswith("The department moved forty services online") and "[" not in d["intro"]
    assert d["source_url"].endswith("/asha-rao/") and d["date"] == "2026-10-02"
    # the featured picture and the full-size inline one; never the resized thumbnail or another host
    assert [i["url"].rsplit("/", 1)[-1] for i in d["images"]] == ["asha.jpg", "stage.jpg"]
    assert d["images"][0]["caption"] == "Asha Rao, Secretary"


def test_the_intro_is_not_printed_twice():
    body = [{"id": "a", "kind": "paragraph", "text": "Ahmedabad\u2019s riverfront is, by any measure, a model. It now runs 38 km."},
            {"id": "b", "kind": "paragraph", "text": "Second paragraph."}]
    out = cms._without_repeated_intro("Ahmedabad's riverfront is, by any measure, a model.", body)
    assert [b["text"] for b in out] == ["It now runs 38 km.", "Second paragraph."] and out[0]["id"] == "a"
    assert cms._without_repeated_intro("Ahmedabad's riverfront is, by any measure, a model. It now runs 38 km.", body) == body[1:]
    assert cms._without_repeated_intro("A different opening entirely.", body) == body
    assert cms._without_repeated_intro("Ahmedabad's riverfront was", body) == body
    question_first = [{"id": "q", "kind": "question", "text": "Ahmedabad's riverfront?"}]
    assert cms._without_repeated_intro("Ahmedabad's riverfront", question_first) == question_first


def test_listing_and_import_routes(client, owner, wordpress):
    h = owner["headers"]
    src = client.get("/api/v1/cms/sources", headers=h).json()
    assert {s["key"] for s in src["sites"]} >= {"egov", "bfsi"} and src["kinds"][0]["articleType"] == "interview"
    assert client.get("/api/v1/cms/posts?site=nowhere&kind=interview", headers=h).status_code == 422
    posts = client.get("/api/v1/cms/posts?site=egov&kind=interview", headers=h).json()
    assert posts[0]["id"] == 501 and posts[0]["wordCount"] > 20 and posts[0]["imageUrl"].endswith("asha.jpg")

    proj = client.post("/api/v1/projects", headers=h, json={"title": "CMS issue", "targetPageCount": 8}).json()
    r = client.post(f"/api/v1/projects/{proj['id']}/articles/import-cms", headers=h,
                    json={"site": "egov", "kind": "interview", "postIds": [501, 999, 501]})
    assert r.status_code == 201, r.text
    out = r.json()
    assert len(out["articles"]) == 1 and out["imagesImported"] == 2
    assert out["skipped"] == [{"postId": 999, "reason": "egov.eletsonline.com answered 404."}]
    art = out["articles"][0]
    assert art["status"] == "draft" and art["generatedBy"] == "human" and art["type"] == "interview"
    assert "Imported from the Elets CMS" in art["reviewNote"] and len(art["suggestedImageIds"]) == 2
    assert art["captions"][art["suggestedImageIds"][0]] == "Asha Rao, Secretary"
    assets = client.get(f"/api/v1/projects/{proj['id']}/assets", headers=h).json()
    assert {a["id"] for a in assets} == set(art["suggestedImageIds"]) and assets[0]["widthPx"] == 640
    assert "cms-import" in assets[0]["tags"] and not any("evil.example.com" in c for c in wordpress)
    listed = client.get(f"/api/v1/projects/{proj['id']}/articles", headers=h).json()
    assert [a["id"] for a in listed] == [art["id"]]


def test_cms_routes_need_a_session(app, wordpress):
    from fastapi.testclient import TestClient

    with TestClient(app) as anon:
        assert anon.get("/api/v1/cms/sources").status_code == 401
        assert anon.get("/api/v1/cms/posts?site=egov&kind=interview").status_code == 401
        assert anon.post("/api/v1/projects/prj_x/articles/import-cms",
                         json={"site": "egov", "kind": "interview", "postIds": [501]}).status_code == 401
    assert wordpress == []


def test_import_needs_content_permission_and_own_project(client, owner, wordpress):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Mine", "targetPageCount": 8}).json()
    other = client.post("/api/v1/auth/signup", json={"name": "Other", "email": f"other-{proj['id'][-6:]}@example.test",
                                                     "password": "correct horse 1", "organisationName": "Other Org"}).json()
    r = client.post(f"/api/v1/projects/{proj['id']}/articles/import-cms",
                    headers={"Authorization": f"Bearer {other['token']}"},
                    json={"site": "egov", "kind": "interview", "postIds": [501]})
    assert r.status_code == 404
    assert client.post(f"/api/v1/projects/{proj['id']}/articles/import-cms", headers=h,
                       json={"site": "egov", "kind": "interview", "postIds": list(range(11))}).status_code == 422


def test_typography_rules():
    text, counts = normalise('He said  "we moved 40 - 50 services" ,  and it\'s done... 10 percent -- no more')
    assert text == "He said “we moved 40–50 services”, and it’s done… 10 per cent – no more"
    assert counts["straight double quotes"] == 2 and counts["percent to per cent"] == 1
    assert normalise("₹ 500 crore")[0] == "₹500 crore"
    assert normalise("Already clean – nothing to do.") == ("Already clean – nothing to do.", {})
    assert normalise("a well-known state-of-the-art plan")[1] == {}        # word hyphens are left alone
    assert normalise("1.5 per cent")[0] == "1.5 per cent"


def test_excerpt_completion():
    full, how = complete_excerpt("The department moved forty services online in a year, and the queues went",
                                 ["The department moved forty services online in a year, and the queues went away. More."])
    assert full.endswith("the queues went away.") and "completed" in how
    assert complete_excerpt("A whole sentence.", ["x"]) == ("A whole sentence.", None)


def test_house_style_route_previews_then_applies_and_revokes_approval(client, owner):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Style", "targetPageCount": 8}).json()
    art = client.post(f"/api/v1/projects/{proj['id']}/articles", headers=h, json={
        "type": "editorial", "headline": 'The "rails"  of governance', "intro": "It's 10 percent done...",
        "body": [{"id": "b1", "kind": "paragraph", "text": "Clean paragraph."},
                 {"id": "b2", "kind": "quote", "text": "We grew 20 - 30 percent"}]}).json()
    client.post(f"/api/v1/articles/{art['id']}/approve", headers=h)

    preview = client.post(f"/api/v1/articles/{art['id']}/house-style", headers=h, json={}).json()
    assert preview["applied"] is False and preview["total"] >= 6 and preview["fields"] == ["body", "headline", "intro"]
    assert "article" not in preview
    assert client.get(f"/api/v1/articles/{art['id']}", headers=h).json()["status"] == "approved"

    done = client.post(f"/api/v1/articles/{art['id']}/house-style", headers=h, json={"apply": True}).json()
    a = done["article"]
    assert done["applied"] and a["headline"] == "The “rails” of governance"
    assert a["intro"] == "It’s 10 per cent done…"
    assert [b["text"] for b in a["body"]] == ["Clean paragraph.", "We grew 20–30 per cent"]
    assert a["body"][0]["id"] == "b1" and a["status"] == "in_review"      # edited approved copy goes back to review
    again = client.post(f"/api/v1/articles/{art['id']}/house-style", headers=h, json={"apply": True}).json()
    assert again["applied"] is False and again["total"] == 0


def test_normalise_article_reports_only_changed_fields():
    changed, counts = normalise_article({"headline": "Fine", "intro": "Fine too.", "kicker": None,
                                         "body": [{"id": "x", "kind": "paragraph", "text": "ok"}]})
    assert changed == {} and counts == {}
