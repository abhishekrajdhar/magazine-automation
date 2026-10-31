"""ReportLab preview renderer for layout contracts.

This is a *preview* renderer using base-14 fallback fonts — it is not Adobe InDesign
output, and the PDF metadata says so. `print` mode adds bleed, crop marks and a slug.
"""

from __future__ import annotations

import io
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import standardFonts
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Frame, KeepInFrame, Paragraph

log = logging.getLogger("pressflow.render")

PRODUCER = "PressFlow preview renderer (ReportLab) — not Adobe InDesign output"
SLUG = 36.0
ALIGN = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT, "justify": TA_JUSTIFY}

AssetResolver = Callable[[str], bytes | None]


@dataclass
class RenderResult:
    pdf: bytes
    page_count: int
    warnings: list[str]


def _safe_font(name: str | None, fallback: str = "Helvetica") -> str:
    if name and name in standardFonts:
        return name
    n = (name or "").lower()
    if "times" in n or "serif" in n and "sans" not in n:
        base = "Times"
    elif "courier" in n or "mono" in n:
        base = "Courier"
    else:
        return fallback
    bold, italic = "bold" in n, ("italic" in n or "oblique" in n)
    if base == "Times":
        return {(0, 0): "Times-Roman", (1, 0): "Times-Bold", (0, 1): "Times-Italic", (1, 1): "Times-BoldItalic"}[(bold, italic)]
    return {(0, 0): "Courier", (1, 0): "Courier-Bold", (0, 1): "Courier-Oblique", (1, 1): "Courier-BoldOblique"}[(bold, italic)]


class ContractRenderer:
    def __init__(self, contract: dict, resolve_asset: AssetResolver, *, mode: str = "digital",
                 watermark_unapproved: bool = True, markup: dict[str, str] | None = None,
                 placeholders: set[str] | None = None):
        self.c = contract
        self.markup = markup or {}
        self.placeholders = placeholders or set()
        self.resolve = resolve_asset
        self.mode = mode
        self.watermark = watermark_unapproved
        doc = contract["document"]
        self.W = float(doc["page_width_pt"])
        self.H = float(doc["page_height_pt"])
        self.bleed = float(doc.get("bleed_pt", 9)) if mode == "print" else 0.0
        self.off = (self.bleed + SLUG) if mode == "print" else 0.0
        self.swatches = {s["name"]: s["hex"] for s in contract["styles"].get("colors", [])}
        self.styles: dict[str, dict] = {p["name"]: p for p in contract["styles"].get("paragraph", [])}
        self.assets = {a["id"]: a for a in contract.get("assets", [])}
        self.warnings: list[str] = []
        self._img_cache: dict[str, ImageReader | None] = {}

    # ------------------------------------------------------------------ helpers
    def color(self, ref: str | None, default: str = "#000000") -> Color:
        if not ref:
            return HexColor(default)
        if ref.startswith("#") and len(ref) == 7:
            return HexColor(ref)
        return HexColor(self.swatches.get(ref, default))

    def para_style(self, name: str | None, size_override: float | None = None) -> ParagraphStyle:
        st = self.styles.get(name or "") or {}
        size = size_override or float(st.get("size_pt", 10))
        lead = float(st.get("leading_pt", size * 1.2)) * (size / float(st.get("size_pt", size) or size))
        font = _safe_font(st.get("fallback_family") or st.get("font_family"),
                          "Times-Roman" if (st.get("role") in ("body", "question", "pullquote")) else "Helvetica")
        return ParagraphStyle(
            name or "default", fontName=font, fontSize=size, leading=lead, textColor=self.color(st.get("color"), "#111111"),
            alignment=ALIGN.get(st.get("align", "left"), TA_LEFT), firstLineIndent=float(st.get("first_line_indent_pt", 0)),
            spaceAfter=float(st.get("space_after_pt", 0)), spaceBefore=float(st.get("space_before_pt", 0)),
        )

    def image_reader(self, asset_id: str) -> ImageReader | None:
        if asset_id in self._img_cache:
            return self._img_cache[asset_id]
        reader = None
        try:
            data = self.resolve(asset_id)
            if data:
                reader = ImageReader(io.BytesIO(data))
        except Exception as e:  # noqa: BLE001
            self.warnings.append(f"Asset {asset_id} could not be read: {e}")
        if reader is None:
            self.warnings.append(f"Asset {asset_id} is missing; a placeholder was drawn.")
        self._img_cache[asset_id] = reader
        return reader

    def rect(self, bounds: list[float], extend_bleed: bool = False) -> tuple[float, float, float, float]:
        """contract [top, left, bottom, right] -> ReportLab (x, y, w, h) in page space (incl. print offset)."""
        top, left, bottom, right = bounds
        if extend_bleed and self.bleed:
            if left <= 0.5:
                left -= self.bleed
            if top <= 0.5:
                top -= self.bleed
            if right >= self.W - 0.5:
                right += self.bleed
            if bottom >= self.H - 0.5:
                bottom += self.bleed
        x = self.off + left
        y = self.off + (self.H - bottom)
        return x, y, right - left, bottom - top

    # ------------------------------------------------------------------ drawing
    def _role_style(self, role: str) -> ParagraphStyle | None:
        name = next((n for n, p in self.styles.items() if p.get("role") == role and "~" not in n), None)
        return self.para_style(name) if name else None

    @staticmethod
    def _italic(font: str) -> str:
        return {"Times-Roman": "Times-Italic", "Times-Bold": "Times-BoldItalic", "Helvetica": "Helvetica-Oblique",
                "Helvetica-Bold": "Helvetica-BoldOblique", "Courier": "Courier-Oblique"}.get(font, font)

    def markup_story(self, raw: str, style: ParagraphStyle, label: str, uppercase: bool) -> list:
        """Frontend light markup: "^ " lead (enlarged initial), "## " subhead, "Q: " question, "• " list item,
        "> " inline quote, "— " attribution."""
        accent = self.swatches.get("PF Accent", "#1F4FD8")
        sub = self._role_style("subhead") or style
        question = self._role_style("question") or style
        attribution = self._role_style("caption") or style
        story, prev = [], ""
        paras = [p for p in raw.split("\n\n") if p.strip()]
        for i, p in enumerate(paras):
            txt = p.upper() if uppercase else p
            if p.startswith("^ ") and len(p) > 3:
                body = escape(txt[2:].strip())
                lead = ParagraphStyle("lead", parent=style, firstLineIndent=0, autoLeading="max")
                story.append(Paragraph(f'<font name="{self._role_style("headline").fontName if self._role_style("headline") else "Helvetica-Bold"}" '
                                       f'size="{style.fontSize * 2.3:.1f}" color="{accent}">{body[0]}</font>{body[1:]}', lead))
            elif p.startswith("## "):
                story.append(Paragraph(escape(txt[3:]), ParagraphStyle("sub", parent=sub, spaceBefore=style.leading * 0.6,
                                                                     keepWithNext=1)))
            elif p.startswith("Q: "):
                story.append(Paragraph(f"<b>Q</b>&nbsp;&nbsp;{escape(txt[3:])}",
                                       ParagraphStyle("q", parent=question, spaceBefore=style.leading * 0.4, keepWithNext=1)))
            elif p.startswith("\u2022 "):
                story.append(Paragraph(escape(txt), ParagraphStyle("li", parent=style, leftIndent=style.fontSize * 0.9,
                                                                 firstLineIndent=-style.fontSize * 0.9, alignment=TA_LEFT)))
            elif p.startswith("> "):
                story.append(Paragraph(escape(txt[2:]), ParagraphStyle("iq", parent=style, firstLineIndent=0,
                                                                     fontName=self._italic(style.fontName),
                                                                     textColor=HexColor(accent), spaceBefore=3, spaceAfter=3)))
            elif p.startswith("\u2014 "):
                story.append(Paragraph(escape(txt), ParagraphStyle("attr", parent=attribution, spaceBefore=6)))
            elif label == "Name & designation" and i == 0:
                story.append(Paragraph(f"<b>{escape(txt)}</b>", ParagraphStyle("nm", parent=style, firstLineIndent=0)))
            else:
                after_heading = prev.startswith(("## ", "Q: ", "^ ")) or i == 0
                ps = ParagraphStyle("p", parent=style, firstLineIndent=0) if after_heading else style
                story.append(Paragraph(escape(txt).replace("\n", "<br/>"), ps))
            prev = p
        return story

    def draw_text(self, cv: Canvas, fr: dict) -> None:
        raw = self.markup.get(fr["id"])
        content = fr.get("content") or ""
        if not content.strip() and not (raw or "").strip():
            return
        st = self.styles.get(fr.get("paragraph_style") or "") or {}
        x, y, w, h = self.rect(fr["bounds_pt"])
        cols = max(1, int(fr.get("columns") or 1))
        gutter = float(fr.get("gutter_pt") or 0)
        style = self.para_style(fr.get("paragraph_style"))
        if raw:
            story = self.markup_story(raw, style, fr.get("label") or "", bool(st.get("uppercase")))
        else:
            if st.get("uppercase"):
                content = content.upper()
            paras = [p.strip() for p in content.split("\n\n") if p.strip()]
            story = [Paragraph(escape(p).replace("\n", "<br/>"), style) for p in paras]
        if fr.get("fit") == "shrink_to_fit" and cols == 1:
            kif = KeepInFrame(w, h, story, mode="shrink")
            f = Frame(x, y, w, h, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
            f.addFromList([kif], cv)
            return
        cw = (w - (cols - 1) * gutter) / cols
        for i in range(cols):
            f = Frame(x + i * (cw + gutter), y - 0.5, cw, h + 0.5, leftPadding=0, rightPadding=0, topPadding=0,
                      bottomPadding=0)
            while story:
                if f.add(story[0], cv, trySplit=0):
                    story.pop(0)
                    continue
                parts = f.split(story[0], cv)
                if len(parts) >= 2 and f.add(parts[0], cv, trySplit=0):
                    story[0:1] = parts[1:]
                break
            if not story:
                break
        if story:
            self.warnings.append(f"Text frame {fr['id']} overflows (overset) in the preview render.")

    def draw_image(self, cv: Canvas, fr: dict) -> None:
        x, y, w, h = self.rect(fr["bounds_pt"], extend_bleed=True)
        img = fr.get("image") or {}
        if img.get("asset_id") in self.placeholders:
            self.draw_placeholder(cv, x, y, w, h, img["asset_id"])
            return
        reader = self.image_reader(img["asset_id"]) if img.get("asset_id") else None
        if reader is None:
            cv.saveState()
            cv.setFillColor(HexColor("#E6E8EC"))
            cv.setStrokeColor(HexColor("#9AA1AD"))
            cv.setLineWidth(0.5)
            cv.rect(x, y, w, h, stroke=1, fill=1)
            cv.line(x, y, x + w, y + h)
            cv.line(x, y + h, x + w, y)
            cv.setFillColor(HexColor("#5A6270"))
            cv.setFont("Helvetica", 7)
            cv.drawCentredString(x + w / 2, y + h / 2 - 3, "Image missing" if img.get("asset_id") else "No image assigned")
            cv.restoreState()
            return
        iw, ih = reader.getSize()
        fitting = img.get("fitting", "fill_proportionally")
        scale = float(img.get("scale") or 1)
        if fitting == "fit_proportionally":
            s = min(w / iw, h / ih) * scale
        elif fitting == "center":
            s = scale
        else:
            s = max(w / iw, h / ih) * scale
        dw, dh = iw * s, ih * s
        ox, oy = float(img.get("offset_x") or 0), float(img.get("offset_y") or 0)
        dx = x - (dw - w) * (1 + ox) / 2
        dy = y - (dh - h) * (1 - oy) / 2
        cv.saveState()
        p = cv.beginPath()
        p.rect(x, y, w, h)
        cv.clipPath(p, stroke=0, fill=0)
        cv.drawImage(reader, dx, dy, dw, dh, mask="auto")
        cv.restoreState()

    def draw_placeholder(self, cv: Canvas, x: float, y: float, w: float, h: float, asset_id: str) -> None:
        """Demo assets have no file behind them: draw a clearly labelled placeholder (never a fake photo)."""
        import hashlib

        hv = int(hashlib.sha256(asset_id.encode()).hexdigest()[:6], 16)
        r, g, b = 0.55 + (hv & 0xFF) / 1020, 0.6 + ((hv >> 8) & 0xFF) / 1020, 0.68 + ((hv >> 16) & 0xFF) / 1020
        cv.saveState()
        cv.setFillColor(Color(r, g, b))
        cv.rect(x, y, w, h, stroke=0, fill=1)
        cv.setFillColor(Color(1, 1, 1, alpha=0.85))
        cv.setFont("Helvetica", 7)
        if w > 60 and h > 20:
            cv.drawCentredString(x + w / 2, y + h / 2 - 2, "Demo image placeholder")
        cv.restoreState()

    def draw_shape(self, cv: Canvas, fr: dict) -> None:
        x, y, w, h = self.rect(fr["bounds_pt"], extend_bleed=True)
        cv.saveState()
        if fr.get("opacity") is not None:
            cv.setFillAlpha(float(fr["opacity"]))
            cv.setStrokeAlpha(float(fr["opacity"]))
        fill = fr.get("fill")
        stroke = fr.get("stroke")
        if fill:
            cv.setFillColor(self.color(fill))
        if stroke:
            cv.setStrokeColor(self.color(stroke))
            cv.setLineWidth(float(fr.get("stroke_weight_pt") or 0.5))
        if fr["kind"] == "line":
            cv.setStrokeColor(self.color(stroke or "PF Rule", "#999999"))
            cv.setLineWidth(float(fr.get("stroke_weight_pt") or 0.5))
            if w >= h:
                cv.line(x, y + h / 2, x + w, y + h / 2)
            else:
                cv.line(x + w / 2, y, x + w / 2, y + h)
        elif fill or stroke:
            cv.rect(x, y, w, h, stroke=1 if stroke else 0, fill=1 if fill else 0)
        cv.restoreState()

    def draw_folio(self, cv: Canvas, page: dict) -> None:
        master = next((m for m in self.c.get("masters", []) if m.get("name") == page.get("master")), None)
        if not master or not master.get("folio") or master["folio"].get("position") == "none":
            return
        if any(f.get("role") == "folio" for f in page.get("frames", [])):
            return
        fol = master["folio"]
        style = self.para_style(fol.get("paragraph_style") or "PF Folio")
        margins = self.c["document"]["margins"]
        n = page["page_number"]
        text = f"{n}   {fol.get('running_text', '')}".strip()
        recto = n % 2 == 1
        cv.setFont(style.fontName, style.fontSize)
        cv.setFillColor(style.textColor)
        pos = fol.get("position", "bottom_outside")
        y = self.off + (margins["bottom"] / 2 if pos != "top_outside" else self.H - margins["top"] / 2)
        if pos == "bottom_center":
            cv.drawCentredString(self.off + self.W / 2, y, text)
        elif recto:
            cv.drawRightString(self.off + self.W - margins["outside"], y, text)
        else:
            cv.drawString(self.off + margins["outside"], y, text)

    def draw_print_marks(self, cv: Canvas, page: dict) -> None:
        o, W, H, b = self.off, self.W, self.H, self.bleed
        cv.saveState()
        cv.setStrokeColor(HexColor("#000000"))
        cv.setLineWidth(0.25)
        L = 18.0
        gap = b + 3
        for cx, cy in ((o, o), (o + W, o), (o, o + H), (o + W, o + H)):
            sx = -1 if cx == o else 1
            sy = -1 if cy == o else 1
            cv.line(cx + sx * gap, cy, cx + sx * (gap + L), cy)
            cv.line(cx, cy + sy * gap, cx, cy + sy * (gap + L))
        cv.setFont("Helvetica", 6)
        cv.setFillColor(HexColor("#000000"))
        title = self.c["document"].get("title", "")
        status = "approved" if page.get("approved") else "NOT APPROVED"
        cv.drawString(o, o - b - 14, f"{title} · page {page['page_number']} · {page['page_type']} · content {status} · "
                                     f"{PRODUCER} · contract {self.c.get('generated_at', '')}")
        cv.restoreState()

    def draw_watermark(self, cv: Canvas) -> None:
        cv.saveState()
        cv.setFillColor(Color(0.85, 0.1, 0.1, alpha=0.18))
        cv.setFont("Helvetica-Bold", 42)
        cv.translate(self.off + self.W / 2, self.off + self.H / 2)
        cv.rotate(52)
        cv.drawCentredString(0, 0, "DRAFT — NOT APPROVED")
        cv.restoreState()

    # ------------------------------------------------------------------ main
    def render(self) -> RenderResult:
        buf = io.BytesIO()
        size = (self.W + 2 * self.off, self.H + 2 * self.off)
        cv = Canvas(buf, pagesize=size, pageCompression=1)
        doc = self.c["document"]
        cv.setTitle(doc.get("title", "PressFlow export"))
        cv.setSubject(f"{doc.get('issue', '')} — preview render of layout contract {self.c.get('contract_version')}")
        cv.setCreator(PRODUCER)
        cv.setProducer(PRODUCER)
        cv.setAuthor("PressFlow")
        cv.setKeywords("PressFlow, preview, ReportLab, not InDesign")
        pages = sorted(self.c["pages"], key=lambda p: p["page_number"])
        for page in pages:
            if self.mode == "print":
                o = self.off
                cv.setTrimBox((o, o, o + self.W, o + self.H))
                cv.setBleedBox((o - self.bleed, o - self.bleed, o + self.W + self.bleed, o + self.H + self.bleed))
            paper = self.swatches.get("PF Paper", "#FFFFFF")
            cv.setFillColor(HexColor(paper))
            cv.rect(self.off - self.bleed, self.off - self.bleed, self.W + 2 * self.bleed, self.H + 2 * self.bleed,
                    stroke=0, fill=1)
            for fr in sorted(page.get("frames", []), key=lambda f: f.get("z", 0)):
                try:
                    kind = fr["kind"]
                    if kind == "text":
                        self.draw_text(cv, fr)
                    elif kind == "image":
                        self.draw_image(cv, fr)
                    else:
                        self.draw_shape(cv, fr)
                except Exception as e:  # noqa: BLE001 - one bad frame must not kill the render
                    self.warnings.append(f"Frame {fr.get('id')} on page {page['page_number']} failed: {e}")
                    log.exception("frame render failed")
            self.draw_folio(cv, page)
            if self.watermark and not page.get("approved"):
                self.draw_watermark(cv)
            if self.mode == "print":
                self.draw_print_marks(cv, page)
            cv.showPage()
        cv.save()
        return RenderResult(pdf=buf.getvalue(), page_count=len(pages), warnings=self.warnings)


def render_contract(contract: dict, resolve_asset: AssetResolver, *, mode: str = "digital",
                    watermark_unapproved: bool = True, markup: dict[str, str] | None = None,
                    placeholders: set[str] | None = None) -> RenderResult:
    return ContractRenderer(contract, resolve_asset, mode=mode, watermark_unapproved=watermark_unapproved,
                            markup=markup, placeholders=placeholders).render()
