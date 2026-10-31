"""Reference-magazine analysis with PyMuPDF (real measurement, no simulation).

Pipeline: extract spans/images/drawings per page -> body style -> edge text (folios)
-> line blocks + roles -> per-page columns/features/layout type -> margins (facing-page
aware) -> grid/gutter/baseline -> typography hierarchy -> palette -> DesignProfile.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from statistics import median

from app.services.reference_analysis import layout as L
from app.services.reference_analysis.blocks import (
    TextBlock,
    body_style,
    caption_placement,
    classify_blocks,
    mark_edges,
    merge_lines,
)
from app.services.reference_analysis.extract import PageData, extract_page, open_pdf, render_page_png
from app.services.reference_analysis.fonts import clean_font_name
from app.services.reference_analysis.profile import layout_blocks, palette, typography

log = logging.getLogger("pressflow.reference")

ProgressFn = Callable[[float, str], None]

__all__ = ["AnalysisResult", "analyse_pdf", "render_page_png"]


@dataclass
class AnalysisResult:
    page_count: int
    title: str | None
    profile: dict  # DesignProfile body (camelCase) without id/referenceId/name/status/version/overrides
    pages: list[dict] = field(default_factory=list)  # ReferencePage bodies (camelCase) + "features"
    notes: list[str] = field(default_factory=list)


def analyse_pdf(source, progress: ProgressFn | None = None) -> AnalysisResult:
    progress = progress or (lambda pct, msg: None)
    doc = open_pdf(source)
    try:
        n = doc.page_count
        if n == 0:
            raise ValueError("PDF has no pages")
        title = (doc.metadata or {}).get("title") or None
        pages: list[PageData] = []
        for i, page in enumerate(doc):
            pages.append(extract_page(page, i))
            if i % 4 == 0 or i == n - 1:
                progress(5 + 45 * (i + 1) / n, f"Extracted page {i + 1} of {n}")
        bleed = _bleed(doc)
    finally:
        doc.close()
    return _analyse_pages(pages, title, bleed, progress)


def _bleed(doc) -> float | None:
    try:
        p = doc[0]
        bb, tb = p.bleedbox, p.trimbox
        d = (bb.width - tb.width) / 2
        return round(d, 2) if d > 0.5 else None
    except Exception:  # noqa: BLE001
        return None


def _analyse_pages(pages: list[PageData], title: str | None, bleed: float | None, progress: ProgressFn) -> AnalysisResult:
    notes: list[str] = []
    n = len(pages)
    body_size, body_font, _ = body_style(pages)
    blocks_by_page: dict[int, list[TextBlock]] = {}
    for p in pages:
        mark_edges(p, body_size)
        blocks = merge_lines(p)
        classify_blocks(p, blocks, body_size, body_font)
        blocks_by_page[p.index] = blocks
    progress(55, "Classified text roles")

    # ---- columns + page types
    col_info: dict[int, L.ColumnInfo | None] = {}
    features: dict[int, L.PageFeatures] = {}
    page_types: dict[int, str] = {}
    page_conf: dict[int, float] = {}
    scores: dict[int, dict] = {}
    for p in pages:
        bl = L.body_lines(p, body_size, body_font)
        ci = L.detect_columns(bl)
        col_info[p.index] = ci
        f = L.compute_features(p, blocks_by_page[p.index], body_size, body_font, ci)
        if ci is None:
            f.columns = _visual_columns(p)
        features[p.index] = f
        t, c, sc = L.classify_page(f, p.index, n)
        page_types[p.index], page_conf[p.index], scores[p.index] = t, c, sc
    progress(65, "Classified page layouts")

    # ---- page size (mode)
    sizes = Counter((round(p.width, 1), round(p.height, 1)) for p in pages)
    (Wr, Hr), size_votes = sizes.most_common(1)[0]
    exemplar = next(p for p in pages if (round(p.width, 1), round(p.height, 1)) == (Wr, Hr))
    W, H = exemplar.width, exemplar.height
    orientation = "landscape" if W > H else "portrait"

    # ---- margins
    content_pages = [p for p in pages if page_types[p.index] not in ("cover", "advertisement", "full_page_image")]
    bounds = {p.index: L.page_content_bounds(p) for p in content_pages}
    odd = [b[0] for i, b in bounds.items() if b and (i + 1) % 2 == 1]
    even = [b[0] for i, b in bounds.items() if b and (i + 1) % 2 == 0]
    facing = bool(odd and even and abs(L.consensus(odd)[0] - L.consensus(even)[0]) >= 2.0)
    ins, outs, tops, bottoms = [], [], [], []
    for i, b in bounds.items():
        if not b:
            continue
        left, top, right, bottom = b
        recto = (i + 1) % 2 == 1
        if facing and not recto:
            ins.append(right)
            outs.append(left)
        else:
            ins.append(left)
            outs.append(right)
        tops.append(top)
        bottoms.append(bottom)
    m_top, c_top = L.consensus(tops)
    m_bottom, c_bottom = L.consensus(bottoms)
    m_in, c_in = L.consensus(ins)
    m_out, c_out = L.consensus(outs)
    if not tops:
        m_top = m_bottom = round(0.07 * H, 1)
        m_in = m_out = round(0.07 * W, 1)
        notes.append("No content pages found; margins defaulted to 7% of the page.")
    margins = {"top": round(m_top, 1), "bottom": round(m_bottom, 1), "inside": round(m_in, 1), "outside": round(m_out, 1)}
    margin_conf = round(min(0.95, 0.4 + 0.5 * median([c_top or 0, c_bottom or 0, c_in or 0, c_out or 0])), 2)

    # ---- grid
    weights: Counter = Counter()
    for i, ci in col_info.items():
        if ci and page_types[i] not in ("cover", "advertisement", "toc"):
            weights[ci.count] += ci.lines
    columns = weights.most_common(1)[0][0] if weights else 1
    col_support = (weights[columns] / sum(weights.values())) if weights else 0.0
    gutters = [ci.gutter for ci in col_info.values() if ci and ci.count == columns and ci.gutter]
    gutter = round(float(median(gutters)), 1) if gutters else round(0.025 * W, 1)
    pitches: list[float] = []
    for p in pages:
        pitches += L.baseline_pitch(L.body_lines(p, body_size, body_font), body_size)
    leading = round(float(median(pitches)) * 4) / 4 if pitches else round(body_size * 1.2 * 4) / 4
    if not weights:
        notes.append("Too little running text to measure columns; grid defaulted to 1 column.")

    # ---- colours + typography
    colors, color_conf = palette(pages, blocks_by_page, page_types)
    styles, type_conf = typography(blocks_by_page, page_types, body_size, body_font, leading, colors["ink"],
                                   colors["accent"])
    progress(80, "Derived typography and palette")

    # ---- folio / images / pull quotes
    folio_pos, folio_conf = L.folio_position(pages, margins["outside"])
    masthead = _masthead(pages, blocks_by_page)
    folio_texts = [b.text for bl in blocks_by_page.values() for b in bl if b.role == "folio"]
    show_name = bool(masthead and any(masthead.lower() in t.lower() for t in folio_texts))
    show_section = _folio_has_section(folio_texts, masthead)
    placements = Counter()
    for p in pages:
        for b in blocks_by_page[p.index]:
            if b.role == "caption":
                pl = caption_placement(p, b)
                if pl in ("below", "above"):
                    placements["below"] += 1
                elif pl:
                    placements[pl] += 1
    caption_pl = placements.most_common(1)[0][0] if placements else "below"
    cover_fb = bool(pages and any(im.area >= 0.9 * pages[0].width * pages[0].height for im in pages[0].images))
    pq_style, pq_conf = _pullquote_style(pages, blocks_by_page)

    profile = {
        "page": {"widthPt": round(W, 2), "heightPt": round(H, 2), "orientation": orientation,
                 "bleedPt": bleed if bleed is not None else 9.0},
        "margins": margins,
        "grid": {"columns": int(columns), "gutterPt": gutter, "baselinePt": leading},
        "typography": styles,
        "colors": colors,
        "folio": {"position": folio_pos, "showMagazineName": show_name, "showSection": show_section},
        "images": {"captionPlacement": caption_pl, "cornerRadius": 0, "fullBleedCover": cover_fb},
        "pullQuote": {"style": pq_style},
        "pageTypeCounts": dict(Counter(page_types.values())),
        "confidence": {
            "page.size": round(min(0.99, 0.6 + 0.4 * size_votes / n), 2),
            "page.bleedPt": 0.9 if bleed is not None else 0.25,
            "margins": margin_conf,
            "grid.columns": round(min(0.95, 0.35 + 0.6 * col_support), 2) if weights else 0.2,
            "grid.gutterPt": 0.8 if gutters else 0.2,
            "grid.baselinePt": 0.85 if pitches else 0.2,
            **type_conf,
            **color_conf,
            "folio.position": folio_conf,
            "images.captionPlacement": 0.7 if placements else 0.25,
            "images.cornerRadius": 0.3,
            "pullQuote.style": pq_conf,
            "pageTypes": round(sum(page_conf.values()) / max(1, n), 2),
        },
    }
    if bleed is None:
        notes.append("PDF has no bleed box; bleed assumed 9 pt (3 mm).")

    out_pages: list[dict] = []
    for p in pages:
        blocks = blocks_by_page[p.index]
        fonts = Counter()
        for ln in p.lines:
            fonts[clean_font_name(ln.font)] += ln.chars
        out_pages.append({
            "pageNumber": p.number,
            "layoutType": page_types[p.index],
            "confidence": page_conf[p.index],
            "widthPt": p.width,
            "heightPt": p.height,
            "blocks": layout_blocks(p, blocks),
            "properties": {
                "columns": int(features[p.index].columns),
                "dominantColors": p.dominant_colors,
                "textCoverage": round(p.text_coverage, 3),
                "imageCoverage": round(p.image_coverage, 3),
                "fonts": [f for f, _ in fonts.most_common(8)],
            },
            "features": {**features[p.index].as_dict(), "scores": scores[p.index]},
        })
    progress(90, "Built page layouts")
    return AnalysisResult(page_count=n, title=title, profile=profile, pages=out_pages, notes=notes)


def _visual_columns(p: PageData) -> int:
    imgs = [im for im in p.images if im.area < 0.5 * p.width * p.height]
    if len(imgs) < 2:
        return 1
    starts = L.cluster_1d([im.x0 for im in imgs], 6.0)
    return max(1, min(6, len(starts)))


def _masthead(pages: list[PageData], blocks_by_page: dict[int, list[TextBlock]]) -> str | None:
    if not pages:
        return None
    cover = blocks_by_page.get(0, [])
    if not cover:
        return None
    big = max(cover, key=lambda b: b.size)
    t = big.text.strip()
    return t if 2 <= len(t) <= 40 else None


def _folio_has_section(texts: list[str], masthead: str | None) -> bool:
    import re

    months = r"(january|february|march|april|may|june|july|august|september|october|november|december)"
    hits = 0
    for t in texts:
        s = t.lower()
        if masthead:
            s = s.replace(masthead.lower(), " ")
        s = re.sub(months, " ", s)
        s = re.sub(r"[\d·|•/\-–—,.:]+", " ", s)
        if len([w for w in s.split() if len(w) > 2]) >= 1:
            hits += 1
    return bool(texts) and hits / len(texts) >= 0.5


def _pullquote_style(pages: list[PageData], blocks_by_page: dict[int, list[TextBlock]]) -> tuple[str, float]:
    votes: Counter = Counter()
    for p in pages:
        for b in blocks_by_page[p.index]:
            if b.role != "pullquote":
                continue
            ruled = any(d.kind == "rule" and 0 <= b.y0 - d.y1 <= 16 and min(d.x1, b.x1) - max(d.x0, b.x0) > 0
                        for d in p.drawings)
            boxed = any(d.kind in ("fill", "stroke") and d.x0 <= b.x0 and d.x1 >= b.x1 and d.y0 <= b.y0
                        and d.y1 >= b.y1 and d.w * d.h < 0.5 * p.width * p.height for d in p.drawings)
            if boxed:
                votes["boxed"] += 1
            elif ruled:
                votes["rule_above"] += 1
            elif b.text.strip()[:1] in "“\"«":
                votes["quote_mark"] += 1
    if not votes:
        return "rule_above", 0.2
    style, k = votes.most_common(1)[0]
    return style, round(min(0.9, 0.5 + 0.1 * k), 2)
