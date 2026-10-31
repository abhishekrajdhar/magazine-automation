"""Bridge <-> API: HTTP calls, auth, retries and the job loop (204 / success / failure paths) with a fake runner."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from conftest import FakeRunner, example_contract, make_zip, parse_multipart
from pressflow_bridge.api import ApiClient, ApiError, AuthError, NotFoundError, TransientError
from pressflow_bridge.check import run_check
from pressflow_bridge.jobs import JobProcessor, build_render_args, outputs_for_format
from pressflow_bridge.multipart import FieldPart, FilePart, MultipartBody
from pressflow_bridge.runners import RunResult
from pressflow_bridge.worker import Bridge, fonts_from_listing

PREFIX = "/api/v1/indesign/bridge"
ASSETS = {"photos/ast_0001.jpg": b"\xff\xd8 fake jpeg"}


def _bridge(fake_api, make_config, runner, **cfg):
    config = make_config(fake_api.url, **cfg)
    api = ApiClient(config.api_url, config.token, timeout=5, retries=2, sleep=lambda s: None)
    return Bridge(config, api=api, runner=runner)


# ---------------------------------------------------------------- multipart


def test_multipart_body_streams_and_parses(tmp_path):
    f = tmp_path / "out.indd"
    f.write_bytes(b"\x00\x01binary\r\n--not-a-boundary")
    body = MultipartBody([FieldPart("status", "succeeded"), FieldPart("report", '{"ok": true, "x": "é"}'), FilePart("indd", f)])
    raw = body.to_bytes()
    assert len(body) == len(raw)
    chunked = b"".join(iter(lambda: body.read(7), b""))
    assert chunked == raw
    parsed = parse_multipart(body.content_type, raw)
    assert parsed["status"] == "succeeded"
    assert json.loads(parsed["report"])["x"] == "é"
    assert parsed["indd"] == {"filename": "out.indd", "content": f.read_bytes()}


# ---------------------------------------------------------------- API client


def test_auth_header_only_sent_to_api_origin():
    api = ApiClient("https://api.pressflow.test", "tok")
    assert api._headers_for("https://api.pressflow.test/api/v1/x")["Authorization"] == "Bearer tok"
    assert "Authorization" not in api._headers_for("https://bucket.s3.amazonaws.com/assets.zip?X-Amz-Signature=abc")
    assert "Authorization" not in api._headers_for("http://api.pressflow.test/api/v1/x")  # scheme differs


def test_error_classification_and_retries(fake_api):
    api = ApiClient(fake_api.url, "test-token", retries=3, sleep=lambda s: None)
    fake_api.fail_next_status = [503, 502]
    assert api.next_job.__doc__  # next_job is not retried (claims are not idempotent)
    resp = api.with_retries("health", lambda: api.request("GET", api.url("/api/v1/health")))
    assert resp.status == 200 and len(fake_api.requests) == 3
    with pytest.raises(AuthError):
        ApiClient(fake_api.url, "wrong").next_job("b1")
    with pytest.raises(NotFoundError):
        api.request("GET", api.url("/nope"))
    fake_api.fail_next_status = [400]
    with pytest.raises(ApiError):
        api.request("GET", api.url("/api/v1/health"))
    with pytest.raises(TransientError):
        ApiClient("http://127.0.0.1:9", "t", retries=1).request("GET", "http://127.0.0.1:9/x")


def test_next_job_204_and_200(fake_api):
    api = ApiClient(fake_api.url, "test-token")
    assert api.next_job("bridge-1") is None
    fake_api.add_job("job_1", example_contract(), make_zip(ASSETS))
    job = api.next_job("bridge-1")
    assert job["jobId"] == "job_1" and job["exportId"] == "exp_job_1"
    req = [r for r in fake_api.requests if r.path.endswith("/jobs/next")][-1]
    assert req.method == "GET" and req.query == {"bridgeId": ["bridge-1"]}
    assert req.headers["Authorization"] == "Bearer test-token"


# ---------------------------------------------------------------- job helpers


def test_outputs_for_format():
    assert outputs_for_format("pdf") == ["indd", "pdf_digital"]
    assert outputs_for_format("PDF_PRINT") == ["indd", "pdf_print"]
    assert outputs_for_format("indd") == ["indd"]
    with pytest.raises(Exception, match="unsupported export format"):
        outputs_for_format("docx")


def test_build_render_args_maps_options(make_config, tmp_path):
    cfg = make_config()
    job = {"jobId": "job_9", "exportId": "exp 9", "format": "pdf_print", "options": {"pdfPreset": "[PDF/X-1a:2001]", "includeBleed": True}}
    args = build_render_args(cfg, job, contract_path=tmp_path / "c.json", asset_root=tmp_path / "a", out_dir=tmp_path / "o", outputs=["indd", "pdf_print"])
    assert args["outputs"] == "indd,pdf_print"
    assert args["pdfPresetPrint"] == "[PDF/X-1a:2001]" and args["pdfPresetDigital"] == "[High Quality Print]"
    assert args["includeBleed"] == "true" and args["force"] == "false" and args["closeDocument"] == "true"
    assert args["jobId"] == "job_9" and args["baseName"].startswith("pressflow-job-")  # "exp 9" is not a safe file name
    assert all(isinstance(v, str) for v in args.values())


# ---------------------------------------------------------------- job loop


def test_poll_returns_idle_on_204(fake_api, make_config):
    runner = FakeRunner()
    bridge = _bridge(fake_api, make_config, runner)
    assert bridge.poll_once() == "idle"
    assert runner.calls == [] and fake_api.results == {}


def test_successful_job_uploads_indd_pdf_and_report(fake_api, make_config):
    fake_api.add_job("job_ok", example_contract(), make_zip(ASSETS), fmt="pdf")
    runner = FakeRunner("success")
    bridge = _bridge(fake_api, make_config, runner)
    assert bridge.poll_once() == "processed"

    jsx, args, _ = runner.calls[0]
    assert jsx.name == "pressflow-render.jsx"
    assert args["outputs"] == "indd,pdf_digital" and args["jobId"] == "job_ok"
    # Contract and assets were downloaded and unpacked where the renderer was told to look.
    paths = [r.path for r in fake_api.requests]
    assert f"{PREFIX}/jobs/job_ok/contract" in paths and f"{PREFIX}/jobs/job_ok/assets.zip" in paths

    result = fake_api.results["job_ok"]
    assert result["status"] == "succeeded"
    assert result["indd"]["filename"].endswith(".indd") and result["indd"]["content"].startswith(b"FAKE indd")
    assert result["pdf"]["filename"].endswith(".pdf")
    assert json.loads(result["report"])["ok"] is True
    upload = [r for r in fake_api.requests if r.path.endswith("/result")][0]
    assert upload.method == "POST" and upload.headers["Content-Type"].startswith("multipart/form-data; boundary=")
    assert upload.headers["Authorization"] == "Bearer test-token"
    # Job folder cleaned up afterwards.
    assert not any((bridge.config.work_dir / "jobs").iterdir())


def test_assets_are_extracted_before_render(fake_api, make_config):
    fake_api.add_job("job_a", example_contract(), make_zip(ASSETS), fmt="indd")
    seen = {}

    def behaviour(args, out: Path) -> RunResult:
        seen["asset"] = (Path(args["assetRoot"]) / "photos/ast_0001.jpg").read_bytes()
        seen["contract"] = json.loads(Path(args["contractPath"]).read_text())
        f = out / "x.indd"
        f.write_bytes(b"FAKE")
        (out / "report.json").write_text(json.dumps({"ok": True, "outputs": {"indd": str(f)}}))
        return RunResult(True)

    bridge = _bridge(fake_api, make_config, FakeRunner(behaviour))
    assert bridge.poll_once() == "processed"
    assert seen["asset"] == ASSETS["photos/ast_0001.jpg"] and seen["contract"]["contract_version"] == "1.0"
    assert set(fake_api.results["job_a"]) == {"status", "report", "indd"}


def test_renderer_failure_is_reported_as_failure(fake_api, make_config):
    fake_api.add_job("job_unapproved", example_contract(), make_zip(ASSETS), fmt="pdf_print")
    bridge = _bridge(fake_api, make_config, FakeRunner("report_failure"))
    assert bridge.poll_once() == "failed"
    result = fake_api.results["job_unapproved"]
    assert result["status"] == "failed"
    assert "not approved" in result["error"]
    assert json.loads(result["report"])["ok"] is False
    assert "indd" not in result and "pdf" not in result


def test_runner_crash_without_report_is_failure(fake_api, make_config):
    fake_api.add_job("job_crash", example_contract(), make_zip(ASSETS))
    bridge = _bridge(fake_api, make_config, FakeRunner("crash"))
    assert bridge.poll_once() == "failed"
    result = fake_api.results["job_crash"]
    assert result["status"] == "failed" and "did not write report.json" in result["error"] and "boom" in result["error"]
    assert "report" not in result


def test_report_ok_but_missing_output_is_failure(fake_api, make_config):
    fake_api.add_job("job_nopdf", example_contract(), make_zip(ASSETS), fmt="pdf")

    def behaviour(args, out: Path) -> RunResult:
        f = out / "x.indd"
        f.write_bytes(b"FAKE")
        (out / "report.json").write_text(json.dumps({"ok": True, "outputs": {"indd": str(f), "pdf_digital": None}}))
        return RunResult(True)

    bridge = _bridge(fake_api, make_config, FakeRunner(behaviour))
    assert bridge.poll_once() == "failed"
    assert "pdf_digital" in fake_api.results["job_nopdf"]["error"]


def test_output_outside_job_folder_is_rejected(fake_api, make_config, tmp_path):
    fake_api.add_job("job_escape", example_contract(), make_zip(ASSETS), fmt="indd")
    secret = tmp_path / "secret.indd"
    secret.write_bytes(b"do not upload")

    def behaviour(args, out: Path) -> RunResult:
        (out / "report.json").write_text(json.dumps({"ok": True, "outputs": {"indd": str(secret)}}))
        return RunResult(True)

    bridge = _bridge(fake_api, make_config, FakeRunner(behaviour))
    assert bridge.poll_once() == "failed"
    assert "outside the job output folder" in fake_api.results["job_escape"]["error"]


def test_unsafe_assets_zip_fails_job_without_rendering(fake_api, make_config):
    fake_api.add_job("job_evil", example_contract(), make_zip({"../../evil.sh": b"rm -rf /"}))
    runner = FakeRunner()
    bridge = _bridge(fake_api, make_config, runner)
    assert bridge.poll_once() == "failed"
    assert runner.calls == []
    assert "path traversal" in fake_api.results["job_evil"]["error"]


def test_missing_assets_zip_fails_when_contract_needs_assets(fake_api, make_config):
    fake_api.add_job("job_noassets", example_contract(), None)
    bridge = _bridge(fake_api, make_config, FakeRunner())
    assert bridge.poll_once() == "failed"
    assert "assets.zip is not available" in fake_api.results["job_noassets"]["error"]


def test_unsupported_format_fails_job(fake_api, make_config):
    fake_api.add_job("job_fmt", example_contract(), make_zip(ASSETS), fmt="docx")
    bridge = _bridge(fake_api, make_config, FakeRunner())
    assert bridge.poll_once() == "failed"
    assert "unsupported export format" in fake_api.results["job_fmt"]["error"]


def test_bad_token_is_auth_error(fake_api, make_config):
    config = make_config(fake_api.url, token="wrong")
    bridge = Bridge(config, api=ApiClient(config.api_url, config.token, sleep=lambda s: None), runner=FakeRunner())
    assert bridge.poll_once() == "auth_error"
    assert bridge.send_heartbeat() is False


def test_heartbeat_payload_and_font_collection(fake_api, make_config):
    runner = FakeRunner()
    bridge = _bridge(fake_api, make_config, runner)
    bridge.collect_fonts()
    assert runner.calls[0][0].name == "list-fonts.jsx"
    assert bridge.send_heartbeat() is True
    hb = fake_api.heartbeats[-1]
    assert set(hb) == {"bridgeId", "hostname", "mode", "indesignVersion", "platform", "fonts"}
    assert hb["fonts"] == ["Minion Pro Bold", "Minion Pro Regular", "Myriad Pro Regular"]
    assert hb["indesignVersion"] == "20.0-fake" and hb["mode"] == "desktop"
    req = [r for r in fake_api.requests if r.path == f"{PREFIX}/heartbeat"][-1]
    assert req.method == "POST" and req.headers["Content-Type"] == "application/json"


def test_fonts_from_listing_dedupes():
    assert fonts_from_listing({"fonts": [{"family": "A", "style": "Bold"}, {"family": "A", "style": "Bold"}, {"family": "B"}, "junk"]}) == ["A Bold", "B"]


def test_run_forever_once_processes_one_job_and_stops(fake_api, make_config):
    fake_api.add_job("job_once", example_contract(), make_zip(ASSETS), fmt="indd")
    fake_api.add_job("job_second", example_contract(), make_zip(ASSETS), fmt="indd")
    bridge = _bridge(fake_api, make_config, FakeRunner())
    bridge.run_forever(once=True)
    assert set(fake_api.results) == {"job_once"}
    assert bridge.stop_event.is_set()


def test_check_command_reports_token_status(fake_api, make_config):
    class R:
        name = "fake"

        def diagnose(self):
            return False, "InDesign not installed on this test machine"

    out = io.StringIO()
    code = run_check(make_config(fake_api.url), out, runner_factory=lambda c: R())
    text = out.getvalue()
    assert "API reachable" in text and "bridge token accepted" in text
    assert "[FAIL] InDesign not installed" in text and code == 1
    out = io.StringIO()
    run_check(make_config(fake_api.url, token="nope"), out, runner_factory=lambda c: R())
    assert "bridge token rejected" in out.getvalue()
    assert "nope" not in out.getvalue()
