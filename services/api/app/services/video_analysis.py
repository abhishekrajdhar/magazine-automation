"""LLM analysis of a transcript -> speakers, sessions, facts (quotes/statistics/announcements/Q&A).

Grounding rules enforced in code (not just in the prompt):
* every fact must reference a real segment; quotes without a valid segment are dropped;
* `transcript_verbatim` only when the text is found in the transcript (normalised match);
* speaker names/designations from the model are stored as `ai_suggested`, never `confirmed`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ids import new_id
from app.models import EventSession, ExtractedFact, Speaker, TranscriptSegment, VideoSource
from app.schemas.project import FACT_KINDS, SESSION_KINDS
from app.services.llm import LLMProvider, nullable, strict_object
from app.services.text_match import match_quote, normalise

log = logging.getLogger("pressflow.video_analysis")

SYSTEM = (
    "You analyse transcripts of government-technology conference sessions for a magazine newsroom. "
    "You must be strictly faithful to the transcript: never invent names, designations, organisations, numbers or "
    "quotes. Only name a speaker if the transcript itself states the name (for example an introduction by the "
    "moderator). Leave designation/organisation null unless stated in the transcript. Quotes must be copied exactly, "
    "word for word, from a single transcript segment or consecutive segments; do not clean up grammar. Statistics "
    "must be reported exactly as spoken. Cite the segment reference (e.g. s12) where each item appears."
)

ANALYSIS_SCHEMA = strict_object({
    "speakers": {"type": "array", "items": strict_object({
        "key": {"type": "string"},
        "name": {"type": "string"},
        "designation": nullable({"type": "string"}),
        "organisation": nullable({"type": "string"}),
        "evidenceSegment": nullable({"type": "string"}),
        "turns": {"type": "array", "items": strict_object({"startSegment": {"type": "string"},
                                                            "endSegment": {"type": "string"}})},
    })},
    "sessions": {"type": "array", "items": strict_object({
        "title": {"type": "string"},
        "kind": {"type": "string", "enum": list(SESSION_KINDS)},
        "speakerKeys": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "topics": {"type": "array", "items": {"type": "string"}},
        "startSegment": {"type": "string"},
        "endSegment": {"type": "string"},
    })},
    "facts": {"type": "array", "items": strict_object({
        "kind": {"type": "string", "enum": list(FACT_KINDS)},
        "text": {"type": "string"},
        "segment": {"type": "string"},
        "speakerKey": nullable({"type": "string"}),
        "confidence": {"type": "number"},
    })},
})


@dataclass
class AnalysisCounts:
    speakers: int = 0
    sessions: int = 0
    facts: int = 0
    verbatim_quotes: int = 0
    dropped: int = 0


def _fmt_time(t: float) -> str:
    t = int(t)
    return f"{t // 3600:d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def _windows(segs: list[TranscriptSegment], max_chars: int) -> list[list[tuple[str, TranscriptSegment]]]:
    out: list[list[tuple[str, TranscriptSegment]]] = [[]]
    size = 0
    for i, s in enumerate(segs):
        ref = f"s{i}"
        line_len = len(s.text) + 30
        if out[-1] and size + line_len > max_chars:
            out.append([])
            size = 0
        out[-1].append((ref, s))
        size += line_len
    return out


def analyse_video(db: Session, llm: LLMProvider, video: VideoSource, max_chars: int, progress) -> AnalysisCounts:
    segs = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.video_id == video.id)
                           .order_by(TranscriptSegment.idx)).all())
    if not segs:
        raise ValueError("No transcript segments to analyse")
    windows = _windows(segs, max_chars)
    results = []
    ref_map: dict[str, TranscriptSegment] = {}
    for wi, win in enumerate(windows):
        progress(100 * wi / len(windows), f"AI analysis of transcript part {wi + 1} of {len(windows)}")
        lines = []
        for ref, s in win:
            ref_map[ref] = s
            lines.append(f"[{ref}] ({_fmt_time(s.start)}) {s.speaker_label}: {s.text}")
        prompt = (
            f"Session recording: {video.title!r}.\n"
            "Transcript (one segment per line, reference in brackets):\n\n" + "\n".join(lines) + "\n\n"
            "Return: speakers (a short key like S1, the stated name, and the segment ranges where they speak), "
            "sessions (agenda items in this recording), and facts: notable verbatim quotes, statistics, announcements, "
            "key discussion points and audience Q&A. Use only segment references that appear above."
        )
        results.append(llm.complete_json(system=SYSTEM, prompt=prompt, schema=ANALYSIS_SCHEMA, schema_name="transcript_analysis"))
    return _write_results(db, video, segs, ref_map, results)


def _write_results(db: Session, video: VideoSource, segs: list[TranscriptSegment], ref_map: dict[str, TranscriptSegment],
                   results: list[dict]) -> AnalysisCounts:
    counts = AnalysisCounts()
    seg_index = {s.id: i for i, s in enumerate(segs)}
    texts = [s.text for s in segs]
    # Re-analysis replaces previous AI output for this video but keeps human decisions.
    db.execute(delete(ExtractedFact).where(ExtractedFact.video_id == video.id, ExtractedFact.status == "pending"))
    db.execute(delete(EventSession).where(EventSession.video_id == video.id, EventSession.status == "draft"))

    existing = {normalise(sp.name): sp for sp in db.scalars(select(Speaker).where(Speaker.project_id == video.project_id))}
    key_to_speaker: dict[str, Speaker] = {}
    for res in results:
        for sp in res.get("speakers", []):
            name = (sp.get("name") or "").strip()
            if not name or len(name) > 200:
                continue
            row = existing.get(normalise(name))
            if row is None:
                row = Speaker(id=new_id("spk"), project_id=video.project_id, name=name, verification="ai_suggested",
                              video_ids=[], labels=[])
                db.add(row)
                existing[normalise(name)] = row
                counts.speakers += 1
            if row.verification != "confirmed":
                row.designation = row.designation or (sp.get("designation") or None)
                row.organisation = row.organisation or (sp.get("organisation") or None)
                row.verification = "ai_suggested" if row.verification != "unverified" else row.verification
            if video.id not in (row.video_ids or []):
                row.video_ids = list(row.video_ids or []) + [video.id]
            key_to_speaker[sp.get("key", "")] = row
            for turn in sp.get("turns", []):
                a, b = ref_map.get(turn.get("startSegment")), ref_map.get(turn.get("endSegment"))
                if a is None or b is None:
                    continue
                for s in segs[seg_index[a.id]: seg_index[b.id] + 1]:
                    s.speaker_id = row.id
                    s.speaker_label = row.name
    db.flush()

    for res in results:
        for se in res.get("sessions", []):
            a, b = ref_map.get(se.get("startSegment")), ref_map.get(se.get("endSegment"))
            kind = se.get("kind") if se.get("kind") in SESSION_KINDS else "presentation"
            db.add(EventSession(
                id=new_id("ses"), project_id=video.project_id, video_id=video.id, title=(se.get("title") or "Session")[:400],
                kind=kind, speaker_ids=[key_to_speaker[k].id for k in se.get("speakerKeys", []) if k in key_to_speaker],
                summary=se.get("summary") or "", topics=[t for t in se.get("topics", []) if isinstance(t, str)][:12],
                status="draft", start_sec=a.start if a else None, end_sec=b.end if b else None,
            ))
            counts.sessions += 1

        for f in res.get("facts", []):
            kind = f.get("kind")
            text = (f.get("text") or "").strip()
            if kind not in FACT_KINDS or not text:
                counts.dropped += 1
                continue
            seg = ref_map.get(f.get("segment"))
            provenance = "ai_interpretation"
            # look near the cited segment first, then the whole transcript
            if seg is not None:
                i = seg_index[seg.id]
                lo = max(0, i - 2)
                m = match_quote(text, texts[lo:i + 3])
                if m.status == "verified":
                    seg = segs[lo + (m.index or 0)]
                    provenance = "transcript_verbatim"
            if provenance != "transcript_verbatim":
                m = match_quote(text, texts)
                if m.status == "verified":
                    seg = segs[m.index or 0]
                    provenance = "transcript_verbatim"
            if seg is None:
                counts.dropped += 1  # cannot ground the fact to a segment: never store it
                continue
            if kind == "quote" and provenance == "transcript_verbatim":
                counts.verbatim_quotes += 1
            conf = f.get("confidence")
            conf = max(0.0, min(1.0, float(conf))) if isinstance(conf, (int, float)) else 0.5
            if provenance != "transcript_verbatim":
                conf = min(conf, 0.6)
            sk = f.get("speakerKey")
            db.add(ExtractedFact(
                id=new_id("fct"), project_id=video.project_id, video_id=video.id, segment_id=seg.id, kind=kind,
                text=text, speaker_id=key_to_speaker[sk].id if sk in key_to_speaker else seg.speaker_id,
                timestamp=seg.start, provenance=provenance, status="pending", confidence=round(conf, 2),
            ))
            counts.facts += 1
    db.flush()
    return counts


def recompute_provenance(db: Session, fact: ExtractedFact) -> None:
    """After a human edits a fact's text, re-check whether it is verbatim."""
    segs = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.video_id == fact.video_id)
                           .order_by(TranscriptSegment.idx)).all())
    m = match_quote(fact.text, [s.text for s in segs])
    if m.status == "verified" and m.index is not None:
        fact.provenance = "transcript_verbatim"
        fact.segment_id = segs[m.index].id
        fact.timestamp = segs[m.index].start
    else:
        fact.provenance = "ai_interpretation"
