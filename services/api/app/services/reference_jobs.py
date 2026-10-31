"""Job handlers: reference_analysis (whole PDF) and page_reanalysis (one page)."""

from __future__ import annotations

import logging

from sqlalchemy import delete, select

from app.config import get_settings
from app.db import session_factory
from app.ids import new_id, utcnow
from app.models import DesignProfile, ReferenceMagazine, ReferencePage
from app.schemas.base import PAGE_TYPES
from app.services.jobs.queue import JobContext, PermanentError, register
from app.services.llm import LLMError, get_llm, strict_object
from app.services.reference_analysis import AnalysisResult, analyse_pdf, render_page_png
from app.services.storage import get_storage

log = logging.getLogger("pressflow.reference_jobs")

VISION_SCHEMA = strict_object({
    "layoutType": {"type": "string", "enum": list(PAGE_TYPES)},
    "confidence": {"type": "number"},
    "reason": {"type": "string"},
})


def _set(ref_id: str, **values) -> None:
    with session_factory()() as db:
        r = db.get(ReferenceMagazine, ref_id)
        if r:
            for k, v in values.items():
                setattr(r, k, v)
            db.commit()


def _on_failure(ctx: JobContext, message: str) -> None:
    rid = ctx.payload.get("referenceId")
    if rid and ctx.kind == "reference_analysis":
        _set(rid, status="failed", analysis_message=message[:1000])


def _vision_refine(pdf: bytes, result: AnalysisResult, progress, pages: list[int] | None = None) -> bool:
    """Optional: ask a vision-capable LLM to double-check page types. Returns True if used."""
    s = get_settings()
    llm = get_llm()
    if not s.llm_vision_reference_analysis or not llm.supports_vision or not llm.configured()[0]:
        return False
    targets = [p for p in result.pages if pages is None or p["pageNumber"] in pages]
    for i, p in enumerate(targets):
        progress(90 + 8 * i / max(1, len(targets)), f"Vision check of page {p['pageNumber']}")
        png = render_page_png(pdf, p["pageNumber"], 0.6)
        try:
            out = llm.complete_json(
                system="You classify magazine page layouts. Answer only from the image.",
                prompt=(f"The heuristic analyser classified this page as '{p['layoutType']}' "
                        f"(confidence {p['confidence']}). Classify the page layout type."),
                schema=VISION_SCHEMA, images=[png], max_tokens=2000, schema_name="page_type")
        except LLMError as e:
            log.warning("vision refinement failed on page %s: %s", p["pageNumber"], e)
            return i > 0
        conf = float(out.get("confidence") or 0)
        p.setdefault("features", {})["vision"] = {**out}
        if out.get("layoutType") in PAGE_TYPES and conf > p["confidence"]:
            p["layoutType"] = out["layoutType"]
            p["confidence"] = round(min(0.97, conf), 2)
    return True


@register("reference_analysis", on_final_failure=_on_failure)
def run_reference_analysis(ctx: JobContext) -> None:
    ref_id = ctx.payload["referenceId"]
    with session_factory()() as db:
        ref = db.get(ReferenceMagazine, ref_id)
        if ref is None:
            raise PermanentError("Reference no longer exists")
        if not ref.storage_key:
            raise PermanentError("Reference PDF is not stored")
        key, org_id, title = ref.storage_key, ref.org_id, ref.title
    _set(ref_id, status="analysing", analysis_progress=1, analysis_message="Opening PDF")
    pdf = get_storage().get_bytes(key)

    def progress(pct: float, msg: str) -> None:
        _set(ref_id, analysis_progress=round(pct, 1), analysis_message=msg)
        ctx.progress(pct, msg)

    try:
        result = analyse_pdf(pdf, progress)
    except ValueError as e:
        raise PermanentError(f"Could not analyse the PDF: {e}") from e
    used_vision = _vision_refine(pdf, result, progress)
    with session_factory()() as db:
        ref = db.get(ReferenceMagazine, ref_id)
        corrected = {p.page_number: p.layout_type for p in
                     db.scalars(select(ReferencePage).where(ReferencePage.reference_id == ref_id,
                                                            ReferencePage.corrected.is_(True)))}
        db.execute(delete(ReferencePage).where(ReferencePage.reference_id == ref_id))
        for p in result.pages:
            db.add(ReferencePage(
                id=new_id("rpg"), reference_id=ref_id, page_number=p["pageNumber"],
                layout_type=corrected.get(p["pageNumber"], p["layoutType"]), confidence=p["confidence"],
                width_pt=p["widthPt"], height_pt=p["heightPt"], blocks=p["blocks"], properties=p["properties"],
                corrected=p["pageNumber"] in corrected, features=p.get("features"),
            ))
        profile = dict(result.profile)
        if corrected:
            counts: dict[str, int] = {}
            for p in result.pages:
                t = corrected.get(p["pageNumber"], p["layoutType"])
                counts[t] = counts.get(t, 0) + 1
            profile["pageTypeCounts"] = counts
        dp = db.get(DesignProfile, ref.design_profile_id) if ref.design_profile_id else None
        if dp is None:
            dp = DesignProfile(id=new_id("dsp"), org_id=org_id, reference_id=ref_id, name=f"{title} — design profile",
                               status="draft", version=1, profile=profile, overrides=[])
            db.add(dp)
            ref.design_profile_id = dp.id
        else:
            # Re-analysis keeps human overrides: overridden dotted paths retain their values.
            from app.services.profiles import apply_overrides

            dp.profile = apply_overrides(profile, dp.profile, dp.overrides or [])
            dp.version += 1
            if dp.status == "approved":
                dp.status = "draft"
                dp.approved_at = None
                dp.approved_by = None
        ref.page_count = result.page_count
        ref.status = "analysed"
        ref.analyser = "pymupdf+vision" if used_vision else "pymupdf"
        ref.analysis_progress = 100
        ref.analysis_message = "Analysis complete" + (f" — {'; '.join(result.notes)}" if result.notes else "")
        ref.completed_at = utcnow()
        db.commit()
        ctx.progress(100, "Analysis complete")
        ctx.set_result(dp.id)


@register("page_reanalysis")
def run_page_reanalysis(ctx: JobContext) -> None:
    ref_id, page_no = ctx.payload["referenceId"], int(ctx.payload["pageNumber"])
    with session_factory()() as db:
        ref = db.get(ReferenceMagazine, ref_id)
        if ref is None or not ref.storage_key:
            raise PermanentError("Reference PDF is not available")
        key = ref.storage_key
    pdf = get_storage().get_bytes(key)
    ctx.progress(10, f"Re-analysing page {page_no}")
    # Document-level context (body style, grid) matters for roles, so the whole document is re-measured
    # (deterministic) and only this page's results are replaced.
    result = analyse_pdf(pdf, lambda pct, msg: ctx.progress(10 + 0.7 * pct, msg))
    _vision_refine(pdf, result, lambda pct, msg: ctx.progress(pct, msg), pages=[page_no])
    page = next((p for p in result.pages if p["pageNumber"] == page_no), None)
    if page is None:
        raise PermanentError(f"Page {page_no} not found in the PDF")
    with session_factory()() as db:
        row = db.scalar(select(ReferencePage).where(ReferencePage.reference_id == ref_id,
                                                    ReferencePage.page_number == page_no))
        if row is None:
            row = ReferencePage(id=new_id("rpg"), reference_id=ref_id, page_number=page_no, layout_type=page["layoutType"],
                                width_pt=page["widthPt"], height_pt=page["heightPt"])
            db.add(row)
        if not row.corrected:
            row.layout_type = page["layoutType"]
        row.confidence = page["confidence"]
        row.blocks = page["blocks"]
        row.properties = page["properties"]
        row.features = page.get("features")
        db.commit()
        ctx.set_result(row.id)
