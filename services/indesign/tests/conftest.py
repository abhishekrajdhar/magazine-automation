"""Shared fixtures: repository paths, a fake PressFlow API (real HTTP on 127.0.0.1) and a fake InDesign runner."""

from __future__ import annotations

import email.parser
import email.policy
import io
import json
import shutil
import threading
import zipfile
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

import pytest

from pressflow_bridge.config import Config
from pressflow_bridge.runners import RunResult

INDESIGN_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = INDESIGN_DIR.parents[1]
CONTRACTS_DIR = REPO_ROOT / "packages" / "contracts"
EXTENDSCRIPT_DIR = INDESIGN_DIR / "extendscript"
NODE = shutil.which("node")


def example_contract() -> dict[str, Any]:
    return json.loads((CONTRACTS_DIR / "layout-contract.example.json").read_text(encoding="utf-8"))


def make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def parse_multipart(content_type: str, body: bytes) -> dict[str, Any]:
    """Parse multipart/form-data into {name: str | {"filename", "content"}}."""
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        f"Content-Type: {content_type}\r\n\r\n".encode() + body
    )
    out: dict[str, Any] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        out[name] = {"filename": filename, "content": payload} if filename else payload.decode("utf-8")
    return out


@dataclass
class Recorded:
    method: str
    path: str
    query: dict[str, list[str]]
    headers: dict[str, str]
    body: bytes


@dataclass
class FakeApi:
    """State behind the fake PressFlow API server."""

    token: str = "test-token"
    jobs: list[dict[str, Any]] = field(default_factory=list)
    contracts: dict[str, bytes] = field(default_factory=dict)
    zips: dict[str, bytes] = field(default_factory=dict)
    requests: list[Recorded] = field(default_factory=list)
    results: dict[str, dict[str, Any]] = field(default_factory=dict)
    heartbeats: list[dict[str, Any]] = field(default_factory=list)
    fail_next_status: list[int] = field(default_factory=list)
    url: str = ""

    def add_job(self, job_id: str, contract: dict[str, Any], zip_bytes: bytes | None, fmt: str = "pdf", **options: Any) -> None:
        self.jobs.append({
            "jobId": job_id,
            "exportId": f"exp_{job_id}",
            "format": fmt,
            "contractUrl": f"/api/v1/indesign/bridge/jobs/{job_id}/contract",
            "assetsUrl": f"/api/v1/indesign/bridge/jobs/{job_id}/assets.zip",
            "options": {"pdfPreset": None, "includeBleed": False, **options},
        })
        self.contracts[job_id] = json.dumps(contract).encode()
        if zip_bytes is not None:
            self.zips[job_id] = zip_bytes


def _handler(state: FakeApi) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: Any) -> None:  # silence
            pass

        def _send(self, status: int, body: bytes = b"", ctype: str = "application/json") -> None:
            self.send_response(status)
            if body:
                self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _handle(self) -> None:
            parts = urlsplit(self.path)
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            state.requests.append(Recorded(self.command, parts.path, parse_qs(parts.query), dict(self.headers.items()), body))
            if state.fail_next_status:
                self._send(state.fail_next_status.pop(0), b'{"detail":"injected"}')
                return
            if parts.path in ("/api/v1/health", "/health"):
                self._send(200, b'{"ok":true}')
                return
            if self.headers.get("Authorization") != f"Bearer {state.token}":
                self._send(401, b'{"detail":"bad token"}')
                return
            p = parts.path
            prefix = "/api/v1/indesign/bridge"
            if self.command == "POST" and p == f"{prefix}/heartbeat":
                state.heartbeats.append(json.loads(body))
                self._send(204)
            elif self.command == "GET" and p == f"{prefix}/jobs/next":
                if not state.jobs:
                    self._send(204)
                else:
                    self._send(200, json.dumps(state.jobs.pop(0)).encode())
            elif self.command == "GET" and p.endswith("/contract"):
                job_id = p.split("/")[-2]
                self._send(200, state.contracts[job_id]) if job_id in state.contracts else self._send(404)
            elif self.command == "GET" and p.endswith("/assets.zip"):
                job_id = p.split("/")[-2]
                self._send(200, state.zips[job_id], "application/zip") if job_id in state.zips else self._send(404)
            elif self.command == "POST" and p.endswith("/result"):
                job_id = p.split("/")[-2]
                state.results[job_id] = parse_multipart(self.headers["Content-Type"], body)
                self._send(200, b'{"ok":true}')
            else:
                self._send(404)

        do_GET = _handle
        do_POST = _handle

    return Handler


@pytest.fixture()
def fake_api():
    state = FakeApi()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state.url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()


class FakeRunner:
    """Stands in for InDesign. ``behaviour`` decides what the 'render' does."""

    name = "fake"

    def __init__(self, behaviour: Callable[[dict[str, str], Path], RunResult] | str = "success") -> None:
        self.behaviour = behaviour
        self.calls: list[tuple[Path, dict[str, str], Path]] = []

    def run_script(self, jsx: Path, args: dict[str, str], args_file: Path, timeout: float) -> RunResult:
        self.calls.append((jsx, dict(args), args_file))
        assert json.loads(args_file.read_text()) == args, "args file must mirror the args"
        if jsx.name == "list-fonts.jsx":
            Path(args["outPath"]).write_text(json.dumps({"ok": True, "indesignVersion": "20.0-fake", "fonts": [
                {"family": "Minion Pro", "style": "Regular"}, {"family": "Minion Pro", "style": "Bold"}, {"family": "Myriad Pro", "style": "Regular"},
            ]}))
            return RunResult(True)
        if callable(self.behaviour):
            return self.behaviour(args, Path(args["outDir"]))
        out = Path(args["outDir"])
        if self.behaviour == "crash":
            return RunResult(False, error="osascript: InDesign got an error: boom", returncode=1)
        report: dict[str, Any] = {
            "ok": self.behaviour == "success", "pages": 1, "overset": [], "missingFonts": [], "substitutedFonts": [],
            "missingLinks": [], "outputs": {"indd": None, "pdf_digital": None, "pdf_print": None}, "durationMs": 5,
            "indesignVersion": "20.0-fake", "error": None,
        }
        if self.behaviour == "success":
            for kind in args["outputs"].split(","):
                ext = "indd" if kind == "indd" else ("idml" if kind == "idml" else "pdf")
                f = out / f"{args['baseName']}-{kind}.{ext}"
                f.write_bytes(f"FAKE {kind} (test double, not InDesign output)".encode())
                report["outputs"][kind] = str(f)
        else:
            report["error"] = "final PDF export refused: page(s) 12 not approved (pass force=true to override)"
        (out / "report.json").write_text(json.dumps(report))
        return RunResult(True)


@pytest.fixture()
def make_config(tmp_path: Path):
    def _make(api_url: str = "http://127.0.0.1:9", **overrides: Any) -> Config:
        base = dict(api_url=api_url, token="test-token", work_dir=tmp_path / "work", jsx_dir=EXTENDSCRIPT_DIR,
                    poll_interval=0.01, heartbeat_interval=0.05, render_timeout=30, http_timeout=5)
        base.update(overrides)
        return Config(**base)

    return _make
