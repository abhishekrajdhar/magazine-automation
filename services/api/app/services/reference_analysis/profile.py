"""Assemble typography, colours and per-page layout blocks into API shapes (camelCase dicts)."""

from __future__ import annotations

from collections import Counter
from statistics import median

from app.ids import new_id
from app.schemas.base import TEXT_ROLES
from app.services.reference_analysis import colors as C
from app.services.reference_analysis.blocks import TextBlock
from app.services.reference_analysis.extract import PageData
from app.services.reference_analysis.fonts import (
    classify_font,
    clean_font_name,
    is_italic,
    preview_font_for,
    weight_of,
)

# Default size multipliers (x body size) for roles without evidence.
ROLE_DEFAULTS = {
    "kicker": (0.85, 700, True, False),
    "headline": (3.0, 700, False, False),
    "deck": (1.35, 400, False, False),
    "byline": (0.9, 400, False, False),
    "body": (1.0, 400, False, False),
    "subhead": (1.1, 700, False, False),
    "pullquote": (1.8, 400, False, True),
    "caption": (0.8, 400, False, False),
    "folio": (0.8, 700, False, False),
    "question": (1.0, 700, False, False),
    "stat": (4.5, 700, False, False),
}

# Which pages provide evidence for a role (page types). None = any page.
ARTICLE_TYPES = {"editorial", "interview", "event_report", "two_column_article"}
EVIDENCE_PAGES: dict[str, set[str] | None] = {
    "headline": ARTICLE_TYPES | {"toc", "photo_gallery", "speaker_profile", "infographic"},
    "deck": ARTICLE_TYPES,
    "subhead": ARTICLE_TYPES,
    "kicker": ARTICLE_TYPES | {"toc", "photo_gallery", "speaker_profile", "infographic"},
    "body": None,
    "byline": ARTICLE_TYPES,
    "pullquote": ARTICLE_TYPES,
    "caption": None,
    "folio": None,
    "question": {"interview"} | ARTICLE_TYPES,
    "stat": None,
}


def _r(x: float, step: float = 0.5) -> float:
    return round(round(x / step) * step, 2)


def typography(blocks_by_page: dict[int, list[TextBlock]], page_types: dict[int, str], body_size: float,
               body_font: str, leading: float, ink: str, accent: str) -> tuple[dict, dict[str, float]]:
    styles: dict[str, dict] = {}
    conf: dict[str, float] = {}
    for role in TEXT_ROLES:
        allowed = EVIDENCE_PAGES.get(role)
        ev: list[TextBlock] = []
        for idx, blocks in blocks_by_page.items():
            if allowed is not None and page_types.get(idx) not in allowed:
                continue
            if page_types.get(idx) in ("cover", "advertisement") and role not in ("folio",):
                continue
            ev += [b for b in blocks if b.role == role]
        if role == "folio":
            digits = [b for b in ev if any(ch.isdigit() for ch in b.text)]
            ev = digits or ev
        if role == "subhead":  # subheads must sit in running text: body text directly below
            body_like = {i: [ln for b in bl if b.role in ("body", "question") for ln in b.lines]
                         for i, bl in blocks_by_page.items()}
            ev = [b for b in ev if any(-1 <= o.y0 - b.y1 <= 2.2 * body_size and abs(o.x0 - b.x0) < 30
                                       for o in body_like.get(b.page, []))]
        if not ev:
            styles[role] = _default_style(role, body_size, body_font, leading, ink, accent)
            conf[f"typography.{role}"] = 0.2
            continue
        sizes: Counter = Counter()
        for b in ev:
            sizes[_r(b.size)] += 1 if role in ("headline", "stat", "kicker", "folio", "subhead", "question") else b.chars
        size = sizes.most_common(1)[0][0]
        same = [b for b in ev if abs(_r(b.size) - size) < 0.01]
        fonts = Counter()
        colours = Counter()
        for b in same:
            fonts[b.font] += b.chars
            colours[b.color] += b.chars
        font = fonts.most_common(1)[0][0]
        lead_vals = [v for b in same if (v := b.leading()) is not None]
        if role == "body":
            lead = leading
        elif lead_vals:
            lead = _r(float(median(lead_vals)), 0.25)
        else:
            lead = _r(size * 1.2, 0.25)
        upper_chars = sum(sum(1 for c in b.text if c.isalpha() and c.isupper()) for b in same)
        letters = sum(sum(1 for c in b.text if c.isalpha()) for b in same) or 1
        serif_flag = Counter(b.first.serif for b in same).most_common(1)[0][0]
        classification = classify_font(font, serif_flag)
        if role in ("headline", "stat") and classification == "serif" and size >= 4 * body_size:
            classification = "display"
        consistency = (sum(sizes[k] for k in sizes if abs(k - size) < 0.01) / max(1, sum(sizes.values())))
        c = round(min(0.97, (0.45 + 0.08 * min(len(ev), 6)) * (0.5 + 0.5 * consistency)), 2)
        styles[role] = {
            "role": role,
            "detectedFont": clean_font_name(font),
            "classification": classification,
            "previewFont": preview_font_for(classification),
            "size": size if role != "body" else round(body_size, 2),
            "leading": lead,
            "weight": weight_of(font, Counter(b.bold for b in same).most_common(1)[0][0]),
            "tracking": 0,
            "color": colours.most_common(1)[0][0],
            "uppercase": upper_chars / letters >= 0.8,
            "italic": is_italic(font, any(b.italic for b in same)),
            "confidence": c if role != "body" else 0.95,
        }
        conf[f"typography.{role}"] = styles[role]["confidence"]
    return styles, conf


def _default_style(role: str, body_size: float, body_font: str, leading: float, ink: str, accent: str) -> dict:
    mult, weight, upper, italic = ROLE_DEFAULTS[role]
    size = _r(body_size * mult)
    cls = classify_font(body_font) if role in ("body", "pullquote", "question") else "sans"
    return {
        "role": role,
        "detectedFont": None,
        "classification": cls,
        "previewFont": preview_font_for(cls),
        "size": size,
        "leading": round(leading, 2) if role == "body" else _r(size * 1.2, 0.25),
        "weight": weight,
        "tracking": 0,
        "color": accent if role in ("kicker", "pullquote", "stat") else ink,
        "uppercase": upper,
        "italic": italic,
        "confidence": 0.2,
    }


def palette(pages: list[PageData], blocks_by_page: dict[int, list[TextBlock]], page_types: dict[int, str]
            ) -> tuple[dict, dict[str, float]]:
    text_colours: Counter = Counter()
    body_colours: Counter = Counter()
    accent_candidates: Counter = Counter()
    rule_colours: Counter = Counter()
    backgrounds: Counter = Counter()
    for p in pages:
        ptype = page_types.get(p.index)
        if ptype not in ("cover", "advertisement", "full_page_image"):
            backgrounds[p.background] += 1
        for b in blocks_by_page.get(p.index, []):
            text_colours[b.color] += b.chars
            if b.role == "body":
                body_colours[b.color] += b.chars
            elif C.is_chromatic(b.color) and ptype not in ("advertisement",):
                accent_candidates[b.color] += b.chars * max(1.0, b.size / 6)
        for d in p.drawings:
            col = d.stroke if d.kind == "rule" else d.fill
            if not col:
                continue
            if d.kind == "rule":
                rule_colours[col] += 1
            if C.is_chromatic(col) and ptype not in ("advertisement",):
                accent_candidates[col] += min(4000.0, (max(1.0, d.w) * max(1.0, d.h)) ** 0.5 * 4)
    ink = (body_colours or text_colours).most_common(1)[0][0] if (body_colours or text_colours) else "#111111"
    paper = backgrounds.most_common(1)[0][0] if backgrounds else "#FFFFFF"
    if C.is_light(paper) and C.distance(paper, "#FFFFFF") < 30:
        paper = "#FFFFFF"
    accent_candidates = Counter({h: w for h, w in accent_candidates.items()
                                 if C.distance(h, ink) > 60 and C.distance(h, paper) > 60})
    accents = C.merge_weighted(accent_candidates, 50)
    conf: dict[str, float] = {"colors.ink": 0.9 if body_colours else 0.5, "colors.paper": 0.8}
    if accents:
        accent = accents[0][0]
        conf["colors.accent"] = 0.8
        alt = next((h for h, _ in accents[1:] if C.distance(h, accent) > 80), None)
        accent_alt = alt or C.mix(accent, paper, 0.45)
        conf["colors.accentAlt"] = 0.7 if alt else 0.3
    else:
        # no chromatic colour found: use pixel palette (e.g. photo-heavy magazines)
        pix: Counter = Counter()
        for p in pages:
            for h, frac in p.pixel_colors:
                if C.is_chromatic(h):
                    pix[h] += frac
        merged = C.merge_weighted(pix, 60)
        accent = merged[0][0] if merged else C.mix(ink, paper, 0.3)
        accent_alt = merged[1][0] if len(merged) > 1 else C.mix(accent, paper, 0.45)
        conf["colors.accent"] = 0.35 if merged else 0.2
        conf["colors.accentAlt"] = 0.25
    greys = Counter({h: n for h, n in text_colours.items() if C.hsv(h)[1] < 0.3 and C.distance(h, ink) > 40
                     and 0.2 < C.luminance(h) < 0.8})
    muted = greys.most_common(1)[0][0] if greys else C.mix(ink, paper, 0.45)
    conf["colors.muted"] = 0.7 if greys else 0.3
    rule = rule_colours.most_common(1)[0][0] if rule_colours else C.mix(ink, paper, 0.75)
    conf["colors.rule"] = 0.7 if rule_colours else 0.3
    pal: list[str] = []
    for h in [ink, accent, accent_alt, muted, rule, paper] + [h for h, _ in accents[2:6]]:
        if all(C.distance(h, x) > 25 for x in pal):
            pal.append(h)
    return {"ink": ink, "paper": paper, "accent": accent, "accentAlt": accent_alt, "muted": muted, "rule": rule,
            "palette": pal[:8]}, conf


def layout_blocks(page: PageData, blocks: list[TextBlock], limit: int = 160) -> list[dict]:
    W, H = page.width, page.height
    out: list[dict] = []

    def norm(x0, y0, x1, y1) -> dict:
        x0, y0 = max(0.0, x0), max(0.0, y0)
        x1, y1 = min(W, x1), min(H, y1)
        return {"x": round(x0 / W, 4), "y": round(y0 / H, 4), "w": round(max(0.0, x1 - x0) / W, 4),
                "h": round(max(0.0, y1 - y0) / H, 4)}

    area = W * H
    for d in page.drawings:
        if d.kind == "fill" and d.w * d.h >= 0.25 * area:
            out.append({"id": new_id("blk"), "kind": "shape", "role": "background", "color": d.fill,
                        **norm(d.x0, d.y0, d.x1, d.y1)})
    for im in page.images:
        role = "background" if im.area >= 0.85 * area else "image"
        out.append({"id": new_id("blk"), "kind": "image", "role": role, **norm(im.x0, im.y0, im.x1, im.y1)})
    for d in page.drawings:
        if d.kind == "rule":
            out.append({"id": new_id("blk"), "kind": "rule", "color": d.stroke, **norm(d.x0, d.y0, d.x1, d.y1)})
        elif d.kind == "fill" and d.w * d.h < 0.25 * area and d.w * d.h >= 40:
            out.append({"id": new_id("blk"), "kind": "shape", "color": d.fill, **norm(d.x0, d.y0, d.x1, d.y1)})
    for b in sorted(blocks, key=lambda b: (b.y0, b.x0)):
        out.append({
            "id": new_id("blk"), "kind": "text", "role": b.role, "fontName": clean_font_name(b.font),
            "fontSize": round(b.size, 2), "color": b.color, "sample": b.text[:80],
            **norm(b.x0, b.y0, b.x1, b.y1),
        })
    return out[:limit]
