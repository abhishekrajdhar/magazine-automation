"""Layout contract -> IDML package, with no InDesign involved.

IDML is InDesign's open XML interchange format (a zip of XML parts: designmap.xml plus Resources, MasterSpreads,
Spreads and Stories). This writer expresses the layout contract in it: CMYK swatches, paragraph and character
styles, facing-page spreads, labelled text frames with live text, graphic frames with linked images, rules and
tinted panels. InDesign opens the result as an ordinary document in which every frame, style and link is editable.

The export is a zip holding `<name>.idml`, a `Links/` folder with the placed images and a README. It is not a
native .indd and it is not a print file: InDesign sets the type with the fonts installed on the machine that opens
it, so line breaks are decided there, not here. Every package is checked by `validate_idml` before it is stored.

Origin: the IDML writer of the Magazine Autopilot pipeline, rebuilt on the layout contract.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Callable
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

from PIL import Image

PRODUCER = "PressFlow IDML writer"
MIMETYPE = "application/vnd.adobe.indesign-idml-package"
NS = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"'
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
DOM = 'DOMVersion="18.0"'
LAYER = "ua4"
NO_PARA = "ParagraphStyle/$ID/[No paragraph style]"
NO_CHAR = "CharacterStyle/$ID/[No character style]"
ALIGN = {"left": "LeftAlign", "center": "CenterAlign", "right": "RightAlign", "justify": "LeftJustified"}
IMAGE_FORMATS = {"JPEG": ("JPEG", ".jpg"), "PNG": ("Portable Network Graphics (PNG)", ".png"),
                 "TIFF": ("TIFF", ".tif"), "GIF": ("GIF", ".gif")}
EDGE = 0.5  # pt: a frame this close to the trim edge is taken out to the bleed
LINE_BREAK = " "  # forced line break inside a paragraph

AssetResolver = Callable[[str], bytes | None]


@dataclass
class IdmlResult:
    package: bytes            # zip: <name>.idml + Links/ + README.txt
    idml: bytes               # the .idml on its own
    file_name: str            # name of the .idml inside the package
    page_count: int
    frame_count: int
    linked_images: int
    warnings: list[str] = field(default_factory=list)


def _n(v: float) -> str:
    return f"{float(v):.3f}".rstrip("0").rstrip(".") or "0"


def _ref(name: str) -> str:
    """A name as it appears inside a Self id: InDesign percent-encodes the characters that would break the id."""
    return "".join(ch if ch.isalnum() or ch in " _-.~+()" else f"%{ord(ch):x}" for ch in name)


def _hex_to_cmyk(hexv: str) -> list[float]:
    h = hexv.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    k = 1 - max(r, g, b)
    if k >= 0.999:
        return [0, 0, 0, 100]
    return [round((1 - x - k) / (1 - k) * 100, 1) for x in (r, g, b)] + [round(k * 100, 1)]


class _Ids:
    def __init__(self) -> None:
        self.n = 0x100

    def new(self, prefix: str = "u") -> str:
        self.n += 1
        return f"{prefix}{self.n:x}"


class IdmlWriter:
    def __init__(self, contract: dict, resolve_asset: AssetResolver, *, markup: dict[str, str] | None = None,
                 placeholders: set[str] | None = None, name: str = "magazine"):
        self.c = contract
        self.resolve = resolve_asset
        self.markup = markup or {}
        self.placeholders = placeholders or set()
        self.name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "magazine"
        doc = contract["document"]
        self.W = float(doc["page_width_pt"])
        self.H = float(doc["page_height_pt"])
        self.bleed = float(doc.get("bleed_pt", 9))
        self.facing = bool(doc.get("facing_pages", True))
        self.margins = {k: float(v) for k, v in doc["margins"].items()}
        self.columns = max(1, int(doc.get("columns") or 1))
        self.gutter = float(doc.get("gutter_pt") or 12)
        self.ids = _Ids()
        self.warnings: list[str] = []
        self.links: dict[str, bytes] = {}            # Links/<file> -> bytes
        self._images: dict[str, tuple[str, int, int, str] | None] = {}
        self.stories: dict[str, str] = {}            # story id -> xml
        self.frame_count = 0
        self.linked = 0

        styles = contract.get("styles") or {}
        self.swatches: dict[str, list[float]] = {}
        for s in styles.get("colors") or []:
            cmyk = s.get("cmyk") if len(s.get("cmyk") or []) == 4 else _hex_to_cmyk(s["hex"])
            self.swatches[s["name"]] = [float(v) for v in cmyk]
        self.para: dict[str, dict] = {p["name"]: dict(p) for p in styles.get("paragraph") or []}
        self.char: dict[str, dict] = {c["name"]: dict(c) for c in styles.get("character") or []}
        self.by_role: dict[str, str] = {}
        for p in styles.get("paragraph") or []:
            if p.get("role") and "~" not in p["name"]:
                self.by_role.setdefault(p["role"], p["name"])
        self.masters = {m["name"]: m for m in contract.get("masters") or []}

    # ------------------------------------------------------------------ references
    def color(self, ref: str | None) -> str:
        """Swatch reference for a swatch name or a literal #RRGGBB (added to the swatches on first use)."""
        if not ref:
            return "Swatch/None"
        if ref.startswith("#") and len(ref) == 7:
            name = f"PF {ref.upper()}"
            self.swatches.setdefault(name, _hex_to_cmyk(ref))
            return f"Color/{_ref(name)}"
        if ref not in self.swatches:
            self.warnings.append(f"Unknown swatch '{ref}'; black was used.")
            return "Color/Black"
        return f"Color/{_ref(ref)}"

    def para_ref(self, name: str | None) -> str:
        return f"ParagraphStyle/{_ref(name)}" if name and name in self.para else NO_PARA

    def _derived(self, base: str | None, suffix: str, patch: dict) -> str | None:
        """A variant of a contract style (lead paragraph with a drop cap, a paragraph after a heading)."""
        if not base or base not in self.para:
            return base
        name = f"{base} {suffix}"
        if name not in self.para:
            self.para[name] = {**self.para[base], **patch, "name": name, "based_on": base}
        return name

    # ------------------------------------------------------------------ geometry
    def _origin(self, page_number: int) -> tuple[float, float]:
        """Top-left of a page in spread coordinates. Facing pages meet at the spine (x = 0)."""
        if self.facing:
            return (0.0 if page_number % 2 == 1 else -self.W), -self.H / 2
        return -self.W / 2, -self.H / 2

    def _box(self, bounds: list[float], page_number: int, to_bleed: bool = False) -> tuple[float, float, float, float]:
        top, left, bottom, right = (float(v) for v in bounds)
        if to_bleed and self.bleed:
            recto = page_number % 2 == 1
            spine_left = self.facing and recto and page_number != 1
            spine_right = self.facing and not recto
            if top <= EDGE:
                top = -self.bleed
            if bottom >= self.H - EDGE:
                bottom = self.H + self.bleed
            if left <= EDGE and not spine_left:
                left = -self.bleed
            if right >= self.W - EDGE and not spine_right:
                right = self.W + self.bleed
        ox, oy = self._origin(page_number)
        return ox + left, oy + top, ox + right, oy + bottom

    @staticmethod
    def _path(x0: float, y0: float, x1: float, y1: float, closed: bool = True) -> str:
        pts = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)] if closed else [(x0, y0), (x1, y1)]
        arr = "".join(f'<PathPointType Anchor="{_n(a)} {_n(b)}" LeftDirection="{_n(a)} {_n(b)}" '
                      f'RightDirection="{_n(a)} {_n(b)}"/>' for a, b in pts)
        return (f'<PathGeometry><GeometryPathType PathOpen="{"false" if closed else "true"}">'
                f'<PathPointArray>{arr}</PathPointArray></GeometryPathType></PathGeometry>')

    @staticmethod
    def _label(fr: dict) -> str:
        label = fr.get("label") or fr.get("role") or fr.get("id") or ""
        return f'<Label><KeyValuePair Key="Label" Value={quoteattr(label)}/></Label>'

    @staticmethod
    def _opacity(fr: dict) -> str:
        if fr.get("opacity") is None or float(fr["opacity"]) >= 1:
            return ""
        return (f'<TransparencySetting><BlendingSetting Opacity="{_n(max(0.0, float(fr["opacity"])) * 100)}"/>'
                f'</TransparencySetting>')

    # ------------------------------------------------------------------ stories
    def _paragraphs(self, fr: dict) -> list[tuple[str, str, str]]:
        """(paragraph style ref, character style ref, text) per paragraph of a text frame.

        With the editor's light markup available (contracts built by the API) headings, questions, the lead
        paragraph and inline quotes get their own styles; otherwise every paragraph takes the frame's style."""
        base = fr.get("paragraph_style")
        raw = self.markup.get(fr["id"])
        if not raw:
            content = fr.get("content") or ""
            return [(self.para_ref(base), NO_CHAR, p.strip()) for p in content.split("\n\n") if p.strip()]
        out: list[tuple[str, str, str]] = []
        after_heading = True
        for p in (x.strip() for x in raw.split("\n\n")):
            if not p:
                continue
            style, cs = base, NO_CHAR
            if p.startswith("## "):
                p, style = p[3:], self.by_role.get("subhead") or base
                after_heading = True
            elif p.startswith("Q: "):
                style = self.by_role.get("question") or base
                after_heading = True
            elif p.startswith("^ "):
                p, style = p[2:], self._derived(base, "Lead", {"drop_cap_lines": 3, "first_line_indent_pt": 0})
                after_heading = False
            elif p.startswith("> "):
                p, cs = p[2:], self._inline_quote()
                style = self._derived(base, "No Indent", {"first_line_indent_pt": 0})
                after_heading = False
            else:
                if after_heading:
                    style = self._derived(base, "No Indent", {"first_line_indent_pt": 0})
                after_heading = False
            out.append((self.para_ref(style), cs, p))
        return out

    def _inline_quote(self) -> str:
        name = "PF Inline Quote"
        if name not in self.char:
            accent = "PF Accent" if "PF Accent" in self.swatches else None
            self.char[name] = {"name": name, "font_style": "Italic", **({"color": accent} if accent else {})}
        return f"CharacterStyle/{_ref(name)}"

    def _story(self, paras: list[tuple[str, str, str]], uppercase: bool = False) -> str:
        sid = self.ids.new("st")
        out = [HEAD, f'<idPkg:Story {NS} {DOM}>',
               f'<Story Self="{sid}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">'
               '<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" '
               'StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>'
               '<InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/>']
        for i, (ps, cs, text) in enumerate(paras):
            last = i == len(paras) - 1
            out.append(f'<ParagraphStyleRange AppliedParagraphStyle="{ps}"><CharacterStyleRange '
                       f'AppliedCharacterStyle="{cs}">')
            if text == "<<PAGE>>":
                out.append("<Content><?ACE 18?></Content>")
            else:
                parts = text.split("<<PAGE>>")
                for j, part in enumerate(parts):
                    if j:
                        out.append("<Content><?ACE 18?></Content>")
                    if part:
                        out.append(f"<Content>{escape(part.replace(chr(10), LINE_BREAK))}</Content>")
            out.append(("" if last else "<Br/>") + "</CharacterStyleRange></ParagraphStyleRange>")
        out.append("</Story></idPkg:Story>")
        self.stories[sid] = "".join(out)
        return sid

    # ------------------------------------------------------------------ page items
    def _text_frame(self, fr: dict, page_number: int) -> str:
        x0, y0, x1, y1 = self._box(fr["bounds_pt"], page_number)
        paras = self._paragraphs(fr)
        sid = self._story(paras or [(self.para_ref(fr.get("paragraph_style")), NO_CHAR, "")])
        cols = max(1, int(fr.get("columns") or 1))
        gutter = float(fr.get("gutter_pt") or self.gutter)
        fill = self.color(fr.get("fill")) if fr.get("fill") else "Swatch/None"
        return (f'<TextFrame Self="{self.ids.new()}" ParentStory="{sid}" ContentType="TextType" '
                f'ItemTransform="1 0 0 1 0 0" ItemLayer="{LAYER}" FillColor="{fill}" StrokeColor="Swatch/None" '
                f'StrokeWeight="0" PreviousTextFrame="n" NextTextFrame="n" Name={quoteattr(fr.get("label") or fr["id"])}>'
                f'<Properties>{self._path(x0, y0, x1, y1)}{self._label(fr)}</Properties>'
                f'<TextFramePreference TextColumnCount="{cols}" TextColumnGutter="{_n(gutter)}" '
                f'VerticalJustification="TopAlign" AutoSizingType="Off" IgnoreWrap="false"/>'
                f'{self._opacity(fr)}</TextFrame>')

    def _image_file(self, asset_id: str) -> tuple[str, int, int, str] | None:
        """(path inside the package, width px, height px, InDesign format name) for an asset, or None."""
        if asset_id in self._images:
            return self._images[asset_id]
        found = None
        if asset_id in self.placeholders:
            self.warnings.append(f"Asset {asset_id} is a demo placeholder; its frame was left empty.")
        else:
            data = None
            try:
                data = self.resolve(asset_id)
            except Exception as e:  # noqa: BLE001 - one unreadable asset must not kill the package
                self.warnings.append(f"Asset {asset_id} could not be read: {e}")
            if data:
                try:
                    with Image.open(io.BytesIO(data)) as im:
                        fmt, (w, h) = im.format or "", im.size
                    if fmt not in IMAGE_FORMATS:
                        with Image.open(io.BytesIO(data)) as im:
                            buf = io.BytesIO()
                            im.convert("RGBA" if "A" in im.getbands() else "RGB").save(buf, "PNG")
                        data, fmt = buf.getvalue(), "PNG"
                    kind, ext = IMAGE_FORMATS[fmt]
                    declared = next((a.get("file") for a in self.c.get("assets") or [] if a["id"] == asset_id), None)
                    stem = PurePosixPath(declared).stem if declared else asset_id
                    path = f"Links/{re.sub(r'[^A-Za-z0-9._-]+', '_', stem)}{ext}"
                    self.links[path] = data
                    found = (path, w, h, kind)
                except Exception as e:  # noqa: BLE001
                    self.warnings.append(f"Asset {asset_id} is not a readable image: {e}")
            elif asset_id not in self.placeholders:
                self.warnings.append(f"Asset {asset_id} has no stored file; its frame was left empty.")
        self._images[asset_id] = found
        return found

    def _image_frame(self, fr: dict, page_number: int) -> str:
        x0, y0, x1, y1 = self._box(fr["bounds_pt"], page_number, to_bleed=True)
        w, h = x1 - x0, y1 - y0
        img = fr.get("image") or {}
        inner = ""
        file = self._image_file(img["asset_id"]) if img.get("asset_id") else None
        if file and w > 0 and h > 0:
            path, pw, ph, kind = file
            fitting = img.get("fitting", "fill_proportionally")
            scale = float(img.get("scale") or 1)
            if fitting == "fit_proportionally":
                s = min(w / pw, h / ph) * scale
            elif fitting == "center":
                s = scale
            else:
                s = max(w / pw, h / ph) * scale
            dw, dh = pw * s, ph * s
            ox = max(-1.0, min(1.0, float(img.get("offset_x") or 0)))
            oy = max(-1.0, min(1.0, float(img.get("offset_y") or 0)))
            tx = x0 - (dw - w) * (1 + ox) / 2      # same crop maths as the preview renderer
            ty = y0 - (dh - h) * (1 + oy) / 2
            ppi = max(1, int(round(72 / s)))
            inner = (f'<Image Self="{self.ids.new()}" ItemTransform="{_n(s)} 0 0 {_n(s)} {_n(tx)} {_n(ty)}" '
                     f'ActualPpi="72 72" EffectivePpi="{ppi} {ppi}" ImageTypeName="$ID/{kind}">'
                     f'<Properties><GraphicBounds Left="0" Top="0" Right="{pw}" Bottom="{ph}"/></Properties>'
                     f'<Link Self="{self.ids.new()}" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI={quoteattr("file:" + path)} '
                     f'LinkResourceFormat="$ID/{kind}" StoredState="Normal" LinkClassID="35906" LinkClientID="257" '
                     f'LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" '
                     f'CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport"/>'
                     f'</Image>')
            self.linked += 1
        fill = "Swatch/None" if inner else self.color("#E6E8EC")
        return (f'<Rectangle Self="{self.ids.new()}" ContentType="GraphicType" ItemTransform="1 0 0 1 0 0" '
                f'ItemLayer="{LAYER}" FillColor="{fill}" StrokeColor="Swatch/None" StrokeWeight="0" '
                f'Name={quoteattr(fr.get("label") or fr["id"])}>'
                f'<Properties>{self._path(x0, y0, x1, y1)}{self._label(fr)}</Properties>'
                f'<FrameFittingOption AutoFit="false" FittingOnEmptyFrame="FillProportionally" '
                f'FittingAlignment="CenterAnchor"/>{self._opacity(fr)}{inner}</Rectangle>')

    def _shape(self, fr: dict, page_number: int) -> str:
        x0, y0, x1, y1 = self._box(fr["bounds_pt"], page_number, to_bleed=fr["kind"] == "rect")
        name = quoteattr(fr.get("label") or fr["id"])
        if fr["kind"] == "line":
            weight = float(fr.get("stroke_weight_pt") or 0.5)
            stroke = self.color(fr.get("stroke") or ("PF Rule" if "PF Rule" in self.swatches else "#999999"))
            if (x1 - x0) >= (y1 - y0):
                my = (y0 + y1) / 2
                path = self._path(x0, my, x1, my, closed=False)
            else:
                mx = (x0 + x1) / 2
                path = self._path(mx, y0, mx, y1, closed=False)
            return (f'<GraphicLine Self="{self.ids.new()}" ItemTransform="1 0 0 1 0 0" ItemLayer="{LAYER}" '
                    f'FillColor="Swatch/None" StrokeColor="{stroke}" StrokeWeight="{_n(weight)}" Name={name}>'
                    f'<Properties>{path}{self._label(fr)}</Properties>{self._opacity(fr)}</GraphicLine>')
        fill = self.color(fr.get("fill")) if fr.get("fill") else "Swatch/None"
        stroke = self.color(fr.get("stroke")) if fr.get("stroke") else "Swatch/None"
        weight = float(fr.get("stroke_weight_pt") or 0.5) if fr.get("stroke") else 0
        return (f'<Rectangle Self="{self.ids.new()}" ContentType="Unassigned" ItemTransform="1 0 0 1 0 0" '
                f'ItemLayer="{LAYER}" FillColor="{fill}" StrokeColor="{stroke}" StrokeWeight="{_n(weight)}" Name={name}>'
                f'<Properties>{self._path(x0, y0, x1, y1)}{self._label(fr)}</Properties>{self._opacity(fr)}</Rectangle>')

    def _folio(self, page: dict) -> str:
        """Running folio for pages on a master that carries one (pages with their own folio frame are skipped)."""
        master = self.masters.get(page.get("master") or "")
        fol = (master or {}).get("folio") or {}
        pos = fol.get("position", "none")
        if pos == "none" or any(f.get("role") == "folio" for f in page.get("frames") or []):
            return ""
        n = page["page_number"]
        style = fol.get("paragraph_style") or self.by_role.get("folio")
        size = float((self.para.get(style or "") or {}).get("size_pt", 8))
        recto = n % 2 == 1
        running = (fol.get("running_text") or "").strip()
        height = size * 1.6
        top = (self.margins["top"] / 2 - height / 2) if pos == "top_outside" else (self.H - self.margins["bottom"] / 2 - height / 2)
        left, right = self.margins["outside"], self.W - self.margins["outside"]
        text = f"<<PAGE>>   {running}".rstrip()
        align = "center" if pos == "bottom_center" else ("right" if recto else "left")
        if align == "right" and running:
            text = f"{running}   <<PAGE>>"
        ps = self._derived(style, f"({align})", {"align": align}) if style in self.para else style
        fr = {"id": f"p{n}_folio", "role": "folio", "label": "Folio", "bounds_pt": [top, left, top + height, right]}
        x0, y0, x1, y1 = self._box(fr["bounds_pt"], n)
        sid = self._story([(self.para_ref(ps), NO_CHAR, text)])
        return (f'<TextFrame Self="{self.ids.new()}" ParentStory="{sid}" ContentType="TextType" '
                f'ItemTransform="1 0 0 1 0 0" ItemLayer="{LAYER}" FillColor="Swatch/None" StrokeColor="Swatch/None" '
                f'StrokeWeight="0" PreviousTextFrame="n" NextTextFrame="n" Name="Folio">'
                f'<Properties>{self._path(x0, y0, x1, y1)}{self._label(fr)}</Properties>'
                f'<TextFramePreference TextColumnCount="1" VerticalJustification="CenterAlign" AutoSizingType="Off"/>'
                f'</TextFrame>')

    # ------------------------------------------------------------------ document parts
    def _margin_pref(self, columns: int | None = None) -> str:
        m = self.margins
        cols = max(1, int(columns or self.columns))
        live = self.W - m["inside"] - m["outside"]
        cw = (live - (cols - 1) * self.gutter) / cols
        pos = " ".join(_n(v) for i in range(cols) for v in (i * (cw + self.gutter), i * (cw + self.gutter) + cw))
        # With facing pages InDesign reads Left as the inside margin and Right as the outside margin.
        return (f'<MarginPreference ColumnCount="{cols}" ColumnGutter="{_n(self.gutter)}" Top="{_n(m["top"])}" '
                f'Bottom="{_n(m["bottom"])}" Left="{_n(m["inside"])}" Right="{_n(m["outside"])}" '
                f'ColumnDirection="Horizontal" ColumnsPositions="{pos}"/>')

    def _page(self, self_id: str, name: str, page_number: int, master: str, columns: int | None = None) -> str:
        ox, oy = self._origin(page_number)
        return (f'<Page Self="{self_id}" Name={quoteattr(name)} AppliedMaster="{master}" OverrideList="" TabOrder="" '
                f'GridStartingPoint="TopOutside" UseMasterGrid="true" MasterPageTransform="1 0 0 1 0 0" '
                f'ItemTransform="1 0 0 1 {_n(ox)} {_n(oy)}" GeometricBounds="0 0 {_n(self.H)} {_n(self.W)}">'
                f'{self._margin_pref(columns)}</Page>')

    def _spreads(self, master_id: str) -> tuple[list[tuple[str, str]], str]:
        pages = sorted(self.c["pages"], key=lambda p: p["page_number"])
        groups: list[list[dict]] = []
        for p in pages:
            n = p["page_number"]
            if self.facing and n % 2 == 1 and n != pages[0]["page_number"] and groups and len(groups[-1]) == 1 \
                    and groups[-1][0]["page_number"] == n - 1:
                groups[-1].append(p)      # an even page and the odd page after it face each other
            else:
                groups.append([p])
        out: list[tuple[str, str]] = []
        first_page_id = ""
        for gi, group in enumerate(groups):
            spread_id = self.ids.new("us")
            body = []
            for p in group:
                pid = self.ids.new("up")
                first_page_id = first_page_id or pid
                body.append(self._page(pid, str(p["page_number"]), p["page_number"], master_id, p.get("columns")))
            for p in group:
                n = p["page_number"]
                for fr in sorted(p.get("frames") or [], key=lambda f: f.get("z", 0)):   # back to front
                    try:
                        if fr["kind"] == "text":
                            body.append(self._text_frame(fr, n))
                        elif fr["kind"] == "image":
                            body.append(self._image_frame(fr, n))
                        else:
                            body.append(self._shape(fr, n))
                        self.frame_count += 1
                    except Exception as e:  # noqa: BLE001 - one bad frame must not kill the package
                        self.warnings.append(f"Frame {fr.get('id')} on page {n} was skipped: {e}")
                body.append(self._folio(p))
            binding = 1 if (self.facing and group[0]["page_number"] % 2 == 0) else 0
            out.append((spread_id, HEAD + f'<idPkg:Spread {NS} {DOM}><Spread Self="{spread_id}" '
                        f'FlattenerOverride="Default" AllowPageShuffle="true" '
                        f'ItemTransform="1 0 0 1 0 {_n(gi * (self.H + 144))}" ShowMasterItems="true" '
                        f'PageCount="{len(group)}" BindingLocation="{binding}" PageTransform="1 0 0 1 0 0">'
                        + "".join(body) + "</Spread></idPkg:Spread>"))
        return out, first_page_id

    def _master(self, master_id: str) -> str:
        pages = (self._page(self.ids.new("up"), "A", 2, "n") + self._page(self.ids.new("up"), "A", 1, "n")) \
            if self.facing else self._page(self.ids.new("up"), "A", 1, "n")
        return (HEAD + f'<idPkg:MasterSpread {NS} {DOM}><MasterSpread Self="{master_id}" Name="A-Master" '
                f'NamePrefix="A" BaseName="Master" ItemTransform="1 0 0 1 0 0" PageCount="{2 if self.facing else 1}" '
                f'ShowMasterItems="true">{pages}</MasterSpread></idPkg:MasterSpread>')

    def _styles_xml(self) -> str:
        out = [HEAD, f'<idPkg:Styles {NS} {DOM}>', '<RootCharacterStyleGroup Self="u77">'
               '<CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/>']
        for name, c in self.char.items():
            attrs = f' FontStyle={quoteattr(c["font_style"])}' if c.get("font_style") else ""
            if c.get("color"):
                attrs += f' FillColor="{self.color(c["color"])}"'
            props = (f'<Properties><AppliedFont type="string">{escape(c["font_family"])}</AppliedFont></Properties>'
                     if c.get("font_family") else "")
            out.append(f'<CharacterStyle Self="CharacterStyle/{_ref(name)}" Name={quoteattr(name)}{attrs}>{props}'
                       f'</CharacterStyle>')
        out.append('</RootCharacterStyleGroup><RootParagraphStyleGroup Self="u7a">'
                   '<ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]"/>'
                   '<ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle"/>')
        for name, p in self.para.items():
            attrs = {"Self": f"ParagraphStyle/{_ref(name)}", "Name": name, "FontStyle": p.get("font_style") or "Regular",
                     "PointSize": _n(p["size_pt"]), "FillColor": self.color(p.get("color")) if p.get("color") else "Color/Black",
                     "Justification": ALIGN.get(p.get("align", "left"), "LeftAlign"),
                     "Tracking": _n(p.get("tracking") or 0), "SpaceBefore": _n(p.get("space_before_pt") or 0),
                     "SpaceAfter": _n(p.get("space_after_pt") or 0),
                     "FirstLineIndent": _n(p.get("first_line_indent_pt") or 0),
                     "Hyphenation": "true" if p.get("role") in ("body", "question") else "false"}
            if p.get("uppercase"):
                attrs["Capitalization"] = "AllCaps"
            if p.get("drop_cap_lines"):
                attrs["DropCapLines"] = str(int(p["drop_cap_lines"]))
                attrs["DropCapCharacters"] = "1"
            a = " ".join(f"{k}={quoteattr(str(v))}" for k, v in attrs.items())
            based = f'ParagraphStyle/{_ref(p["based_on"])}' if p.get("based_on") else "ParagraphStyle/$ID/NormalParagraphStyle"
            out.append(f'<ParagraphStyle {a}><Properties><BasedOn type="object">{escape(based)}</BasedOn>'
                       f'<AppliedFont type="string">{escape(p["font_family"])}</AppliedFont>'
                       f'<Leading type="unit">{_n(p["leading_pt"])}</Leading></Properties></ParagraphStyle>')
        out.append('</RootParagraphStyleGroup>'
                   '<RootObjectStyleGroup Self="u7c"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/>'
                   '<ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"/>'
                   '<ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"/>'
                   '</RootObjectStyleGroup>'
                   '<RootTableStyleGroup Self="u7e"><TableStyle Self="TableStyle/$ID/[Basic Table]" '
                   'Name="$ID/[Basic Table]"/></RootTableStyleGroup>'
                   '<RootCellStyleGroup Self="u80"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/>'
                   '</RootCellStyleGroup></idPkg:Styles>')
        return "".join(out)

    def _graphic_xml(self) -> str:
        out = [HEAD, f'<idPkg:Graphic {NS} {DOM}>']
        for name, cmyk in self.swatches.items():
            out.append(f'<Color Self="Color/{_ref(name)}" Model="Process" Space="CMYK" '
                       f'ColorValue="{" ".join(_n(v) for v in cmyk)}" ColorOverride="Normal" '
                       f'AlternateSpace="NoAlternateColor" AlternateColorValue="" Name={quoteattr(name)} '
                       f'ColorEditable="true" ColorRemovable="true" Visible="true" SwatchCreatorID="7937"/>')
        out.append('<Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black" '
                   'ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>'
                   '<Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" '
                   'SwatchCreatorID="7937"/><StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/>'
                   '</idPkg:Graphic>')
        return "".join(out)

    def _fonts_xml(self) -> str:
        families: dict[str, set[str]] = {}
        for p in self.para.values():
            families.setdefault(p["font_family"], set()).add(p.get("font_style") or "Regular")
        out = [HEAD, f'<idPkg:Fonts {NS} {DOM}>']
        for i, (fam, styles) in enumerate(sorted(families.items())):
            out.append(f'<FontFamily Self="di{i + 10}" Name={quoteattr(fam)}>')
            for j, st in enumerate(sorted(styles)):
                full = quoteattr(f"{fam} {st}")
                ps = quoteattr(fam.replace(" ", "") + "-" + st.replace(" ", ""))
                out.append(f'<Font Self="di{i + 10}Font{j}" FontFamily={quoteattr(fam)} Name={full} PostScriptName={ps} '
                           f'Status="Installed" FontStyleName={quoteattr(st)} FontType="OpenTypeCFF" WritingScript="0" '
                           f'FullName={full} FullNameNative={full} FontStyleNameNative={quoteattr(st)} '
                           f'PlatformName="$ID/" Version="1.0"/>')
            out.append("</FontFamily>")
        out.append("</idPkg:Fonts>")
        return "".join(out)

    def _preferences_xml(self) -> str:
        b = _n(self.bleed)
        body = self.by_role.get("body")
        return (HEAD + f'<idPkg:Preferences {NS} {DOM}>'
                f'<DocumentPreference PageHeight="{_n(self.H)}" PageWidth="{_n(self.W)}" '
                f'PagesPerDocument="{len(self.c["pages"])}" FacingPages="{"true" if self.facing else "false"}" '
                f'DocumentBleedTopOffset="{b}" DocumentBleedBottomOffset="{b}" DocumentBleedInsideOrLeftOffset="{b}" '
                f'DocumentBleedOutsideOrRightOffset="{b}" DocumentBleedUniformSize="true" SlugTopOffset="0" '
                f'SlugBottomOffset="0" SlugInsideOrLeftOffset="0" SlugRightOrOutsideOffset="0" '
                f'PreserveLayoutWhenShuffling="true" AllowPageShuffle="true" OverprintBlack="true" '
                f'PageBinding="LeftToRight" ColumnDirection="Horizontal" Intent="PrintIntent" StartPageNumber="1"/>'
                f'<ViewPreference HorizontalMeasurementUnits="Points" VerticalMeasurementUnits="Points" '
                f'RulerOrigin="PageOrigin" ShowRulers="true"/>'
                + (f'<TextDefault AppliedParagraphStyle="{self.para_ref(body)}"/>' if body else "")
                + '</idPkg:Preferences>')

    # ------------------------------------------------------------------ assemble
    def build(self) -> IdmlResult:
        master_id = self.ids.new("ub")
        spreads, first_page = self._spreads(master_id)          # also fills stories, links and derived styles
        master = self._master(master_id)
        pages = sorted(self.c["pages"], key=lambda p: p["page_number"])
        doc = self.c["document"]
        dm = [HEAD, '<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="18.0(72)" ?>',
              f'<Document {NS} {DOM} Self="d" StoryList="{" ".join(self.stories)}" Name={quoteattr(self.name + ".indd")} '
              f'ZeroPoint="0 0" ActiveLayer="{LAYER}" CMYKProfile="$ID/" RGBProfile="sRGB IEC61966-2.1" '
              'SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" '
              'DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" '
              'CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false">',
              '<Language Self="Language/$ID/English%3a UK" Name="$ID/English: UK" SingleQuotes="&#x2018;&#x2019;" '
              'DoubleQuotes="&#x201c;&#x201d;" PrimaryLanguageName="$ID/English" SublanguageName="$ID/UK" Id="525" '
              'HyphenationVendor="Hunspell" SpellingVendor="Hunspell"/>',
              '<idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/>'
              '<idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/>'
              '<idPkg:Tags src="XML/Tags.xml"/>',
              f'<Layer Self="{LAYER}" Name="PressFlow" Visible="true" Locked="false" IgnoreWrap="false" '
              'ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true">'
              '<Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>',
              f'<idPkg:MasterSpread src="MasterSpreads/MasterSpread_{master_id}.xml"/>']
        dm += [f'<idPkg:Spread src="Spreads/Spread_{sid}.xml"/>' for sid, _ in spreads]
        dm.append('<idPkg:BackingStory src="XML/BackingStory.xml"/>')
        dm += [f'<idPkg:Story src="Stories/Story_{sid}.xml"/>' for sid in self.stories]
        dm.append(f'<Section Self="{self.ids.new("sec")}" Length="{len(pages)}" Name="" ContinueNumbering="false" '
                  f'IncludeSectionPrefix="false" Marker="" PageNumberStart="{pages[0]["page_number"]}" SectionPrefix="" '
                  f'PageStart="{first_page}"><Properties><PageNumberStyle type="enumeration">Arabic</PageNumberStyle>'
                  f'</Properties></Section></Document>')
        parts = {
            "designmap.xml": "".join(dm),
            # Styles, swatches and fonts are written last: frames and stories add derived styles and swatches.
            "Resources/Styles.xml": self._styles_xml(),
            "Resources/Graphic.xml": self._graphic_xml(),
            "Resources/Fonts.xml": self._fonts_xml(),
            "Resources/Preferences.xml": self._preferences_xml(),
            f"MasterSpreads/MasterSpread_{master_id}.xml": master,
            "XML/Tags.xml": HEAD + f'<idPkg:Tags {NS} {DOM}><XMLTag Self="XMLTag/Root" Name="Root"><Properties>'
                            '<TagColor type="enumeration">LightBlue</TagColor></Properties></XMLTag></idPkg:Tags>',
            "XML/BackingStory.xml": HEAD + f'<idPkg:BackingStory {NS} {DOM}><XmlStory Self="uad" AppliedTOCStyle="n" '
                                    'TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">'
                                    '<XMLElement Self="di2" MarkupTag="XMLTag/Root" XMLContent="uad"/></XmlStory>'
                                    '</idPkg:BackingStory>',
            "META-INF/container.xml": HEAD + '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" '
                                      'version="1.0"><rootfiles><rootfile full-path="designmap.xml" '
                                      'media-type="text/xml"/></rootfiles></container>',
        }
        for sid, xml in spreads:
            parts[f"Spreads/Spread_{sid}.xml"] = xml
        for sid, xml in self.stories.items():
            parts[f"Stories/Story_{sid}.xml"] = xml

        idml = io.BytesIO()
        with zipfile.ZipFile(idml, "w") as z:
            z.writestr(zipfile.ZipInfo("mimetype"), MIMETYPE, compress_type=zipfile.ZIP_STORED)
            for name, xml in parts.items():
                z.writestr(name, xml, compress_type=zipfile.ZIP_DEFLATED)
        idml_bytes = idml.getvalue()

        unapproved = [p["page_number"] for p in pages if not p.get("approved")]
        fonts = sorted({f'{p["font_family"]} {p.get("font_style") or "Regular"}' for p in self.para.values()})
        readme = "\n".join([
            f"{doc.get('title', 'Magazine')} {doc.get('issue', '')}".strip(),
            f"Editable InDesign package written by the {PRODUCER} from layout contract "
            f"{self.c.get('contract_version')} ({self.c.get('generated_at', '')}).",
            "",
            "How to open",
            f"  1. Unzip this archive and keep {self.name}.idml beside the Links folder.",
            f"  2. Open {self.name}.idml in Adobe InDesign (File > Open). InDesign converts it to an untitled document.",
            "  3. If the Links panel reports missing links, choose Relink to Folder and pick the Links folder.",
            "  4. Save as .indd.",
            "",
            "What this is",
            "  Every frame, style, swatch and link is live and editable. Frames carry script labels (Window >",
            "  Utilities > Script Label) that match the layout contract's frame labels.",
            "",
            "What this is not",
            "  It is not a native .indd and not a print-ready file. The type is set by InDesign with the fonts",
            "  installed on the machine that opens it, so check every page for overset text and run preflight",
            "  before sending anything to the printer.",
            "",
            f"Pages: {len(pages)}   Frames: {self.frame_count}   Linked images: {self.linked}",
            "Fonts the styles ask for: " + (", ".join(fonts) or "none"),
            ("Pages with content that is NOT approved: " + ", ".join(str(n) for n in unapproved)) if unapproved
            else "Every page's content is approved.",
            *(["", "Warnings"] + [f"  - {w}" for w in self.warnings] if self.warnings else []),
            "",
        ])
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"{self.name}.idml", idml_bytes, compress_type=zipfile.ZIP_STORED)
            for path, data in self.links.items():
                z.writestr(path, data, compress_type=zipfile.ZIP_STORED)
            z.writestr("README.txt", readme)
        return IdmlResult(package=package.getvalue(), idml=idml_bytes, file_name=f"{self.name}.idml",
                          page_count=len(pages), frame_count=self.frame_count, linked_images=self.linked,
                          warnings=self.warnings)


def render_idml(contract: dict, resolve_asset: AssetResolver, *, markup: dict[str, str] | None = None,
                placeholders: set[str] | None = None, name: str = "magazine") -> IdmlResult:
    result = IdmlWriter(contract, resolve_asset, markup=markup, placeholders=placeholders, name=name).build()
    problems = validate_idml(result.idml)
    if problems:
        raise ValueError("The IDML package failed its structure check: " + "; ".join(problems[:5]))
    return result


def validate_idml(data: bytes) -> list[str]:
    """Structural check of an IDML package: zip layout, mimetype first and stored, every part well-formed XML,
    every part named by designmap.xml present, every frame's story present, and every style and swatch that a
    story or page item refers to defined in the resources."""
    problems: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        if not names or names[0] != "mimetype" or z.getinfo("mimetype").compress_type != zipfile.ZIP_STORED:
            problems.append("mimetype must be the first, uncompressed entry")
        elif z.read("mimetype").decode() != MIMETYPE:
            problems.append("mimetype has the wrong content")
        trees: dict[str, ET.Element] = {}
        for n in names:
            if n.endswith(".xml"):
                try:
                    trees[n] = ET.fromstring(z.read(n))
                except ET.ParseError as e:
                    problems.append(f"{n}: not well-formed ({e})")
    dm = trees.get("designmap.xml")
    if dm is None:
        return problems + ["designmap.xml missing"]
    for el in dm.iter():
        src = el.get("src")
        if src and src not in names:
            problems.append(f"designmap references missing part {src}")
    styles, graphic = trees.get("Resources/Styles.xml"), trees.get("Resources/Graphic.xml")
    if styles is None or graphic is None:
        return problems + ["Resources/Styles.xml or Resources/Graphic.xml missing"]
    para = {e.get("Self") for e in styles.iter("ParagraphStyle")}
    char = {e.get("Self") for e in styles.iter("CharacterStyle")}
    colours = {e.get("Self") for e in graphic.iter() if e.tag in ("Color", "Swatch")}
    for e in styles.iter("ParagraphStyle"):
        for key in ("FillColor",):
            if e.get(key) and e.get(key) not in colours:
                problems.append(f"style {e.get('Name')} uses unknown swatch {e.get(key)}")
        based = e.find("Properties/BasedOn")
        if based is not None and based.text not in para:
            problems.append(f"style {e.get('Name')} is based on unknown style {based.text}")
    stories = {el.get("Self") for n, t in trees.items() if n.startswith("Stories/") for el in t.iter("Story")}
    listed = set((dm.get("StoryList") or "").split())
    if stories - listed:
        problems.append(f"{len(stories - listed)} stories are missing from the document's StoryList")
    pages = 0
    for n, t in trees.items():
        if n.startswith("Spreads/"):
            for spread in t.iter("Spread"):
                count = len(list(spread.iter("Page")))
                pages += count
                if str(count) != spread.get("PageCount"):
                    problems.append(f"{n}: PageCount does not match its pages")
            for item in t.iter():
                if item.tag == "TextFrame" and item.get("ParentStory") not in stories:
                    problems.append(f"{n}: frame {item.get('Self')} points at missing story {item.get('ParentStory')}")
                for key in ("FillColor", "StrokeColor"):
                    if item.get(key) and item.get(key) not in colours:
                        problems.append(f"{n}: {item.tag} {item.get('Self')} uses unknown swatch {item.get(key)}")
        if n.startswith("Stories/"):
            for pr in t.iter("ParagraphStyleRange"):
                if pr.get("AppliedParagraphStyle") not in para:
                    problems.append(f"{n}: unknown paragraph style {pr.get('AppliedParagraphStyle')}")
            for cr in t.iter("CharacterStyleRange"):
                if cr.get("AppliedCharacterStyle") not in char:
                    problems.append(f"{n}: unknown character style {cr.get('AppliedCharacterStyle')}")
    if pages == 0:
        problems.append("the document has no pages")
    return problems
