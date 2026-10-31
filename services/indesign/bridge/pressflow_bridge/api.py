"""PressFlow API client used by the bridge (urllib, no third-party dependencies).

Endpoints (all with ``Authorization: Bearer <INDESIGN_BRIDGE_TOKEN>``):

    POST {API}/api/v1/indesign/bridge/heartbeat                 JSON body
    GET  {API}/api/v1/indesign/bridge/jobs/next?bridgeId=...    204 | 200 JSON job
    GET  {API}/api/v1/indesign/bridge/jobs/{jobId}/contract     layout contract JSON
    GET  {API}/api/v1/indesign/bridge/jobs/{jobId}/assets.zip   zip of assets
    POST {API}/api/v1/indesign/bridge/jobs/{jobId}/result       multipart/form-data
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from . import __version__
from .multipart import FieldPart, FilePart, MultipartBody

log = logging.getLogger("pressflow.api")

T = TypeVar("T")

BRIDGE_PREFIX = "/api/v1/indesign/bridge"


class ApiError(Exception):
    def __init__(self, message: str, status: int | None = None, body: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class AuthError(ApiError):
    """401/403: the bridge token was rejected. Not retried."""


class TransientError(ApiError):
    """Network failure, timeout, 429 or 5xx. Retried with backoff."""


class NotFoundError(ApiError):
    """404."""


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8-sig")) if self.body else None


class ApiClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = 60.0,
        retries: int = 3,
        backoff: float = 1.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.timeout = timeout
        self.retries = max(1, retries)
        self.backoff = backoff
        self._sleep = sleep
        self._origin = self._origin_of(self.base_url)
        self.user_agent = f"pressflow-indesign-bridge/{__version__}"

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _origin_of(url: str) -> tuple[str, str]:
        p = urllib.parse.urlsplit(url)
        return (p.scheme.lower(), p.netloc.lower())

    def url(self, path_or_url: str, **query: str) -> str:
        if path_or_url.startswith(("http://", "https://")):
            url = path_or_url
        else:
            url = self.base_url + "/" + path_or_url.lstrip("/")
        if query:
            sep = "&" if "?" in url else "?"
            url += sep + urllib.parse.urlencode(query)
        return url

    def _headers_for(self, url: str, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {"User-Agent": self.user_agent, "Accept": "application/json, */*"}
        # Only send the bridge token to the PressFlow API origin (never to e.g. presigned storage URLs).
        if self._origin_of(url) == self._origin:
            headers["Authorization"] = f"Bearer {self._token}"
        if extra:
            headers.update(extra)
        return headers

    def _open(self, method: str, url: str, data: Any = None, headers: dict[str, str] | None = None, timeout: float | None = None):
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers_for(url, headers))
        try:
            return urllib.request.urlopen(req, timeout=timeout or self.timeout)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", "replace")[:2000]
            except Exception:  # noqa: BLE001
                pass
            msg = f"{method} {self._safe(url)} -> HTTP {exc.code}"
            if exc.code in (401, 403):
                raise AuthError(msg, exc.code, body) from None
            if exc.code == 404:
                raise NotFoundError(msg, exc.code, body) from None
            if exc.code == 429 or exc.code >= 500:
                raise TransientError(msg, exc.code, body) from None
            raise ApiError(msg, exc.code, body) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise TransientError(f"{method} {self._safe(url)} failed: {reason}") from None

    @staticmethod
    def _safe(url: str) -> str:
        """URL without query string (query strings of presigned URLs carry credentials)."""
        p = urllib.parse.urlsplit(url)
        return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, "", ""))

    def request(self, method: str, url: str, *, data: Any = None, headers: dict[str, str] | None = None, timeout: float | None = None) -> Response:
        with self._open(method, url, data=data, headers=headers, timeout=timeout) as resp:
            return Response(resp.status, dict(resp.headers.items()), resp.read())

    def with_retries(self, what: str, fn: Callable[[], T], retries: int | None = None) -> T:
        attempts = retries or self.retries
        delay = self.backoff
        for attempt in range(1, attempts + 1):
            try:
                return fn()
            except TransientError as exc:
                if attempt >= attempts:
                    raise
                log.warning("transient error, retrying", extra={"what": what, "attempt": attempt, "error": str(exc), "retry_in_s": delay})
                self._sleep(delay)
                delay = min(delay * 2, 60.0)
        raise AssertionError("unreachable")

    # ------------------------------------------------------------------ endpoints
    def heartbeat(self, payload: dict[str, Any]) -> Response:
        body = json.dumps(payload).encode("utf-8")
        url = self.url(f"{BRIDGE_PREFIX}/heartbeat")
        return self.with_retries("heartbeat", lambda: self.request("POST", url, data=body, headers={"Content-Type": "application/json"}), retries=1)

    def next_job(self, bridge_id: str) -> dict[str, Any] | None:
        """Claim the next job. Not retried: a lost response must not claim a second job."""
        resp = self.request("GET", self.url(f"{BRIDGE_PREFIX}/jobs/next", bridgeId=bridge_id))
        if resp.status == 204 or not resp.body.strip():
            return None
        job = resp.json()
        if not isinstance(job, dict) or not job.get("jobId"):
            raise ApiError(f"jobs/next returned an unexpected payload: {resp.body[:200]!r}", resp.status)
        return job

    def contract_url(self, job: dict[str, Any]) -> str:
        return self.url(job.get("contractUrl") or f"{BRIDGE_PREFIX}/jobs/{urllib.parse.quote(str(job['jobId']), safe='')}/contract")

    def assets_url(self, job: dict[str, Any]) -> str:
        return self.url(job.get("assetsUrl") or f"{BRIDGE_PREFIX}/jobs/{urllib.parse.quote(str(job['jobId']), safe='')}/assets.zip")

    def download(self, url: str, dest: Path, *, max_bytes: int | None = None) -> int:
        """Stream ``url`` to ``dest`` (atomically). Returns the byte count."""

        def attempt() -> int:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + ".part")
            total = 0
            try:
                with self._open("GET", url) as resp, open(tmp, "wb") as out:
                    if resp.status == 204:
                        raise NotFoundError(f"GET {self._safe(url)} -> 204 (no content)", 204)
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if max_bytes is not None and total > max_bytes:
                            raise ApiError(f"download of {self._safe(url)} exceeds the {max_bytes} byte limit")
                        out.write(chunk)
                os.replace(tmp, dest)
                return total
            finally:
                if tmp.exists():
                    tmp.unlink()

        return self.with_retries(f"download {self._safe(url)}", attempt)

    def result_url(self, job_id: str) -> str:
        return self.url(f"{BRIDGE_PREFIX}/jobs/{urllib.parse.quote(job_id, safe='')}/result")

    def post_result_success(self, job_id: str, files: dict[str, Path], report: dict[str, Any]) -> Response:
        """multipart: status=succeeded, report=<json>, files indd / pdf (/ idml)."""

        def attempt() -> Response:
            parts: list[FieldPart | FilePart] = [
                FieldPart("status", "succeeded"),
                FieldPart("report", json.dumps(report, ensure_ascii=False)),
            ]
            parts += [FilePart(name, path) for name, path in files.items()]
            body = MultipartBody(parts)
            headers = {"Content-Type": body.content_type, "Content-Length": str(len(body))}
            return self.request("POST", self.result_url(job_id), data=body, headers=headers, timeout=max(self.timeout, 600.0))

        return self.with_retries(f"upload result {job_id}", attempt)

    def post_result_failure(self, job_id: str, error: str, report: dict[str, Any] | None = None) -> Response:
        """multipart: status=failed, error=<message>, report=<json> (when a report exists)."""

        def attempt() -> Response:
            parts: list[FieldPart | FilePart] = [FieldPart("status", "failed"), FieldPart("error", error[:8000])]
            if report is not None:
                parts.append(FieldPart("report", json.dumps(report, ensure_ascii=False)))
            body = MultipartBody(parts)
            headers = {"Content-Type": body.content_type, "Content-Length": str(len(body))}
            return self.request("POST", self.result_url(job_id), data=body, headers=headers)

        return self.with_retries(f"report failure {job_id}", attempt)
