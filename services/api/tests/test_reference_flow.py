"""End-to-end: upload sample reference -> analysis job -> profile -> templates -> plan -> pages -> preflight -> exports."""

import io
import json
import zipfile

import pymupdf
from PIL import Image

from tests.conftest import SAMPLE_PDF, run_jobs


def _upload_reference(client, h):
    r = client.post("/api/v1/references", headers=h,
                    files={"file": ("pressflow-sample-reference.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
                    data={"title": "eGov Horizons (sample)"})
    assert r.status_code == 201, r.text
    return r.json()


def test_reference_upload_validation(client, owner):
    h = owner["headers"]
    r = client.post("/api/v1/references", headers=h, files={"file": ("fake.pdf", b"hello world", "application/pdf")})
    assert r.status_code == 415
    r = client.post("/api/v1/references", headers=h,
                    files={"file": ("x.pdf", SAMPLE_PDF.read_bytes(), "application/pdf"),
                           "designSource": ("x.indd", b"not an indesign file at all", "application/octet-stream")})
    assert r.status_code == 415


def test_full_reference_to_export_flow(client, owner):
    h = owner["headers"]
    up = _upload_reference(client, h)
    ref = up["reference"]
    assert ref["status"] == "analysing" and ref["pageCount"] == 12 and ref["hasSourcePdf"] and not ref["hasInddSource"]
    assert run_jobs() >= 1
    job = client.get(f"/api/v1/jobs/{up['jobId']}", headers=h).json()
    assert job["status"] == "succeeded" and job["progress"] == 100

    ref = client.get(f"/api/v1/references/{ref['id']}", headers=h).json()
    assert ref["status"] == "analysed" and ref["analysis"]["analyser"] == "pymupdf" and ref["designProfileId"]
    pages = client.get(f"/api/v1/references/{ref['id']}/pages", headers=h).json()
    assert len(pages) == 12 and pages[0]["layoutType"] == "cover"
    assert pages[0]["imageUrl"].endswith("/pages/1/image")

    img = client.get(f"/api/v1/references/{ref['id']}/pages/2/image?scale=0.5", headers=h)
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(img.content)).size[0] in (297, 298)
    assert client.get(f"/api/v1/references/{ref['id']}/pages/2/image?scale=0.5", headers=h).content == img.content

    # manual correction
    c = client.patch(f"/api/v1/references/{ref['id']}/pages/6", headers=h, json={"layoutType": "event_report"})
    assert c.status_code == 200 and c.json()["corrected"] is True and c.json()["layoutType"] == "event_report"
    rj = client.post(f"/api/v1/references/{ref['id']}/pages/6/reanalyse", headers=h)
    assert rj.status_code == 202
    run_jobs()
    p6 = [p for p in client.get(f"/api/v1/references/{ref['id']}/pages", headers=h).json() if p["pageNumber"] == 6][0]
    assert p6["layoutType"] == "event_report" and p6["corrected"] is True  # correction survives re-analysis

    # design profile: patch -> overrides + version; approve
    pid = ref["designProfileId"]
    prof = client.get(f"/api/v1/design-profiles/{pid}", headers=h).json()
    assert prof["grid"]["columns"] == 3 and prof["status"] == "draft" and prof["version"] == 1
    patched = client.patch(f"/api/v1/design-profiles/{pid}", headers=h,
                           json={"grid": {"gutterPt": 12}, "typography": {"headline": {"size": 32}}})
    assert patched.status_code == 200, patched.text
    pj = patched.json()
    assert pj["version"] == 2 and set(pj["overrides"]) == {"grid.gutterPt", "typography.headline.size"}
    assert pj["grid"]["columns"] == 3 and pj["typography"]["headline"]["role"] == "headline"
    bad = client.patch(f"/api/v1/design-profiles/{pid}", headers=h, json={"grid": {"columns": "three"}})
    assert bad.status_code == 422
    ap = client.post(f"/api/v1/design-profiles/{pid}/approve", headers=h).json()
    assert ap["status"] == "approved" and ap["approvedBy"] == owner["user"]["id"]

    # templates
    t = client.post("/api/v1/templates/derive", headers=h, json={"referenceId": ref["id"], "pageNumber": 4})
    assert t.status_code == 201, t.text
    tpl = t.json()
    assert tpl["source"] == "reference" and tpl["pageType"] == "event_report"
    assert tpl["id"] == f"tpl_ref_{ref['id']}_p4" and tpl["name"] == "Event report — reference p.4"
    roles = {s["role"] for s in tpl["slots"]}
    assert {"headline", "body", "hero_image", "caption"} <= roles and "folio" not in roles
    again = client.post("/api/v1/templates/derive", headers=h, json={"referenceId": ref["id"], "pageNumber": 4})
    assert again.status_code == 200 and again.json()["id"] == tpl["id"]  # idempotent
    all_t = client.get("/api/v1/templates", headers=h).json()
    builtin_ids = {x["id"] for x in all_t if x["source"] == "builtin"}
    assert len(builtin_ids) == 20 and {"tpl_report_hero", "tpl_toc_classic", "tpl_speakers_grid"} <= builtin_ids
    assert any(x["id"] == tpl["id"] for x in all_t)
    # profile-normalised built-ins: hero opener caption snaps to 2 of the profile's 3 columns
    t2 = client.get(f"/api/v1/templates?designProfileId={pid}", headers=h).json()
    hero = next(x for x in t2 if x["id"] == "tpl_report_hero")
    assert hero["columns"] == 3

    # project using the profile -> plan -> pages
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Summit special", "referenceId": ref["id"],
                                                            "targetPageCount": 12}).json()
    assert proj["designProfileId"] == pid
    art = client.post(f"/api/v1/projects/{proj['id']}/articles", headers=h, json={
        "type": "event_report", "headline": "Building the Rails", "subheadline": "Summit report", "intro": "Intro.",
        "body": [{"id": "b1", "kind": "paragraph", "text": "Delegates met to compare platforms. " * 40}]}).json()
    plan = client.post(f"/api/v1/projects/{proj['id']}/plan/recommend", headers=h, json={})
    assert plan.status_code == 200, plan.text
    plan = plan.json()
    assert plan["engine"] == "heuristic" and len(plan["pages"]) == 12 and plan["rationale"]
    types = [p["pageType"] for p in plan["pages"]]
    assert types[0] == "cover" and "toc" in types and "event_report" in types and types[-1] == "advertisement"
    assert {p["templateId"] for p in plan["pages"]} <= builtin_ids
    put = client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": plan["pages"]})
    assert put.status_code == 200, put.text
    # template ids: built-in, stored, or tpl_ref_<ref>_p<n> derived on the fly; anything else is rejected
    probe = [dict(plan["pages"][0], id=None, templateId=f"tpl_ref_{ref['id']}_p9")]
    assert client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": probe}).status_code == 200
    assert any(x["id"] == f"tpl_ref_{ref['id']}_p9" for x in client.get("/api/v1/templates", headers=h).json())
    bad_t = client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h,
                       json={"pages": [dict(plan["pages"][0], id=None, templateId="tpl_event_report_hero")]})
    assert bad_t.status_code == 422 and bad_t.json()["detail"]["templateIds"] == ["tpl_event_report_hero"]
    missing_ref = [dict(plan["pages"][0], id=None, templateId="tpl_ref_ref_nope_p1")]
    assert client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": missing_ref}).status_code == 422
    put = client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": plan["pages"]})
    assert put.status_code == 200, put.text
    saved = put.json()["pages"]
    assert len(saved) == 12
    # lock a page; it cannot be dropped by a PUT
    saved[0]["locked"] = True
    client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": saved})
    drop = client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": saved[1:]})
    assert drop.status_code == 409

    # preflight of current pages
    pf = client.post(f"/api/v1/projects/{proj['id']}/preflight", headers=h)
    assert pf.status_code == 200, pf.text
    codes = {i["code"] for i in pf.json()["issues"]}
    assert "unapproved_content" in codes and "missing_image" in codes

    # final output (pdf_print) is refused while the article is unapproved, unless forced
    pp = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "pdf_print"}).json()
    assert pp["status"] == "failed" and "unapproved" in pp["message"]

    # approve the article, then export pdf_digital (ReportLab preview)
    client.post(f"/api/v1/articles/{art['id']}/approve", headers=h)
    ex = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "pdf_digital"})
    assert ex.status_code == 202 and ex.json()["status"] == "queued" and ex.json()["renderer"] == "reportlab"
    run_jobs()
    rec = client.get(f"/api/v1/exports/{ex.json()['id']}", headers=h).json()
    assert rec["status"] == "complete", rec
    dl = client.get(rec["downloadUrl"], headers=h)
    assert dl.status_code == 200 and dl.headers["content-type"] == "application/pdf"
    assert int(dl.headers["content-length"]) == rec["sizeBytes"]
    doc = pymupdf.open(stream=dl.content, filetype="pdf")
    assert doc.page_count == 12 and "ReportLab" in doc.metadata["producer"]

    pp = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "pdf_print"}).json()
    assert pp["status"] == "queued"
    run_jobs()
    pdoc = pymupdf.open(stream=client.get(f"/api/v1/exports/{pp['id']}/download", headers=h).content, filetype="pdf")
    assert pdoc[0].rect.width > 595.28 + 18

    # previews / layout json / content package
    for fmt in ("page_previews", "layout_json", "content_package", "asset_archive"):
        r = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": fmt})
        assert r.status_code == 202, (fmt, r.text)
    run_jobs()
    exports = {e["format"]: e for e in client.get(f"/api/v1/projects/{proj['id']}/exports", headers=h).json()}
    z = zipfile.ZipFile(io.BytesIO(client.get(exports["page_previews"]["downloadUrl"], headers=h).content))
    assert len([n for n in z.namelist() if n.endswith(".png")]) == 12
    lj = json.loads(client.get(exports["layout_json"]["downloadUrl"], headers=h).content)
    assert lj["contract_version"] == "1.0" and len(lj["pages"]) == 12
    cz = zipfile.ZipFile(io.BytesIO(client.get(exports["content_package"]["downloadUrl"], headers=h).content))
    assert any(n.endswith(".md") for n in cz.namelist()) and "manifest.json" in cz.namelist()

    # invalid contract body is rejected
    bad = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h,
                      json={"format": "pdf_digital", "contract": {"contract_version": "1.0"}})
    assert bad.status_code == 422 and bad.json()["detail"]["errors"]


def test_llm_features_return_503_when_unconfigured(client, owner):
    h = owner["headers"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "No AI"}).json()
    r = client.post(f"/api/v1/projects/{proj['id']}/articles/generate", headers=h, json={"types": ["event_report"]})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "llm_not_configured"
    art = client.post(f"/api/v1/projects/{proj['id']}/articles", headers=h,
                      json={"type": "editorial", "headline": "H", "intro": "I"}).json()
    a = client.post(f"/api/v1/articles/{art['id']}/assist", headers=h, json={"action": "rewrite_headline"})
    assert a.status_code == 503
    v = client.post(f"/api/v1/articles/{art['id']}/verify", headers=h)  # deterministic: works without an LLM
    assert v.status_code == 200 and v.json()["engine"] == "deterministic"


def test_project_created_during_analysis_gets_the_profile(client, owner):
    """A project pointed at a reference that is still analysing is linked to its profile once analysis finishes."""
    h = owner["headers"]
    ref = _upload_reference(client, h)["reference"]
    proj = client.post("/api/v1/projects", headers=h, json={"title": "Early", "referenceId": ref["id"]}).json()
    assert proj["referenceId"] == ref["id"] and not proj.get("designProfileId")
    run_jobs()
    profile_id = client.get(f"/api/v1/references/{ref['id']}", headers=h).json()["designProfileId"]
    assert client.get(f"/api/v1/projects/{proj['id']}", headers=h).json()["designProfileId"] == profile_id
