"""UXP plugin: manifest sanity, bundled renderer freshness, no hard-coded secrets, and the Node library tests."""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import zipfile

import pytest

from conftest import EXTENDSCRIPT_DIR, INDESIGN_DIR, NODE

UXP = INDESIGN_DIR / "uxp"
needs_node = pytest.mark.skipif(NODE is None, reason="node is not installed")


def test_manifest_v5_for_indesign():
    m = json.loads((UXP / "manifest.json").read_text())
    assert m["manifestVersion"] == 5
    assert m["host"]["app"] == "ID"
    assert m["main"] == "index.html" and (UXP / m["main"]).is_file()
    panel = m["entrypoints"][0]
    assert panel["type"] == "panel" and panel["id"] == "pressflowPanel"
    assert "network" in m["requiredPermissions"]


def test_bundled_renderer_matches_source():
    assert (UXP / "jsx/pressflow-render.jsx").read_bytes() == (EXTENDSCRIPT_DIR / "pressflow-render.jsx").read_bytes(), \
        "run `make uxp-sync` after editing extendscript/pressflow-render.jsx"


def test_panel_uses_secure_storage_and_no_hardcoded_credentials():
    main = (UXP / "main.js").read_text()
    assert "secureStorage.setItem(KEYS.token" in main
    assert "ScriptLanguage.JAVASCRIPT" in main and "app.doScript(" in main
    for path in [UXP / "main.js", UXP / "index.html", UXP / "lib/pressflow.js"]:
        text = path.read_text()
        assert not re.search(r"Bearer\s+[A-Za-z0-9._-]{12,}", text), f"hard-coded bearer token in {path.name}"
        assert not re.search(r"https?://(?!pressflow\.example\.com)[a-z0-9.-]+\.(com|in|io|net)\b", text), f"hard-coded host in {path.name}"


@needs_node
def test_uxp_js_syntax():
    for path in [UXP / "main.js", UXP / "lib/unzip.js", UXP / "lib/pressflow.js"]:
        proc = subprocess.run([NODE, "--check", str(path)], capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr


@needs_node
def test_uxp_library_node_tests(tmp_path):
    # Cross-check the JS unzip against an archive written by Python's zipfile (deflate + stored).
    fixture = tmp_path / "py.zip"
    files = {"photos/ast_0001.jpg": os.urandom(40000), "captions/c.txt": ("Delegates é " * 400).encode(), "empty.txt": b""}
    with zipfile.ZipFile(fixture, "w") as zf:
        for i, (name, data) in enumerate(files.items()):
            zf.writestr(name, data, compress_type=zipfile.ZIP_STORED if i == 0 else zipfile.ZIP_DEFLATED)
    expected = tmp_path / "expected.json"
    expected.write_text(json.dumps({k: base64.b64encode(v).decode() for k, v in files.items()}))
    env = dict(os.environ, PRESSFLOW_ZIP_FIXTURE=str(fixture), PRESSFLOW_ZIP_EXPECTED=str(expected))
    proc = subprocess.run([NODE, "--test", str(INDESIGN_DIR / "tests/js/uxp_libs.test.js")], capture_output=True, text=True, env=env, timeout=300)
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
    assert "# fail 0" in proc.stdout and "# skipped 0" in proc.stdout


@needs_node
def test_check_script_passes():
    proc = subprocess.run(["bash", str(INDESIGN_DIR / "scripts/check-jsx.sh")], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
