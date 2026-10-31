"""Grid, margins, leading and page-type heuristics."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from statistics import median

from app.services.reference_analysis.blocks import TextBlock
from app.services.reference_analysis.extract import Line, PageData


def percentile(vals: list[float], q: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def cluster_1d(vals: list[float], tol: float) -> list[list[float]]:
    out: list[list[float]] = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def consensus(vals: list[float], tol: float = 3.0) -> tuple[float, float]:
    """Value supported by the largest cluster (ties -> smaller). Returns (value, support fraction)."""
    vals = [v for v in vals if v is not None]
    if not vals:
        return 0.0, 0.0
    clusters = cluster_1d(vals, tol)
    best = max(clusters, key=lambda c: (len(c), -median(c)))
    return float(median(best)), len(best) / len(vals)


# ---------------------------------------------------------------- columns

@dataclass
class ColumnInfo:
    count: int
    starts: list[float] = field(default_factory=list)
    widths: list[float] = field(default_factory=list)
    gutter: float | None = None
    lines: int = 0


def body_lines(page: PageData, body_size: float, body_font: str) -> list[Line]:
    return [ln for ln in page.lines if ln.role == "body" and not ln.edge and ln.font == body_font
            and abs(ln.size - body_size) <= 0.3]


def detect_columns(lines: list[Line], min_lines: int = 20) -> ColumnInfo | None:
    if len(lines) < min_lines:
        return None
    clusters = cluster_1d([ln.x0 for ln in lines], tol=3.0)
    sig = [c for c in clusters if len(c) >= max(3, 0.06 * len(lines))]
    starts: list[list[float]] = []
    for c in sorted(sig, key=min):
        x = min(c)
        if starts and x - starts[-1][0] < 30:  # first-line indents / ragged starts belong to the same column
            starts[-1][1] += len(c)
        else:
            starts.append([x, len(c)])
    if not starts:
        return None
    widths = []
    for i, (x, _) in enumerate(starts):
        nxt = starts[i + 1][0] if i + 1 < len(starts) else 1e9
        ws = [ln.w for ln in lines if x - 1 <= ln.x0 < nxt - 1 and ln.x0 - x < 30]
        widths.append(percentile(ws, 0.9) if ws else 0.0)
    gutters = [starts[i + 1][0] - (starts[i][0] + widths[i]) for i in range(len(starts) - 1)]
    gutters = [g for g in gutters if 0 < g < 60]
    return ColumnInfo(
        count=len(starts), starts=[s[0] for s in starts], widths=widths,
        gutter=float(median(gutters)) if gutters else None, lines=len(lines),
    )


def baseline_pitch(lines: list[Line], body_size: float) -> list[float]:
    by_col: dict[int, list[Line]] = {}
    for ln in lines:
        by_col.setdefault(int(ln.x0 // 30), []).append(ln)
    diffs: list[float] = []
    for col in by_col.values():
        bl = sorted(ln.baseline for ln in col)
        diffs += [b - a for a, b in zip(bl, bl[1:]) if 0.9 * body_size <= b - a <= 2.2 * body_size]
    return diffs


# ---------------------------------------------------------------- margins

def page_content_bounds(page: PageData) -> tuple[float, float, float, float] | None:
    """(left, top, right, bottom) margins implied by non-edge text + non-bleeding images."""
    items: list[tuple[float, float, float, float]] = [(ln.x0, ln.y0, ln.x1, ln.y1) for ln in page.lines if not ln.edge]
    if len(items) < 5:
        return None
    W, H = page.width, page.height
    for im in page.images:
        bleeds = im.x0 <= 1 or im.y0 <= 1 or im.x1 >= W - 1 or im.y1 >= H - 1
        if not bleeds:
            items.append((im.x0, im.y0, im.x1, im.y1))
    for d in page.drawings:
        if d.kind == "rule" and d.x0 > 1 and d.x1 < W - 1:
            items.append((d.x0, d.y0, d.x1, d.y1))
    left = min(i[0] for i in items)
    top = min(i[1] for i in items)
    right = W - max(i[2] for i in items)
    bottom = H - max(i[3] for i in items)
    return left, top, right, bottom


# ---------------------------------------------------------------- page types

TOC_RE = re.compile(r"\b(contents|in this issue|inside this issue|table of contents)\b", re.I)
AD_RE = re.compile(r"\b(advertisement|advertorial|sponsored|promotion|www\.|\.com\b|\.example\b|register now|"
                   r"call now|visit us|book now|for enquiries)", re.I)
EDITORIAL_RE = re.compile(r"\b(from the editor|editor'?s note|editorial|letter from the editor|editor-in-chief)\b", re.I)
INTERVIEW_RE = re.compile(r"\b(interview|in conversation|q\s*&\s*a|one-on-one|tete-a-tete)\b", re.I)
GALLERY_RE = re.compile(r"\b(gallery|in pictures|photo ?essay|snapshots|moments|in frames)\b", re.I)
PROFILE_RE = re.compile(r"\b(profiles?|speakers|voices|who'?s who|meet the)\b", re.I)
INFO_RE = re.compile(r"\b(in numbers|by the numbers|infographic|at a glance|key figures|data)\b", re.I)
REPORT_RE = re.compile(r"\b(report|summit|conference|conclave|session|forum|expo)\b", re.I)
TOC_ENTRY_RE = re.compile(r"^\d{1,3}$|^\d{1,3}\s+\S|\S\s*\.{2,}\s*\d{1,3}$|\S\s+\d{1,3}$")


@dataclass
class PageFeatures:
    body_lines: int = 0
    columns: int = 1
    questions: int = 0
    stats: int = 0
    captions: int = 0
    headlines: int = 0
    images: int = 0
    image_coverage: float = 0.0
    full_bleed: bool = False
    max_size: float = 0.0
    portraits: int = 0
    grid_images: int = 0
    toc_entries: int = 0
    keywords: dict[str, bool] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def compute_features(page: PageData, blocks: list[TextBlock], body_size: float, body_font: str,
                     columns: ColumnInfo | None) -> PageFeatures:
    f = PageFeatures()
    bl = body_lines(page, body_size, body_font)
    f.body_lines = len(bl)
    f.columns = columns.count if columns else 1
    f.questions = sum(1 for b in blocks if b.role == "question")
    f.stats = sum(1 for b in blocks if b.role == "stat")
    f.captions = sum(1 for b in blocks if b.role == "caption")
    f.headlines = sum(1 for b in blocks if b.role == "headline")
    f.images = len(page.images)
    f.image_coverage = round(page.image_coverage, 3)
    area = page.width * page.height
    f.full_bleed = any(im.area >= 0.85 * area for im in page.images)
    f.max_size = max((b.size for b in blocks if b.role != "stat"), default=0.0)
    # images with portrait aspect and similar widths
    portraits = [im for im in page.images if im.h >= 1.08 * im.w and im.area < 0.2 * area]
    if len(portraits) >= 3:
        ws = [im.w for im in portraits]
        if (max(ws) - min(ws)) <= 0.2 * median(ws):
            f.portraits = len(portraits)
    mids = [im for im in page.images if 0.02 * area <= im.area <= 0.3 * area]
    if len(mids) >= 4:
        areas = sorted(im.area for im in mids)
        med = median(areas)
        f.grid_images = sum(1 for a in areas if 0.6 * med <= a <= 1.6 * med)
    headline_text = " ".join(b.text for b in blocks if b.role in ("headline", "kicker", "deck", "subhead"))
    all_text = " ".join(b.text for b in blocks)
    f.toc_entries = sum(1 for b in blocks if not b.edge and TOC_ENTRY_RE.search(b.text.strip()) and len(b.text) < 120)
    f.keywords = {
        "toc": bool(TOC_RE.search(headline_text)),
        "ad": bool(AD_RE.search(all_text)),
        "editorial": bool(EDITORIAL_RE.search(headline_text) or EDITORIAL_RE.search(all_text[-400:])),
        "interview": bool(INTERVIEW_RE.search(headline_text)),
        "gallery": bool(GALLERY_RE.search(headline_text)),
        "profiles": bool(PROFILE_RE.search(headline_text)),
        "infographic": bool(INFO_RE.search(headline_text)),
        "report": bool(REPORT_RE.search(headline_text)),
    }
    return f


def classify_page(f: PageFeatures, index: int, page_count: int) -> tuple[str, float, dict[str, float]]:
    s: Counter = Counter()
    kw = f.keywords
    heavy_image = f.full_bleed or f.image_coverage >= 0.8
    if index == 0:
        s["cover"] += 0.45
        if heavy_image:
            s["cover"] += 0.3
        if f.max_size >= 40:
            s["cover"] += 0.2
    elif heavy_image and f.max_size >= 48 and f.body_lines < 5:
        s["cover"] += 0.35
    if heavy_image and index > 0:
        s["advertisement"] += 0.3
        s["full_page_image"] += 0.3
        if kw.get("ad"):
            s["advertisement"] += 0.45
        if index == page_count - 1:
            s["advertisement"] += 0.15
        if f.body_lines < 5 and not kw.get("ad"):
            s["full_page_image"] += 0.25
    elif kw.get("ad") and f.body_lines < 10 and f.image_coverage >= 0.4:
        s["advertisement"] += 0.5
    if kw.get("toc"):
        s["toc"] += 0.5
        if f.toc_entries >= 4:
            s["toc"] += 0.4
    elif f.toc_entries >= 8 and f.body_lines < 20:
        s["toc"] += 0.4
    if f.questions >= 3:
        s["interview"] += 0.6 + min(0.25, f.questions * 0.02)
    if kw.get("interview"):
        s["interview"] += 0.25
    if f.stats >= 3:
        s["infographic"] += 0.6 + (0.25 if kw.get("infographic") else 0.0)
    elif kw.get("infographic") and f.body_lines < 30:
        s["infographic"] += 0.4
    if f.portraits >= 3:
        s["speaker_profile"] += 0.6 + (0.25 if kw.get("profiles") else 0.0)
    elif kw.get("profiles") and f.images >= 2:
        s["speaker_profile"] += 0.4
    if f.grid_images >= 4 and f.body_lines < 40:
        s["photo_gallery"] += 0.55 + (0.15 if f.captions >= 3 else 0.0) + (0.2 if kw.get("gallery") else 0.0)
    elif kw.get("gallery") and f.images >= 2:
        s["photo_gallery"] += 0.45
    if kw.get("editorial") and f.body_lines >= 15:
        s["editorial"] += 0.6 + (0.15 if f.columns <= 2 else 0.0)
    if f.body_lines >= 25:
        if f.columns >= 3:
            s["event_report"] += 0.5 + (0.1 if f.images else 0.0) + (0.15 if kw.get("report") else 0.0)
        else:
            s["two_column_article"] += 0.5 + (0.1 if f.columns == 2 else 0.0)
            if kw.get("report"):
                s["event_report"] += 0.3
    if not s:
        if f.image_coverage >= 0.5:
            s["full_page_image"] += 0.35
        else:
            s["two_column_article"] += 0.3
    ranked = s.most_common()
    best, score = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    conf = min(0.97, max(0.3, score)) * (0.7 + 0.3 * min(1.0, (score - second) / 0.3))
    return best, round(conf, 2), {k: round(v, 2) for k, v in ranked[:4]}


def folio_position(pages: list[PageData], margins_out: float) -> tuple[str, float]:
    votes: Counter = Counter()
    for p in pages:
        for ln in p.lines:
            if not (ln.edge and ln.role == "folio" and any(ch.isdigit() for ch in ln.text)):
                continue
            centre = (ln.x0 + ln.x1) / 2
            if abs(centre - p.width / 2) < 20:
                votes["bottom_center" if ln.y0 > p.height / 2 else "top_outside"] += 1
                continue
            recto = p.number % 2 == 1
            at_outside = (ln.x1 >= p.width - margins_out - 25) if recto else (ln.x0 <= margins_out + 25)
            if ln.y0 > p.height / 2:
                votes["bottom_outside" if at_outside else "bottom_center"] += 1
            else:
                votes["top_outside"] += 1
    if not votes:
        return "bottom_outside", 0.3
    pos, n = votes.most_common(1)[0]
    return pos, round(min(0.95, 0.5 + 0.5 * n / sum(votes.values())), 2)
