"""ExtendScript checks that run without InDesign.

1. Syntax: ``node --check`` on both .jsx files (fed through stdin: Node refuses the .jsx extension).
2. ES3 hygiene: ASCII-only source, no ES5+ built-ins ExtendScript lacks.
3. Behaviour against tests/js/mock_indesign.js, a FAKE InDesign DOM. These tests exercise the
   script's own logic (args, validation, fonts, approval gate, shrink loop, report). They do not
   prove that real InDesign accepts every call - see docs/indesign.md "Testing status".
"""

from __future__ import annotations

import copy
import json
import re
import subprocess
from pathlib import Path

import pytest

from conftest import EXTENDSCRIPT_DIR, INDESIGN_DIR, NODE, example_contract

JSX_FILES = sorted(EXTENDSCRIPT_DIR.glob("*.jsx"))
MOCK = INDESIGN_DIR / "tests" / "js" / "mock_indesign.js"
RENDER = EXTENDSCRIPT_DIR / "pressflow-render.jsx"
needs_node = pytest.mark.skipif(NODE is None, reason="node is not installed")

ALL_FONTS = [["Minion Pro", "Regular"], ["Minion Pro", "Bold"], ["Minion Pro", "Italic"], ["Myriad Pro", "Regular"], ["Myriad Pro", "Semibold"]]


def test_both_jsx_files_exist():
    assert {p.name for p in JSX_FILES} == {"pressflow-render.jsx", "list-fonts.jsx"}


@needs_node
@pytest.mark.parametrize("jsx", JSX_FILES, ids=lambda p: p.name)
def test_node_check_syntax(jsx):
    proc = subprocess.run([NODE, "--check"], stdin=jsx.open("rb"), capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr


@pytest.mark.parametrize("jsx", JSX_FILES, ids=lambda p: p.name)
def test_es3_hygiene(jsx):
    src = jsx.read_text(encoding="utf-8")
    assert src.startswith("//@target indesign\n//@targetengine"), "use comment directives so node --check works"
    non_ascii = [(i, ch) for i, ch in enumerate(src) if ord(ch) > 127]
    assert not non_ascii, f"non-ASCII characters (write \\uXXXX escapes): {non_ascii[:5]}"
    code = re.sub(r"//[^\n]*|/\*.*?\*/", "", src, flags=re.S)
    code = re.sub(r'"(?:[^"\\\n]|\\.)*"', '""', code)
    for pattern, why in [
        (r"\blet\s", "let"), (r"\bconst\s", "const"), (r"=>", "arrow function"), (r"`", "template literal"),
        (r"\bJSON\.", "JSON builtin (use the polyfill)"), (r"\.forEach\(", "Array.forEach"), (r"\.map\(", "Array.map"),
        (r"\.filter\(", "Array.filter"), (r"Object\.keys", "Object.keys"), (r"Array\.isArray", "Array.isArray"),
        (r"\.trim\(\)", "String.trim"), (r"Date\.now", "Date.now"), (r"\.toISOString", "Date.toISOString"),
        (r",\s*[\]}]", "trailing comma"), (r"#target", "#target directive breaks node --check"),
    ]:
        assert not re.search(pattern, code), f"{jsx.name}: ES3/ExtendScript-incompatible construct: {why}"


# ---------------------------------------------------------------- mock-DOM behaviour


def run_mock(tmp_path: Path, contract: dict | None = None, *, outputs="indd,pdf_digital,pdf_print", fonts=None,
             extra_args: dict | None = None, via="arguments", template: dict | None = None, assets=True,
             preset_read_only: list | None = None) -> tuple[dict, dict]:
    work = tmp_path / "mock"
    (work / "assets/photos").mkdir(parents=True, exist_ok=True)
    if assets:
        (work / "assets/photos/ast_0001.jpg").write_bytes(b"fake")
    contract_path = work / "contract.json"
    contract_path.write_text(json.dumps(contract if contract is not None else example_contract()), encoding="utf-8")
    args = {"contractPath": str(contract_path), "assetRoot": str(work / "assets"), "outDir": str(work / "out"), "outputs": outputs, "jobId": "job_mock"}
    if template is not None:
        tpl = work / "approved.indt"
        tpl.write_text(json.dumps(template))
        args["templatePath"] = str(tpl)
    args.update(extra_args or {})
    scenario = {"jsxPath": str(RENDER), "tempDir": str(work), "fonts": ALL_FONTS if fonts is None else fonts,
                "presetReadOnly": preset_read_only or []}
    if via == "arguments":
        args_file = work / "render-args.json"
        args_file.write_text(json.dumps(args))
        scenario["arguments"] = [str(args_file)]
    else:
        scenario["scriptArgs"] = {k: str(v) for k, v in args.items()}
        scenario["serverName"] = True
    scen = work / "scenario.json"
    scen.write_text(json.dumps(scenario))
    proc = subprocess.run([NODE, str(MOCK), str(scen)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    mock = json.loads(proc.stdout)
    assert mock["unknownEnums"] == [], "script used enum members the mock does not know"
    report = json.loads((work / "out/report.json").read_text(encoding="utf-8"))
    assert json.loads(mock["result"]) == report, "script must return the report JSON"
    return report, mock


@needs_node
def test_mock_render_example_contract(tmp_path):
    report, mock = run_mock(tmp_path)
    assert report["ok"] is True and report["error"] is None and report["errors"] == []
    assert report["pages"] == 1 and report["overset"] == []
    assert report["substitutedFonts"] == [] and report["missingFonts"] == [] and report["missingLinks"] == []
    assert not [w for w in report["warnings"] if "could not" in w], report["warnings"]
    for key in ("indd", "pdf_digital", "pdf_print"):
        assert Path(report["outputs"][key]).is_file()
    calls = mock["calls"]
    exports = [c for c in calls if c["op"] == "exportFile"]
    digital, printed = exports
    assert digital["preset"]["name"] == "[High Quality Print]"
    # Print PDF: preset cloned from [PDF/X-4:2008] with bleed + crop marks forced on.
    assert printed["preset"]["standardsCompliance"] == "PDFX4_2008"
    assert printed["preset"]["cropMarks"] is True and printed["preset"]["useDocumentBleedWithPDF"] is True
    assert calls[-1] == {"op": "close", "opt": "SaveOptions.NO"}
    # Every contract text/image frame was created, plus folio frames on both master pages.
    assert sum(1 for c in calls if c["op"] == "add" and c["type"] == "textFrame" and not c["master"]) == 2
    assert sum(1 for c in calls if c["op"] == "add" and c["type"] == "textFrame" and c["master"]) == 2
    assert [c["option"] for c in calls if c["op"] == "fit"] == ["FitOptions.FILL_PROPORTIONALLY", "FitOptions.CENTER_CONTENT"]
    assert any(c["op"] == "add" and c["type"] == "paragraphStyle" and c["name"] == "PF Headline" for c in calls)
    log = (Path(report["outputs"]["indd"]).parent / "render.log").read_text()
    assert "shrink_to_fit" in log  # the example headline needs shrinking under the mock's text model


@needs_node
def test_mock_print_pdf_fails_loudly_if_crop_marks_cannot_be_forced(tmp_path):
    report, mock = run_mock(tmp_path, preset_read_only=["cropMarks"])
    assert report["ok"] is False and "print PDF export failed" in report["error"] and "cropMarks" in report["error"]
    assert report["outputs"]["pdf_print"] is None and report["outputs"]["pdf_digital"]
    assert not [c for c in mock["calls"] if c["op"] == "exportFile" and c["path"].endswith("-print.pdf")]


@needs_node
def test_mock_font_substitution_is_reported(tmp_path):
    fonts = [["Times New Roman", "Regular"], ["Times New Roman", "Bold"], ["Times New Roman", "Italic"], ["Arial", "Regular"], ["Arial", "Bold"]]
    report, _ = run_mock(tmp_path, fonts=fonts, outputs="indd")
    subs = {s["requested"]: s["used"] for s in report["substitutedFonts"]}
    assert subs["Minion Pro Bold"] == "Times New Roman Bold"
    assert subs["Minion Pro Italic"] == "Times New Roman Italic"
    assert subs["Myriad Pro Regular"] == "Arial Regular"
    assert subs["Myriad Pro Semibold"] == "Arial Bold"  # fallback_family Helvetica-Bold -> Arial Bold
    assert "Minion Pro Bold" in report["missingFonts"]
    assert report["ok"] is True


@needs_node
def test_mock_unapproved_page_blocks_pdf_but_keeps_indd(tmp_path):
    contract = example_contract()
    contract["pages"][0]["approved"] = False
    report, mock = run_mock(tmp_path, contract)
    assert report["ok"] is False and "not approved" in report["error"]
    assert report["unapprovedPages"] == [12] and report["blockedOutputs"] == ["pdf_digital", "pdf_print"]
    assert report["outputs"]["indd"] and Path(report["outputs"]["indd"]).is_file()
    assert report["outputs"]["pdf_digital"] is None and report["outputs"]["pdf_print"] is None
    assert not [c for c in mock["calls"] if c["op"] == "exportFile"]


@needs_node
def test_mock_missing_approved_flag_counts_as_unapproved(tmp_path):
    contract = example_contract()
    del contract["pages"][0]["approved"]
    report, _ = run_mock(tmp_path, contract, outputs="pdf_digital")
    assert report["ok"] is False and report["unapprovedPages"] == [12]


@needs_node
def test_mock_force_exports_unapproved(tmp_path):
    contract = example_contract()
    contract["pages"][0]["approved"] = False
    report, _ = run_mock(tmp_path, contract, extra_args={"force": "true"})
    assert report["ok"] is True and report["outputs"]["pdf_print"]
    assert any("force=true" in w for w in report["warnings"])


@needs_node
def test_mock_indd_only_with_unapproved_pages_is_ok(tmp_path):
    contract = example_contract()
    contract["pages"][0]["approved"] = False
    report, _ = run_mock(tmp_path, contract, outputs="indd")
    assert report["ok"] is True and report["outputs"]["indd"]


@needs_node
def test_mock_overset_is_collected(tmp_path):
    contract = example_contract()
    contract["pages"][0]["frames"][1]["content"] = "A very long headline " * 12
    report, _ = run_mock(tmp_path, contract, outputs="indd")
    assert report["overset"] == [{"page": 12, "frameId": "f2"}]
    assert any("still overset after shrinking to 85%" in w for w in report["warnings"])


@needs_node
def test_mock_grow_frame_uses_auto_sizing(tmp_path):
    contract = example_contract()
    contract["pages"][0]["frames"][1]["fit"] = "grow_frame"
    contract["pages"][0]["frames"][1]["content"] = "A very long headline " * 12
    report, _ = run_mock(tmp_path, contract, outputs="indd")
    assert report["overset"] == []


@needs_node
def test_mock_missing_asset_is_reported(tmp_path):
    report, _ = run_mock(tmp_path, outputs="indd", assets=False)
    assert report["missingLinks"][0]["frameId"] == "f1" and report["missingLinks"][0]["reason"] == "file not found"


@needs_node
def test_mock_unsafe_asset_path_is_not_placed(tmp_path):
    contract = example_contract()
    contract["assets"][0]["file"] = "../../etc/passwd"
    report, mock = run_mock(tmp_path, contract, outputs="indd")
    assert "unsafe asset path" in report["missingLinks"][0]["reason"]
    assert not [c for c in mock["calls"] if c["op"] == "place"]


@needs_node
def test_mock_invalid_contract_still_writes_report(tmp_path):
    contract = example_contract()
    contract["contract_version"] = "2.0"
    contract["pages"][0]["frames"][0]["bounds_pt"] = [0, 0, 1]
    report, _ = run_mock(tmp_path, contract)
    assert report["ok"] is False
    assert "unsupported contract_version" in report["error"] and "bounds_pt must be 4 numbers" in report["error"]
    assert report["outputs"] == {"indd": None, "pdf_digital": None, "pdf_print": None}


@needs_node
def test_mock_server_style_script_args(tmp_path):
    report, mock = run_mock(tmp_path, outputs="indd", via="scriptArgs")
    assert report["ok"] is True and report["jobId"] == "job_mock"
    assert {"op": "scriptArgs.clear"} in mock["calls"]


@needs_node
def test_mock_template_reuses_existing_styles_and_masters(tmp_path):
    template = {"paragraphStyles": ["PF Headline"], "groupedParagraphStyles": ["PF Body"], "colors": ["PF Ink"], "masters": ["A-Article"]}
    report, mock = run_mock(tmp_path, outputs="indd", template=template)
    assert report["ok"] is True and report["templateUsed"].endswith("approved.indt")
    added = {(c["type"], c.get("name")) for c in mock["calls"] if c["op"] == "add"}
    assert ("paragraphStyle", "PF Headline") not in added and ("paragraphStyle", "PF Deck") in added
    assert ("paragraphStyle", "PF Body") not in added  # found inside a style group
    assert ("color", "PF Ink") not in added and ("color", "PF Accent") in added
    # The template's master is reused: no folio frames are added on master pages.
    assert not [c for c in mock["calls"] if c["op"] == "add" and c["type"] == "textFrame" and c["master"]]


@needs_node
def test_mock_page_number_gap_creates_section(tmp_path):
    contract = example_contract()
    p2 = copy.deepcopy(contract["pages"][0])
    p2["page_number"] = 20
    p2["frames"] = []
    contract["pages"].append(p2)
    report, mock = run_mock(tmp_path, contract, outputs="indd")
    assert report["pages"] == 2
    sections = [c for c in mock["calls"] if c["op"] == "add" and c["type"] == "section"]
    assert sections and sections[0]["props"] == {"continueNumbering": False, "pageNumberStart": 20}


@needs_node
def test_mock_missing_contract_file(tmp_path):
    work = tmp_path / "w"
    work.mkdir()
    args_file = work / "args.json"
    args_file.write_text(json.dumps({"contractPath": str(work / "nope.json"), "outDir": str(work / "out")}))
    scen = work / "s.json"
    scen.write_text(json.dumps({"jsxPath": str(RENDER), "arguments": [str(args_file)], "tempDir": str(work), "fonts": []}))
    proc = subprocess.run([NODE, str(MOCK), str(scen)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    report = json.loads((work / "out/report.json").read_text())
    assert report["ok"] is False and "File not found" in report["error"]
