"""Layout contract (packages/contracts/layout-contract.schema.json): validation + build from a project."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from app.config import REPO_ROOT
from app.ids import iso, utcnow
from app.services.page_builder import article_paragraphs, build_toc, folio_text, issue_label, magazine_name
from app.services.templates import page_type_label
from app.services.reference_analysis.colors import hex_to_rgb
from app.services.reference_analysis.fonts import human_family, reportlab_fallback

BUNDLED = Path(__file__).resolve().parent.parent / "contracts" / "layout-contract.schema.json"
SHARED = REPO_ROOT / "packages" / "contracts" / "layout-contract.schema.json"
ROLE_NAMES = {"kicker": "Kicker", "headline": "Headline", "deck": "Deck", "byline": "Byline", "body": "Body",
              "subhead": "Subhead", "pullquote": "Pull Quote", "caption": "Caption", "folio": "Folio",
              "question": "Question", "stat": "Stat"}
NO_MASTER = {"cover", "advertisement", "full_page_image"}


@lru_cache
def schema() -> dict:
    path = SHARED if SHARED.exists() else BUNDLED
    return json.loads(path.read_text())


def validate_contract(contract: Any) -> list[dict[str, str]]:
    v = Draft202012Validator(schema(), format_checker=FormatChecker())
    errors = []
    for e in sorted(v.iter_errors(contract), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in e.absolute_path) or "(root)"
        errors.append({"path": path, "message": e.message[:300]})
    return errors[:50]


def style_name(role: str) -> str:
    return f"PF {ROLE_NAMES.get(role, role.title())}"


def _cmyk(hexv: str) -> list[float]:
    r, g, b = (c / 255 for c in hex_to_rgb(hexv))
    k = 1 - max(r, g, b)
    if k >= 0.999:
        return [0, 0, 0, 100]
    c, m, y = ((1 - x - k) / (1 - k) for x in (r, g, b))
    return [round(v * 100, 1) for v in (c, m, y, k)]


def _font_style(weight: int, italic: bool) -> str:
    base = "Bold" if weight >= 700 else "Semibold" if weight >= 600 else "Light" if weight <= 300 else "Regular"
    if italic:
        return "Italic" if base == "Regular" else f"{base} Italic"
    return base


def markup_to_plain(text: str) -> str:
    """Frontend light markup -> contract plain text ("\n\n" between paragraphs).

    Formatting-only markers are removed ("^ " lead, "## " subhead, "> " inline quote); markers that are real
    copy are kept ("Q: " question prefix, "• " bullet, "— " attribution)."""
    out = []
    for para in (text or "").split("\n\n"):
        for marker in ("^ ", "## ", "> "):
            if para.startswith(marker):
                para = para[len(marker):]
                break
        out.append(para)
    return "\n\n".join(out)


def toc_markup(entries: list[dict]) -> str:
    return "\n\n".join(f"{e['page']:02d}   {e['kicker'].upper()}\n{e['title']}" for e in entries)


def build_contract(project: dict, profile: dict, pages: list[dict], articles: dict[str, dict],
                   assets: dict[str, dict], speakers: list[dict] | None = None,
                   markup_out: dict[str, str] | None = None) -> dict:
    """Build a schema-valid layout contract from saved MagazinePage[] (frontend PageElement shapes).

    Dynamic frames are filled here (folio = page number + running text, toc = article openers). Text keeps the
    frontend markup only in `markup_out` (frame id -> raw text) for the ReportLab preview; the contract itself
    carries plain text so InDesign never sets markers literally."""
    colors = profile["colors"]
    swatches: list[dict] = []
    by_hex: dict[str, str] = {}

    def swatch(name: str, hexv: str | None) -> str | None:
        if not hexv:
            return None
        hexv = hexv.upper()
        if hexv in by_hex:
            return by_hex[hexv]
        if any(s["name"] == name for s in swatches):
            name = f"{name} {len(swatches) + 1}"
        swatches.append({"name": name, "hex": hexv, "cmyk": _cmyk(hexv)})
        by_hex[hexv] = name
        return name

    for key, name in (("ink", "PF Ink"), ("paper", "PF Paper"), ("accent", "PF Accent"), ("accentAlt", "PF Accent Alt"),
                      ("muted", "PF Muted"), ("rule", "PF Rule")):
        swatch(name, colors.get(key))

    paragraph = []
    for role, t in (profile.get("typography") or {}).items():
        family = human_family(t["detectedFont"]) if t.get("detectedFont") else t.get("previewFont", "Helvetica")
        style = {
            "name": style_name(role), "role": role, "font_family": family,
            "font_style": _font_style(int(t.get("weight", 400)), bool(t.get("italic"))),
            "fallback_family": reportlab_fallback(t.get("classification", "sans"), int(t.get("weight", 400)) >= 600,
                                                  bool(t.get("italic"))),
            "size_pt": float(t["size"]), "leading_pt": float(t.get("leading") or t["size"] * 1.2),
            "tracking": float(t.get("tracking") or 0), "color": swatch(f"PF {role.title()} Colour", t.get("color")) or "PF Ink",
            "uppercase": bool(t.get("uppercase")), "align": "justify" if role == "body" else "left",
        }
        if role == "body":
            style["first_line_indent_pt"] = round(float(t["size"]), 1)
        paragraph.append(style)

    by_name = {p["name"]: p for p in paragraph}
    classification = {r: t.get("classification", "sans") for r, t in (profile.get("typography") or {}).items()}
    derived_sig: dict[tuple, str] = {}

    def frame_style(role: str, el_style: dict | None) -> str:
        """Frame-level overrides (size/colour/alignment from the template or the editor) become derived styles."""
        name = style_name(role)
        base = by_name.get(name)
        st = el_style or {}
        if not base or not st:
            return name
        patch: dict = {}
        if st.get("size"):
            patch["size_pt"] = float(st["size"])
            patch["leading_pt"] = float(st.get("leading") or base["leading_pt"] * float(st["size"]) / base["size_pt"])
        elif st.get("leading"):
            patch["leading_pt"] = float(st["leading"])
        if st.get("color"):
            patch["color"] = swatch("PF Colour", st["color"])
        if st.get("align"):
            patch["align"] = st["align"]
        if st.get("tracking") is not None:
            patch["tracking"] = float(st["tracking"])
        if st.get("uppercase") is not None:
            patch["uppercase"] = bool(st["uppercase"])
        if st.get("weight") is not None or st.get("italic") is not None:
            t = (profile.get("typography") or {}).get(role, {})
            weight = int(st.get("weight") or t.get("weight", 400))
            italic = bool(st["italic"]) if st.get("italic") is not None else bool(t.get("italic"))
            patch["font_style"] = _font_style(weight, italic)
            patch["fallback_family"] = reportlab_fallback(classification.get(role, "sans"), weight >= 600, italic)
        patch = {k: v for k, v in patch.items() if base.get(k) != v}
        if not patch:
            return name
        sig = (name, tuple(sorted(patch.items())))
        if sig not in derived_sig:
            derived = f"{name} ~{sum(1 for k in derived_sig if k[0] == name) + 1}"
            by_name[derived] = {**base, **patch, "name": derived}
            paragraph.append(by_name[derived])
            derived_sig[sig] = derived
        return derived_sig[sig]

    speaker_map = {sp["id"]: sp for sp in speakers or []}
    magazine = magazine_name(project.get("title") or "")
    issue = issue_label(project.get("publicationDate") or "")
    toc_entries = build_toc(pages, articles)

    W, H = float(profile["page"]["widthPt"]), float(profile["page"]["heightPt"])
    out_pages = []
    used_assets: set[str] = set()
    for i, p in enumerate(pages):
        art = articles.get(p.get("articleId") or "") if p.get("articleId") else None
        approved = p.get("editorialStatus") == "approved" and (art is None or art.get("status") == "approved")
        frames = []
        hero = None
        caption = None
        for el in sorted(p.get("elements") or [], key=lambda e: e.get("z", 0)):
            if el.get("hidden"):
                continue
            x, y, w, h = float(el["x"]), float(el["y"]), float(el["w"]), float(el["h"])
            # Frontend element ids are positional ("el_hero") and repeat across pages: prefix with the page number.
            fid = f"p{i + 1}_{el['id']}" if el["id"].startswith("el_") else el["id"]
            fr: dict[str, Any] = {"id": fid, "role": el.get("role", ""), "label": el.get("name", ""),
                                  "bounds_pt": [round(y, 2), round(x, 2), round(y + h, 2), round(x + w, 2)],
                                  "z": int(el.get("z", 0))}
            kind = el.get("kind")
            if kind == "text":
                fr["kind"] = "text"
                role = el.get("styleRole") or (el.get("role") if el.get("role") in ROLE_NAMES else "body")
                fr["paragraph_style"] = frame_style(role, el.get("style"))
                raw = el.get("text") or ""
                if el.get("dynamic") == "folio":
                    section = ((art or {}).get("kicker") or "").split("·")[0].strip() or page_type_label(p["pageType"])
                    raw = folio_text(profile, i + 1, magazine, issue, section, (el.get("style") or {}).get("align", "right"))
                elif el.get("dynamic") == "toc":
                    raw = toc_markup(toc_entries)
                fr["content"] = markup_to_plain(raw)
                if markup_out is not None and raw:
                    markup_out[fid] = raw
                if el.get("columns"):
                    fr["columns"] = int(el["columns"])
                    fr["gutter_pt"] = float(el.get("gutter") or profile["grid"]["gutterPt"])
                fr["fit"] = "shrink_to_fit" if el.get("role") in ("headline", "stat") else "none"
                if el.get("role") == "caption" and el.get("text"):
                    caption = caption or el["text"]
            elif kind == "image":
                fr["kind"] = "image"
                if el.get("assetId"):
                    crop = el.get("crop") or {}
                    fr["image"] = {"asset_id": el["assetId"], "fitting": "fill_proportionally",
                                   "scale": float(crop.get("scale") or 1),
                                   "offset_x": max(-1.0, min(1.0, float(crop.get("offsetX") or 0))),
                                   "offset_y": max(-1.0, min(1.0, float(crop.get("offsetY") or 0)))}
                    used_assets.add(el["assetId"])
                    if el.get("role") in ("hero_image", "background") and hero is None:
                        hero = el["assetId"]
            elif kind == "rule":
                fr["kind"] = "line"
                fr["stroke"] = swatch("PF Stroke", el.get("stroke") or el.get("fill") or colors.get("rule")) or "PF Rule"
                fr["stroke_weight_pt"] = float(el.get("strokeWidth") or max(0.25, min(h if w >= h else w, 4.0)))
            else:
                fr["kind"] = "rect"
                if el.get("fill"):
                    fr["fill"] = swatch("PF Fill", el["fill"])
                if el.get("stroke"):
                    fr["stroke"] = swatch("PF Stroke", el["stroke"])
                    fr["stroke_weight_pt"] = float(el.get("strokeWidth") or 0.5)
            if el.get("opacity") is not None:
                fr["opacity"] = max(0.0, min(1.0, float(el["opacity"])))
            frames.append(fr)
        page: dict[str, Any] = {"page_number": i + 1, "page_type": p["pageType"], "template_id": p["templateId"],
                                "approved": bool(approved), "frames": frames}
        if any(f.get("role") == "folio" for f in frames):
            page["master"] = "B-Frames"  # the page carries its own folio frame; master folio off (no duplicates)
        elif p["pageType"] not in NO_MASTER:
            page["master"] = "A-Article"
        if art:
            page["article_id"] = art["id"]
            page["headline"] = art.get("headline") or ""
            page["subheadline"] = art.get("subheadline") or ""
            quote_ids = {b["id"] for b in art.get("body") or [] if b.get("kind") == "quote"}
            page["body"] = markup_to_plain("\n\n".join(article_paragraphs(art, speaker_map, quote_ids)))
            quotes = [b["text"] for b in art.get("body") or [] if b.get("kind") == "quote" and b.get("text")]
            if quotes:
                page["pull_quotes"] = quotes[:3]
        cols = next((f.get("columns") for f in frames if f.get("role") == "body" and f.get("columns")), None)
        if cols:
            page["columns"] = cols
        if hero:
            page["hero_image"] = hero
        if caption:
            page["caption"] = caption
        out_pages.append(page)

    asset_list = []
    for aid in sorted(used_assets):
        a = assets.get(aid)
        if not a:
            asset_list.append({"id": aid, "file": f"assets/{aid}.missing"})
            continue
        ext = Path(a.get("fileName") or "").suffix.lower() or ".jpg"
        item: dict[str, Any] = {"id": aid, "file": f"assets/{aid}{ext}"}
        if a.get("widthPx"):
            item["width_px"] = int(a["widthPx"])
        if a.get("heightPx"):
            item["height_px"] = int(a["heightPx"])
        if a.get("credit"):
            item["credit"] = a["credit"]
        asset_list.append(item)

    folio_pos = (profile.get("folio") or {}).get("position", "bottom_outside")
    return {
        "contract_version": "1.0",
        "generated_at": iso(utcnow()),
        "project_id": project["id"],
        "document": {
            "title": project.get("title") or "Untitled",
            "issue": project.get("issueNumber") or "",
            "publication_date": project.get("publicationDate") or "",
            "page_width_pt": W, "page_height_pt": H,
            "bleed_pt": float(profile["page"].get("bleedPt", 9)),
            "facing_pages": True,
            "margins": {k: float(profile["margins"][k]) for k in ("top", "bottom", "inside", "outside")},
            "columns": int(profile["grid"]["columns"]),
            "gutter_pt": float(profile["grid"]["gutterPt"]),
            "baseline_pt": float(profile["grid"]["baselinePt"]),
        },
        "styles": {
            "colors": swatches,
            "paragraph": paragraph,
            "character": [{"name": "PF Speaker Name", "font_style": "Bold"}],
            "object": [{"name": "PF Image", "stroke_weight_pt": 0, "text_wrap": "bounding_box"}],
        },
        "masters": [{"name": "A-Article", "folio": {
            "position": folio_pos, "paragraph_style": "PF Folio",
            "running_text": " · ".join(x for x in [magazine, issue] if x)}},
            {"name": "B-Frames", "folio": {"position": "none"}}],
        "pages": out_pages or [{"page_number": 1, "page_type": "cover", "template_id": "tpl_cover_fullbleed",
                                "approved": False, "frames": []}],
        "assets": asset_list,
    }
