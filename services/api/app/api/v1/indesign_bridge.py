"""InDesign bridge API (called by services/indesign). Auth: `Authorization: Bearer <INDESIGN_BRIDGE_TOKEN>`."""

from __future__ import annotations

import hmac
import json
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import Field
from sqlalchemy import select

from app.config import get_settings
from app.deps import DB
from app.ids import as_utc, iso, utcnow
from app.models import Export, IndesignBridge, Job
from app.schemas.base import CamelModel
from app.services.exports import assets_zip_for_contract
from app.services.jobs.queue import claim_next
from app.services.storage import get_storage

from .common import PFRoute, safe_filename

router = APIRouter(prefix="/indesign/bridge", tags=["indesign-bridge"], route_class=PFRoute)


def bridge_auth(authorization: str | None = Header(default=None)) -> None:
    token = get_settings().indesign_bridge_token
    if not token:
        raise HTTPException(status_code=503, detail="INDESIGN_BRIDGE_TOKEN is not configured on the API.")
    supplied = (authorization or "")[7:].strip() if (authorization or "").lower().startswith("bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, token):
        raise HTTPException(status_code=401, detail="Invalid bridge token")


Auth = Depends(bridge_auth)


class Heartbeat(CamelModel):
    bridge_id: str = Field(min_length=1, max_length=120)
    hostname: str = ""
    mode: Literal["desktop", "server"] = "desktop"
    indesign_version: str = ""
    platform: str = ""
    fonts: list[str] = Field(default_factory=list)


@router.post("/heartbeat", dependencies=[Auth])
def heartbeat(body: Heartbeat, db: DB) -> dict:
    b = db.get(IndesignBridge, body.bridge_id)
    if b is None:
        b = IndesignBridge(id=body.bridge_id)
        db.add(b)
    b.hostname, b.mode, b.indesign_version, b.platform = body.hostname, body.mode, body.indesign_version, body.platform
    b.fonts = sorted(set(body.fonts))[:20000]
    b.last_heartbeat_at = utcnow()
    db.commit()
    return {"ok": True, "serverTime": utcnow().isoformat(), "fontCount": len(b.fonts)}


def _abs(request: Request, path: str) -> str:
    s = get_settings()
    base = s.public_api_url.rstrip("/") if s.public_api_url else str(request.base_url).rstrip("/")
    return f"{base}{path}"


def _bridge_job(db, job_id: str) -> tuple[Job, Export]:
    job = db.get(Job, job_id)
    if job is None or job.queue != "indesign":
        raise HTTPException(status_code=404, detail="Job not found")
    exp = db.get(Export, (job.payload or {}).get("exportId"))
    if exp is None:
        raise HTTPException(status_code=404, detail="Export not found")
    return job, exp


@router.get("/jobs", dependencies=[Auth])
def list_jobs(db: DB, status: Literal["queued", "running", "succeeded", "failed"] | None = None,
              limit: int = Query(50, ge=1, le=200)) -> dict:
    """Queue overview for the bridge's UXP panel."""
    requeue_expired_bridge_jobs(db)
    q = select(Job).where(Job.queue == "indesign").order_by(Job.created_at.desc()).limit(limit)
    if status:
        q = q.where(Job.status == status)
    out = []
    for j in db.scalars(q):
        exp = db.get(Export, (j.payload or {}).get("exportId"))
        out.append({"jobId": j.id, "exportId": exp.id if exp else None, "format": exp.format if exp else None,
                    "status": j.status, "attempts": j.attempts, "createdAt": iso(j.created_at),
                    "fileName": exp.file_name if exp else None})
    return {"jobs": out}


@router.get("/jobs/next", dependencies=[Auth])
def next_job(request: Request, db: DB, bridge_id: str = Query(alias="bridgeId")):
    b = db.get(IndesignBridge, bridge_id)
    if b is None:
        raise HTTPException(status_code=409, detail="Unknown bridge; send a heartbeat first.")
    b.last_heartbeat_at = utcnow()
    db.commit()
    requeue_expired_bridge_jobs(db)
    lease = get_settings().bridge_job_lease_seconds
    while True:
        job = claim_next("indesign", worker_id=f"bridge:{bridge_id}", lease_seconds=lease)
        if job is None:
            return Response(status_code=204)
        job = db.get(Job, job.id)
        db.refresh(job)
        exp = db.get(Export, (job.payload or {}).get("exportId"))
        if exp is None:
            job.status, job.error, job.finished_at = "failed", "Export record missing", utcnow()
            db.commit()
            continue
        if job.attempts > job.max_attempts:
            _fail(job, exp, f"No result after {job.max_attempts} bridge attempts (lease {lease}s each).")
            db.commit()
            continue
        break
    exp.status = "running"
    exp.message = f"Rendering on InDesign bridge {bridge_id} (attempt {job.attempts})"
    db.commit()
    options: dict = {"pdfPreset": "[PDF/X-4:2008]" if exp.format == "pdf_print" else "[High Quality Print]",
                     "includeBleed": exp.format in ("pdf_print", "indd")}
    if (exp.options or {}).get("force") is True:
        options["force"] = True  # only when a user explicitly forced export of unapproved pages
    return JSONResponse({
        "jobId": job.id, "exportId": exp.id, "format": exp.format,
        "contractUrl": _abs(request, f"/api/v1/indesign/bridge/jobs/{job.id}/contract"),
        "assetsUrl": _abs(request, f"/api/v1/indesign/bridge/jobs/{job.id}/assets.zip"),
        "options": options,
    })


def _fail(job: Job, exp: Export, message: str, report: dict | None = None) -> None:
    job.status = "failed"
    job.error = message[:2000]
    job.finished_at = utcnow()
    job.lease_until = None
    exp.status = "failed"
    exp.message = f"InDesign bridge failed: {message}"[:2000]
    exp.report = report
    exp.completed_at = utcnow()


def requeue_expired_bridge_jobs(db) -> int:
    """Claimed-but-silent bridge jobs: back to the queue after the lease (or fail after max attempts)."""
    now = utcnow()
    n = 0
    for job in db.scalars(select(Job).where(Job.queue == "indesign", Job.status == "running",
                                            Job.lease_until.is_not(None))):
        if as_utc(job.lease_until) >= now:
            continue
        exp = db.get(Export, (job.payload or {}).get("exportId"))
        if job.attempts >= job.max_attempts:
            if exp is not None:
                _fail(job, exp, f"No result from the InDesign bridge within the lease after {job.attempts} attempt(s).")
            else:
                job.status = "failed"
        else:
            job.status, job.lease_until, job.locked_by = "queued", None, None
            job.message = "Re-queued: the bridge did not report a result before the lease expired"
            if exp is not None:
                exp.status = "queued"
                exp.message = job.message
        n += 1
    if n:
        db.commit()
    return n


@router.get("/jobs/{job_id}/contract", dependencies=[Auth])
def job_contract(job_id: str, db: DB) -> JSONResponse:
    _, exp = _bridge_job(db, job_id)
    return JSONResponse(exp.contract or {})


@router.get("/jobs/{job_id}/assets.zip", dependencies=[Auth])
def job_assets(job_id: str, db: DB) -> Response:
    _, exp = _bridge_job(db, job_id)
    data = assets_zip_for_contract(db, exp.project_id, exp.contract or {})
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{exp.id}-assets.zip"'})


@router.post("/jobs/{job_id}/result", dependencies=[Auth])
async def job_result(job_id: str, db: DB, status: str | None = Form(None), error: str | None = Form(None),
                     report: str | None = Form(None), indd: UploadFile | None = File(None),
                     pdf: UploadFile | None = File(None), idml: UploadFile | None = File(None)) -> dict:
    """Success: status=succeeded + report JSON + files (indd, pdf and/or idml). Failure: status=failed + error."""
    job, exp = _bridge_job(db, job_id)
    if job.status not in ("running", "queued"):
        raise HTTPException(status_code=409, detail=f"Job is already {job.status}")
    report_obj = None
    if report:
        try:
            report_obj = json.loads(report)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=422, detail="report must be JSON") from e
    files = [(f, up) for f, up in (("indd", indd), ("pdf", pdf), ("idml", idml)) if up is not None and up.filename]
    if (status or "").lower() == "failed" or not files:
        _fail(job, exp, error or ("Bridge reported failure" if status == "failed" else "Bridge sent no files"), report_obj)
        db.commit()
        return {"ok": True, "status": "failed"}
    storage = get_storage()
    ctypes = {"indd": "application/x-indesign", "pdf": "application/pdf", "idml": "application/vnd.adobe.indesign-idml-package"}
    extra: dict = {}
    total = 0
    for field, up in files:
        data = await up.read()
        if field == "pdf" and not data.startswith(b"%PDF-"):
            raise HTTPException(status_code=422, detail="pdf is not a PDF file")
        if field == "idml" and not data.startswith(b"PK"):
            raise HTTPException(status_code=422, detail="idml is not an IDML package")
        key = f"exports/{exp.org_id}/{exp.project_id}/{exp.id}-indesign.{field}"
        storage.put_bytes(key, data, ctypes[field])
        extra[field] = key
        extra[f"{field}Name"] = safe_filename(up.filename, f"{exp.id}.{field}")
        total += len(data)
    primary = "pdf" if exp.format in ("pdf_print", "pdf_digital") else "indd"
    if primary not in extra:
        _fail(job, exp, f"Bridge result for {exp.format} did not include the required '{primary}' file "
                        f"(received: {', '.join(f for f, _ in files)}).", report_obj)
        db.commit()
        raise HTTPException(status_code=422, detail=f"Export format {exp.format} requires the '{primary}' file")
    exp.storage_key = extra[primary]
    exp.extra_files = extra
    exp.size_bytes = storage.size(extra[primary])
    exp.content_type = ctypes[primary]
    exp.renderer = "indesign"
    exp.status = "complete"
    exp.report = report_obj
    exp.message = "Rendered by Adobe InDesign via the PressFlow bridge."
    exp.completed_at = utcnow()
    job.status = "succeeded"
    job.progress = 100
    job.finished_at = utcnow()
    job.lease_until = None
    bridge_id = (job.locked_by or "").removeprefix("bridge:")
    b = db.get(IndesignBridge, bridge_id) if bridge_id else None
    if b:
        b.jobs_completed += 1
    db.commit()
    return {"ok": True, "status": "complete", "bytes": total, "files": sorted(k for k in extra if "Name" not in k)}
