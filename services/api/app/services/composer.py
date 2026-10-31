"""Compose a flatplan into MagazinePage[] — port of composeMagazine/composeArticle/composeStandalone (compose.ts)."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.page_builder import (
    PageContent,
    article_paragraphs,
    balanced_capacities,
    body_capacities,
    build_elements,
    count_slots,
    distribute_paragraphs,
    issue_label,
    magazine_name,
    paragraph_cost,
)
from app.services.template_specs import SPEC_BY_ID

TAG_PREFERENCE = {
    "speakers_first": ["speaker", "panel", "stage", "award", "audience"],
    "stage_wide": ["stage", "panel", "audience", "speaker", "award"],
    "balanced": ["panel", "speaker", "stage", "audience", "award"],
    "audience": ["audience", "networking", "stage", "panel", "speaker"],
}


@dataclass
class PlanEntry:
    page_type: str
    template_id: str
    label: str
    article_id: str | None = None
    ad_asset_id: str | None = None
    image_ids: list[str] | None = None
    locked: bool = False
    id: str | None = None


@dataclass
class ComposeContext:
    profile: dict
    project: dict
    articles: list[dict]
    speakers: list[dict]
    facts: list[dict]
    assets: list[dict]
    reference_templates: dict[str, dict] = field(default_factory=dict)
    image_preference: str = "speakers_first"

    def template(self, template_id: str) -> dict | None:
        return SPEC_BY_ID.get(template_id) or self.reference_templates.get(template_id)


def _pick_fallback_images(ctx: ComposeContext, article: dict | None, count: int, used: set[str]) -> list[str]:
    if count <= 0:
        return []
    order = TAG_PREFERENCE.get(ctx.image_preference or "speakers_first", TAG_PREFERENCE["speakers_first"])
    sess = set((article or {}).get("sessionIds") or [])
    pool = [a for a in ctx.assets if a.get("kind") in ("photo", "video_frame") and a["id"] not in used
            and (not article or not sess or not a.get("sessionId") or a.get("sessionId") in sess)]

    def rank(a: dict) -> tuple:
        tag = (a.get("tags") or [""])[0]
        return (order.index(tag) if tag in order else 99, a["id"])

    return [a["id"] for a in sorted(pool, key=rank)[:count]]


def _speaker_detail(s: dict) -> str:
    return ", ".join(x for x in [s.get("designation"), s.get("organisation")] if x)


def compose_article(article: dict, entries: list[tuple[PlanEntry, int]], ctx: ComposeContext, used: set[str]) -> list[dict]:
    tpls = [ctx.template(e.template_id) for e, _ in entries]
    caps = [body_capacities(t, ctx.profile, n) if t else [] for t, (_, n) in zip(tpls, entries)]
    pq_slots = [count_slots(t, ctx.profile, n, ("pullquote",)) if t else 0 for t, (_, n) in zip(tpls, entries)]
    img_slots = [count_slots(t, ctx.profile, n, ("hero_image", "image", "portrait")) if t else 0
                 for t, (_, n) in zip(tpls, entries)]
    speakers = {s["id"]: s for s in ctx.speakers}
    facts = {f["id"]: f for f in ctx.facts}
    quote_blocks = [b for b in article.get("body") or [] if b.get("kind") == "quote"]
    fact_quotes = [facts[i] for i in article.get("quoteFactIds") or [] if i in facts and facts[i].get("status") != "rejected"
                   and not any(b.get("text") == facts[i]["text"] for b in quote_blocks)]
    pool = [{"id": b["id"], "text": b["text"], "speakerId": b.get("speakerId")} for b in quote_blocks] + \
           [{"id": f["id"], "text": f["text"], "speakerId": f.get("speakerId")} for f in fact_quotes]
    as_pull = pool[:sum(pq_slots)]
    inline = {b["id"] for b in quote_blocks if not any(q["id"] == b["id"] for q in as_pull)}
    paragraphs = article_paragraphs(article, speakers, inline)
    chunks = distribute_paragraphs(paragraphs, balanced_capacities(caps, sum(paragraph_cost(p) for p in paragraphs)))

    needed = sum(img_slots)
    suggested = [i for i in article.get("suggestedImageIds") or [] if i not in used]
    images = (suggested + _pick_fallback_images(ctx, article, max(0, needed - len(suggested)), used | set(suggested)))[:needed]
    used.update(images)
    assets = {a["id"]: a for a in ctx.assets}

    out = []
    chunk_cur = quote_cur = image_cur = 0
    for part, ((entry, page_number), tpl) in enumerate(zip(entries, tpls)):
        page_images = images[image_cur:image_cur + img_slots[part]]
        image_cur += img_slots[part]
        page_quotes = [{"text": q["text"], "attribution": (speakers.get(q.get("speakerId") or "") or {}).get("name")}
                       for q in as_pull[quote_cur:quote_cur + pq_slots[part]]]
        quote_cur += pq_slots[part]
        n_body = len(caps[part])
        content = PageContent(
            kicker=article.get("kicker"), headline=article.get("headline"), deck=article.get("subheadline"),
            byline=article.get("byline"), body_chunks=["\n\n".join(c) for c in chunks[chunk_cur:chunk_cur + n_body]],
            images=list(page_images),
            captions=[(article.get("captions") or {}).get(i) or (assets.get(i) or {}).get("caption") for i in page_images],
            quotes=page_quotes)
        chunk_cur += n_body
        if entry.page_type == "speaker_profile" or article.get("type") == "speaker_profiles":
            people = [speakers[i] for i in (article.get("speakerIds") or [])[part * 12: part * 12 + 12] if i in speakers]
            content.people = [{"portraitId": s.get("portraitAssetId"), "name": s["name"], "detail": _speaker_detail(s)}
                              for s in people]
            content.deck = article.get("subheadline") if part == 0 else None
        if entry.page_type == "infographic":
            content.stats = []
            for b in article.get("body") or []:
                if b.get("kind") == "list_item" and "|" in (b.get("text") or ""):
                    value, label = [x.strip() for x in b["text"].split("|", 1)]
                    content.stats.append({"value": value, "label": label})
            content.deck = article.get("intro")
        if part > 0 and entry.page_type not in ("photo_gallery", "speaker_profile"):
            content.headline = content.kicker = content.deck = content.byline = None
        elements = build_elements(tpl, ctx.profile, page_number, content, entry.page_type) if tpl else []
        out.append({
            "id": entry.id or f"pg_{page_number}_{entry.template_id}", "projectId": ctx.project["id"],
            "pageType": entry.page_type, "templateId": entry.template_id, "label": entry.label,
            "articleId": article["id"], "articlePart": part, "elements": elements,
            "editorialStatus": "approved" if article.get("status") == "approved" else "pending",
            "designStatus": "in_progress", "locked": entry.locked,
        })
    return out


def compose_standalone(entry: PlanEntry, page_number: int, ctx: ComposeContext, used: set[str]) -> dict:
    tpl = ctx.template(entry.template_id)
    p = ctx.project
    content = PageContent()
    assets = {a["id"]: a for a in ctx.assets}
    if entry.page_type == "cover":
        approved_reports = [a for a in ctx.articles if a.get("type") == "event_report" and a.get("status") == "approved"]
        lead = approved_reports[0] if approved_reports else (ctx.articles[0] if ctx.articles else None)
        lines = [f"{(a.get('kicker') or '').split('·')[-1].strip().upper()}\n{a.get('headline', '').replace('“', '').replace('”', '')}"
                 for a in ctx.articles if a.get("type") in ("keynote", "panel", "interview", "tech_feature")][:4]
        content.masthead = magazine_name(p.get("title") or "")
        content.headline = (lead or {}).get("headline")
        content.deck = f"{p.get('eventName') or ''} · Special Issue".strip(" ·")
        content.kicker = f"{p.get('issueNumber') or ''} · {issue_label(p.get('publicationDate') or '')}".strip(" ·")
        content.cover_lines = "\n\n".join(lines)
        content.images = list(entry.image_ids or _pick_fallback_images(ctx, None, 1, used))
    elif entry.page_type == "toc":
        content.images = list(entry.image_ids or _pick_fallback_images(ctx, None, 1, used))
        content.captions = [(assets.get(i) or {}).get("caption") for i in content.images]
        content.credits = (f"{p.get('title')}\n\n{p.get('issueNumber') or ''}\n\nPublished by {p.get('publisher') or ''}"
                           "\n\nAll quotations in this issue are linked to the session recordings in which they were spoken.")
    elif entry.page_type == "advertisement":
        content.ad_asset_id = entry.ad_asset_id
    else:
        content.images = list(entry.image_ids or _pick_fallback_images(ctx, None, 1, used))
        content.captions = [(assets.get(i) or {}).get("caption") for i in content.images]
    used.update(i for i in content.images if i)
    return {
        "id": entry.id or f"pg_{page_number}_{entry.template_id}", "projectId": p["id"], "pageType": entry.page_type,
        "templateId": entry.template_id, "label": entry.label,
        "elements": build_elements(tpl, ctx.profile, page_number, content, entry.page_type) if tpl else [],
        "editorialStatus": "approved", "designStatus": "ready" if entry.page_type == "advertisement" else "in_progress",
        "locked": entry.locked,
    }


def compose_magazine(plan: list[PlanEntry], ctx: ComposeContext) -> list[dict | None]:
    """Compose every entry at its real position (page parity matters). Locked entries are left as None."""
    used: set[str] = {i for e in plan for i in (e.image_ids or [])}
    out: list[dict | None] = [None] * len(plan)
    by_article: dict[str, list[tuple[PlanEntry, int, int]]] = {}
    for idx, e in enumerate(plan):
        if e.article_id and not e.locked:
            by_article.setdefault(e.article_id, []).append((e, idx + 1, idx))
    for idx, e in enumerate(plan):
        if not e.article_id and not e.locked:
            out[idx] = compose_standalone(e, idx + 1, ctx, used)
    articles = {a["id"]: a for a in ctx.articles}
    for aid, entries in by_article.items():
        art = articles.get(aid)
        if art is None:
            for e, n, idx in entries:
                out[idx] = compose_standalone(e, n, ctx, used)
            continue
        pages = compose_article(art, [(e, n) for e, n, _ in entries], ctx, used)
        for (_, _, idx), pg in zip(entries, pages):
            out[idx] = pg
    return out
