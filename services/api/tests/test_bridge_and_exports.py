from datetime import timedelta

from sqlalchemy import update

from app.db import session_factory
from app.ids import utcnow
from app.models import IndesignBridge, Job
from tests.conftest import run_jobs

BRIDGE = {"Authorization": "Bearer test-bridge-token"}


def _offline_all_bridges():
    with session_factory()() as db:
        db.execute(update(IndesignBridge).values(last_heartbeat_at=utcnow() - timedelta(hours=1)))
        db.commit()


def _approved_project(client, h):
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Bridge test", "targetPageCount": 4}).json()
    art = client.post(f"/api/v1/projects/{proj['id']}/articles", headers=h, json={
        "type": "event_report", "headline": "Rails", "intro": "Intro", "body": [{"id": "b", "kind": "paragraph", "text": "x"}]}).json()
    client.post(f"/api/v1/articles/{art['id']}/approve", headers=h)
    plan = client.post(f"/api/v1/projects/{proj['id']}/plan/recommend", headers=h, json={}).json()
    for p in plan["pages"]:
        p["editorialStatus"] = "approved"
    client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": plan["pages"]})
    return proj


def test_indd_unavailable_without_bridge(client, owner):
    _offline_all_bridges()
    h = owner["headers"]
    proj = _approved_project(client, h)
    r = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "indd"})
    assert r.status_code == 202
    rec = r.json()
    assert rec["status"] == "unavailable" and rec["message"] == "InDesign bridge not connected"
    assert rec["renderer"] == "indesign" and "downloadUrl" not in rec
    assert client.get(f"/api/v1/exports/{rec['id']}/download", headers=h).status_code == 409
    st = {i["key"]: i for i in client.get("/api/v1/integrations/status", headers=h).json()}
    assert st["indesign_bridge"]["available"] is False


def test_bridge_auth_heartbeat_and_job_roundtrip(client, owner):
    h = owner["headers"]
    hb = {"bridgeId": "bridge-test-1", "hostname": "design-mac", "mode": "desktop", "indesignVersion": "20.4",
          "platform": "darwin", "fonts": ["Minion Pro Regular", "Myriad Pro Semibold"]}
    assert client.post("/api/v1/indesign/bridge/heartbeat", json=hb).status_code == 401
    assert client.post("/api/v1/indesign/bridge/heartbeat", json=hb,
                       headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/api/v1/indesign/bridge/heartbeat", json=hb, headers=BRIDGE).status_code == 200

    ind = client.get("/api/v1/integrations/indesign", headers=h).json()
    assert ind["status"] == "online" and ind["fontCount"] == 2 and ind["indesignVersion"] == "20.4"
    st = {i["key"]: i for i in client.get("/api/v1/integrations/status", headers=h).json()}
    assert st["indesign_bridge"]["configured"] and st["indesign_bridge"]["available"]
    assert {"key", "label", "configured", "available", "detail", "docsHint"} <= set(st["ffmpeg"])
    assert st["llm"]["configured"] is False and st["llm"]["available"] is False
    assert st["database"]["available"] is True

    proj = _approved_project(client, h)
    rec = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "indd"}).json()
    assert rec["status"] == "queued" and rec["renderer"] == "indesign"
    assert run_jobs() == 0  # the API worker never takes InDesign jobs

    q = client.get("/api/v1/indesign/bridge/jobs?status=queued", headers=BRIDGE).json()
    assert any(j["exportId"] == rec["id"] for j in q["jobs"])
    nxt = client.get("/api/v1/indesign/bridge/jobs/next", params={"bridgeId": "bridge-test-1"}, headers=BRIDGE)
    assert nxt.status_code == 200, nxt.text
    job = nxt.json()
    assert job["exportId"] == rec["id"] and job["format"] == "indd"
    assert job["contractUrl"].startswith("http") and "force" not in job["options"]
    contract = client.get(job["contractUrl"], headers=BRIDGE).json()
    assert contract["contract_version"] == "1.0" and all(p["approved"] is True for p in contract["pages"])
    assets = client.get(job["assetsUrl"], headers=BRIDGE)
    assert assets.status_code == 200 and assets.headers["content-type"] == "application/zip"
    assert client.get("/api/v1/indesign/bridge/jobs/next", params={"bridgeId": "bridge-test-1"},
                      headers=BRIDGE).status_code == 204

    res = client.post(f"/api/v1/indesign/bridge/jobs/{job['jobId']}/result", headers=BRIDGE,
                      data={"status": "succeeded", "report": '{"pages": 4, "overset": 0}'},
                      files={"indd": ("issue.indd", b"\x06\x06\xed\xf5fake-indd-bytes", "application/octet-stream"),
                             "pdf": ("issue.pdf", b"%PDF-1.7\n%fake\n", "application/pdf")})
    assert res.status_code == 200, res.text
    done = client.get(f"/api/v1/exports/{rec['id']}", headers=h).json()
    assert done["status"] == "complete" and done["renderer"] == "indesign"
    dl = client.get(done["downloadUrl"], headers=h)
    assert dl.status_code == 200 and dl.content.startswith(b"\x06\x06")
    assert client.get(f"/api/v1/exports/{rec['id']}/download?file=pdf", headers=h).content.startswith(b"%PDF")

    # failure shape + lease expiry re-queue
    rec2 = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "indd"}).json()
    j2 = client.get("/api/v1/indesign/bridge/jobs/next", params={"bridgeId": "bridge-test-1"}, headers=BRIDGE).json()
    with session_factory()() as db:
        db.execute(update(Job).where(Job.id == j2["jobId"]).values(lease_until=utcnow() - timedelta(seconds=1)))
        db.commit()
    assert client.get("/api/v1/integrations/indesign", headers=h).json()["queuedJobs"] >= 1
    assert client.get(f"/api/v1/exports/{rec2['id']}", headers=h).json()["status"] == "queued"
    j2b = client.get("/api/v1/indesign/bridge/jobs/next", params={"bridgeId": "bridge-test-1"}, headers=BRIDGE).json()
    assert j2b["jobId"] == j2["jobId"]
    fail = client.post(f"/api/v1/indesign/bridge/jobs/{j2['jobId']}/result", headers=BRIDGE,
                       data={"status": "failed", "error": "Missing font: Minion Pro Bold"})
    assert fail.status_code == 200
    f = client.get(f"/api/v1/exports/{rec2['id']}", headers=h).json()
    assert f["status"] == "failed" and "Minion Pro Bold" in f["message"]

    # preflight uses the bridge's font list
    pf = client.post(f"/api/v1/projects/{proj['id']}/preflight", headers=h).json()
    assert not any("font availability was not verified" in n for n in pf["notes"])
    _offline_all_bridges()
