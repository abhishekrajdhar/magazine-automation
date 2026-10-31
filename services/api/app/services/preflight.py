"""Preflight checks on a layout contract (deterministic).

Overset detection is APPROXIMATE: text is wrapped with ReportLab using the contract's
base-14 fallback fonts, so InDesign (with the real fonts) may differ.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

from app.ids import new_id
from app.services.renderers.reportlab_renderer import _safe_font

ARTICLE_PAGES = {"editorial", "interview", "event_report", "two_column_article"}
IMAGE_ROLES = {"hero_image", "image", "portrait", "background", "ad"}
DECORATIVE_TEXT = {"folio"}


@dataclass
class AssetInfo:
    exists: bool
    width_px: int | None = None
    height_px: int | None = None
    simulated: bool = False  # demo asset: no file behind it


@dataclass
class PreflightContext:
    profile_page: tuple[float, float] | None = None  # (w, h) from the design profile
    assets: dict[str, AssetInfo] = field(default_factory=dict)  # by asset id
    article_status: dict[str, str] = field(default_factory=dict)
    bridge_fonts: list[str] | None = None  # None = no InDesign bridge has reported fonts


def _issue(code, severity, message, recommendation, *, page=None, element=None, fix=None) -> dict:
    d = {"id": new_id("qc"), "code": code, "severity": severity, "message": message, "recommendation": recommendation}
    if page is not None:
        d["pageNumber"] = page["page_number"]
        if page.get("_page_id"):
            d["pageId"] = page["_page_id"]
    if element:
        d["elementId"] = element
    if fix:
        d["fix"] = fix
    return d


def _norm_font(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def measure_text_height(text: str, style: dict, width: float, uppercase: bool = False) -> float:
    size = float(style.get("size_pt", 10))
    ps = ParagraphStyle("m", fontName=_safe_font(style.get("fallback_family") or style.get("font_family"), "Times-Roman"),
                        fontSize=size, leading=float(style.get("leading_pt", size * 1.2)),
                        firstLineIndent=float(style.get("first_line_indent_pt", 0)),
                        spaceBefore=float(style.get("space_before_pt", 0)), spaceAfter=float(style.get("space_after_pt", 0)))
    total = 0.0
    for p in [p for p in text.split("\n\n") if p.strip()]:
        para = Paragraph(escape(p.upper() if uppercase else p).replace("\n", "<br/>"), ps)
        _, h = para.wrap(width, 1e6)
        total += h + ps.spaceBefore + ps.spaceAfter
    return total


def _caption_issue(fr: dict, page: dict, W: float, H: float) -> dict:
    """Missing caption: a warning, or info for full-page opener photographs (≥85% of the page, e.g. spread openers
    whose title sits on the image) where a credit line is good practice but the template has no caption frame."""
    top, left, bottom, right = fr["bounds_pt"]
    visible = max(0.0, min(right, W) - max(left, 0.0)) * max(0.0, min(bottom, H) - max(top, 0.0))
    label = fr.get("label") or fr["id"]
    if visible >= 0.85 * W * H:
        return _issue("missing_caption", "info", f"Full-page opener photograph '{label}' has no caption or credit.",
                      "Credit the photograph (e.g. on the facing page) if the publication requires it.",
                      page=page, element=fr["id"], fix="add_caption")
    return _issue("missing_caption", "warning", f"Image frame '{label}' on an article page has no caption.",
                  "Add a caption with names, place and credit.", page=page, element=fr["id"], fix="add_caption")


def run_preflight(contract: dict, ctx: PreflightContext) -> tuple[list[dict], list[str]]:
    issues: list[dict] = []
    notes: list[str] = ["Overset checks are approximate: measured with ReportLab using base-14 fallback fonts."]
    doc = contract["document"]
    W, H = float(doc["page_width_pt"]), float(doc["page_height_pt"])
    bleed = float(doc.get("bleed_pt", 9))
    m = doc["margins"]
    styles = {s["name"]: s for s in contract["styles"].get("paragraph", [])}
    asset_ids = {a["id"]: a for a in contract.get("assets", [])}
    pages = contract.get("pages", [])

    # ---- page size vs profile
    if ctx.profile_page:
        pw, ph = ctx.profile_page
        if abs(pw - W) > 1 or abs(ph - H) > 1:
            issues.append(_issue("page_size_mismatch", "error",
                                 f"Document is {W:.2f}×{H:.2f} pt but the design profile specifies {pw:.2f}×{ph:.2f} pt.",
                                 "Rebuild the layout from the approved design profile or correct the profile's page size.",
                                 fix="open_editor"))

    # ---- page numbering continuity
    nums = [p["page_number"] for p in pages]
    expected = list(range(1, len(pages) + 1))
    if sorted(nums) != expected:
        dupes = sorted({n for n in nums if nums.count(n) > 1})
        missing = sorted(set(expected) - set(nums))
        detail = []
        if dupes:
            detail.append(f"duplicates {dupes}")
        if missing:
            detail.append(f"gaps at {missing[:10]}")
        issues.append(_issue("page_numbering", "error", f"Page numbering is not continuous ({'; '.join(detail) or 'out of order'}).",
                             "Renumber pages sequentially from 1.", fix="renumber"))
    if len(pages) % 2:
        notes.append(f"Document has {len(pages)} pages (odd); facing-page print layouts usually need an even count.")

    # ---- fonts reported by the InDesign bridge
    if ctx.bridge_fonts is None:
        notes.append("No InDesign bridge has reported its installed fonts; font availability was not verified.")
    else:
        installed = {_norm_font(f) for f in ctx.bridge_fonts}
        for name, st in styles.items():
            fam = _norm_font(st.get("font_family", ""))
            if fam and not any(i.startswith(fam) or fam.startswith(i) for i in installed if i):
                issues.append(_issue("font_substitution", "warning",
                                     f"Font '{st.get('font_family')}' (style {name}) is not installed on the InDesign bridge.",
                                     "Install the font on the InDesign machine or change the style's font family."))

    placeholders: list[tuple[int, str]] = []  # (page number, asset id) of demo images with no file
    for page in pages:
        ptype = page.get("page_type")
        frames = page.get("frames", [])
        # ---- unapproved content
        art = page.get("article_id")
        art_status = ctx.article_status.get(art) if art else None
        if not page.get("approved") or (art and art_status != "approved"):
            why = f"article is {art_status}" if art and art_status and art_status != "approved" else "page content is not approved"
            issues.append(_issue("unapproved_content", "error" if art else "warning",
                                 f"Page {page['page_number']}: {why}.",
                                 "Approve the article/page content before final export.", page=page, fix="approve_content"))
        caption_present = bool(page.get("caption")) or any(
            f.get("kind") == "text" and f.get("role") == "caption" and (f.get("content") or "").strip() for f in frames)
        for fr in frames:
            top, left, bottom, right = fr["bounds_pt"]
            fw, fh = right - left, bottom - top
            # ---- geometry
            if left < -bleed - 0.5 or top < -bleed - 0.5 or right > W + bleed + 0.5 or bottom > H + bleed + 0.5:
                issues.append(_issue("layout_overflow", "error",
                                     f"Frame '{fr.get('label') or fr['id']}' extends beyond the bleed area.",
                                     "Move or resize the frame inside the page + bleed.", page=page, element=fr["id"],
                                     fix="snap_to_margins"))
            if fr["kind"] == "text" and fr.get("role") not in DECORATIVE_TEXT and (fr.get("content") or "").strip():
                inside_left = m["inside"] if page["page_number"] % 2 == 1 else m["outside"]
                inside_right = m["outside"] if page["page_number"] % 2 == 1 else m["inside"]
                if (left < inside_left - 2 or right > W - inside_right + 2 or top < m["top"] - 2
                        or bottom > H - m["bottom"] + 2) and ptype not in ("cover", "advertisement", "full_page_image"):
                    issues.append(_issue("margin_violation", "warning",
                                         f"Text frame '{fr.get('label') or fr['id']}' crosses the page margins.",
                                         "Snap the frame to the margin guides.", page=page, element=fr["id"],
                                         fix="snap_to_margins"))
            # ---- text
            if fr["kind"] == "text":
                content = (fr.get("content") or "").strip()
                if not content:
                    if fr.get("role") not in DECORATIVE_TEXT:
                        issues.append(_issue("empty_frame", "warning",
                                             f"Text frame '{fr.get('label') or fr['id']}' is empty.",
                                             "Add copy or remove the frame.", page=page, element=fr["id"], fix="remove_frame"))
                    continue
                st = styles.get(fr.get("paragraph_style") or "")
                if st and fr.get("fit") != "shrink_to_fit" and fw > 4 and fh > 4:
                    cols = max(1, int(fr.get("columns") or 1))
                    gutter = float(fr.get("gutter_pt") or 0)
                    cw = (fw - (cols - 1) * gutter) / cols
                    need = measure_text_height(content, st, cw, bool(st.get("uppercase")))
                    have = fh * cols
                    if need > have * 1.02:
                        over = int(round(100 * (need - have) / need))
                        issues.append(_issue(
                            "overset_text", "error" if over >= 10 else "warning",
                            f"Approximate overset: '{fr.get('label') or fr['id']}' needs ~{need:.0f} pt of column depth but "
                            f"holds {have:.0f} pt (~{over}% of the text will not fit). Measured with fallback font "
                            f"{_safe_font(st.get('fallback_family'), 'Times-Roman')}; InDesign may differ.",
                            "Cut copy, continue the article on another page, or enlarge the frame.",
                            page=page, element=fr["id"], fix="fit_text"))
            # ---- images
            elif fr["kind"] == "image":
                img = fr.get("image")
                if not img or not img.get("asset_id"):
                    issues.append(_issue("missing_image", "error" if fr.get("role") in ("hero_image", "ad", "background") else "warning",
                                         f"Image frame '{fr.get('label') or fr['id']}' has no image assigned.",
                                         "Assign an image from the asset library.", page=page, element=fr["id"],
                                         fix="assign_image"))
                    continue
                aid = img["asset_id"]
                info = ctx.assets.get(aid)
                if info is not None and info.simulated and not info.exists:
                    placeholders.append((page["page_number"], aid))  # labelled demo data: aggregated below
                    if ptype in ARTICLE_PAGES and fr.get("role") in ("hero_image", "image") and not caption_present:
                        issues.append(_caption_issue(fr, page, W, H))
                    continue
                if aid not in asset_ids or info is None or not info.exists:
                    issues.append(_issue("broken_asset", "error",
                                         f"Image '{aid}' in frame '{fr.get('label') or fr['id']}' is missing from storage"
                                         + ("" if aid in asset_ids else " and from the contract's asset list") + ".",
                                         "Re-upload the image or assign a different one.", page=page, element=fr["id"],
                                         fix="assign_image"))
                    continue
                wpx = info.width_px or asset_ids[aid].get("width_px")
                hpx = info.height_px or asset_ids[aid].get("height_px")
                if wpx and hpx and fw > 0 and fh > 0:
                    scale = float(img.get("scale") or 1)
                    fitting = img.get("fitting", "fill_proportionally")
                    if fitting == "fit_proportionally":
                        pt_per_px = min(fw / wpx, fh / hpx) * scale
                    elif fitting == "center":
                        pt_per_px = scale * 72 / 300
                    else:
                        pt_per_px = max(fw / wpx, fh / hpx) * scale
                    ppi = 72.0 / pt_per_px if pt_per_px else 0
                    if ppi < 150:
                        issues.append(_issue("low_resolution", "error",
                                             f"Image '{aid}' prints at {ppi:.0f} ppi effective resolution (< 150).",
                                             "Use a higher-resolution original or make the frame smaller.",
                                             page=page, element=fr["id"], fix="assign_image"))
                    elif ppi < 200:
                        issues.append(_issue("low_resolution", "warning",
                                             f"Image '{aid}' prints at {ppi:.0f} ppi effective resolution (< 200).",
                                             "Prefer a higher-resolution original for print.", page=page, element=fr["id"]))
                if ptype in ARTICLE_PAGES and fr.get("role") in ("hero_image", "image") and not caption_present:
                    issues.append(_caption_issue(fr, page, W, H))
    if placeholders:
        n_pages = len({p for p, _ in placeholders})
        issues.append({"id": new_id("qc"), "code": "missing_image", "severity": "info",
                       "message": f"{len(placeholders)} placed images are demo placeholders "
                                  f"({len({a for _, a in placeholders})} distinct, on {n_pages} pages); they have no "
                                  "image files behind them.",
                       "recommendation": "Upload the real photographs and assign them before final export.",
                       "fix": "assign_image"})
    return issues, notes


def summarise(issues: list[dict]) -> dict[str, int]:
    out = {"error": 0, "warning": 0, "info": 0}
    for i in issues:
        out[i["severity"]] = out.get(i["severity"], 0) + 1
    out["total"] = len(issues)
    return out
