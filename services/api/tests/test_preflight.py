import json

from app.config import REPO_ROOT
from app.services.contract import validate_contract
from app.services.preflight import AssetInfo, PreflightContext, run_preflight

EXAMPLE = REPO_ROOT / "packages" / "contracts" / "layout-contract.example.json"
LONG = " ".join(["Delegates compared notes on registries, procurement and the cost of maintaining public platforms."] * 120)


def contract():
    c = json.loads(EXAMPLE.read_text())
    page = c["pages"][0]
    page["page_number"] = 1
    del page["caption"]
    page["frames"] += [
        {"id": "f_empty", "kind": "text", "role": "deck", "bounds_pt": [480, 42, 500, 547], "paragraph_style": "PF Deck",
         "content": ""},
        {"id": "f_over", "kind": "text", "role": "body", "bounds_pt": [700, 42, 760, 300], "paragraph_style": "PF Body",
         "content": LONG},
        {"id": "f_noimg", "kind": "image", "role": "image", "bounds_pt": [100, 400, 200, 547]},
        {"id": "f_out", "kind": "rect", "bounds_pt": [-50, -50, 10, 10]},
    ]
    p2 = json.loads(json.dumps(page))
    p2["page_number"] = 3  # gap at 2
    p2["approved"] = False
    p2["caption"] = "A caption"
    c["pages"].append(p2)
    return c


def codes(issues):
    return {i["code"] for i in issues}


def test_preflight_finds_expected_issues():
    c = contract()
    assert validate_contract(c) == []
    ctx = PreflightContext(
        profile_page=(612.0, 792.0),  # US Letter profile vs A4 document
        assets={"ast_0001": AssetInfo(exists=True, width_px=800, height_px=533)},
        article_status={"art_summit_report": "in_review"},
        bridge_fonts=["Myriad Pro Regular", "Myriad Pro Semibold"],  # no Minion Pro
    )
    issues, notes = run_preflight(c, ctx)
    found = codes(issues)
    for expected in ("page_size_mismatch", "page_numbering", "empty_frame", "overset_text", "missing_image",
                     "low_resolution", "unapproved_content", "font_substitution", "layout_overflow",
                     "missing_caption"):
        assert expected in found, expected
    over = next(i for i in issues if i["code"] == "overset_text")
    assert "Approximate" in over["message"] and over["fix"] == "fit_text"
    low = [i for i in issues if i["code"] == "low_resolution"]
    assert low and low[0]["severity"] == "error"  # 800 px across 595 pt = ~97 ppi
    fonts = [i for i in issues if i["code"] == "font_substitution"]
    assert any("Minion Pro" in i["message"] for i in fonts)
    assert not any("Myriad Pro" in i["message"] for i in fonts)
    assert any("approximate" in n.lower() for n in notes)
    # page 3 has a caption -> missing_caption only reported for page 1
    assert {i["pageNumber"] for i in issues if i["code"] == "missing_caption"} == {1}


def test_preflight_clean_contract_and_broken_asset():
    c = json.loads(EXAMPLE.read_text())
    c["pages"][0]["page_number"] = 1
    ctx = PreflightContext(profile_page=(595.28, 841.89),
                           assets={"ast_0001": AssetInfo(exists=True, width_px=4000, height_px=2667)},
                           article_status={"art_summit_report": "approved"}, bridge_fonts=None)
    issues, notes = run_preflight(c, ctx)
    assert "low_resolution" not in codes(issues)
    assert "page_size_mismatch" not in codes(issues)
    assert "unapproved_content" not in codes(issues)
    assert any("font availability was not verified" in n for n in notes)
    ctx.assets["ast_0001"] = AssetInfo(exists=False)
    issues, _ = run_preflight(c, ctx)
    assert "broken_asset" in codes(issues)


def test_demo_placeholders_are_one_info_issue():
    c = json.loads(EXAMPLE.read_text())
    c["pages"][0]["page_number"] = 1
    page2 = json.loads(json.dumps(c["pages"][0]))
    page2["page_number"] = 2
    c["pages"].append(page2)
    ctx = PreflightContext(profile_page=(595.28, 841.89),
                           assets={"ast_0001": AssetInfo(exists=False, width_px=4000, height_px=2667, simulated=True)},
                           article_status={"art_summit_report": "approved"})
    issues, _ = run_preflight(c, ctx)
    assert "broken_asset" not in codes(issues)
    agg = [i for i in issues if i["code"] == "missing_image" and i["severity"] == "info"]
    assert len(agg) == 1 and agg[0]["message"].startswith("2 placed images are demo placeholders")
    ctx.assets["ast_0001"] = AssetInfo(exists=False, simulated=False)  # real asset without a file: still an error
    issues, _ = run_preflight(c, ctx)
    assert sum(1 for i in issues if i["code"] == "broken_asset") == 2
