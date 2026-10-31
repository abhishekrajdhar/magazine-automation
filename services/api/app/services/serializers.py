"""ORM row -> API schema conversion (single place so shapes stay consistent)."""

from __future__ import annotations

from typing import Any

from app import models as m
from app.ids import iso
from app.schemas import editorial as se
from app.schemas import identity as si
from app.schemas import pages as sp
from app.schemas import project as sproj
from app.schemas import reference as sr
from app.security import initials_for
from app.services.project_defaults import default_config

API = "/api/v1"


def user(u: m.User) -> si.User:
    return si.User(id=u.id, name=u.name, email=u.email, title=u.title, initials=initials_for(u.name))


def organisation(o: m.Organisation) -> si.Organisation:
    plan = o.plan if o.plan in ("demo", "team", "enterprise") else "team"
    return si.Organisation(id=o.id, name=o.name, slug=o.slug, plan=plan)


def member(u: m.User, ms: m.Membership) -> si.Member:
    return si.Member(
        user_id=u.id,
        name=u.name,
        email=u.email,
        role=ms.role,
        title=u.title,
        initials=initials_for(u.name),
        last_active_at=iso(ms.last_active_at),
        status="invited" if ms.status == "invited" else "active",
    )


def project(p: m.Project) -> sproj.Project:
    cfg = {**default_config(p.target_page_count).model_dump(by_alias=True), **{k: v for k, v in (p.config or {}).items()}}
    return sproj.Project(
        id=p.id,
        org_id=p.org_id,
        title=p.title,
        event_name=p.event_name,
        category=p.category,
        issue_number=p.issue_number,
        publication_date=p.publication_date,
        publisher=p.publisher,
        target_page_count=p.target_page_count,
        description=p.description,
        status=p.status,
        reference_id=p.reference_id,
        design_profile_id=p.design_profile_id,
        config=sproj.GenerationConfig.model_validate(cfg),
        owner_id=p.owner_id,
        created_at=iso(p.created_at),
        updated_at=iso(p.updated_at),
        is_demo=p.is_demo,
    )


def video(v: m.VideoSource) -> sproj.VideoSource:
    return sproj.VideoSource(
        id=v.id,
        project_id=v.project_id,
        source_type=v.source_type,
        url=v.url,
        external_id=v.external_id,
        file_name=v.file_name,
        file_size_bytes=v.file_size_bytes,
        title=v.title or v.file_name or "Untitled recording",
        duration_sec=v.duration_sec,
        thumbnail_url=v.thumbnail_url,
        session_id=v.session_id,
        processing=sproj.Processing(
            state=v.processing_state,
            progress=v.processing_progress or 0.0,
            message=v.processing_message,
            updated_at=iso(v.processing_updated_at or v.updated_at),
        ),
        transcription=sproj.Transcription(
            state=v.transcription_state,
            method=v.transcription_method,
            language=v.transcription_language,
            word_count=v.word_count,
        ),
        simulated=v.simulated,
        added_at=iso(v.created_at),
    )


def segment(s: m.TranscriptSegment) -> sproj.TranscriptSegment:
    return sproj.TranscriptSegment(
        id=s.id, video_id=s.video_id, start=s.start, end=s.end, speaker_id=s.speaker_id,
        speaker_label=s.speaker_label, text=s.text,
    )


def speaker(s: m.Speaker) -> sproj.Speaker:
    return sproj.Speaker(
        id=s.id, project_id=s.project_id, name=s.name, designation=s.designation, organisation=s.organisation,
        verification=s.verification, video_ids=list(s.video_ids or []), bio=s.bio, portrait_asset_id=s.portrait_asset_id,
    )


def session(s: m.EventSession) -> sproj.EventSession:
    return sproj.EventSession(
        id=s.id, project_id=s.project_id, video_id=s.video_id, title=s.title, kind=s.kind,
        speaker_ids=list(s.speaker_ids or []), summary=s.summary or "", topics=list(s.topics or []), status=s.status,
    )


def fact(f: m.ExtractedFact) -> sproj.ExtractedFact:
    return sproj.ExtractedFact(
        id=f.id, project_id=f.project_id, video_id=f.video_id, segment_id=f.segment_id, kind=f.kind, text=f.text,
        speaker_id=f.speaker_id, timestamp=f.timestamp, provenance=f.provenance, status=f.status,
        confidence=f.confidence,
    )


def article(a: m.Article) -> se.Article:
    return se.Article(
        id=a.id,
        project_id=a.project_id,
        type=a.type,
        kicker=a.kicker,
        headline=a.headline or "",
        subheadline=a.subheadline or "",
        byline=a.byline,
        intro=a.intro or "",
        body=[se.ArticleBlock.model_validate(b) for b in (a.body or [])],
        quote_fact_ids=list(a.quote_fact_ids or []),
        speaker_ids=list(a.speaker_ids or []),
        session_ids=list(a.session_ids or []),
        suggested_image_ids=list(a.suggested_image_ids or []),
        captions=dict(a.captions or {}),
        status=a.status,
        generated_by=a.generated_by,
        updated_at=iso(a.updated_at),
        approved_by=a.approved_by,
        approved_at=iso(a.approved_at),
        review_note=a.review_note,
        variants=se.ArticleVariants.model_validate(a.variants) if a.variants else None,
    )


def asset(a: m.Asset) -> sp.Asset:
    return sp.Asset(
        id=a.id, project_id=a.project_id, kind=a.kind, file_name=a.file_name, width_px=a.width_px,
        height_px=a.height_px, session_id=a.session_id, video_id=a.video_id, speaker_id=a.speaker_id,
        tags=list(a.tags or []), caption=a.caption, credit=a.credit, seed=a.seed,
        url=f"{API}/assets/{a.id}/file" if a.storage_key else None, simulated=a.simulated,
    )


def page(p: m.MagazinePage) -> sp.MagazinePage:
    return sp.MagazinePage(
        id=p.id, project_id=p.project_id, page_type=p.page_type, template_id=p.template_id, label=p.label or "",
        article_id=p.article_id, article_part=p.article_part,
        elements=[sp.PageElement.model_validate(e) for e in (p.elements or [])],
        editorial_status=p.editorial_status, design_status=p.design_status, locked=p.locked, notes=p.notes,
    )


def export(e: m.Export) -> sp.ExportRecord:
    return sp.ExportRecord(
        id=e.id, project_id=e.project_id, format=e.format, status=e.status, renderer=e.renderer,
        file_name=e.file_name, size_bytes=e.size_bytes, created_at=iso(e.created_at), completed_at=iso(e.completed_at),
        created_by=e.created_by,
        download_url=f"{API}/exports/{e.id}/download" if (e.status == "complete" and e.storage_key) else None,
        message=e.message,
    )


def job(j: m.Job) -> sp.Job:
    return sp.Job(
        id=j.id, kind=j.kind, status=j.status, progress=j.progress or 0.0, message=j.message, attempts=j.attempts,
        created_at=iso(j.created_at), updated_at=iso(j.updated_at), result_ref=j.result_ref, error=j.error,
    )


def activity(a: m.Activity) -> sp.ActivityItem:
    return sp.ActivityItem(
        id=a.id, at=iso(a.created_at), actor_id=a.actor_id, verb=a.verb, target=a.target, kind=a.kind,
        project_id=a.project_id,
    )


def reference(r: m.ReferenceMagazine) -> sr.ReferenceMagazine:
    analyser = r.analyser if r.analyser in ("pymupdf", "pymupdf+vision", "demo_seed") else "pymupdf"
    return sr.ReferenceMagazine(
        id=r.id, org_id=r.org_id, title=r.title, file_name=r.file_name, file_size_bytes=r.file_size_bytes or 0,
        page_count=r.page_count or 0, uploaded_at=iso(r.created_at), status=r.status,
        analysis=sr.ReferenceAnalysis(progress=r.analysis_progress or 0.0, message=r.analysis_message,
                                      analyser=analyser, completed_at=iso(r.completed_at)),
        design_profile_id=r.design_profile_id, has_source_pdf=bool(r.storage_key),
        has_indd_source=bool(r.indd_key), is_demo=r.is_demo,
    )


def reference_page(p: m.ReferencePage, has_pdf: bool = True) -> sr.ReferencePage:
    props = dict(p.properties or {})
    props.setdefault("columns", 1)
    props.setdefault("dominantColors", [])
    props.setdefault("textCoverage", 0.0)
    props.setdefault("imageCoverage", 0.0)
    props.setdefault("fonts", [])
    return sr.ReferencePage(
        id=p.id, reference_id=p.reference_id, page_number=p.page_number, layout_type=p.layout_type,
        confidence=p.confidence, width_pt=p.width_pt, height_pt=p.height_pt,
        image_url=f"{API}/references/{p.reference_id}/pages/{p.page_number}/image" if has_pdf else None,
        blocks=[sr.LayoutBlock.model_validate(b) for b in (p.blocks or [])],
        properties=sr.PageProperties.model_validate(props), corrected=p.corrected,
    )


def design_profile(d: m.DesignProfile) -> sr.DesignProfile:
    body: dict[str, Any] = dict(d.profile or {})
    return sr.DesignProfile.model_validate(
        {
            **body,
            "id": d.id,
            "referenceId": d.reference_id,
            "name": d.name,
            "status": d.status,
            "version": d.version,
            "overrides": list(d.overrides or []),
            "approvedAt": iso(d.approved_at),
            "approvedBy": d.approved_by,
        }
    )


def template_row(t: m.Template) -> sr.Template:
    return sr.Template(
        id=t.id, name=t.name, page_type=t.page_type, source="builtin" if t.source == "builtin" else "reference",
        reference_page_number=t.reference_page_number,
        description=t.description or "", slots=[sr.TemplateSlot.model_validate(s) for s in (t.slots or [])],
        columns=t.columns,
    )
