"""Raw per-page extraction with PyMuPDF: text lines (font/size/flags/colour/bbox),
image placements, vector drawings (rules, fills) and a low-res render for colour.
"""

from __future__ import annotations

import io
from collections import Counter
from dataclasses import dataclass, field

import pymupdf
from PIL import Image

from app.services.reference_analysis.colors import int_to_hex, page_background, quantize_pixmap, rgb_to_hex
from app.services.reference_analysis.fonts import clean_font_name, is_bold, is_italic

FLAG_ITALIC = 2
FLAG_SERIF = 4
FLAG_MONO = 8
FLAG_BOLD = 16


@dataclass
class Line:
    page: int
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    baseline: float
    font: str
    size: float
    color: str
    flags: int
    chars: int
    bold: bool
    italic: bool
    serif: bool
    role: str | None = None
    edge: bool = False

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0


@dataclass
class Placement:
    x0: float
    y0: float
    x1: float
    y1: float
    width_px: int = 0
    height_px: int = 0

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return max(0.0, self.w) * max(0.0, self.h)


@dataclass
class Drawing:
    x0: float
    y0: float
    x1: float
    y1: float
    kind: str  # rule | fill | stroke
    fill: str | None = None
    stroke: str | None = None
    width: float = 0.0

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0


@dataclass
class PageData:
    index: int  # 0-based
    width: float
    height: float
    lines: list[Line] = field(default_factory=list)
    images: list[Placement] = field(default_factory=list)
    drawings: list[Drawing] = field(default_factory=list)
    dominant_colors: list[str] = field(default_factory=list)
    background: str = "#FFFFFF"
    pixel_colors: list[tuple[str, float]] = field(default_factory=list)
    image_coverage: float = 0.0
    text_coverage: float = 0.0

    @property
    def number(self) -> int:
        return self.index + 1


def _clip(x0, y0, x1, y1, w, h):
    return max(0.0, x0), max(0.0, y0), min(w, x1), min(h, y1)


def coverage(rects: list[tuple[float, float, float, float]], w: float, h: float, grid: int = 80) -> float:
    """Union area fraction on a coarse grid (avoids double counting overlaps)."""
    if not rects or w <= 0 or h <= 0:
        return 0.0
    gx, gy = grid, max(1, int(grid * h / w))
    import numpy as np

    mask = np.zeros((gy, gx), dtype=bool)
    for x0, y0, x1, y1 in rects:
        x0, y0, x1, y1 = _clip(x0, y0, x1, y1, w, h)
        if x1 <= x0 or y1 <= y0:
            continue
        mask[int(y0 / h * gy): max(int(y0 / h * gy) + 1, int(round(y1 / h * gy))),
             int(x0 / w * gx): max(int(x0 / w * gx) + 1, int(round(x1 / w * gx)))] = True
    return float(mask.mean())


def _page_frame(page: pymupdf.Page) -> tuple[float, float, float, float]:
    """(offset_x, offset_y, width, height) of the trim box relative to the page rect."""
    rect = page.rect
    try:
        trim = page.trimbox
        crop = page.cropbox
        if trim and (abs(trim.width - rect.width) > 1 or abs(trim.height - rect.height) > 1) and trim.width > 50:
            return trim.x0 - crop.x0, trim.y0 - crop.y0, trim.width, trim.height
    except Exception:  # noqa: BLE001 - malformed boxes: fall back to page rect
        pass
    return 0.0, 0.0, rect.width, rect.height


def extract_page(page: pymupdf.Page, index: int, render_width: int = 96) -> PageData:
    ox, oy, W, H = _page_frame(page)
    pd = PageData(index=index, width=round(W, 2), height=round(H, 2))

    # ---- text
    d = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP)
    for block in d.get("blocks", []):
        if block.get("type") != 0:
            continue
        for ln in block.get("lines", []):
            spans = [s for s in ln.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            if abs(ln.get("dir", (1, 0))[1]) > 0.2:  # skip rotated/vertical text lines
                continue
            weights: Counter = Counter()
            for s in spans:
                weights[(clean_font_name(s["font"]), round(s["size"], 2), s["flags"], s["color"])] += len(s["text"].strip())
            (font, size, flags, color), _ = weights.most_common(1)[0]
            text = "".join(s["text"] for s in ln["spans"]).strip()
            x0, y0, x1, y1 = ln["bbox"]
            origin = next((s["origin"] for s in spans if clean_font_name(s["font"]) == font), spans[0]["origin"])
            pd.lines.append(
                Line(
                    page=index, text=text, x0=x0 - ox, y0=y0 - oy, x1=x1 - ox, y1=y1 - oy, baseline=origin[1] - oy,
                    font=font, size=float(size), color=int_to_hex(color), flags=int(flags),
                    chars=sum(len(s["text"].strip()) for s in spans),
                    bold=is_bold(font, bool(flags & FLAG_BOLD)), italic=is_italic(font, bool(flags & FLAG_ITALIC)),
                    serif=bool(flags & FLAG_SERIF),
                )
            )

    # ---- images
    try:
        infos = page.get_image_info()
    except Exception:  # noqa: BLE001
        infos = []
    for info in infos:
        x0, y0, x1, y1 = info["bbox"]
        x0, y0, x1, y1 = x0 - ox, y0 - oy, x1 - ox, y1 - oy
        cx0, cy0, cx1, cy1 = _clip(x0, y0, x1, y1, W, H)
        if cx1 - cx0 < 4 or cy1 - cy0 < 4:
            continue
        pd.images.append(Placement(cx0, cy0, cx1, cy1, int(info.get("width") or 0), int(info.get("height") or 0)))

    # ---- vector drawings (rules + fills)
    try:
        drawings = page.get_drawings()
    except Exception:  # noqa: BLE001
        drawings = []
    for dr in drawings[:2000]:
        r = dr.get("rect")
        if r is None:
            continue
        x0, y0, x1, y1 = r.x0 - ox, r.y0 - oy, r.x1 - ox, r.y1 - oy
        fill = dr.get("fill")
        stroke = dr.get("color")
        width = float(dr.get("width") or 0.0)
        w, h = x1 - x0, y1 - y0
        fill_hex = rgb_to_hex(fill) if fill else None
        stroke_hex = rgb_to_hex(stroke) if stroke else None
        thin = (h <= 3 and w >= 20) or (w <= 3 and h >= 20)
        if thin and (stroke_hex or fill_hex):
            pd.drawings.append(Drawing(x0, y0, x1, y1, "rule", fill_hex, stroke_hex or fill_hex, max(width, min(w, h))))
        elif fill_hex and w > 3 and h > 3:
            pd.drawings.append(Drawing(x0, y0, x1, y1, "fill", fill_hex, stroke_hex, width))
        elif stroke_hex and w > 3 and h > 3:
            pd.drawings.append(Drawing(x0, y0, x1, y1, "stroke", None, stroke_hex, width))

    # ---- coverage
    pd.image_coverage = coverage([(i.x0, i.y0, i.x1, i.y1) for i in pd.images], W, H)
    pd.text_coverage = coverage([(ln.x0, ln.y0, ln.x1, ln.y1) for ln in pd.lines], W, H)

    # ---- low-res render for palette / paper colour
    try:
        zoom = render_width / max(1.0, page.rect.width)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        pd.pixel_colors = quantize_pixmap(img, 6)
        pd.dominant_colors = [h for h, frac in pd.pixel_colors if frac >= 0.02][:5]
        pd.background = page_background(img)
    except Exception:  # noqa: BLE001
        pass
    return pd


def render_page_png(pdf_bytes_or_path, page_number: int, scale: float = 1.0) -> bytes:
    scale = max(0.1, min(4.0, float(scale)))
    doc = pymupdf.open(pdf_bytes_or_path) if not isinstance(pdf_bytes_or_path, bytes) else pymupdf.open(
        stream=pdf_bytes_or_path, filetype="pdf")
    try:
        if page_number < 1 or page_number > doc.page_count:
            raise ValueError(f"Page {page_number} out of range (1..{doc.page_count})")
        page = doc[page_number - 1]
        pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def open_pdf(path_or_bytes) -> pymupdf.Document:
    if isinstance(path_or_bytes, (bytes, bytearray)):
        return pymupdf.open(stream=bytes(path_or_bytes), filetype="pdf")
    return pymupdf.open(str(path_or_bytes))


def image_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
