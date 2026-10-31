"""Editorial engine: article generation (LLM, grounded), editing assistance, deterministic verification."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_factory
from app.ids import iso, new_id, utcnow
from app.models import Article, EventSession, ExtractedFact, Project, Speaker, TranscriptSegment, VideoSource
from app.schemas.editorial import BLOCK_KINDS
from app.services.claim_verification import Seg, verify_article
from app.services.jobs.queue import JobContext, PermanentError, RetryableError, register
from app.services.llm import LLMError, LLMNotConfigured, LLMProvider, get_llm, nullable, strict_object
from app.services.text_match import match_quote

log = logging.getLogger("pressflow.editorial")

TYPE_BRIEFS = {
    "event_report": "a comprehensive event report covering the main themes, sessions and outcomes (900-1400 words)",
    "keynote": "a write-up of a single keynote address, its argument and key lines (600-900 words)",
    "interview": "a Q&A interview: alternate 'question' and 'answer' blocks drawn from the conversation (700-1100 words)",
    "government_perspective": "an article on the government officials' perspective and policy signals (600-900 words)",
    "panel": "a panel discussion report capturing the different viewpoints (700-1000 words)",
    "tech_feature": "a technology feature explaining the solutions and platforms discussed (700-1000 words)",
    "speaker_profiles": "short profiles of the speakers using only stated facts (60-90 words each, one subhead per speaker)",
    "highlights": "a highlights round-up as list items of the most notable moments (250-400 words)",
    "editorial": "an editor's letter introducing the issue's themes (350-500 words)",
    "photo_captions": "photo captions as list items describing sessions and speakers (one sentence each)",
}

SYSTEM = (
    "You are a senior editor at a government-technology magazine (Elets eGov style). You write accurate, readable "
    "magazine copy grounded ONLY in the approved facts and transcript excerpts provided. Rules: (1) never invent "
    "names, designations, organisations, statistics, dates or quotes; (2) speakers may only be referred to using the "
    "speaker list given — if a speaker is marked UNVERIFIED, use the name but do not add a designation; (3) a block of "
    "kind 'quote' must reproduce transcript words exactly; (4) every block must cite the transcript segment "
    "references (e.g. s12) it is based on in sourceSegments; (5) if the material is thin, write less rather than pad. "
    "Write in British English unless told otherwise."
)

ARTICLE_SCHEMA = strict_object({
    "kicker": nullable({"type": "string"}),
    "headline": {"type": "string"},
    "subheadline": {"type": "string"},
    "intro": {"type": "string"},
    "body": {"type": "array", "items": strict_object({
        "kind": {"type": "string", "enum": list(BLOCK_KINDS)},
        "text": {"type": "string"},
        "speakerId": nullable({"type": "string"}),
        "sourceSegments": {"type": "array", "items": {"type": "string"}},
    })},
    "quoteFactIds": {"type": "array", "items": {"type": "string"}},
    "headlineVariants": {"type": "array", "items": {"type": "string"}},
})

ASSIST_SCHEMA = strict_object({"suggestions": {"type": "array", "items": {"type": "string"}}})


# ---------------------------------------------------------------- context gathering

def gather_context(db: Session, project: Project, session_ids: list[str], max_chars: int) -> dict[str, Any]:
    sessions = list(db.scalars(select(EventSession).where(EventSession.project_id == project.id)).all())
    if session_ids:
        sessions = [s for s in sessions if s.id in session_ids]
    video_ids = {s.video_id for s in sessions} or {
        v.id for v in db.scalars(select(VideoSource).where(VideoSource.project_id == project.id))}
    facts = [f for f in db.scalars(select(ExtractedFact).where(ExtractedFact.project_id == project.id,
                                                                ExtractedFact.status == "approved"))
             if f.video_id in video_ids]
    speakers = list(db.scalars(select(Speaker).where(Speaker.project_id == project.id)).all())
    segs: list[TranscriptSegment] = []
    for vid in video_ids:
        vsegs = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.video_id == vid)
                                .order_by(TranscriptSegment.idx)).all())
        ranges = [(s.start_sec, s.end_sec) for s in sessions if s.video_id == vid and s.start_sec is not None]
        if ranges and session_ids:
            vsegs = [g for g in vsegs if any(a <= g.start <= (b or 1e12) for a, b in ranges)]
        segs += vsegs
    # budget: keep segments around approved facts first, then the rest in order
    fact_seg_ids = {f.segment_id for f in facts}
    chosen: list[TranscriptSegment] = []
    size = 0
    priority = [g for g in segs if g.id in fact_seg_ids] + [g for g in segs if g.id not in fact_seg_ids]
    for g in priority:
        if size + len(g.text) + 40 > max_chars:
            continue
        chosen.append(g)
        size += len(g.text) + 40
    chosen.sort(key=lambda g: (g.video_id, g.idx))
    return {"sessions": sessions, "facts": facts, "speakers": speakers, "segments": chosen}


def _ref_tables(segments: list[TranscriptSegment]) -> tuple[dict[str, TranscriptSegment], dict[str, str]]:
    ref_to_seg = {f"s{i}": g for i, g in enumerate(segments)}
    seg_to_ref = {g.id: r for r, g in ref_to_seg.items()}
    return ref_to_seg, seg_to_ref


def build_prompt(project: Project, art_type: str, ctx: dict, tone: str, style: str, language: str) -> tuple[str, dict]:
    ref_to_seg, seg_to_ref = _ref_tables(ctx["segments"])
    lines = [f"Publication: {project.title} — {project.event_name}. Article type: {art_type} — "
             f"{TYPE_BRIEFS.get(art_type, 'a magazine article')}. Tone: {tone}. Style: {style}. Language: {language}."]
    lines.append("\nSPEAKERS (id | name | designation | organisation | verification):")
    for s in ctx["speakers"]:
        lines.append(f"{s.id} | {s.name} | {s.designation or '-'} | {s.organisation or '-'} | "
                     f"{'VERIFIED' if s.verification == 'confirmed' else 'UNVERIFIED'}")
    lines.append("\nSESSIONS:")
    for s in ctx["sessions"]:
        lines.append(f"- {s.title} ({s.kind}): {s.summary}")
    lines.append("\nAPPROVED FACTS (id | kind | segment | speaker | text):")
    for f in ctx["facts"]:
        lines.append(f"{f.id} | {f.kind} | {seg_to_ref.get(f.segment_id, '-')} | {f.speaker_id or '-'} | {f.text}")
    lines.append("\nTRANSCRIPT EXCERPTS (ref | time | speaker | text):")
    for r, g in ref_to_seg.items():
        lines.append(f"[{r}] {int(g.start)}s {g.speaker_label}: {g.text}")
    lines.append("\nWrite the article now. Use quoteFactIds for approved quote facts you used as pull quotes. "
                 "Offer 3 alternative headlines in headlineVariants.")
    return "\n".join(lines), ref_to_seg


def postprocess(raw: dict, ctx: dict, ref_to_seg: dict[str, TranscriptSegment]) -> dict:
    speaker_ids = {s.id for s in ctx["speakers"]}
    fact_ids = {f.id for f in ctx["facts"] if f.kind == "quote"}
    body = []
    unverified = 0
    for b in raw.get("body") or []:
        kind = b.get("kind") if b.get("kind") in BLOCK_KINDS else "paragraph"
        text = (b.get("text") or "").strip()
        if not text:
            continue
        refs = []
        for r in b.get("sourceSegments") or []:
            g = ref_to_seg.get(r)
            if g:
                refs.append({"videoId": g.video_id, "start": g.start, "end": g.end, "segmentId": g.id})
        if kind == "quote":
            cited = [ref_to_seg[r].text for r in (b.get("sourceSegments") or []) if r in ref_to_seg]
            pool = cited or [g.text for g in ctx["segments"]]
            if match_quote(text.strip("“”\""), pool).status != "verified":
                unverified += 1
        sid = b.get("speakerId")
        body.append({"id": new_id("blk"), "kind": kind, "text": text,
                     **({"speakerId": sid} if sid in speaker_ids else {}),
                     **({"sourceRefs": refs} if refs else {})})
    used_speakers = sorted({b["speakerId"] for b in body if b.get("speakerId")})
    return {
        "kicker": raw.get("kicker") or None,
        "headline": (raw.get("headline") or "").strip(),
        "subheadline": (raw.get("subheadline") or "").strip(),
        "intro": (raw.get("intro") or "").strip(),
        "body": body,
        "quoteFactIds": [f for f in raw.get("quoteFactIds") or [] if f in fact_ids],
        "speakerIds": used_speakers,
        "headlines": [h for h in raw.get("headlineVariants") or [] if isinstance(h, str)][:5],
        "unverifiedQuotes": unverified,
    }


# ---------------------------------------------------------------- generation job

@register("article_generation")
def run_article_generation(ctx: JobContext) -> None:
    s = get_settings()
    p = ctx.payload
    llm = get_llm()
    if not llm.configured()[0]:
        raise PermanentError(llm.configured()[1])
    with session_factory()() as db:
        project = db.get(Project, p["projectId"])
        if project is None:
            raise PermanentError("Project no longer exists")
        cfg = project.config or {}
        context = gather_context(db, project, p.get("sessionIds") or [], s.llm_analysis_window_chars)
        if not context["facts"]:
            raise PermanentError("No approved facts for the selected sessions; approve facts before generating articles.")
        created: list[str] = []
        types = p["types"]
        for i, art_type in enumerate(types):
            ctx.progress(5 + 90 * i / len(types), f"Writing {art_type.replace('_', ' ')} ({i + 1}/{len(types)})")
            prompt, ref_to_seg = build_prompt(project, art_type, context, cfg.get("editorialTone", "authoritative"),
                                              cfg.get("contentStyle", "feature"), cfg.get("language", "en"))
            try:
                raw = llm.complete_json(system=SYSTEM, prompt=prompt, schema=ARTICLE_SCHEMA, schema_name="article")
            except LLMNotConfigured as e:
                raise PermanentError(str(e)) from e
            except LLMError as e:
                db.commit()  # keep articles already written in this run
                if e.retryable and not created:
                    raise RetryableError(str(e)) from e
                raise PermanentError(f"Generation stopped at {art_type}: {e}") from e
            out = postprocess(raw, context, ref_to_seg)
            art = Article(
                id=new_id("art"), project_id=project.id, type=art_type, kicker=out["kicker"], headline=out["headline"],
                subheadline=out["subheadline"], intro=out["intro"], body=out["body"], quote_fact_ids=out["quoteFactIds"],
                speaker_ids=out["speakerIds"], session_ids=[x.id for x in context["sessions"]], suggested_image_ids=[],
                captions={}, status="draft", generated_by="llm",
                variants={"headlines": out["headlines"]} if out["headlines"] else None,
            )
            claims = verify_article(_article_dict(art), _segs(context["segments"]))
            bad = [c for c in claims if c.status != "verified"]
            art.last_verification = {"checkedAt": iso(utcnow()), "unverified": len(bad), "total": len(claims)}
            if bad:
                art.review_note = (f"Automatic check: {len(bad)} of {len(claims)} quotes/figures could not be fully "
                                   f"verified against the transcript. Run Verify before approving.")
            db.add(art)
            # Commit per article: SQLite allows one writer, and ctx.progress() writes the job row from its own
            # session, so an open transaction here would block it until "database is locked". It also keeps
            # finished articles if a later type fails.
            db.commit()
            created.append(art.id)
        if project.status in ("setup", "ingesting", "analysing"):
            project.status = "editorial"
        db.commit()
        ctx.set_result(created[0] if created else "")
        ctx.progress(100, f"Generated {len(created)} article(s)")


def _segs(rows: list[TranscriptSegment]) -> list[Seg]:
    return [Seg(g.id, g.video_id, g.start, g.end, g.text) for g in rows]


def _article_dict(a: Article) -> dict:
    return {"headline": a.headline, "subheadline": a.subheadline, "kicker": a.kicker, "intro": a.intro, "body": a.body}


# ---------------------------------------------------------------- verification (deterministic)

def linked_segments(db: Session, article: Article) -> list[TranscriptSegment]:
    seg_ids: set[str] = set()
    for b in article.body or []:
        for r in b.get("sourceRefs") or []:
            if r.get("segmentId"):
                seg_ids.add(r["segmentId"])
    for f in db.scalars(select(ExtractedFact).where(ExtractedFact.id.in_(article.quote_fact_ids or []))):
        if f.segment_id:
            seg_ids.add(f.segment_id)
    out = {g.id: g for g in db.scalars(select(TranscriptSegment).where(TranscriptSegment.id.in_(seg_ids)))} if seg_ids else {}
    sessions = list(db.scalars(select(EventSession).where(EventSession.id.in_(article.session_ids or []))))
    for s in sessions:
        q = select(TranscriptSegment).where(TranscriptSegment.video_id == s.video_id)
        for g in db.scalars(q):
            if s.start_sec is None or (s.start_sec - 1 <= g.start <= (s.end_sec or 1e12) + 1):
                out[g.id] = g
    return sorted(out.values(), key=lambda g: (g.video_id, g.idx))


def verify(db: Session, article: Article) -> dict:
    segs = linked_segments(db, article)
    claims = verify_article(_article_dict(article), _segs(segs))
    summary = {"verified": 0, "partial": 0, "notFound": 0}
    out = []
    for c in claims:
        summary["notFound" if c.status == "not_found" else c.status] += 1
        item: dict[str, Any] = {"text": c.text, "kind": c.kind, "status": c.status, "location": c.location}
        if c.source:
            item["sourceRef"] = {"videoId": c.source.video_id, "start": c.source.start, "end": c.source.end,
                                 "segmentId": c.source.id}
        if c.note:
            item["note"] = c.note
        out.append(item)
    result = {"articleId": article.id, "checkedAt": iso(utcnow()), "engine": "deterministic",
              "segmentsChecked": len(segs), "claims": out, "summary": summary}
    article.last_verification = {"checkedAt": result["checkedAt"], "summary": summary}
    return result


# ---------------------------------------------------------------- assist (LLM)

ASSIST_INSTRUCTIONS = {
    "rewrite_headline": "Suggest 5 alternative headlines (max 12 words each) that stay faithful to the article.",
    "change_tone": "Rewrite the intro in a {tone} tone. Return 1 suggestion. Keep every fact and name unchanged.",
    "expand": "Expand the target text by ~50% using ONLY information in the transcript excerpts. Return 1 suggestion.",
    "shorten": "Shorten the target text to about half its length without losing facts. Return 1 suggestion.",
    "summarise": "Write a 2-3 sentence summary of the article. Return 1 suggestion.",
    "regenerate_paragraph": "Rewrite the target paragraph, grounded only in its cited transcript excerpts. Return 2 suggestions.",
}


def assist(db: Session, llm: LLMProvider, article: Article, action: str, block_id: str | None, tone: str | None) -> list[str]:
    block = next((b for b in article.body or [] if b.get("id") == block_id), None) if block_id else None
    if action == "regenerate_paragraph" and block is None:
        raise ValueError("blockId is required and must refer to a block of this article")
    target = block["text"] if block else (article.intro if action in ("change_tone", "expand", "shorten") else "")
    segs = []
    if block:
        ids = [r.get("segmentId") for r in block.get("sourceRefs") or [] if r.get("segmentId")]
        if ids:
            segs = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.id.in_(ids))))
    if not segs and action in ("expand", "regenerate_paragraph"):
        segs = linked_segments(db, article)[:300]
    excerpt = "\n".join(f"[{int(g.start)}s] {g.text}" for g in segs)
    full = "\n\n".join([article.headline or "", article.subheadline or "", article.intro or ""] +
                       [b.get("text", "") for b in article.body or []])
    prompt = (ASSIST_INSTRUCTIONS[action].format(tone=tone or "neutral") +
              f"\n\nARTICLE:\n{full[:60000]}\n\nTARGET TEXT:\n{target}\n\nTRANSCRIPT EXCERPTS:\n{excerpt[:60000]}")
    out = llm.complete_json(system=SYSTEM, prompt=prompt, schema=ASSIST_SCHEMA, max_tokens=8000, schema_name="assist")
    suggestions = [s.strip() for s in out.get("suggestions") or [] if isinstance(s, str) and s.strip()]
    # cache alternates on the article (types.ts `variants`)
    variants = dict(article.variants or {})
    if action == "rewrite_headline":
        variants["headlines"] = suggestions
    elif action == "summarise" and suggestions:
        variants["summary"] = suggestions[0]
    elif action == "shorten" and not block and suggestions:
        variants["shortIntro"] = suggestions[0]
    elif action == "change_tone" and tone and suggestions:
        variants["intros"] = {**(variants.get("intros") or {}), tone: suggestions[0]}
    article.variants = variants or None
    return suggestions
