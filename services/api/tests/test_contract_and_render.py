import copy
import io
import json

import pymupdf
from PIL import Image

from app.config import REPO_ROOT
from app.services.contract import BUNDLED, build_contract, validate_contract
from app.services.house_style import house_profile
from app.services.renderers import PRODUCER, render_contract

EXAMPLE = REPO_ROOT / "packages" / "contracts" / "layout-contract.example.json"


def example():
    return json.loads(EXAMPLE.read_text())


def test_example_contract_is_valid():
    assert validate_contract(example()) == []


def test_bundled_schema_matches_shared_schema():
    shared = REPO_ROOT / "packages" / "contracts" / "layout-contract.schema.json"
    assert json.loads(BUNDLED.read_text()) == json.loads(shared.read_text())


def test_invalid_contract_reports_paths():
    bad = example()
    bad["contract_version"] = "2.0"
    bad["pages"][0]["page_type"] = "poster"
    del bad["document"]["margins"]
    errors = validate_contract(bad)
    paths = {e["path"] for e in errors}
    assert "contract_version" in paths and "document" in paths and "pages/0/page_type" in paths


def _jpeg(w=400, h=300) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (40, 90, 160)).save(buf, "JPEG")
    return buf.getvalue()


def test_render_digital_pdf():
    res = render_contract(example(), lambda aid: _jpeg() if aid == "ast_0001" else None)
    doc = pymupdf.open(stream=res.pdf, filetype="pdf")
    assert doc.page_count == 1 == res.page_count
    assert abs(doc[0].rect.width - 595.28) < 0.5 and abs(doc[0].rect.height - 841.89) < 0.5
    assert doc.metadata["producer"] == PRODUCER
    assert "not Adobe InDesign" in doc.metadata["creator"]
    text = doc[0].get_text()
    assert "Building the Rails" in text


def test_render_print_pdf_has_bleed_and_marks():
    c = example()
    c["pages"] = [copy.deepcopy(c["pages"][0]) for _ in range(3)]
    for i, p in enumerate(c["pages"]):
        p["page_number"] = i + 1
    c["pages"][1]["approved"] = False
    res = render_contract(c, lambda aid: None, mode="print")
    doc = pymupdf.open(stream=res.pdf, filetype="pdf")
    assert doc.page_count == 3
    page = doc[0]
    expected = 595.28 + 2 * (9 + 36)
    assert abs(page.rect.width - expected) < 0.5
    assert abs(page.trimbox.width - 595.28) < 0.5
    assert "NOT APPROVED" in doc[1].get_text()  # slug + watermark on the unapproved page
    assert any("missing" in w.lower() for w in res.warnings)


def test_build_contract_from_pages_validates():
    from app.services.page_builder import PageContent, build_elements
    from app.services.template_specs import SPEC_BY_ID

    profile = house_profile()
    art = {"id": "art_1", "type": "event_report", "kicker": "Event report · Summit", "headline": "Rails for Digital Governance",
           "subheadline": "Deck", "intro": "Intro text.", "status": "approved", "captions": {},
           "body": [{"id": "b", "kind": "subhead", "text": "Registries"}, {"id": "c", "kind": "paragraph", "text": "Body copy."}]}
    content = PageContent(kicker=art["kicker"], headline=art["headline"], deck=art["subheadline"],
                          body_chunks=["^ Intro text.\n\n## Registries\n\nBody copy."], images=["ast_1"], captions=["Stage"])
    els = build_elements(SPEC_BY_ID["tpl_report_hero"], profile, 1, content, "event_report")
    assert any(e.get("dynamic") == "folio" for e in els)
    toc_els = build_elements(SPEC_BY_ID["tpl_toc_classic"], profile, 2, PageContent(), "toc")
    pages = [{"id": "pg1", "pageType": "event_report", "templateId": "tpl_report_hero", "articleId": "art_1",
              "elements": els, "editorialStatus": "approved"},
             {"id": "pg2", "pageType": "toc", "templateId": "tpl_toc_classic", "elements": toc_els,
              "editorialStatus": "approved"}]
    markup: dict = {}
    contract = build_contract({"id": "prj_1", "title": "eGov — Summit Special", "issueNumber": "11",
                               "publicationDate": "2026-11-15"}, profile, pages, {"art_1": art},
                              {"ast_1": {"id": "ast_1", "fileName": "a.jpg", "widthPx": 3000, "heightPx": 2000}},
                              markup_out=markup)
    assert validate_contract(contract) == []
    p1 = contract["pages"][0]
    assert p1["approved"] is True and p1["master"] == "B-Frames"
    ids = [f["id"] for p in contract["pages"] for f in p["frames"]]
    assert len(ids) == len(set(ids))  # positional element ids are made unique per page
    body = next(f for f in p1["frames"] if f["role"] == "body")
    assert body["content"].startswith("Intro text.") and "## " not in body["content"] and body["columns"] == 3
    assert markup[body["id"]].startswith("^ ")
    folio = next(f for f in p1["frames"] if f["role"] == "folio")
    assert folio["content"].endswith("|  1") and "eGov" in folio["content"]
    toc = next(f for f in contract["pages"][1]["frames"] if f["label"] == "Contents list")
    assert "01   EVENT REPORT" in toc["content"] and "Rails for Digital Governance" in toc["content"]
    assert contract["assets"][0]["file"] == "assets/ast_1.jpg"
    styles = {s["name"] for s in contract["styles"]["paragraph"]}
    assert {"PF Body", "PF Headline", "PF Caption"} <= styles
    res = render_contract(contract, lambda aid: _jpeg(), markup=markup)
    assert res.page_count == 2
    text = pymupdf.open(stream=res.pdf, filetype="pdf")[0].get_text()
    assert "Registries" in text and "## " not in text
