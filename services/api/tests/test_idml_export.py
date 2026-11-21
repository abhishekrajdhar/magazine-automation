"""IDML package written straight from the layout contract (no InDesign)."""

import copy
import io
import json
import zipfile
from xml.etree import ElementTree as ET

import pytest
from PIL import Image

from app.config import REPO_ROOT
from app.services.contract import build_contract, validate_contract
from app.services.house_style import house_profile
from app.services.renderers import render_idml, validate_idml
from tests.conftest import run_jobs

EXAMPLE = REPO_ROOT / "packages" / "contracts" / "layout-contract.example.json"
W, H = 595.28, 841.89


def example():
    return json.loads(EXAMPLE.read_text())


def _jpeg(w=400, h=300) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (40, 90, 160)).save(buf, "JPEG")
    return buf.getvalue()


def _parts(idml: bytes) -> dict[str, ET.Element]:
    with zipfile.ZipFile(io.BytesIO(idml)) as z:
        return {n: ET.fromstring(z.read(n)) for n in z.namelist() if n.endswith(".xml")}


def _anchors(item: ET.Element) -> list[tuple[float, float]]:
    return [tuple(float(v) for v in p.get("Anchor").split()) for p in item.iter("PathPointType")]


def test_package_layout_and_structure():
    res = render_idml(example(), lambda aid: _jpeg(), name="eGov Summit")
    with zipfile.ZipFile(io.BytesIO(res.package)) as z:
        names = z.namelist()
        assert names[0] == "eGov-Summit.idml" and "README.txt" in names
        assert [n for n in names if n.startswith("Links/")] == ["Links/ast_0001.jpg"]
        readme = z.read("README.txt").decode()
    assert "not a native .indd" in readme and "Relink to Folder" in readme
    with zipfile.ZipFile(io.BytesIO(res.idml)) as z:
        assert z.namelist()[0] == "mimetype" and z.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        assert z.read("mimetype") == b"application/vnd.adobe.indesign-idml-package"
    assert validate_idml(res.idml) == []
    assert res.page_count == 1 and res.linked_images == 1
    assert res.frame_count == len(example()["pages"][0]["frames"])


def test_styles_swatches_and_live_text():
    c = example()
    parts = _parts(render_idml(c, lambda aid: _jpeg()).idml)
    styles = {e.get("Name"): e for e in parts["Resources/Styles.xml"].iter("ParagraphStyle")}
    for p in c["styles"]["paragraph"]:
        st = styles[p["name"]]
        assert float(st.get("PointSize")) == pytest.approx(p["size_pt"])
        assert st.find("Properties/AppliedFont").text == p["font_family"]
        assert float(st.find("Properties/Leading").text) == pytest.approx(p["leading_pt"])
    colours = {e.get("Name"): e for e in parts["Resources/Graphic.xml"].iter("Color")}
    for s in c["styles"]["colors"]:
        assert colours[s["name"]].get("Space") == "CMYK"
    text = "".join(e.text or "" for n, t in parts.items() if n.startswith("Stories/") for e in t.iter("Content"))
    headline = next(f for f in c["pages"][0]["frames"] if f.get("role") == "headline")
    assert headline["content"] in text
    labels = {kv.get("Value") for n, t in parts.items() if n.startswith("Spreads/") for kv in t.iter("KeyValuePair")}
    assert {f.get("label") or f.get("role") for f in c["pages"][0]["frames"]} <= labels


def test_facing_pages_pair_into_spreads():
    c = example()
    c["pages"] = [copy.deepcopy(c["pages"][0]) for _ in range(5)]
    for i, p in enumerate(c["pages"]):
        p["page_number"] = i + 1
        for f in p["frames"]:
            f["id"] = f"p{i + 1}_{f['id']}"
    res = render_idml(c, lambda aid: _jpeg())
    spreads = [t.find("Spread") for n, t in sorted(_parts(res.idml).items()) if n.startswith("Spreads/")]
    spreads.sort(key=lambda s: int(s.find("Page").get("Name")))
    assert [[pg.get("Name") for pg in s.iter("Page")] for s in spreads] == [["1"], ["2", "3"], ["4", "5"]]
    assert [s.get("BindingLocation") for s in spreads] == ["0", "1", "1"]
    left, right = list(spreads[1].iter("Page"))
    assert float(left.get("ItemTransform").split()[4]) == pytest.approx(-W, abs=0.01)   # left page ends at the spine
    assert float(right.get("ItemTransform").split()[4]) == 0
    assert res.page_count == 5 and validate_idml(res.idml) == []


def test_image_crop_matches_the_preview_renderer():
    c = example()
    page = c["pages"][0]
    page["page_number"] = 1
    page["frames"] = [{"id": "hero", "kind": "image", "role": "hero_image", "label": "Hero",
                       "bounds_pt": [100, 100, 300, 400],      # 300 wide, 200 high on a right-hand page
                       "image": {"asset_id": "ast_0001", "fitting": "fill_proportionally", "scale": 1,
                                 "offset_x": -1, "offset_y": 1}}]
    res = render_idml(c, lambda aid: _jpeg(400, 400))
    spread = next(t for n, t in _parts(res.idml).items() if n.startswith("Spreads/"))
    rect = next(e for e in spread.iter("Rectangle"))
    xs, ys = zip(*_anchors(rect))
    assert (min(xs), max(xs)) == pytest.approx((100, 400)) and (min(ys), max(ys)) == pytest.approx((100 - H / 2, 300 - H / 2))
    s, _, _, s2, tx, ty = (float(v) for v in rect.find("Image").get("ItemTransform").split())
    assert s == s2 == pytest.approx(0.75)                       # 400 px fills the 300 pt width
    assert tx == pytest.approx(100)                             # offset_x -1: left edge of the picture
    assert ty == pytest.approx(100 - H / 2 - 100)               # offset_y +1: bottom of the picture
    assert rect.find("Image/Link").get("LinkResourceURI") == "file:Links/ast_0001.jpg"


def test_full_bleed_frames_reach_the_bleed_but_not_across_the_spine():
    c = example()
    c["document"]["bleed_pt"] = 9
    frame = {"id": "bg", "kind": "image", "bounds_pt": [0, 0, H, W], "image": {"asset_id": "ast_0001"}}
    c["pages"] = [{**copy.deepcopy(c["pages"][0]), "page_number": n, "frames": [{**frame, "id": f"bg{n}"}]} for n in (2, 3)]
    spread = next(t for n, t in _parts(render_idml(c, lambda aid: _jpeg()).idml).items() if n.startswith("Spreads/"))
    left, right = [list(zip(*_anchors(r))) for r in spread.iter("Rectangle")]
    assert (min(left[0]), max(left[0])) == pytest.approx((-W - 9, 0))       # verso: bleeds outside, stops at the spine
    assert (min(right[0]), max(right[0])) == pytest.approx((0, W + 9))
    assert (min(left[1]), max(left[1])) == pytest.approx((-H / 2 - 9, H / 2 + 9))


def test_missing_and_placeholder_assets_leave_an_empty_frame():
    res = render_idml(example(), lambda aid: None)
    assert res.linked_images == 0 and any("no stored file" in w for w in res.warnings)
    spread = next(t for n, t in _parts(res.idml).items() if n.startswith("Spreads/"))
    assert not list(spread.iter("Image"))
    res = render_idml(example(), lambda aid: _jpeg(), placeholders={"ast_0001"})
    assert res.linked_images == 0 and any("demo placeholder" in w for w in res.warnings)


def test_editor_markup_becomes_paragraph_styles():
    from app.services.page_builder import PageContent, build_elements
    from app.services.template_specs import SPEC_BY_ID

    profile = house_profile()
    art = {"id": "art_1", "type": "event_report", "kicker": "Event report", "headline": "Rails & <Registries>",
           "subheadline": "Deck", "intro": "Intro text.", "status": "approved", "captions": {}, "body": []}
    content = PageContent(kicker=art["kicker"], headline=art["headline"], deck=art["subheadline"],
                          body_chunks=["^ Intro text.\n\n## Registries\n\nBody copy.\n\nQ: Why now?\n\n> A quoted line."],
                          images=["ast_1"], captions=["Stage"])
    els = build_elements(SPEC_BY_ID["tpl_report_hero"], profile, 1, content, "event_report")
    pages = [{"id": "pg1", "pageType": "event_report", "templateId": "tpl_report_hero", "articleId": "art_1",
              "elements": els, "editorialStatus": "approved"}]
    markup: dict = {}
    contract = build_contract({"id": "prj_1", "title": "eGov", "issueNumber": "11", "publicationDate": "2026-11-15"},
                              profile, pages, {"art_1": art},
                              {"ast_1": {"id": "ast_1", "fileName": "a.jpg", "widthPx": 3000, "heightPx": 2000}},
                              markup_out=markup)
    assert validate_contract(contract) == []
    res = render_idml(contract, lambda aid: _jpeg(), markup=markup)
    parts = _parts(res.idml)
    applied = {}
    for n, t in parts.items():
        if n.startswith("Stories/"):
            for pr in t.iter("ParagraphStyleRange"):
                applied["".join(e.text or "" for e in pr.iter("Content"))] = (
                    pr.get("AppliedParagraphStyle"), pr.find("CharacterStyleRange").get("AppliedCharacterStyle"))
    assert applied["Registries"][0] == "ParagraphStyle/PF Subhead"
    assert applied["Q: Why now?"][0] == "ParagraphStyle/PF Question"
    assert applied["Intro text."][0].endswith(" Lead")
    assert applied["A quoted line."][1] == "CharacterStyle/PF Inline Quote"
    assert "Rails & <Registries>" in applied                    # escaped in the XML, intact when read back
    lead = next(e for e in parts["Resources/Styles.xml"].iter("ParagraphStyle") if e.get("Name", "").endswith(" Lead"))
    assert lead.get("DropCapLines") == "3" and lead.get("FirstLineIndent") == "0"
    assert not any("## " in k or k.startswith("^ ") for k in applied)


def test_validator_catches_a_broken_package():
    res = render_idml(example(), lambda aid: _jpeg())
    src = zipfile.ZipFile(io.BytesIO(res.idml))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for n in src.namelist():
            if n.startswith("Stories/") and n == sorted(x for x in src.namelist() if x.startswith("Stories/"))[0]:
                continue
            z.writestr(n, src.read(n))
    problems = validate_idml(out.getvalue())
    assert any("missing part" in p for p in problems) and any("missing story" in p for p in problems)


def _project_with_pages(client, h, approve: bool):
    """`approve=False` leaves the first page's sign-off pending (the article itself is always approved)."""
    proj = client.post("/api/v1/projects", headers=h, json={"title": "IDML test", "targetPageCount": 4}).json()
    art = client.post(f"/api/v1/projects/{proj['id']}/articles", headers=h, json={
        "type": "event_report", "headline": "Rails", "intro": "Intro",
        "body": [{"id": "b", "kind": "paragraph", "text": "Body copy for the page."}]}).json()
    client.post(f"/api/v1/articles/{art['id']}/approve", headers=h)
    plan = client.post(f"/api/v1/projects/{proj['id']}/plan/recommend", headers=h, json={}).json()
    for i, p in enumerate(plan["pages"]):
        p["editorialStatus"] = "approved" if (approve or i) else "pending"
    client.put(f"/api/v1/projects/{proj['id']}/pages", headers=h, json={"pages": plan["pages"]})
    return proj


def test_idml_export_end_to_end_without_a_bridge(client, owner):
    h = owner["headers"]
    proj = _project_with_pages(client, h, approve=False)
    r = client.post(f"/api/v1/projects/{proj['id']}/exports", headers=h, json={"format": "idml"})
    assert r.status_code == 202, r.text
    rec = r.json()
    assert rec["status"] == "queued" and rec["renderer"] == "idml" and rec["fileName"].endswith("-indesign-idml.zip")
    run_jobs()
    rec = client.get(f"/api/v1/exports/{rec['id']}", headers=h).json()
    assert rec["status"] == "complete", rec
    assert "Editable IDML package" in rec["message"] and "unapproved" in rec["message"]
    dl = client.get(f"/api/v1/exports/{rec['id']}/download", headers=h)
    assert dl.status_code == 200 and dl.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(dl.content)) as z:
        idml = z.read(next(n for n in z.namelist() if n.endswith(".idml")))
        assert "NOT approved" in z.read("README.txt").decode()
    assert validate_idml(idml) == []
    text = "".join(e.text or "" for n, t in _parts(idml).items() if n.startswith("Stories/") for e in t.iter("Content"))
    assert "Rails" in text and "Contents" in text      # a four-page plan is cover, contents and furniture
    # an editable working file never marks the issue as published
    assert client.get(f"/api/v1/projects/{proj['id']}", headers=h).json()["status"] != "exported"
