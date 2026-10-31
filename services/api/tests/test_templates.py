"""Built-in template IDs and geometry must match the frontend (apps/web/src/lib/templates/specs.ts is the source of truth)."""

import json
import re

import pytest

from app.config import REPO_ROOT
from app.services.template_specs import BUILTIN_IDS
from app.services.templates import builtin_templates, derive_template, parse_ref_template_id, ref_template_id

SPECS_TS = REPO_ROOT / "apps" / "web" / "src" / "lib" / "templates" / "specs.ts"
DEMO = REPO_ROOT / "packages" / "demo-data" / "workspace.json"


def test_ids_match_frontend_specs():
    if not SPECS_TS.exists():
        pytest.skip("frontend specs.ts not present")
    ts_ids = re.findall(r'^\s*id: "(tpl_[a-z_]+)"', SPECS_TS.read_text(), re.M)
    assert tuple(ts_ids) == BUILTIN_IDS


def test_geometry_matches_frontend_export():
    if not DEMO.exists():
        pytest.skip("demo workspace not present")
    data = json.loads(DEMO.read_text())
    mine = {t["id"]: t for t in builtin_templates(data["designProfiles"][0])}
    for t in (t for t in data["templates"] if t["source"] == "builtin"):
        m = mine[t["id"]]
        assert m["columns"] == t["columns"] and len(m["slots"]) == len(t["slots"]), t["id"]
        for a, b in zip(t["slots"], m["slots"]):
            assert a["id"] == b["id"] and a["role"] == b["role"] and a.get("columns") == b.get("columns")
            for k in ("x", "y", "w", "h"):
                assert abs(a[k] - b[k]) <= 0.0002, (t["id"], a["id"], k)


def test_ref_template_ids_and_derivation():
    assert ref_template_id("ref_egov_sep26", 6) == "tpl_ref_ref_egov_sep26_p6"
    assert parse_ref_template_id("tpl_ref_ref_egov_sep26_p6") == ("ref_egov_sep26", 6)
    assert parse_ref_template_id("tpl_report_hero") is None
    page = {"referenceId": "ref_x", "pageNumber": 3, "layoutType": "event_report", "blocks": [
        {"id": "i1", "kind": "image", "x": 0, "y": 0, "w": 1, "h": 0.4},
        {"id": "i2", "kind": "image", "x": 0.1, "y": 0.5, "w": 0.2, "h": 0.1},
        {"id": "t1", "kind": "text", "role": "headline", "x": 0.08, "y": 0.42, "w": 0.8, "h": 0.05},
        {"id": "t2", "kind": "text", "role": "folio", "x": 0.08, "y": 0.95, "w": 0.2, "h": 0.01},
        {"id": "b1", "kind": "text", "role": "body", "x": 0.08, "y": 0.6, "w": 0.26, "h": 0.3},
        {"id": "b2", "kind": "text", "role": "body", "x": 0.36, "y": 0.6, "w": 0.26, "h": 0.3},
        {"id": "b3", "kind": "text", "role": "question", "x": 0.64, "y": 0.6, "w": 0.26, "h": 0.3},
    ]}
    t = derive_template(page, "eGov Sep")
    assert t["id"] == "tpl_ref_ref_x_p3" and t["name"] == "Event report — reference p.3" and t["columns"] == 3
    roles = [s["role"] for s in t["slots"]]
    assert roles == ["hero_image", "image", "headline", "body"]  # folio dropped, three body columns merged


def test_resolved_slots_match_saved_demo_pages():
    """Every built-in slot on every demo page (recto and mirrored verso) lands where the frontend put it."""
    if not DEMO.exists():
        pytest.skip("demo workspace not present")
    from app.services.template_specs import SPEC_BY_ID
    from app.services.templates import resolve_slots

    data = json.loads(DEMO.read_text())
    profile = data["designProfiles"][0]
    checked = 0
    for n, page in enumerate(data["workspaces"][0]["pages"], start=1):
        spec = SPEC_BY_ID.get(page["templateId"])
        if spec is None:
            continue
        els = {e["id"]: e for e in page["elements"]}
        for s in resolve_slots(spec, profile, n):
            e = els.get(f"el_{s['id']}")
            if e is None:  # slot without content (e.g. no caption) produces no element
                continue
            for k in ("x", "y", "w", "h"):
                assert abs(e[k] - round(s[k], 2)) <= 0.011, (n, page["templateId"], s["id"], k, e[k], s[k])
            checked += 1
    assert checked > 150
