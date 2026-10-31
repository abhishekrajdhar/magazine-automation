"""Runner payloads: osascript command/AppleScript, InDesign Server SOAP envelope, COM fallback."""

from __future__ import annotations

import io
import subprocess
import sys
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from pressflow_bridge.config import Config
from pressflow_bridge.runners import (
    IDSP_NS,
    SCRIPT_LANGUAGE_JAVASCRIPT,
    SOAP_ENV_NS,
    MacDesktopRunner,
    ServerSoapRunner,
    WindowsComRunner,
    build_applescript,
    build_osascript_command,
    build_soap_envelope,
    make_runner,
    parse_soap_response,
)

# ---------------------------------------------------------------- macOS / osascript


def test_applescript_uses_literal_app_id_and_argv_paths():
    src = build_applescript("com.adobe.InDesign")
    assert 'tell application id "com.adobe.InDesign"' in src
    assert "on run argv" in src
    assert "do script jsxFile language javascript with arguments {argsPath}" in src
    assert "with timeout of timeoutSec seconds" in src
    # Paths are never interpolated into the script source.
    assert "/Users/" not in src and ".jsx" not in src


@pytest.mark.parametrize("bad", ['com.adobe.InDesign" to quit', "", "a b", "x;y"])
def test_applescript_rejects_injection_in_app_id(bad):
    with pytest.raises(ValueError):
        build_applescript(bad)


def test_osascript_command_passes_paths_as_argv(tmp_path):
    jsx = Path('/opt/press "flow"/pressflow-render.jsx')
    args_file = tmp_path / "render-args.json"
    cmd = build_osascript_command(tmp_path / "render-args.applescript", jsx, args_file, 1800)
    assert cmd == ["osascript", str(tmp_path / "render-args.applescript"), str(jsx), str(args_file), "1800"]


def test_mac_runner_invokes_osascript(tmp_path):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, 0, stdout='{"ok":true}\n', stderr="")

    runner = MacDesktopRunner("com.adobe.InDesign", run=fake_run)
    args_file = tmp_path / "render-args.json"
    args_file.write_text("{}")
    res = runner.run_script(Path("/x/pressflow-render.jsx"), {"contractPath": "/c.json"}, args_file, 120)
    assert res.ok and res.script_result == '{"ok":true}'
    cmd, kwargs = calls[0]
    script_path = Path(cmd[1])
    assert cmd[0] == "osascript" and cmd[2:] == ["/x/pressflow-render.jsx", str(args_file), "120"]
    assert script_path.read_text() == build_applescript("com.adobe.InDesign")
    assert kwargs["timeout"] == 150 and kwargs["capture_output"] is True


def test_mac_runner_reports_osascript_failure(tmp_path):
    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="execution error: Adobe InDesign got an error: boom (-2753)")

    args_file = tmp_path / "a.json"
    args_file.write_text("{}")
    res = MacDesktopRunner(run=fake_run).run_script(Path("/x.jsx"), {}, args_file, 10)
    assert not res.ok and "boom" in res.error and res.returncode == 1


def test_mac_runner_timeout(tmp_path):
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    args_file = tmp_path / "a.json"
    args_file.write_text("{}")
    res = MacDesktopRunner(run=fake_run).run_script(Path("/x.jsx"), {}, args_file, 10)
    assert not res.ok and "timed out" in res.error


# ---------------------------------------------------------------- InDesign Server SOAP


def test_soap_envelope_structure():
    env = build_soap_envelope(script_file="/srv/jsx/pressflow-render.jsx", args={"contractPath": "/j/contract.json", "outputs": "indd,pdf_print", "weird": "<&\">"})
    root = ET.fromstring(env)
    assert root.tag == f"{{{SOAP_ENV_NS}}}Envelope"
    body = root.find(f"{{{SOAP_ENV_NS}}}Body")
    run = body.find(f"{{{IDSP_NS}}}RunScript")
    params = run.find("runScriptParameters")
    assert params.findtext("scriptLanguage") == "javascript"
    assert params.findtext("scriptFile") == "/srv/jsx/pressflow-render.jsx"
    pairs = {a.findtext("name"): a.findtext("value") for a in params.findall("scriptArgs")}
    assert pairs == {"contractPath": "/j/contract.json", "outputs": "indd,pdf_print", "weird": "<&\">"}


def test_soap_envelope_requires_exactly_one_script_source():
    with pytest.raises(ValueError):
        build_soap_envelope()
    with pytest.raises(ValueError):
        build_soap_envelope(script_file="a", script_text="b")


OK_RESPONSE = b"""<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:IDSP="http://ns.adobe.com/InDesign/soap/">
<SOAP-ENV:Body><IDSP:RunScriptResponse><errorNumber>0</errorNumber>
<scriptResult><data>{"ok":true}</data></scriptResult></IDSP:RunScriptResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>"""

ERR_RESPONSE = b"""<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:IDSP="http://ns.adobe.com/InDesign/soap/">
<SOAP-ENV:Body><IDSP:RunScriptResponse><errorNumber>25</errorNumber><errorString>File not found</errorString>
</IDSP:RunScriptResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>"""

FAULT_RESPONSE = b"""<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault>
<faultcode>SOAP-ENV:Client</faultcode><faultstring>Validation constraint violation</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>"""


def test_parse_soap_responses():
    ok = parse_soap_response(OK_RESPONSE)
    assert ok.error_number == 0 and ok.script_result == '{"ok":true}' and ok.fault is None
    err = parse_soap_response(ERR_RESPONSE)
    assert err.error_number == 25 and err.error_string == "File not found"
    fault = parse_soap_response(FAULT_RESPONSE)
    assert fault.fault == "Validation constraint violation"
    assert parse_soap_response(b"not xml").error_number == -1


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_server_runner_posts_envelope(tmp_path):
    seen = {}

    def opener(req, timeout):
        seen["url"], seen["data"], seen["headers"], seen["timeout"] = req.full_url, req.data, dict(req.header_items()), timeout
        return _Resp(OK_RESPONSE)

    runner = ServerSoapRunner("http://ids.local:18383", opener=opener)
    args_file = tmp_path / "render-args.json"
    res = runner.run_script(Path("/srv/pressflow-render.jsx"), {"contractPath": "/j/c.json"}, args_file, 900)
    assert res.ok and res.script_result == '{"ok":true}'
    assert seen["url"] == "http://ids.local:18383" and seen["timeout"] == 900
    assert seen["headers"]["Content-type"].startswith("text/xml")
    params = ET.fromstring(seen["data"]).find(f".//{{{IDSP_NS}}}RunScript/runScriptParameters")
    pairs = {a.findtext("name"): a.findtext("value") for a in params.findall("scriptArgs")}
    assert pairs == {"contractPath": "/j/c.json", "argsFile": str(args_file)}


def test_server_runner_reports_script_error_and_http_500_fault(tmp_path):
    runner = ServerSoapRunner("http://ids", opener=lambda req, timeout: _Resp(ERR_RESPONSE))
    res = runner.run_script(Path("/s.jsx"), {}, tmp_path / "a.json", 5)
    assert not res.ok and "errorNumber=25" in res.error

    def fault_opener(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 500, "Internal Server Error", {}, io.BytesIO(FAULT_RESPONSE))

    res = ServerSoapRunner("http://ids", opener=fault_opener).run_script(Path("/s.jsx"), {}, tmp_path / "a.json", 5)
    assert not res.ok and "Validation constraint violation" in res.error


def test_server_runner_unreachable(tmp_path):
    def opener(req, timeout):
        raise urllib.error.URLError("Connection refused")

    res = ServerSoapRunner("http://ids", opener=opener).run_script(Path("/s.jsx"), {}, tmp_path / "a.json", 5)
    assert not res.ok and "Connection refused" in res.error


# ---------------------------------------------------------------- Windows COM / factory


def test_com_constant_is_javascript_fourcc():
    assert SCRIPT_LANGUAGE_JAVASCRIPT.to_bytes(4, "big") == b"JSLg"


@pytest.mark.skipif(sys.platform == "win32", reason="pywin32 may be installed on Windows")
def test_com_runner_without_pywin32_fails_cleanly(tmp_path):
    res = WindowsComRunner().run_script(Path("/s.jsx"), {}, tmp_path / "a.json", 5)
    assert not res.ok and "pywin32" in res.error


def test_make_runner_selects_by_mode(make_config):
    assert isinstance(make_runner(make_config(mode="server", server_url="http://ids:18383")), ServerSoapRunner)
    if sys.platform == "darwin":
        assert isinstance(make_runner(make_config()), MacDesktopRunner)


def test_config_from_env_and_problems(tmp_path):
    cfg = Config.from_env({
        "PRESSFLOW_API_URL": "https://api.example.test/",
        "INDESIGN_BRIDGE_TOKEN": "secret-token",
        "INDESIGN_MODE": "server",
        "INDESIGN_SERVER_URL": "http://localhost:18383",
        "BRIDGE_WORK_DIR": str(tmp_path),
        "POLL_INTERVAL_SEC": "2.5",
        "BRIDGE_ID": "render box #1",
    })
    assert cfg.api_url == "https://api.example.test" and cfg.mode == "server" and cfg.poll_interval == 2.5
    assert cfg.bridge_id == "render-box-1"
    assert cfg.problems() == []
    assert "secret-token" not in repr(cfg) and "secret-token" not in str(cfg.redacted())
    bad = Config.from_env({"INDESIGN_MODE": "cloud", "INDESIGN_APP_ID": 'x" & quit'})
    problems = " ".join(bad.problems())
    assert "PRESSFLOW_API_URL" in problems and "INDESIGN_BRIDGE_TOKEN" in problems and "INDESIGN_MODE" in problems and "INDESIGN_APP_ID" in problems
