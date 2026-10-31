"""``python -m pressflow_bridge --check``: diagnostics without rendering anything."""

from __future__ import annotations

import tempfile
from typing import Callable, TextIO

from .api import ApiClient, ApiError, AuthError, TransientError
from .config import Config
from .runners import Runner, make_runner
from .worker import heartbeat_payload


def run_check(config: Config, out: TextIO, *, api: ApiClient | None = None, runner_factory: Callable[[Config], Runner] = make_runner) -> int:
    results: list[tuple[bool, str]] = []

    def line(ok: bool | None, text: str) -> None:
        tag = "[ ok ]" if ok else ("[info]" if ok is None else "[FAIL]")
        out.write(f"{tag} {text}\n")
        if ok is not None:
            results.append((ok, text))

    out.write("PressFlow InDesign bridge diagnostics\n")
    for key, value in config.redacted().items():
        out.write(f"       {key}: {value}\n")

    problems = config.problems()
    line(not problems, "configuration valid" if not problems else "configuration: " + "; ".join(problems))
    line(config.render_jsx.is_file(), f"renderer script {config.render_jsx}")
    line(config.fonts_jsx.is_file(), f"font listing script {config.fonts_jsx}")

    try:
        config.work_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=config.work_dir, delete=True):
            pass
        line(True, f"work dir writable: {config.work_dir}")
    except OSError as exc:
        line(False, f"work dir not writable: {config.work_dir} ({exc})")

    if config.api_url and config.token:
        api = api or ApiClient(config.api_url, config.token, timeout=min(config.http_timeout, 20), retries=1)
        reachable = False
        for path in ("/api/v1/health", "/health"):
            try:
                resp = api.request("GET", api.url(path))
                line(True, f"API reachable: GET {path} -> {resp.status}")
                reachable = True
                break
            except TransientError as exc:
                if exc.status is not None:  # 5xx: the server answered
                    line(True, f"API reachable: GET {path} -> {exc.status}")
                    reachable = True
                    break
                line(False, f"API not reachable: {exc}")
                break
            except ApiError as exc:  # 401/403/404 etc.: the server answered
                line(True, f"API reachable: GET {path} -> {exc.status}")
                reachable = True
                break
        if reachable:
            # A heartbeat is the only bridge endpoint without side effects on jobs.
            try:
                resp = api.heartbeat(heartbeat_payload(config, [], None))
                line(True, f"bridge token accepted (heartbeat -> {resp.status}; sent with an empty font list)")
            except AuthError as exc:
                line(False, f"bridge token rejected (heartbeat -> {exc.status})")
            except ApiError as exc:
                line(False, f"heartbeat failed: {exc}")
    else:
        line(False, "API check skipped (PRESSFLOW_API_URL / INDESIGN_BRIDGE_TOKEN missing)")

    try:
        runner = runner_factory(config)
        line(None, f"runner: {runner.name}")
        ok, detail = runner.diagnose()
        line(ok, detail)
    except Exception as exc:  # noqa: BLE001
        line(False, f"no usable InDesign runner: {exc}")

    out.write("result: " + ("all checks passed" if all(ok for ok, _ in results) else "some checks FAILED") + "\n")
    return 0 if all(ok for ok, _ in results) else 1
