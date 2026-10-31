"""Worker loop (used by `python -m app.worker` and the inline worker thread)."""

from __future__ import annotations

import logging
import os
import socket
import threading
import time

from app.config import get_settings
from app.services.jobs.queue import claim_next, run_job

log = logging.getLogger("pressflow.worker")


def load_handlers() -> None:
    """Import modules that register job handlers."""
    from app.services import (  # noqa: F401
        editorial,
        exports,
        reference_jobs,
        video_pipeline,
    )


class Worker:
    def __init__(self, name: str | None = None):
        self.name = name or f"{socket.gethostname()}:{os.getpid()}:{threading.get_ident()}"
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        load_handlers()
        s = get_settings()
        log.info("worker %s started (poll %.1fs)", self.name, s.worker_poll_seconds)
        while not self._stop.is_set():
            try:
                job = claim_next("default", worker_id=self.name)
            except Exception:  # noqa: BLE001 - DB hiccup; keep polling
                log.exception("claim failed")
                job = None
            if job is None:
                self._stop.wait(s.worker_poll_seconds)
                continue
            log.info("running job %s (%s) attempt %s", job.id, job.kind, job.attempts)
            started = time.monotonic()
            status = run_job(job)
            log.info("job %s -> %s in %.1fs", job.id, status, time.monotonic() - started)
        log.info("worker %s stopped", self.name)


_inline: tuple[Worker, threading.Thread] | None = None


def start_inline_worker() -> None:
    global _inline
    if _inline is not None:
        return
    w = Worker(name=f"inline:{os.getpid()}")
    t = threading.Thread(target=w.run_forever, name="pressflow-inline-worker", daemon=True)
    t.start()
    _inline = (w, t)


def stop_inline_worker() -> None:
    global _inline
    if _inline is None:
        return
    w, t = _inline
    w.stop()
    t.join(timeout=5)
    _inline = None
