"""Merge text lines into blocks and tag typographic roles."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from statistics import median

from app.services.reference_analysis.extract import Line, PageData, Placement
from app.services.reference_analysis.fonts import family_of

BYLINE_RE = re.compile(r"^(by|words by|text by|written by|report by|interview by)\s+\S", re.I)
QUESTION_RE = re.compile(r"^(q[.:)\s]|question[:.]|—?\s*q\s)", re.I)
STAT_RE = re.compile(r"^[~+\-−]?[₹$€£]?\s?\d[\d,.]*\s?(%|x|k|m|bn|cr|crore|lakh|mn|\+)?$", re.I)
EDGE_FRACTION = 0.06


@dataclass
class TextBlock:
    page: int
    lines: list[Line] = field(default_factory=list)
    role: str | None = None

    @property
    def x0(self) -> float:
        return min(ln.x0 for ln in self.lines)

    @property
    def y0(self) -> float:
        return min(ln.y0 for ln in self.lines)

    @property
    def x1(self) -> float:
        return max(ln.x1 for ln in self.lines)

    @property
    def y1(self) -> float:
        return max(ln.y1 for ln in self.lines)

    @property
    def first(self) -> Line:
        return self.lines[0]

    @property
    def text(self) -> str:
        return " ".join(ln.text for ln in self.lines)

    @property
    def size(self) -> float:
        return self.first.size

    @property
    def font(self) -> str:
        return self.first.font

    @property
    def color(self) -> str:
        return self.first.color

    @property
    def bold(self) -> bool:
        return self.first.bold

    @property
    def italic(self) -> bool:
        return self.first.italic

    @property
    def chars(self) -> int:
        return sum(ln.chars for ln in self.lines)

    @property
    def edge(self) -> bool:
        return all(ln.edge for ln in self.lines)

    def leading(self) -> float | None:
        bl = sorted(ln.baseline for ln in self.lines)
        diffs = [b - a for a, b in zip(bl, bl[1:]) if 0.8 * self.size <= b - a <= 2.5 * self.size]
        return float(median(diffs)) if diffs else None


def body_style(pages: list[PageData]) -> tuple[float, str, str]:
    """(size, font, family) of the text style carrying the most characters."""
    by_size: Counter = Counter()
    fonts: dict[float, Counter] = {}
    for p in pages:
        for ln in p.lines:
            s = round(ln.size * 2) / 2
            by_size[s] += ln.chars
            fonts.setdefault(s, Counter())[ln.font] += ln.chars
    if not by_size:
        return 10.0, "", ""
    size = by_size.most_common(1)[0][0]
    font = fonts[size].most_common(1)[0][0]
    # refine size: exact median of lines in that bucket with that font
    exact = [ln.size for p in pages for ln in p.lines if ln.font == font and abs(ln.size - size) <= 0.25]
    if exact:
        size = round(float(median(exact)), 2)
    return size, font, family_of(font)


def mark_edges(page: PageData, body_size: float) -> None:
    """Folios / running heads: small, short text in the top or bottom 6% of the page."""
    lim = EDGE_FRACTION * page.height
    for ln in page.lines:
        near = ln.y1 <= lim + 2 or ln.y0 >= page.height - lim - 2
        ln.edge = near and ln.size <= body_size * 1.2 + 0.5 and len(ln.text) <= 140


def merge_lines(page: PageData) -> list[TextBlock]:
    lines = sorted(page.lines, key=lambda ln: (ln.y0, ln.x0))
    blocks: list[TextBlock] = []
    for ln in lines:
        best: TextBlock | None = None
        best_gap = 1e9
        for b in blocks:
            last = b.lines[-1]
            if last.edge != ln.edge or last.font != ln.font or abs(last.size - ln.size) > 0.3 or last.color != ln.color:
                continue
            gap = ln.y0 - last.y1
            if gap < -0.5 * ln.size or gap > 0.9 * ln.size + 2:
                continue
            ov = min(ln.x1, b.x1) - max(ln.x0, b.x0)
            if not (abs(ln.x0 - b.x0) <= 14 or ov >= 0.3 * min(ln.w, b.x1 - b.x0)):
                continue
            if gap < best_gap:
                best, best_gap = b, gap
        if best is None:
            blocks.append(TextBlock(page=page.index, lines=[ln]))
        else:
            best.lines.append(ln)
    return blocks


def _uppercase_ratio(t: str) -> float:
    letters = [c for c in t if c.isalpha()]
    if len(letters) < 3:
        return 0.0
    return sum(c.isupper() for c in letters) / len(letters)


def _near_image(b: TextBlock, images: list[Placement], max_gap: float = 16.0) -> tuple[Placement, str] | None:
    for im in images:
        h_overlap = min(b.x1, im.x1) - max(b.x0, im.x0)
        v_overlap = min(b.y1, im.y1) - max(b.y0, im.y0)
        if h_overlap > 0.4 * min(b.x1 - b.x0, im.w) and -2 <= b.y0 - im.y1 <= max_gap:
            return im, "below"
        if b.x0 >= im.x0 - 1 and b.x1 <= im.x1 + 1 and b.y0 >= im.y0 - 1 and b.y1 <= im.y1 + 1:
            return im, "overlay"
        if v_overlap > 0 and (0 <= b.x0 - im.x1 <= max_gap or 0 <= im.x0 - b.x1 <= max_gap):
            return im, "side"
        if h_overlap > 0.4 * min(b.x1 - b.x0, im.w) and -2 <= im.y0 - b.y1 <= max_gap * 0.6:
            return im, "above"
    return None


def classify_blocks(page: PageData, blocks: list[TextBlock], body_size: float, body_font: str) -> None:
    S = body_size
    headlines = []
    for b in blocks:
        t = b.text.strip()
        size = b.size
        if b.edge:
            b.role = "folio"
        elif size >= 2.2 * S and STAT_RE.match(t) and len(t) <= 12:
            b.role = "stat"
        elif size >= 1.9 * S:
            b.role = "headline"
            headlines.append(b)
        elif BYLINE_RE.match(t) and size <= 1.3 * S:
            b.role = "byline"
        elif (b.italic and size >= 1.25 * S) or (t[:1] in "“\"«" and size >= 1.25 * S):
            b.role = "pullquote"
        elif b.bold and abs(size - S) <= 0.75 and (QUESTION_RE.match(t) or b.first.text.rstrip().endswith("?")):
            b.role = "question"
        else:
            b.role = None
    for b in blocks:
        if b.role is not None:
            continue
        t = b.text.strip()
        size = b.size
        upper = _uppercase_ratio(t)
        above_headline = any(0 <= h.y0 - b.y1 <= 70 and min(h.x1, b.x1) - max(h.x0, b.x0) > -20 for h in headlines)
        if upper >= 0.8 and size <= 1.3 * S and len(b.lines) <= 2 and (above_headline or b.y0 < 0.3 * page.height):
            b.role = "kicker"
        elif size < S - 0.4:
            near = _near_image(b, page.images)
            if near is not None:
                b.role = "caption"
            else:
                b.role = "body" if (family_of(b.font) == family_of(body_font) or b.first.serif) else "caption"
        elif b.bold and size < 1.9 * S and len(t) <= 140:
            b.role = "subhead"
        elif size >= 1.2 * S and not b.bold:
            b.role = "deck"
        else:
            b.role = "body"
    for b in blocks:
        for ln in b.lines:
            ln.role = b.role


def caption_placement(page: PageData, b: TextBlock) -> str | None:
    near = _near_image(b, page.images)
    return near[1] if near else None
