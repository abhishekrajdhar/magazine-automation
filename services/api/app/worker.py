"""Standalone job worker: `python -m app.worker` (polls the jobs table)."""

from __future__ import annotations

import signal

from app.main import configure_logging
from app.services.jobs.runner import Worker


def main() -> None:
    configure_logging()
    w = Worker()
    signal.signal(signal.SIGTERM, lambda *_: w.stop())
    signal.signal(signal.SIGINT, lambda *_: w.stop())
    w.run_forever()


if __name__ == "__main__":
    main()
