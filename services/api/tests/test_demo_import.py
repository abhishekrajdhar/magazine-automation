import json

from sqlalchemy import select

from app.db import session_factory
from app.ids import new_id
from app.models import Article, MagazinePage, Organisation, Project, User, VideoSource
from app.services.demo_import import import_workspace_file

NOW = "2026-10-01T10:00:00Z"


def _workspace():
    cfg = {"designMode": "adapted_reference", "targetPageCount": 24, "contentStyle": "feature", "language": "en",
           "editorialTone": "authoritative", "imagePreference": "balanced", "articleTypes": ["event_report"],
           "includeToc": True, "includeEditorial": True, "includeAdvertisements": True, "includeInterviews": True,
           "includeEventReports": True, "adPageCount": 2}
    pid = "prj_demo_import_test"
    return {
        "organisation": {"id": "org_x", "name": "Elets", "slug": "elets", "plan": "demo"},
        "users": [{"id": "usr_a", "name": "Ananya K", "email": "ananya@demo-elets.example", "initials": "AK"},
                  {"id": "usr_bad", "name": "Broken"}],
        "members": [{"userId": "usr_a", "name": "Ananya K", "email": "ananya@demo-elets.example", "role": "editor",
                     "initials": "AK"}],
        "references": [], "referencePages": [], "designProfiles": [], "templates": [],
        "activity": [{"id": "act_demo_1", "at": NOW, "actorId": "usr_a", "verb": "approved", "target": "Report",
                      "kind": "article", "projectId": pid}],
        "workspaces": [{
            "project": {"id": pid, "orgId": "org_x", "title": "Demo Summit", "eventName": "Summit", "category": "Gov",
                        "issueNumber": "1", "publicationDate": "2026-11-01", "publisher": "Elets",
                        "targetPageCount": 24, "description": "", "status": "editorial", "config": cfg,
                        "ownerId": "usr_a", "createdAt": NOW, "updatedAt": NOW, "isDemo": True},
            "videos": [{"id": "vid_demo_1", "projectId": pid, "sourceType": "youtube", "title": "Keynote",
                        "processing": {"state": "ready", "progress": 100, "updatedAt": NOW},
                        "transcription": {"state": "complete", "method": "demo_seed"}, "simulated": True,
                        "addedAt": NOW}],
            "segments": [{"id": "seg_demo_1", "videoId": "vid_demo_1", "start": 0, "end": 5, "speakerLabel": "S1",
                          "text": "Welcome to the summit."}],
            "speakers": [], "sessions": [], "facts": [],
            "articles": [{"id": "art_demo_1", "projectId": pid, "type": "event_report", "headline": "H",
                          "subheadline": "S", "intro": "I", "body": [{"id": "b1", "kind": "paragraph", "text": "T"}],
                          "quoteFactIds": [], "speakerIds": [], "sessionIds": [], "suggestedImageIds": [],
                          "captions": {}, "status": "approved", "generatedBy": "demo_seed", "updatedAt": NOW,
                          "approvedBy": "usr_a", "approvedAt": NOW}],
            "assets": [],
            "pages": [{"id": "pg_demo_1", "projectId": pid, "pageType": "cover", "templateId": "tpl_cover",
                       "label": "Cover", "elements": [], "editorialStatus": "approved", "designStatus": "ready",
                       "locked": False}],
            "exports": [],
        }],
    }


def test_import_workspace(tmp_path, owner):
    path = tmp_path / "workspace.json"
    path.write_text(json.dumps(_workspace()))
    with session_factory()() as db:
        org = db.get(Organisation, owner["org"]["id"])
        user = db.get(User, owner["user"]["id"])
        imp = import_workspace_file(db, path, org, user)
        db.commit()
        assert imp.counts["projects"] == 1 and imp.counts["videos"] == 1 and imp.counts["pages"] == 1
        assert imp.counts["users"] == 1 and any("usr_bad" in w for w in imp.warnings)
        p = db.get(Project, "prj_demo_import_test")
        assert p.is_demo and p.org_id == org.id
        assert db.get(VideoSource, "vid_demo_1").simulated is True
        assert db.get(Article, "art_demo_1").status == "approved"
        assert db.scalar(select(MagazinePage).where(MagazinePage.project_id == p.id)).position == 0
    # idempotent
    with session_factory()() as db:
        imp2 = import_workspace_file(db, path, db.get(Organisation, owner["org"]["id"]), db.get(User, owner["user"]["id"]))
        db.commit()
        assert imp2.counts["projects"] == 1


DEMO = __import__("app.config", fromlist=["REPO_ROOT"]).REPO_ROOT / "packages" / "demo-data" / "workspace.json"


def test_import_real_demo_workspace_and_render(client, owner):
    """packages/demo-data/workspace.json (exported by the frontend) imports cleanly and renders from saved pages."""
    import pytest

    if not DEMO.exists():
        pytest.skip("packages/demo-data/workspace.json not present")
    from app.services.contract import validate_contract
    from tests.conftest import run_jobs

    with session_factory()() as db:
        imp = import_workspace_file(db, DEMO, db.get(Organisation, owner["org"]["id"]), db.get(User, owner["user"]["id"]))
        db.commit()
    assert imp.warnings == []
    data = json.loads(DEMO.read_text())
    ws = data["workspaces"][0]
    pid = ws["project"]["id"]
    h = owner["headers"]
    got = client.get(f"/api/v1/projects/{pid}/workspace", headers=h).json()
    for key in ("videos", "segments", "speakers", "sessions", "facts", "articles", "assets", "pages", "exports"):
        assert len(got[key]) == len(ws[key]), key
    assert sum(1 for p in got["pages"] for e in p["elements"] if e.get("dynamic")) == \
        sum(1 for p in ws["pages"] for e in p["elements"] if e.get("dynamic"))
    ref = data["references"][0]
    assert len(client.get(f"/api/v1/references/{ref['id']}/pages", headers=h).json()) == len(data["referencePages"])
    assert client.get(f"/api/v1/references/{ref['id']}/pages/1/image", headers=h).status_code == 404

    pf = client.post(f"/api/v1/projects/{pid}/preflight", headers=h)
    assert pf.status_code == 200, pf.text
    ex = client.post(f"/api/v1/projects/{pid}/exports", headers=h, json={"format": "layout_json"})
    assert ex.status_code == 202, ex.text
    ex2 = client.post(f"/api/v1/projects/{pid}/exports", headers=h, json={"format": "pdf_digital"})
    run_jobs()
    contract = json.loads(client.get(f"/api/v1/exports/{ex.json()['id']}/download", headers=h).content)
    assert validate_contract(contract) == [] and len(contract["pages"]) == len(ws["pages"])
    folios = [f for p in contract["pages"] for f in p["frames"] if f["role"] == "folio"]
    assert folios and all(f["content"] for f in folios)
    assert not any(f["content"].startswith(("^ ", "## ")) for p in contract["pages"] for f in p["frames"] if f["kind"] == "text")
    rec = client.get(f"/api/v1/exports/{ex2.json()['id']}", headers=h).json()
    assert rec["status"] == "complete", rec
    import pymupdf

    doc = pymupdf.open(stream=client.get(rec["downloadUrl"], headers=h).content, filetype="pdf")
    assert doc.page_count == len(ws["pages"])
