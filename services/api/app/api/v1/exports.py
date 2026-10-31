"""Exports: create (validated contract), list, authorised download (stream or presigned redirect)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select

from app.deps import DB, CurrentAuth, require
from app.models import Export
from app.schemas.pages import ExportCreateRequest, ExportRecord
from app.services import serializers as ser
from app.services.activity import record_activity
from app.services.contract import validate_contract
from app.services.exports import create_export
from app.services.project_context import project_contract
from app.services.storage import get_storage

from .common import PFRoute, get_export, get_project

router = APIRouter(tags=["exports"], route_class=PFRoute)


@router.post("/projects/{project_id}/exports", response_model=ExportRecord, status_code=202)
def create(project_id: str, body: ExportCreateRequest, db: DB, ctx=require("export.create")) -> ExportRecord:
    p = get_project(db, ctx, project_id)
    markup: dict[str, str] = {}
    contract = body.contract or project_contract(db, p, markup)
    errors = validate_contract(contract)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Layout contract failed schema validation.",
                                                     "errors": errors})
    if contract.get("project_id") and contract["project_id"] != p.id:
        raise HTTPException(status_code=422, detail="contract.project_id does not match this project")
    exp = create_export(db, p, ctx.user_id, body.format, contract, body.renderer, body.force, markup=markup)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"requested {body.format} export ({exp.status})",
                    target=p.title, kind="export", project_id=p.id)
    db.commit()
    return ser.export(exp)


@router.get("/projects/{project_id}/exports", response_model=list[ExportRecord])
def list_exports(project_id: str, ctx: CurrentAuth, db: DB) -> list[ExportRecord]:
    p = get_project(db, ctx, project_id)
    rows = db.scalars(select(Export).where(Export.project_id == p.id).order_by(Export.created_at.desc()))
    return [ser.export(e) for e in rows]


@router.get("/exports/{export_id}", response_model=ExportRecord)
def get_export_route(export_id: str, ctx: CurrentAuth, db: DB) -> ExportRecord:
    return ser.export(get_export(db, ctx, export_id))


@router.get("/exports/{export_id}/download")
def download(export_id: str, ctx: CurrentAuth, db: DB, file: str | None = None):
    e = get_export(db, ctx, export_id)
    key, name, ctype = e.storage_key, e.file_name, e.content_type
    extra = e.extra_files or {}
    if file in ("pdf", "indd", "idml") and extra.get(file):
        key = extra[file]
        name = name.rsplit(".", 1)[0] + f".{file}"
        ctype = {"pdf": "application/pdf", "indd": "application/x-indesign",
                 "idml": "application/vnd.adobe.indesign-idml-package"}[file]
    elif file:
        raise HTTPException(status_code=404, detail=f"This export has no '{file}' file.")
    if e.status != "complete" or not key:
        raise HTTPException(status_code=409, detail=f"Export is {e.status}; nothing to download.")
    storage = get_storage()
    url = storage.presigned_url(key, name, ctype)
    if url:
        return RedirectResponse(url, status_code=307)
    if not storage.exists(key):
        raise HTTPException(status_code=410, detail="The export file is no longer in storage.")
    size = storage.size(key)
    return StreamingResponse(storage.iter_chunks(key), media_type=ctype or "application/octet-stream",
                             headers={"Content-Length": str(size),
                                      "Content-Disposition": f'attachment; filename="{name}"',
                                      "Cache-Control": "private, no-store"})
