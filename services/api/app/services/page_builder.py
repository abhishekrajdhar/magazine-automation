"""Page composer — a port of `apps/web/src/lib/templates/compose.ts` (buildElements, folio, text flow).

Turns a template + design profile + content into PageElements (points). Text frames use the frontend's light
markup: "^ " lead paragraph, "## " subhead, "Q: " question, "• " list item, "> " inline quote, "— " attribution.
Folio and contents frames are `dynamic` and filled at render time.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.services.templates import resolve_slots

TEXT_ROLES = ("kicker", "headline", "deck", "byline", "body", "subhead", "pullquote", "caption", "folio", "question", "stat")
NAMES = {"hero_image": "Hero image", "image": "Image", "portrait": "Portrait", "headline": "Headline",
         "deck": "Standfirst", "kicker": "Kicker", "byline": "Byline", "body": "Body text", "pullquote": "Pull quote",
         "caption": "Caption", "stat": "Figure", "background": "Background", "accent_bar": "Accent bar", "rule": "Rule",
         "ad": "Advertisement", "folio": "Folio"}


@dataclass
class PageContent:
    masthead: str | None = None
    kicker: str | None = None
    headline: str | None = None
    deck: str | None = None
    byline: str | None = None
    body_chunks: list[str] = field(default_factory=list)
    images: list[str | None] = field(default_factory=list)
    captions: list[str | None] = field(default_factory=list)
    quotes: list[dict] = field(default_factory=list)  # {text, attribution?}
    stats: list[dict] = field(default_factory=list)  # {value, label}
    people: list[dict] = field(default_factory=list)  # {portraitId?, name, detail}
    ad_asset_id: str | None = None
    credits: str | None = None
    cover_lines: str | None = None


def fill_color(profile: dict, key: str | None) -> str | None:
    if not key:
        return None
    c = profile["colors"]
    pal = c.get("palette") or []
    return {"accent": c["accent"], "accentAlt": c["accentAlt"], "ink": c["ink"], "paper": c["paper"],
            "muted": c["muted"], "rule": c["rule"], "tint": pal[3] if len(pal) > 3 else "#F1F4F9"}.get(key)


def _r(n: float) -> float:
    return round(n * 100) / 100


def folio_element(profile: dict, page_number: int, z: int) -> dict:
    from app.services.templates import live_area

    la = live_area(profile, page_number)
    w = 320.0
    pos = (profile.get("folio") or {}).get("position", "bottom_outside")
    y = max(14.0, float(profile["margins"]["top"]) - 30) if pos == "top_outside" else \
        float(profile["page"]["heightPt"]) - float(profile["margins"]["bottom"]) + 22
    center = pos == "bottom_center"
    x = (float(profile["page"]["widthPt"]) - w) / 2 if center else (la["x"] + la["w"] - w if la["recto"] else la["x"])
    return {"id": "el_folio", "kind": "text", "role": "folio", "name": "Folio", "x": _r(x), "y": _r(y), "w": w, "h": 12,
            "z": z, "dynamic": "folio", "text": "", "styleRole": "folio",
            "style": {"align": "center" if center else ("right" if la["recto"] else "left")}, "locked": True}


def build_elements(template: dict, profile: dict, page_number: int, content: PageContent, page_type: str) -> list[dict]:
    slots = resolve_slots(template, profile, page_number)
    t = profile["typography"]
    elements: list[dict[str, Any]] = []
    body_idx = quote_idx = image_idx = 0
    image_slot_assets: list[str | None] = []
    for z, slot in enumerate(slots):
        role = slot["role"]
        base = {"id": f"el_{slot['id']}", "role": role, "name": NAMES.get(role, role), "x": _r(slot["x"]),
                "y": _r(slot["y"]), "w": _r(slot["w"]), "h": _r(slot["h"]), "z": z}
        style_role = slot.get("styleRole") or (role if role in TEXT_ROLES else None)
        style: dict[str, Any] = {}
        if slot.get("sizeScale") and style_role:
            style["size"] = round(t[style_role]["size"] * slot["sizeScale"], 1)
            style["leading"] = round(t[style_role]["leading"] * slot["sizeScale"], 1)
        if slot.get("lineHeight") and style_role:
            style["leading"] = round(style.get("size", t[style_role]["size"]) * slot["lineHeight"], 1)
        colour = fill_color(profile, slot.get("colorKey"))
        if colour:
            style["color"] = colour
        if slot.get("align"):
            style["align"] = slot["align"]
        cols = int(slot.get("columns") or 1)

        def text_el(text: str | None, **extra: Any) -> None:
            if text is None:
                return
            el = {**base, "kind": "text", "text": text, "styleRole": style_role}
            if style:
                el["style"] = dict(style)
            if cols > 1:
                el["columns"] = cols
                el["gutter"] = profile["grid"]["gutterPt"]
            el.update(extra)
            elements.append(el)

        if role in ("hero_image", "image", "portrait"):
            if page_type == "speaker_profile":
                person = content.people[slot.get("index") or 0] if (slot.get("index") or 0) < len(content.people) else None
                asset_id = person.get("portraitId") if person else None
            else:
                asset_id = content.images[image_idx] if image_idx < len(content.images) else None
            image_idx += 1
            image_slot_assets.append(asset_id)
            if page_type == "speaker_profile" and not person:
                continue
            el = {**base, "kind": "image", "crop": {"scale": 1, "offsetX": 0,
                                                    "offsetY": -0.2 if role == "portrait" or page_type == "interview" else 0}}
            if asset_id:
                el["assetId"] = asset_id
            elements.append(el)
        elif role == "ad":
            el = {**base, "kind": "image", "crop": {"scale": 1, "offsetX": 0, "offsetY": 0}}
            if content.ad_asset_id:
                el["assetId"] = content.ad_asset_id
            elements.append(el)
        elif role in ("background", "accent_bar", "rule"):
            el = {**base, "kind": "rule" if role == "rule" else "shape",
                  "fill": fill_color(profile, slot.get("fill")) or profile["colors"]["rule"]}
            if slot.get("opacity") is not None:
                el["opacity"] = slot["opacity"]
            elements.append(el)
        elif role == "headline":
            if page_type == "cover" and slot["id"] == "mast":
                text_el(content.masthead, name="Masthead")
            else:
                text_el(slot.get("fixedText") or content.headline)
        elif role == "kicker":
            text_el(slot.get("fixedText") or content.kicker)
        elif role == "deck":
            if slot["id"] == "lines":
                text_el(content.cover_lines, name="Cover lines")
            elif slot.get("dynamic") == "toc":
                text_el("", dynamic="toc", name="Contents list")
            else:
                text_el(content.deck or None)
        elif role == "byline":
            text_el(f"By {content.byline}" if content.byline else None)
        elif role == "body":
            if slot.get("dynamic") == "toc":
                text_el("", dynamic="toc", name="Contents list", styleRole="deck")
            else:
                chunk = content.body_chunks[body_idx] if body_idx < len(content.body_chunks) else ""
                body_idx += 1
                text_el(chunk, name=f"Body text ({cols} col)" if cols > 1 else "Body text")
        elif role == "pullquote":
            q = content.quotes[quote_idx] if quote_idx < len(content.quotes) else None
            quote_idx += 1
            if q:
                txt = re.sub(r'^[“"]|[”"]$', "", q["text"])
                text_el(f"“{txt}”" + (f"\n\n— {q['attribution']}" if q.get("attribution") else ""))
        elif role == "stat":
            i = slot.get("index") or 0
            if i < len(content.stats):
                text_el(content.stats[i]["value"], name="Figure")
        elif role == "caption":
            i = slot.get("index") or 0
            if i == 99:
                text_el(content.credits, name="Issue credits")
            elif i >= 200:
                p = content.people[i - 200] if i - 200 < len(content.people) else None
                if p:
                    text_el(f"{p['name']}\n\n{p['detail']}", name="Name & designation")
            elif i >= 100:
                st = content.stats[i - 100] if i - 100 < len(content.stats) else None
                if st:
                    text_el(st["label"], name="Figure label")
            else:
                asset_id = image_slot_assets[i] if i < len(image_slot_assets) else (
                    content.images[i] if i < len(content.images) else None)
                if asset_id:
                    cap = content.captions[i] if i < len(content.captions) else None
                    text_el(cap or "")
    from app.services.template_specs import SPEC_BY_ID

    spec = SPEC_BY_ID.get(template.get("id") or "")
    if spec is None or spec.get("folio", True) is not False:  # reference templates always get a folio
        elements.append(folio_element(profile, page_number, len(elements)))
    if content.ad_asset_id and not any(e["role"] == "ad" for e in elements):
        b = float(profile["page"].get("bleedPt", 9))
        elements.insert(0, {"id": "el_ad", "kind": "image", "role": "ad", "name": "Advertisement", "x": -b, "y": -b,
                            "w": float(profile["page"]["widthPt"]) + 2 * b, "h": float(profile["page"]["heightPt"]) + 2 * b,
                            "z": -1, "assetId": content.ad_asset_id})
    return elements


# ---------------------------------------------------------------- article text

def article_paragraphs(article: dict, speakers: dict[str, dict], inline_quote_ids: set[str]) -> list[str]:
    out: list[str] = []
    if article.get("intro"):
        out.append(f"^ {article['intro']}")
    for b in article.get("body") or []:
        k, text = b.get("kind"), b.get("text") or ""
        if k in ("paragraph", "answer"):
            out.append(text)
        elif k == "subhead":
            out.append(f"## {text}")
        elif k == "question":
            out.append(f"Q: {text}")
        elif k == "list_item":
            out.append(f"• {text}")
        elif k == "quote" and b.get("id") in inline_quote_ids:
            who = (speakers.get(b.get("speakerId") or "") or {}).get("name")
            out.append(f"> “{text}”" + (f" — {who}" if who else ""))
    return out


def _words(s: str) -> int:
    return len(s.split())


def paragraph_cost(p: str) -> int:
    return _words(p) + (10 if p.startswith(("## ", "Q: ")) else 3)


def distribute_paragraphs(paragraphs: list[str], capacities: list[int]) -> list[list[str]]:
    chunks: list[list[str]] = [[] for _ in capacities]
    if not capacities:
        return chunks
    queue = list(paragraphs)
    for i, cap in enumerate(capacities):
        if i == len(capacities) - 1:
            chunks[i].extend(queue)
            queue = []
            break
        remaining = cap
        while queue:
            p = queue[0]
            cost = paragraph_cost(p)
            if cost <= remaining:
                chunks[i].append(queue.pop(0))
                remaining -= cost
                continue
            if remaining >= 28 and not p.startswith(("## ", "Q: ")):
                sentences = re.findall(r"[^.!?]+[.!?]+[\"”’)]*\s*", p) or [p]
                head = ""
                while sentences and _words(head + sentences[0]) <= remaining - 3:
                    head += sentences.pop(0)
                if head.strip() and sentences:
                    chunks[i].append(head.strip())
                    queue[0] = "".join(sentences).strip()
            if chunks[i] and chunks[i][-1].startswith("## "):
                queue.insert(0, chunks[i].pop())
            break
    return chunks


def balanced_capacities(capacities: list[list[int]], total_words: int) -> list[int]:
    flat = [c for page in capacities for c in page]
    if not capacities or len(capacities[-1]) < 2:
        return flat
    before = sum(c for page in capacities[:-1] for c in page)
    remaining = max(0, total_words - before)
    last_total = sum(capacities[-1])
    if remaining >= last_total:
        return flat
    ratio = remaining / last_total
    return [c for page in capacities[:-1] for c in page] + [math.ceil(c * ratio) + 4 for c in capacities[-1]]


def estimate_word_capacity(w: float, h: float, columns: int, gutter: float, size: float, leading: float) -> int:
    cols = max(1, columns)
    cw = (w - gutter * (cols - 1)) / cols
    if cw <= 0 or h <= 0:
        return 0
    chars_per_line = cw / (size * 0.48)
    lines = math.floor(h / leading)
    return max(0, math.floor(cols * lines * chars_per_line / 6.0 * 0.88))


def body_capacities(template: dict, profile: dict, page_number: int) -> list[int]:
    body = profile["typography"]["body"]
    return [estimate_word_capacity(s["w"], s["h"], s["columns"], profile["grid"]["gutterPt"],
                                   body["size"] * (s.get("sizeScale") or 1), body["leading"] * (s.get("sizeScale") or 1))
            for s in resolve_slots(template, profile, page_number) if s["role"] == "body" and not s.get("dynamic")]


def count_slots(template: dict, profile: dict, page_number: int, roles: tuple[str, ...]) -> int:
    return sum(1 for s in resolve_slots(template, profile, page_number) if s["role"] in roles)


# ---------------------------------------------------------------- render-time helpers (folio + contents)

def magazine_name(title: str) -> str:
    return re.split(r"\s+[—–-]\s+", title or "")[0].strip() or (title or "")


def issue_label(publication_date: str) -> str:
    try:
        d = datetime.fromisoformat((publication_date or "")[:10])
    except ValueError:
        return ""
    return d.strftime("%B %Y")


def build_toc(pages: list[dict], articles: dict[str, dict]) -> list[dict]:
    from app.services.templates import page_type_label

    seen: set[str] = set()
    out = []
    for i, page in enumerate(pages):
        aid = page.get("articleId")
        if not aid or aid in seen:
            continue
        seen.add(aid)
        a = articles.get(aid)
        if not a or a.get("type") == "editorial":
            continue
        kicker = (a.get("kicker") or page_type_label(page.get("pageType", ""))).split("·")[0].strip()
        out.append({"page": i + 1, "kicker": kicker, "title": re.sub(r'[“”"]', "", a.get("headline") or "").strip()})
    return out[:14]


def folio_text(profile: dict, page_number: int, magazine: str, issue: str, section: str | None, align: str) -> str:
    f = profile.get("folio") or {}
    meta = "   ·   ".join(x for x in [f"{magazine} · {issue}".strip(" ·") if f.get("showMagazineName", True) else None,
                                        section if f.get("showSection", True) and section else None] if x)
    if not meta:
        return str(page_number)
    return f"{page_number}  |  {meta}" if align == "left" else f"{meta}  |  {page_number}"
