from sqlalchemy import select

from app.db import session_factory
from app.ids import new_id
from app.models import Article, EventSession, ExtractedFact, Job, TranscriptSegment, VideoSource
from app.services import editorial
from app.services.llm import LLMProvider
from tests.conftest import run_jobs


class FakeLLM(LLMProvider):
    name, model = "fake", "fake-1"

    def configured(self):
        return True, "fake"

    def check(self):
        return True, "fake"

    def complete_json(self, *, system, prompt, schema, schema_name, **kw):
        return {"kicker": None, "headline": "Rails for everyone", "subheadline": "Sub", "intro": "Intro.",
                "body": [{"kind": "paragraph", "text": "Delegates met.", "speakerId": None, "sourceSegments": []}],
                "quoteFactIds": [], "headlineVariants": []}


def test_generates_every_requested_type_on_sqlite(client, owner, monkeypatch):
    """Regression: the job's progress update used to deadlock on SQLite's single writer after the first article."""
    monkeypatch.setattr(editorial, "get_llm", lambda: FakeLLM())
    monkeypatch.setattr("app.api.v1.editorial.require_llm", lambda: FakeLLM())
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Generation"}).json()
    with session_factory()() as db:
        vid = VideoSource(id=new_id("vid"), org_id=owner["org"]["id"], project_id=proj["id"], source_type="upload_video",
                          title="Keynote")
        db.add(vid)
        db.flush()
        db.add(TranscriptSegment(id=new_id("seg"), project_id=proj["id"], video_id=vid.id, start=0, end=5,
                                 text="Delegates met."))
        ses = EventSession(id=new_id("ses"), project_id=proj["id"], video_id=vid.id, title="Keynote", status="approved")
        db.add(ses)
        db.add(ExtractedFact(id=new_id("fct"), project_id=proj["id"], video_id=vid.id, kind="statistic",
                             text="40 speakers", status="approved"))
        db.commit()
        ses_id = ses.id

    types = ["event_report", "panel", "interview"]
    req = {"types": types, "sessionIds": [ses_id]}
    r = client.post(f"/api/v1/projects/{proj['id']}/articles/generate", headers=h, json=req)
    assert r.status_code == 202, r.text
    # a repeated click while it's queued returns the same job; a different request gets its own
    again = client.post(f"/api/v1/projects/{proj['id']}/articles/generate", headers=h, json=req).json()
    assert again["jobId"] == r.json()["jobId"]
    other = client.post(f"/api/v1/projects/{proj['id']}/articles/generate", headers=h,
                        json={"types": ["panel"], "sessionIds": [ses_id]}).json()
    assert other["jobId"] != r.json()["jobId"]
    listed = client.get(f"/api/v1/projects/{proj['id']}/articles/jobs", headers=h).json()
    assert [j["id"] for j in listed] == [other["jobId"], r.json()["jobId"]]
    assert all(j["status"] == "queued" and j["kind"] == "article_generation" for j in listed)
    run_jobs()
    assert {j["status"] for j in client.get(f"/api/v1/projects/{proj['id']}/articles/jobs", headers=h).json()} == {"succeeded"}
    with session_factory()() as db:
        job = db.get(Job, r.json()["jobId"])
        assert job.status == "succeeded", job.error
        made = db.scalars(select(Article).where(Article.project_id == proj["id"])).all()
    assert sorted(a.type for a in made) == sorted([*types, "panel"])
