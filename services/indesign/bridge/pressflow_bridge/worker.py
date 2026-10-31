"""The long-running bridge worker: heartbeat thread + job polling loop."""

from __future__ import annotations

import json
import logging
import signal
import socket
import threading
from typing import Any

from .api import ApiClient, ApiError, AuthError, TransientError
from .config import Config
from .jobs import JobProcessor
from .runners import Runner, make_runner

log = logging.getLogger("pressflow.bridge")


def heartbeat_payload(config: Config, fonts: list[str], indesign_version: str | None) -> dict[str, Any]:
    return {
        "bridgeId": config.bridge_id,
        "hostname": socket.gethostname(),
        "mode": config.mode,
        "indesignVersion": indesign_version,
        "platform": config.platform,
        "fonts": fonts,
    }


def fonts_from_listing(listing: dict[str, Any]) -> list[str]:
    """list-fonts.jsx output -> sorted unique "Family Style" strings for the heartbeat."""
    out = set()
    for f in listing.get("fonts") or []:
        if isinstance(f, dict) and f.get("family"):
            out.add(f"{f['family']} {f.get('style') or ''}".strip())
    return sorted(out)


class Bridge:
    def __init__(self, config: Config, api: ApiClient | None = None, runner: Runner | None = None) -> None:
        self.config = config
        self.api = api or ApiClient(config.api_url, config.token, timeout=config.http_timeout)
        self.runner = runner or make_runner(config)
        self.processor = JobProcessor(config, self.api, self.runner)
        self.stop_event = threading.Event()
        self.fonts: list[str] = []
        self.indesign_version: str | None = None
        self._busy = threading.Lock()
        self._hb_thread: threading.Thread | None = None

    # ------------------------------------------------------------------ fonts / heartbeat
    def collect_fonts(self) -> None:
        """Run list-fonts.jsx once and cache the result (also yields the InDesign version)."""
        out = self.config.work_dir / "fonts"
        out.mkdir(parents=True, exist_ok=True)
        out_path = out / "fonts.json"
        out_path.unlink(missing_ok=True)
        args = {"outPath": str(out_path)}
        args_file = out / "list-fonts-args.json"
        args_file.write_text(json.dumps(args), encoding="utf-8")
        with self._busy:
            result = self.runner.run_script(self.config.fonts_jsx, args, args_file, min(self.config.render_timeout, 300))
        try:
            listing = json.loads(out_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            log.warning("could not list InDesign fonts; heartbeat will report none", extra={"error": result.error})
            return
        self.fonts = fonts_from_listing(listing)
        self.indesign_version = listing.get("indesignVersion")
        log.info("collected InDesign fonts", extra={"fonts": len(self.fonts), "indesign_version": self.indesign_version})

    def heartbeat_payload(self) -> dict[str, Any]:
        return heartbeat_payload(self.config, self.fonts, self.indesign_version)

    def send_heartbeat(self) -> bool:
        try:
            self.api.heartbeat(self.heartbeat_payload())
            return True
        except AuthError as exc:
            log.error("heartbeat rejected: bridge token not accepted", extra={"status": exc.status})
        except ApiError as exc:
            log.warning("heartbeat failed", extra={"error": str(exc)})
        return False

    def _heartbeat_loop(self) -> None:
        while not self.stop_event.is_set():
            self.send_heartbeat()
            self.stop_event.wait(self.config.heartbeat_interval)

    # ------------------------------------------------------------------ polling
    def poll_once(self) -> str:
        """Claim and process at most one job. Returns 'idle', 'processed', 'failed', 'auth_error' or 'error'."""
        try:
            job = self.api.next_job(self.config.bridge_id)
        except AuthError as exc:
            log.error("job poll rejected: bridge token not accepted", extra={"status": exc.status})
            return "auth_error"
        except (TransientError, ApiError) as exc:
            log.warning("job poll failed", extra={"error": str(exc)})
            return "error"
        if job is None:
            return "idle"
        with self._busy:
            outcome = self.processor.process(job)
        return "processed" if outcome.ok else "failed"

    def run_forever(self, *, once: bool = False) -> None:
        self.config.work_dir.mkdir(parents=True, exist_ok=True)
        log.info("bridge starting", extra=self.config.redacted())
        self.collect_fonts()
        self._hb_thread = threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True)
        self._hb_thread.start()
        delay = self.config.poll_interval
        while not self.stop_event.is_set():
            status = self.poll_once()
            if once and status != "idle":
                break
            if status in ("processed", "failed"):
                delay = self.config.poll_interval
                continue  # look for the next job immediately
            if status == "idle":
                delay = self.config.poll_interval
                if once:
                    break
            elif status == "auth_error":
                delay = max(60.0, self.config.poll_interval)
            else:
                delay = min(max(delay * 2, self.config.poll_interval), 300.0)
            self.stop_event.wait(delay)
        self.stop_event.set()
        log.info("bridge stopped")

    def stop(self) -> None:
        self.stop_event.set()

    def install_signal_handlers(self) -> None:
        def handler(signum: int, _frame: Any) -> None:
            if self.stop_event.is_set():
                raise KeyboardInterrupt
            log.info("shutdown requested; finishing the current job (signal again to abort)", extra={"signal": signum})
            self.stop_event.set()

        signal.signal(signal.SIGINT, handler)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, handler)
