"""DB-backed job queue.

* `enqueue()` inserts a row (status=queued).
* Workers claim with an optimistic conditional UPDATE (works on SQLite and PostgreSQL):
  a job is claimable when queued and due, or running with an expired lease.
* Handlers report progress through `JobContext.progress()` (which also renews the lease).
* `RetryableError` / unexpected exceptions retry with exponential backoff until
  `max_attempts`; `PermanentError` fails immediately.
"""

from __future__ import annotations

import logging
import socket
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_factory
from app.ids import new_id, utcnow
from app.models import Job

log = logging.getLogger("pressflow.jobs")


class PermanentError(Exception):
    """Do not retry (configuration missing, invalid input, policy refusal)."""


class RetryableError(Exception):
    """Transient failure (network, rate limit). Retried with backoff."""


@dataclass
class JobContext:
    job_id: str
    kind: str
    payload: dict[str, Any]
    attempt: int
    org_id: str | None
    _worker_id: str = field(default="")

    def progress(self, pct: float, message: str | None = None) -> None:
        s = get_settings()
        with session_factory()() as db:
            db.execute(
                update(Job)
                .where(Job.id == self.job_id)
                .values(
                    progress=max(0.0, min(100.0, float(pct))),
                    message=message,
                    lease_until=utcnow() + timedelta(seconds=s.job_lease_seconds),
                    updated_at=utcnow(),
                )
            )
            db.commit()

    def set_result(self, ref: str) -> None:
        with session_factory()() as db:
            db.execute(update(Job).where(Job.id == self.job_id).values(result_ref=ref, updated_at=utcnow()))
            db.commit()


Handler = Callable[[JobContext], None]
FailureHook = Callable[[JobContext, str], None]

_HANDLERS: dict[str, Handler] = {}
_FAILURE_HOOKS: dict[str, FailureHook] = {}


def register(kind: str, on_final_failure: FailureHook | None = None) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        _HANDLERS[kind] = fn
        if on_final_failure:
            _FAILURE_HOOKS[kind] = on_final_failure
        return fn

    return deco


def enqueue(
    db: Session,
    kind: str,
    payload: dict[str, Any],
    *,
    org_id: str | None,
    queue: str = "default",
    max_attempts: int | None = None,
    result_ref: str | None = None,
) -> Job:
    job = Job(
        id=new_id("job"),
        org_id=org_id,
        kind=kind,
        queue=queue,
        status="queued",
        progress=0.0,
        attempts=0,
        max_attempts=max_attempts or get_settings().job_max_attempts,
        payload=payload,
        result_ref=result_ref,
        run_after=utcnow(),
        message="Queued",
    )
    db.add(job)
    db.flush()
    return job


def _claimable(now, queue: str):
    return and_(
        Job.queue == queue,
        or_(
            and_(Job.status == "queued", or_(Job.run_after.is_(None), Job.run_after <= now)),
            and_(Job.status == "running", Job.lease_until.is_not(None), Job.lease_until < now),
        ),
    )


def claim_next(queue: str = "default", worker_id: str | None = None, lease_seconds: int | None = None,
               kinds: list[str] | None = None) -> Job | None:
    s = get_settings()
    worker_id = worker_id or f"{socket.gethostname()}:{id(object())}"
    lease = lease_seconds or s.job_lease_seconds
    with session_factory()() as db:
        now = utcnow()
        q = select(Job.id).where(_claimable(now, queue)).order_by(Job.created_at).limit(5)
        if kinds:
            q = q.where(Job.kind.in_(kinds))
        for job_id in db.scalars(q).all():
            res = db.execute(
                update(Job)
                .where(Job.id == job_id, _claimable(now, queue))
                .values(
                    status="running",
                    locked_by=worker_id,
                    lease_until=now + timedelta(seconds=lease),
                    attempts=Job.attempts + 1,
                    updated_at=now,
                )
            )
            db.commit()
            if res.rowcount == 1:
                return db.get(Job, job_id)
    return None


def _finish(job_id: str, **values: Any) -> None:
    with session_factory()() as db:
        db.execute(update(Job).where(Job.id == job_id).values(updated_at=utcnow(), **values))
        db.commit()


def run_job(job: Job) -> str:
    """Execute a claimed job. Returns the final status for this attempt."""
    s = get_settings()
    handler = _HANDLERS.get(job.kind)
    ctx = JobContext(job_id=job.id, kind=job.kind, payload=dict(job.payload or {}), attempt=job.attempts, org_id=job.org_id)
    if handler is None:
        _finish(job.id, status="failed", error=f"No handler registered for job kind {job.kind!r}", finished_at=utcnow(),
                lease_until=None)
        return "failed"
    try:
        handler(ctx)
    except PermanentError as e:
        log.warning("job %s (%s) failed permanently: %s", job.id, job.kind, e)
        _finish(job.id, status="failed", error=str(e), message=str(e), finished_at=utcnow(), lease_until=None)
        _run_failure_hook(ctx, str(e))
        return "failed"
    except Exception as e:  # noqa: BLE001 - every failure must be recorded
        msg = f"{type(e).__name__}: {e}"
        log.error("job %s (%s) attempt %s failed: %s\n%s", job.id, job.kind, job.attempts, msg, traceback.format_exc())
        if job.attempts < job.max_attempts:
            delay = s.job_backoff_base_seconds * (2 ** (job.attempts - 1))
            _finish(
                job.id,
                status="queued",
                error=msg,
                message=f"Attempt {job.attempts} failed; retrying in {int(delay)}s",
                run_after=utcnow() + timedelta(seconds=delay),
                lease_until=None,
                locked_by=None,
            )
            return "queued"
        _finish(job.id, status="failed", error=msg, message=f"Failed after {job.attempts} attempts: {msg}",
                finished_at=utcnow(), lease_until=None)
        _run_failure_hook(ctx, msg)
        return "failed"
    _finish(job.id, status="succeeded", progress=100.0, error=None, finished_at=utcnow(), lease_until=None)
    return "succeeded"


def _run_failure_hook(ctx: JobContext, message: str) -> None:
    hook = _FAILURE_HOOKS.get(ctx.kind)
    if not hook:
        return
    try:
        hook(ctx, message)
    except Exception:  # noqa: BLE001
        log.exception("failure hook for %s raised", ctx.kind)


def run_pending(max_jobs: int = 50, ignore_schedule: bool = False) -> int:
    """Synchronously drain due jobs on the default queue (used by tests + scripts)."""
    n = 0
    while n < max_jobs:
        if ignore_schedule:
            with session_factory()() as db:
                db.execute(update(Job).where(Job.status == "queued", Job.queue == "default").values(run_after=None))
                db.commit()
        job = claim_next("default", worker_id="inline-sync")
        if job is None:
            break
        run_job(job)
        n += 1
    return n


def cancel_jobs_for(db: Session, kind: str, key: str, value: str) -> None:
    for job in db.scalars(select(Job).where(Job.kind == kind, Job.status == "queued")).all():
        if (job.payload or {}).get(key) == value:
            job.status = "cancelled"
            job.finished_at = utcnow()
