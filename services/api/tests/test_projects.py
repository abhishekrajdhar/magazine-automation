import io

from PIL import Image

from app.schemas.workspace import ProjectWorkspace


def test_project_crud_and_workspace(client, owner):
    h = owner["headers"]
    r = client.post("/api/v1/projects", headers=h, json={
        "title": "eGov — National eGovernance Summit 2026 Special", "eventName": "National eGovernance Summit 2026",
        "category": "Government", "issueNumber": "Vol. 22 · Issue 11", "publicationDate": "2026-11-15",
        "publisher": "Elets Technomedia", "targetPageCount": 32, "description": "Summit special"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "setup" and p["targetPageCount"] == 32 and p["config"]["targetPageCount"] == 32
    assert p["config"]["designMode"] == "adapted_reference" and p["isDemo"] is False
    assert set(p["config"]) >= {"articleTypes", "adPageCount", "includeToc", "imagePreference"}
    pid = p["id"]

    assert any(x["id"] == pid for x in client.get("/api/v1/projects", headers=h).json())
    up = client.patch(f"/api/v1/projects/{pid}", headers=h, json={"title": "Renamed", "config": {
        **p["config"], "adPageCount": 6, "editorialTone": "celebratory"}})
    assert up.status_code == 200
    assert up.json()["title"] == "Renamed" and up.json()["config"]["adPageCount"] == 6
    # multi-word camelCase fields must map onto snake_case columns
    up2 = client.patch(f"/api/v1/projects/{pid}", headers=h, json={"eventName": "NeGS 2026", "issueNumber": "12",
                                                                    "publicationDate": "2026-12-01"}).json()
    assert (up2["eventName"], up2["issueNumber"], up2["publicationDate"]) == ("NeGS 2026", "12", "2026-12-01")
    art = client.post(f"/api/v1/projects/{pid}/articles", headers=h, json={"type": "keynote", "headline": "H"}).json()
    a2 = client.patch(f"/api/v1/articles/{art['id']}", headers=h,
                      json={"subheadline": "Deck line", "reviewNote": "check names", "status": "in_review"}).json()
    assert a2["subheadline"] == "Deck line" and a2["reviewNote"] == "check names" and a2["status"] == "in_review"
    assert client.patch(f"/api/v1/articles/{art['id']}", headers=h, json={"status": "approved"}).status_code == 422

    # asset upload
    buf = io.BytesIO()
    Image.new("RGB", (1200, 800), (200, 80, 40)).save(buf, "JPEG")
    a = client.post(f"/api/v1/projects/{pid}/assets", headers=h, files={"file": ("stage.jpg", buf.getvalue(), "image/jpeg")},
                    data={"kind": "photo", "caption": "Main stage", "credit": "Elets Photo Desk"})
    assert a.status_code == 201, a.text
    asset = a.json()
    assert asset["widthPx"] == 1200 and asset["url"].endswith("/file")
    f = client.get(asset["url"], headers=h)
    assert f.status_code == 200 and f.headers["content-type"] == "image/jpeg"
    bad = client.post(f"/api/v1/projects/{pid}/assets", headers=h, files={"file": ("x.jpg", b"not an image", "image/jpeg")})
    assert bad.status_code == 415

    ws = client.get(f"/api/v1/projects/{pid}/workspace", headers=h)
    assert ws.status_code == 200
    body = ws.json()
    assert set(body) == {"project", "videos", "segments", "speakers", "sessions", "facts", "articles", "assets", "pages",
                         "exports"}
    ProjectWorkspace.model_validate(body)
    assert len(body["assets"]) == 1

    act = client.get(f"/api/v1/projects/{pid}/activity", headers=h).json()
    assert act and {"id", "at", "actorId", "verb", "target", "kind"} <= set(act[0])

    assert client.delete(f"/api/v1/projects/{pid}", headers=h).status_code == 200
    assert client.get(f"/api/v1/projects/{pid}", headers=h).status_code == 404


def test_validation_errors(client, owner):
    r = client.post("/api/v1/projects", headers=owner["headers"], json={"title": ""})
    assert r.status_code == 422 and r.json()["errors"]
