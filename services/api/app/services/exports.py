"""Export creation + the `export_render` job handler.

pdf_digital / pdf_print -> ReportLab preview renderer (print adds bleed, crop marks, slug)
page_previews           -> rendered PDF rasterised per page with PyMuPDF, zipped
layout_json             -> the validated layout contract
content_package         -> approved articles as Markdown + JSON (zip)
asset_archive           -> stored project assets (zip)
indd                    -> InDesign bridge only; never faked
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

import pymupdf
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import session_factory
from app.ids import iso, new_id, utcnow
from app.models import Article, Asset, Export, Project
from app.services import serializers as ser
from app.services.jobs.queue import JobContext, PermanentError, enqueue, register
from app.services.project_context import asset_resolver, dump, online_bridges, placeholder_asset_ids
from app.services.renderers import render_contract
from app.services.storage import get_storage

FILE_EXT = {"pdf_digital": ".pdf", "pdf_print": ".pdf", "indd": ".indd", "page_previews": ".zip",
            "content_package": ".zip", "asset_archive": ".zip", "layout_json": ".json"}
CONTENT_TYPES = {".pdf": "application/pdf", ".zip": "application/zip", ".json": "application/json",
                 ".indd": "application/x-indesign"}
FINAL_FORMATS = {"pdf_print", "indd"}


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "magazine").lower()).strip("-")[:60] or "magazine"


def file_name_for(project: Project, fmt: str) -> str:
    suffix = {"pdf_digital": "digital", "pdf_print": "print", "indd": "indesign", "page_previews": "page-previews",
              "content_package": "content", "asset_archive": "assets", "layout_json": "layout"}[fmt]
    return f"{slugify(project.title)}-{suffix}{FILE_EXT[fmt]}"


def create_export(db: Session, project: Project, user_id: str, fmt: str, contract: dict, renderer_pref: str,
                  force: bool, markup: dict[str, str] | None = None) -> Export:
    # `markup` (frame id -> frontend text markup) only feeds the ReportLab preview; the contract stays plain text.
    exp = Export(id=new_id("exp"), org_id=project.org_id, project_id=project.id, format=fmt, status="queued",
                 renderer="reportlab", file_name=file_name_for(project, fmt), contract=contract,
                 options={"force": force, **({"markup": markup} if markup else {})}, created_by=user_id)
    db.add(exp)
    unapproved = [p["page_number"] for p in contract.get("pages", []) if not p.get("approved")]

    if fmt in FINAL_FORMATS and unapproved and not force:
        exp.status = "failed"
        exp.message = (f"Final output refused: {len(unapproved)} page(s) have unapproved content "
                       f"(pages {unapproved[:12]}). Approve them, or export with force=true for a watermarked proof.")
        exp.completed_at = utcnow()
        return exp

    bridges = online_bridges(db)
    if fmt == "indd":
        exp.renderer = "indesign"
        if not bridges:
            exp.status = "unavailable"
            exp.message = "InDesign bridge not connected"
            exp.completed_at = utcnow()
            return exp
        job = enqueue(db, "export_render", {"exportId": exp.id, "renderer": "indesign"}, org_id=project.org_id,
                      queue="indesign", max_attempts=2, result_ref=exp.id)
        exp.job_id = job.id
        exp.message = "Queued for the InDesign bridge"
        return exp

    if fmt == "pdf_print" and renderer_pref in ("indesign", "auto") and bridges:
        exp.renderer = "indesign"
        job = enqueue(db, "export_render", {"exportId": exp.id, "renderer": "indesign"}, org_id=project.org_id,
                      queue="indesign", max_attempts=2, result_ref=exp.id)
        exp.job_id = job.id
        exp.message = "Queued for the InDesign bridge"
        return exp
    if renderer_pref == "indesign" and fmt != "pdf_print":
        exp.status = "failed"
        exp.message = f"The InDesign renderer only produces indd and pdf_print, not {fmt}."
        exp.completed_at = utcnow()
        return exp
    if renderer_pref == "indesign" and not bridges:
        exp.status = "unavailable"
        exp.renderer = "indesign"
        exp.message = "InDesign bridge not connected"
        exp.completed_at = utcnow()
        return exp

    job = enqueue(db, "export_render", {"exportId": exp.id, "renderer": "reportlab"}, org_id=project.org_id,
                  result_ref=exp.id)
    exp.job_id = job.id
    return exp


def _on_failure(ctx: JobContext, message: str) -> None:
    with session_factory()() as db:
        exp = db.get(Export, ctx.payload.get("exportId"))
        if exp and exp.status not in ("complete", "unavailable"):
            exp.status = "failed"
            exp.message = message[:1000]
            exp.completed_at = utcnow()
            db.commit()


@register("export_render", on_final_failure=_on_failure)
def run_export(ctx: JobContext) -> None:
    storage = get_storage()
    with session_factory()() as db:
        exp = db.get(Export, ctx.payload["exportId"])
        if exp is None:
            raise PermanentError("Export record no longer exists")
        if ctx.payload.get("renderer") == "indesign":
            raise PermanentError("InDesign jobs are processed by the bridge, not the API worker")
        exp.status = "running"
        db.commit()
        ctx.progress(10, f"Rendering {exp.format}")
        project = db.get(Project, exp.project_id)
        contract = exp.contract or {}
        force = bool((exp.options or {}).get("force"))
        fmt = exp.format
        if fmt in ("pdf_digital", "pdf_print", "page_previews"):
            res = render_contract(contract, asset_resolver(db, exp.project_id),
                                  mode="print" if fmt == "pdf_print" else "digital", watermark_unapproved=True,
                                  markup=(exp.options or {}).get("markup"),
                                  placeholders=placeholder_asset_ids(db, exp.project_id))
            ctx.progress(60, f"Rendered {res.page_count} pages")
            if fmt == "page_previews":
                data = _rasterise(res.pdf)
            else:
                data = res.pdf
            warnings = res.warnings
        elif fmt == "layout_json":
            data = json.dumps(contract, indent=2, ensure_ascii=False).encode("utf-8")
            warnings = []
        elif fmt == "content_package":
            data, warnings = _content_package(db, project)
        elif fmt == "asset_archive":
            data, warnings = _asset_archive(db, project)
        else:
            raise PermanentError(f"Format {fmt} cannot be rendered by the API worker")
        ext = FILE_EXT[fmt]
        key = f"exports/{exp.org_id}/{exp.project_id}/{exp.id}{ext}"
        storage.put_bytes(key, data, CONTENT_TYPES[ext])
        exp.storage_key = key
        exp.size_bytes = len(data)
        exp.content_type = CONTENT_TYPES[ext]
        exp.status = "complete"
        exp.completed_at = utcnow()
        exp.report = {"warnings": warnings[:200], "forced": force}
        notes = []
        if fmt in ("pdf_digital", "pdf_print", "page_previews"):
            notes.append("Preview render (ReportLab, fallback fonts) — not Adobe InDesign output.")
        if warnings:
            notes.append(f"{len(warnings)} warning(s).")
        exp.message = " ".join(notes) or None
        # Draft previews don't publish an issue; only final formats do.
        if project and fmt in ("pdf_print", "indd") and project.status in ("design", "review"):
            project.status = "exported"
        db.commit()
        ctx.set_result(exp.id)


def _rasterise(pdf: bytes, scale: float = 1.5) -> bytes:
    buf = io.BytesIO()
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for i, page in enumerate(doc):
                pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                z.writestr(f"page-{i + 1:03d}.png", pix.tobytes("png"))
            z.writestr("README.txt", "Page previews rasterised from the PressFlow ReportLab preview render "
                                     "(not Adobe InDesign output).\n")
    finally:
        doc.close()
    return buf.getvalue()


def article_markdown(a: dict) -> str:
    out = []
    if a.get("kicker"):
        out.append(f"*{a['kicker']}*\n")
    out.append(f"# {a.get('headline', '')}\n")
    if a.get("subheadline"):
        out.append(f"## {a['subheadline']}\n")
    if a.get("byline"):
        out.append(f"_{a['byline']}_\n")
    if a.get("intro"):
        out.append(f"**{a['intro']}**\n")
    for b in a.get("body") or []:
        t = b.get("text", "")
        k = b.get("kind")
        refs = b.get("sourceRefs") or []
        cite = (" <!-- sources: " + ", ".join(f"{r['videoId']}@{r['start']:.0f}s" for r in refs) + " -->") if refs else ""
        if k == "subhead":
            out.append(f"### {t}{cite}\n")
        elif k == "quote":
            out.append(f"> {t}{cite}\n")
        elif k == "question":
            out.append(f"**Q. {t}**{cite}\n")
        elif k == "answer":
            out.append(f"{t}{cite}\n")
        elif k == "list_item":
            out.append(f"- {t}{cite}")
        else:
            out.append(f"{t}{cite}\n")
    out.append(f"\n---\nApproved by {a.get('approvedBy')} at {a.get('approvedAt')}.\n")
    return "\n".join(out)


def _content_package(db: Session, project: Project) -> tuple[bytes, list[str]]:
    arts = list(db.scalars(select(Article).where(Article.project_id == project.id)).all())
    approved = [a for a in arts if a.status == "approved"]
    warnings = [] if approved else ["No approved articles; the package only contains the manifest."]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        manifest = {"project": dump(ser.project(project)), "exportedAt": iso(utcnow()),
                    "articles": [], "excludedUnapproved": [a.id for a in arts if a.status != "approved"]}
        for a in approved:
            d = dump(ser.article(a))
            base = f"articles/{slugify(a.headline)}-{a.id[-6:]}"
            z.writestr(f"{base}.md", article_markdown(d))
            z.writestr(f"{base}.json", json.dumps(d, indent=2, ensure_ascii=False))
            manifest["articles"].append({"id": a.id, "type": a.type, "headline": a.headline, "file": f"{base}.md"})
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
    return buf.getvalue(), warnings


def _asset_archive(db: Session, project: Project) -> tuple[bytes, list[str]]:
    storage = get_storage()
    warnings: list[str] = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        manifest = []
        for a in db.scalars(select(Asset).where(Asset.project_id == project.id)).all():
            if not a.storage_key or not storage.exists(a.storage_key):
                warnings.append(f"Asset {a.id} ({a.file_name}) has no stored file" + (" (demo placeholder)" if a.simulated else ""))
                continue
            name = f"assets/{a.id}{Path(a.file_name).suffix.lower() or '.bin'}"
            z.writestr(name, storage.get_bytes(a.storage_key))
            manifest.append({**dump(ser.asset(a)), "file": name})
        z.writestr("manifest.json", json.dumps({"assets": manifest, "warnings": warnings}, indent=2))
    return buf.getvalue(), warnings


def assets_zip_for_contract(db: Session, project_id: str, contract: dict) -> bytes:
    """Zip of the files referenced by a contract, at the paths the contract names (for the InDesign bridge)."""
    storage = get_storage()
    rows = {a.id: a for a in db.scalars(select(Asset).where(Asset.project_id == project_id))}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for a in contract.get("assets", []):
            row = rows.get(a["id"])
            if row and row.storage_key and storage.exists(row.storage_key):
                z.writestr(a["file"], storage.get_bytes(row.storage_key))
    return buf.getvalue()
