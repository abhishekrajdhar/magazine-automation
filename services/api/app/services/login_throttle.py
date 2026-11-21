"""Temporary lock after repeated failed sign-ins.

Counts failures per e-mail address and per client address in this process's memory. That is enough to make
password guessing through one instance impractical; with several API replicas each keeps its own count, so put a
rate limit on /api/v1/auth/* at the load balancer as well.
"""

from __future__ import annotations

import threading
import time

from app.config import get_settings

_lock = threading.Lock()
_failures: dict[str, list[float]] = {}
ADDRESS_FACTOR = 5  # many people can share one office or proxy address


def _recent(key: str, now: float, window: float) -> list[float]:
    hits = [t for t in _failures.get(key, []) if now - t < window]
    if hits:
        _failures[key] = hits
    else:
        _failures.pop(key, None)
    return hits


def retry_after(email: str, address: str | None) -> int:
    """Seconds until another attempt is allowed; 0 when not locked."""
    s = get_settings()
    window = s.login_lock_minutes * 60
    now = time.monotonic()
    wait = 0.0
    with _lock:
        for key, limit in ((f"e:{email}", s.login_max_failures), (f"a:{address}", s.login_max_failures * ADDRESS_FACTOR)):
            if key.endswith(":None") or limit <= 0:
                continue
            hits = _recent(key, now, window)
            if len(hits) >= limit:
                wait = max(wait, window - (now - hits[-limit]))
    return int(wait) + 1 if wait > 0 else 0


def record_failure(email: str, address: str | None) -> None:
    now = time.monotonic()
    with _lock:
        if len(_failures) > 50_000:  # bound memory under a spray of made-up addresses
            _failures.clear()
        _failures.setdefault(f"e:{email}", []).append(now)
        if address:
            _failures.setdefault(f"a:{address}", []).append(now)


def record_success(email: str) -> None:
    with _lock:
        _failures.pop(f"e:{email}", None)


def reset() -> None:
    with _lock:
        _failures.clear()
