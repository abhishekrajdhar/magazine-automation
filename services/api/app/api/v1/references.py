"""Reference magazines: upload, analysis jobs, page renders, page corrections."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select

from app.config import get_settings
from app.deps import DB, CurrentAuth, require
from app.ids import new_id
from app.models import Job, ReferenceMagazine, ReferencePage
from app.schemas.pages import JobRef
from app.schemas.reference import (
    AnalyseResponse,
    ReferenceMagazine as RefSchema,
    ReferencePage as RefPageSchema,
    ReferencePageUpdate,
    ReferenceUploadResponse,
)
from app.services import serializers as ser
from app.services.activity import record_activity
from app.services.jobs.queue import enqueue
from app.services.reference_analysis import render_page_png
from app.services.reference_analysis.extract import open_pdf
from app.services.storage import get_storage

from .common import PFRoute, get_reference, safe_filename, save_upload_to_temp

router = APIRouter(prefix="/references", tags=["references"], route_class=PFRoute)

INDD_MAGIC = bytes.fromhex("0606edf5d81d46e5bd31efe7fe74b71d")  # InDesign document GUID header


def _start_analysis(db, ref: ReferenceMagazine) -> Job:
    job = enqueue(db, "reference_analysis", {"referenceId": ref.id}, org_id=ref.org_id, result_ref=ref.id)
    ref.status = "analysing"
    ref.analysis_progress = 0
    ref.analysis_message = "Queued for analysis"
    return job


@router.post("", response_model=ReferenceUploadResponse, status_code=201)
async def upload_reference(db: DB, ctx=require("design.write"), file: UploadFile = File(...),
                           title: str | None = Form(None), design_source: UploadFile | None = File(None, alias="designSource"),
                           analyse: bool = Form(True)) -> ReferenceUploadResponse:
    s = get_settings()
    limit = s.max_reference_upload_mb * 1024 * 1024
    tmp, size, head = await save_upload_to_temp(file, limit, ".pdf")
    extra_tmp = None
    try:
        if not head.startswith(b"%PDF-"):
            raise HTTPException(status_code=415, detail="This file is not a PDF (missing %PDF- header).")
        try:
            doc = open_pdf(tmp)
            pages = doc.page_count
            meta_title = (doc.metadata or {}).get("title")
            encrypted = doc.needs_pass
            doc.close()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"The PDF could not be opened: {e}") from e
        if encrypted:
            raise HTTPException(status_code=422, detail="The PDF is password-protected; upload an unlocked copy.")
        if pages == 0:
            raise HTTPException(status_code=422, detail="The PDF has no pages.")
        rid = new_id("ref")
        storage = get_storage()
        name = safe_filename(file.filename, "reference.pdf")
        key = f"references/{ctx.org_id}/{rid}/source.pdf"
        storage.put_file(key, tmp, "application/pdf")
        ref = ReferenceMagazine(id=rid, org_id=ctx.org_id, title=(title or meta_title or Path(name).stem)[:300],
                                file_name=name, file_size_bytes=size, page_count=pages, status="uploaded",
                                analyser="pymupdf", storage_key=key, uploaded_by=ctx.user_id)
        if design_source is not None and design_source.filename:
            dname = safe_filename(design_source.filename, "design")
            dext = Path(dname).suffix.lower()
            if dext not in (".indd", ".idml"):
                raise HTTPException(status_code=415, detail="Design source must be an .indd or .idml file.")
            extra_tmp, _, dhead = await save_upload_to_temp(design_source, limit, dext)
            if dext == ".idml" and not dhead.startswith(b"PK"):
                raise HTTPException(status_code=415, detail="The .idml file is not a valid IDML package (zip).")
            if dext == ".indd" and not dhead.startswith(INDD_MAGIC):
                raise HTTPException(status_code=415, detail="The .indd file does not have an InDesign document header.")
            ref.indd_key = f"references/{ctx.org_id}/{rid}/design-source{dext}"
            ref.indd_file_name = dname
            storage.put_file(ref.indd_key, extra_tmp, "application/octet-stream")
        db.add(ref)
        db.flush()
        job = _start_analysis(db, ref) if analyse else None
        record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="uploaded reference magazine", target=ref.title,
                        kind="reference")
        db.commit()
        return ReferenceUploadResponse(reference=ser.reference(ref), job_id=job.id if job else None)
    finally:
        Path(tmp).unlink(missing_ok=True)
        if extra_tmp:
            Path(extra_tmp).unlink(missing_ok=True)


@router.get("", response_model=list[RefSchema])
def list_references(ctx: CurrentAuth, db: DB) -> list[RefSchema]:
    rows = db.scalars(select(ReferenceMagazine).where(ReferenceMagazine.org_id == ctx.org_id)
                      .order_by(ReferenceMagazine.created_at.desc()))
    return [ser.reference(r) for r in rows]


@router.get("/{ref_id}", response_model=RefSchema)
def get_reference_route(ref_id: str, ctx: CurrentAuth, db: DB) -> RefSchema:
    return ser.reference(get_reference(db, ctx, ref_id))


@router.post("/{ref_id}/analyse", response_model=AnalyseResponse, status_code=202)
def analyse(ref_id: str, db: DB, ctx=require("design.write")) -> AnalyseResponse:
    ref = get_reference(db, ctx, ref_id)
    if not ref.storage_key:
        raise HTTPException(status_code=409, detail="This reference has no stored PDF to analyse (demo record).")
    running = db.scalar(select(Job).where(Job.kind == "reference_analysis", Job.status.in_(("queued", "running")),
                                          Job.result_ref == ref.id))
    if running:
        return AnalyseResponse(job_id=running.id, reference=ser.reference(ref))
    job = _start_analysis(db, ref)
    db.commit()
    return AnalyseResponse(job_id=job.id, reference=ser.reference(ref))


@router.get("/{ref_id}/pages", response_model=list[RefPageSchema])
def pages(ref_id: str, ctx: CurrentAuth, db: DB) -> list[RefPageSchema]:
    ref = get_reference(db, ctx, ref_id)
    rows = db.scalars(select(ReferencePage).where(ReferencePage.reference_id == ref.id).order_by(ReferencePage.page_number))
    return [ser.reference_page(p, bool(ref.storage_key)) for p in rows]


@router.get("/{ref_id}/pages/{page_number}/image")
def page_image(ref_id: str, page_number: int, ctx: CurrentAuth, db: DB,
               scale: float = Query(1.0, ge=0.1, le=4.0)) -> Response:
    ref = get_reference(db, ctx, ref_id)
    if not ref.storage_key:
        raise HTTPException(status_code=404, detail="No source PDF stored for this reference.")
    if page_number < 1 or (ref.page_count and page_number > ref.page_count):
        raise HTTPException(status_code=404, detail="Page out of range")
    scale = round(scale * 4) / 4 or 0.25  # quantise so the cache stays small
    storage = get_storage()
    key = f"extracted/references/{ref.org_id}/{ref.id}/page-{page_number:04d}@{scale:g}x.png"
    if storage.exists(key):
        data = storage.get_bytes(key)
    else:
        with storage.local_path(ref.storage_key) as pdf:
            try:
                data = render_page_png(pdf, page_number, scale)
            except ValueError as e:
                raise HTTPException(status_code=404, detail=str(e)) from e
        storage.put_bytes(key, data, "image/png")
    return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/{ref_id}/pages/{page_number}/reanalyse", response_model=JobRef, status_code=202)
def reanalyse_page(ref_id: str, page_number: int, db: DB, ctx=require("design.write")) -> JobRef:
    ref = get_reference(db, ctx, ref_id)
    if not ref.storage_key:
        raise HTTPException(status_code=409, detail="No source PDF stored for this reference.")
    if page_number < 1 or page_number > (ref.page_count or 0):
        raise HTTPException(status_code=404, detail="Page out of range")
    job = enqueue(db, "page_reanalysis", {"referenceId": ref.id, "pageNumber": page_number}, org_id=ref.org_id,
                  result_ref=ref.id)
    db.commit()
    return JobRef(job_id=job.id, job=ser.job(job))


@router.patch("/{ref_id}/pages/{page_number}", response_model=RefPageSchema)
def correct_page(ref_id: str, page_number: int, body: ReferencePageUpdate, db: DB,
                 ctx=require("design.write")) -> RefPageSchema:
    ref = get_reference(db, ctx, ref_id)
    page = db.scalar(select(ReferencePage).where(ReferencePage.reference_id == ref.id,
                                                 ReferencePage.page_number == page_number))
    if page is None:
        raise HTTPException(status_code=404, detail="Page not analysed yet")
    page.layout_type = body.layout_type
    page.corrected = True
    page.confidence = 1.0
    # keep the profile's page-type counts in sync with human corrections
    if ref.design_profile_id:
        from app.models import DesignProfile

        dp = db.get(DesignProfile, ref.design_profile_id)
        if dp is not None:
            counts: dict[str, int] = {}
            for p in db.scalars(select(ReferencePage).where(ReferencePage.reference_id == ref.id)):
                counts[p.layout_type] = counts.get(p.layout_type, 0) + 1
            dp.profile = {**(dp.profile or {}), "pageTypeCounts": counts}
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"corrected page {page_number} to {body.layout_type}",
                    target=ref.title, kind="reference")
    db.commit()
    return ser.reference_page(page, bool(ref.storage_key))
