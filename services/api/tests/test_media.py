import shutil
import subprocess

import pytest

from app.db import session_factory
from app.ids import new_id, utcnow
from app.models import ExtractedFact, Speaker, TranscriptSegment, VideoSource
from tests.conftest import run_jobs


def _tone(tmp_path) -> bytes:
    out = tmp_path / "tone.m4a"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                    "-c:a", "aac", str(out)], check=True)
    return out.read_bytes()


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_upload_and_process_without_transcriber(client, owner, tmp_path):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Media"}).json()
    bad = client.post(f"/api/v1/projects/{proj['id']}/videos/upload", headers=h,
                      files={"file": ("notes.txt", b"hello", "text/plain")})
    assert bad.status_code == 415
    r = client.post(f"/api/v1/projects/{proj['id']}/videos/upload", headers=h,
                    files={"file": ("keynote.m4a", _tone(tmp_path), "audio/mp4")}, data={"title": "Keynote audio"})
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["sourceType"] == "upload_audio" and abs(v["durationSec"] - 2) < 0.3
    assert v["processing"]["state"] == "pending" and v["transcription"]["state"] == "none"
    p = client.post(f"/api/v1/videos/{v['id']}/process", headers=h)
    assert p.status_code == 202
    run_jobs()
    v2 = client.get(f"/api/v1/videos/{v['id']}", headers=h).json()
    # TRANSCRIPTION_PROVIDER=none in tests: honest 'unavailable', never a fake transcript
    assert v2["processing"]["state"] == "unavailable"
    assert v2["transcription"]["state"] == "unavailable"
    assert "TRANSCRIPTION_PROVIDER" in v2["processing"]["message"]
    assert client.get(f"/api/v1/videos/{v['id']}/transcript", headers=h).json()["segments"] == []
    job = client.get(f"/api/v1/jobs/{p.json()['jobId']}", headers=h).json()
    assert job["status"] == "failed" and job["attempts"] == 1


def test_youtube_without_owner_oauth_is_unavailable(client, owner):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "YT"}).json()
    with session_factory()() as db:
        vid = new_id("vid")
        db.add(VideoSource(id=vid, org_id=owner["org"]["id"], project_id=proj["id"], source_type="youtube",
                           url="https://www.youtube.com/watch?v=dQw4w9WgXcQ", external_id="dQw4w9WgXcQ", title="Session",
                           processing_updated_at=utcnow()))
        db.commit()
    client.post(f"/api/v1/videos/{vid}/process", headers=h)
    run_jobs()
    v = client.get(f"/api/v1/videos/{vid}", headers=h).json()
    assert v["processing"]["state"] == "unavailable" and v["transcription"]["state"] == "unavailable"
    assert "original recording" in v["processing"]["message"]


def test_fact_and_speaker_edits(client, owner):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Facts"}).json()
    with session_factory()() as db:
        vid, seg, fid, sid = new_id("vid"), new_id("seg"), new_id("fct"), new_id("spk")
        db.add(VideoSource(id=vid, org_id=owner["org"]["id"], project_id=proj["id"], source_type="upload_video",
                           title="Panel", processing_updated_at=utcnow(), transcription_state="complete"))
        db.flush()
        db.add(TranscriptSegment(id=seg, project_id=proj["id"], video_id=vid, idx=0, start=12.5, end=18.0,
                                 speaker_label="Speaker", text="Data that nobody maintains becomes a liability."))
        db.add(Speaker(id=sid, project_id=proj["id"], name="Dr. Meera Raghavan", verification="ai_suggested",
                       video_ids=[vid], labels=[]))
        db.add(ExtractedFact(id=fid, project_id=proj["id"], video_id=vid, segment_id=seg, kind="quote",
                             text="Unmaintained data is a liability", timestamp=12.5, provenance="ai_interpretation",
                             status="pending", confidence=0.5))
        db.commit()
    f = client.patch(f"/api/v1/facts/{fid}", headers=h, json={"text": "Data that nobody maintains becomes a liability.",
                                                              "status": "approved"}).json()
    assert f["provenance"] == "transcript_verbatim" and f["status"] == "approved" and f["segmentId"] == seg
    f = client.patch(f"/api/v1/facts/{fid}", headers=h, json={"text": "A paraphrase nobody said"}).json()
    assert f["provenance"] == "ai_interpretation"
    s = client.patch(f"/api/v1/speakers/{sid}", headers=h, json={"designation": "Principal Secretary (IT)"}).json()
    assert s["verification"] == "unverified"  # human-edited, not yet confirmed
    s = client.patch(f"/api/v1/speakers/{sid}", headers=h, json={"verification": "confirmed"}).json()
    assert s["verification"] == "confirmed"
    ws = client.get(f"/api/v1/projects/{proj['id']}/workspace", headers=h).json()
    assert ws["segments"][0]["speakerLabel"] == "Speaker" and len(ws["facts"]) == 1


def test_resolve_rejects_unsupported_urls(client, owner):
    r = client.post("/api/v1/media/resolve", headers=owner["headers"], json={"url": "https://vimeo.com/1234"})
    assert r.status_code == 200 and r.json()["valid"] is False and r.json()["error"]
    d = client.post("/api/v1/media/resolve", headers=owner["headers"],
                    json={"url": "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345"}).json()
    assert d["valid"] is True and d["isFolder"] is True and "Google" in d["error"]
