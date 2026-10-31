"""Templates: built-in specs (IDs owned by the frontend), slot resolution, reference-page derivation.

Ports of `apps/web/src/lib/templates/{geometry,compose(resolveSlots),derive}.ts` so the planner, contract builder
and the frontend place frames identically.
"""

from __future__ import annotations

import re
from typing import Any

from app.services.template_specs import BUILTIN_IDS, SPEC_BY_ID, TEMPLATE_SPECS

IMAGE_ROLES = ("hero_image", "image", "portrait")
REF_TEMPLATE_RE = re.compile(r"^tpl_ref_(.+)_p(\d+)$")
PAGE_TYPE_LABEL = {
    "cover": "Cover", "editorial": "Editorial", "toc": "Contents", "interview": "Interview",
    "event_report": "Event report", "two_column_article": "Article", "full_page_image": "Full-page image",
    "photo_gallery": "Gallery", "advertisement": "Advertisement", "infographic": "Infographic",
    "speaker_profile": "Speaker profiles",
}

# Planner defaults (frontend IDs).
DEFAULT_TEMPLATE_FOR = {
    "cover": "tpl_cover_fullbleed",
    "advertisement": "tpl_ad_full",
    "toc": "tpl_toc_classic",
    "editorial": "tpl_editorial_portrait",
    "event_report": "tpl_report_hero",
    "two_column_article": "tpl_feature_opener",
    "interview": "tpl_interview_opener",
    "photo_gallery": "tpl_gallery_grid",
    "speaker_profile": "tpl_speakers_grid",
    "infographic": "tpl_infographic_stats",
    "full_page_image": "tpl_full_image",
}


def page_type_label(t: str) -> str:
    return PAGE_TYPE_LABEL.get(t, t)


def ref_template_id(reference_id: str, page_number: int) -> str:
    return f"tpl_ref_{reference_id}_p{page_number}"


def parse_ref_template_id(template_id: str) -> tuple[str, int] | None:
    m = REF_TEMPLATE_RE.match(template_id or "")
    return (m.group(1), int(m.group(2))) if m else None


def is_builtin(template_id: str) -> bool:
    return template_id in SPEC_BY_ID


# ---------------------------------------------------------------- geometry (geometry.ts)

def live_area(profile: dict, page_number: int) -> dict:
    m = profile["margins"]
    recto = page_number % 2 == 1
    left = float(m["inside"] if recto else m["outside"])
    right = float(m["outside"] if recto else m["inside"])
    W, H = float(profile["page"]["widthPt"]), float(profile["page"]["heightPt"])
    return {"x": left, "y": float(m["top"]), "w": W - left - right, "h": H - float(m["top"]) - float(m["bottom"]),
            "recto": recto}


def _column_grid(profile: dict, la: dict) -> tuple[list[float], list[float]]:
    n = max(1, int(profile["grid"]["columns"]))
    g = float(profile["grid"]["gutterPt"])
    cw = (la["w"] - g * (n - 1)) / n
    starts = [la["x"] + i * (cw + g) for i in range(n)]
    return starts, [x + cw for x in starts]


def _nearest(values: list[float], target: float) -> int:
    best = 0
    for i in range(1, len(values)):
        if abs(values[i] - target) < abs(values[best] - target):
            best = i
    return best


def snap_to_columns(profile: dict, la: dict, fx: float, fw: float) -> tuple[float, float, int]:
    starts, ends = _column_grid(profile, la)
    si = _nearest(starts, la["x"] + fx * la["w"])
    ei = _nearest(ends, la["x"] + (fx + fw) * la["w"])
    ei = max(ei, si)
    return starts[si], ends[ei] - starts[si], ei - si + 1


# ---------------------------------------------------------------- slot resolution (compose.ts resolveSlots)

def resolve_slots(template: dict, profile: dict, page_number: int) -> list[dict[str, Any]]:
    """Slots in points for a spec (built-in) or a Template row (reference-derived, normalised 0..1)."""
    W, H = float(profile["page"]["widthPt"]), float(profile["page"]["heightPt"])
    spec = SPEC_BY_ID.get(template.get("id") or "")
    if spec is None and template.get("slots") and "fx" in template["slots"][0]:
        spec = template
    if spec is None:  # reference-derived Template row: normalised slots, indices counted per role
        counters: dict[str, int] = {}
        out = []
        for sl in template.get("slots") or []:
            key = "image" if sl["role"] in IMAGE_ROLES else sl["role"]
            idx = counters.get(key, 0)
            counters[key] = idx + 1
            out.append({"id": sl["id"], "role": sl["role"], "x": sl["x"] * W, "y": sl["y"] * H, "w": sl["w"] * W,
                        "h": sl["h"] * H, "columns": int(sl.get("columns") or 1), "index": idx})
        return out
    bleed = float(profile["page"].get("bleedPt", 9))
    recto = page_number % 2 == 1
    # Mirrored templates are laid out as their right-hand version, then flipped, so the inside/outside
    # margins land on the correct sides (compose.ts resolveSlots).
    la = live_area(profile, page_number + 1) if spec.get("mirror") and not recto else live_area(profile, page_number)
    out = []
    for sl in spec["slots"]:
        cols_spec = sl.get("columns")
        columns = cols_spec if isinstance(cols_spec, int) else 1
        if sl.get("snap") is False:
            x, w = la["x"] + sl["fx"] * la["w"], sl["fw"] * la["w"]
        else:
            x, w, n = snap_to_columns(profile, la, sl["fx"], sl["fw"])
            if cols_spec == "auto":
                columns = n
        y, h = la["y"] + sl["fy"] * la["h"], sl["fh"] * la["h"]
        b = sl.get("bleed") or {}
        if b.get("top"):
            h += y + bleed
            y = -bleed
        if b.get("bottom"):
            h = H + bleed - y
        if b.get("left"):
            w += x + bleed
            x = -bleed
        if b.get("right"):
            w = W + bleed - x
        if spec.get("mirror") and not recto:
            x = W - (x + w)
        rest = {k: v for k, v in sl.items() if k not in ("fx", "fy", "fw", "fh", "snap", "bleed", "columns")}
        out.append({**rest, "x": x, "y": y, "w": w, "h": h, "columns": columns})
    return out


def builtin_templates(profile: dict) -> list[dict]:
    """Built-ins as `Template` rows normalised against `profile` on a recto page (as the frontend exports them)."""
    W, H = float(profile["page"]["widthPt"]), float(profile["page"]["heightPt"])
    out = []
    for spec in TEMPLATE_SPECS:
        slots = resolve_slots(spec, profile, 1)
        out.append({
            "id": spec["id"], "name": spec["name"], "pageType": spec["pageType"], "source": "builtin",
            "description": spec["description"], "columns": max([1] + [s["columns"] for s in slots]),
            "slots": [{"id": s["id"], "role": s["role"], "x": round(s["x"] / W, 4), "y": round(s["y"] / H, 4),
                       "w": round(s["w"] / W, 4), "h": round(s["h"] / H, 4),
                       **({"columns": s["columns"]} if s["columns"] > 1 else {})} for s in slots],
        })
    return out


# ---------------------------------------------------------------- reference derivation (derive.ts)

def _role_for(block: dict, largest_id: str | None) -> str | None:
    kind, role = block.get("kind"), block.get("role")
    if kind == "image":
        return "hero_image" if block.get("id") == largest_id else "image"
    if kind == "rule":
        return "rule"
    if kind == "shape":
        return "background"
    if role == "folio":
        return None  # folios are generated from the profile
    if role == "question":
        return "body"
    if role in ("headline", "kicker", "deck", "byline", "body", "subhead", "pullquote", "caption", "stat"):
        return role
    return "body"


def derive_template(page: dict, reference_title: str) -> dict:
    """`page` is a ReferencePage in API (camelCase) shape."""
    blocks = page.get("blocks") or []
    images = [b for b in blocks if b.get("kind") == "image"]
    largest = max(images, key=lambda b: b["w"] * b["h"], default=None)
    bodies = [b for b in blocks if b.get("kind") == "text" and b.get("role") in ("body", "question")]
    merged: list[dict] = []
    for b in sorted(bodies, key=lambda b: (b["y"], b["x"])):
        row = next((m for m in merged if abs(m["y"] - b["y"]) < 0.01 and abs(m["h"] - b["h"]) < 0.02
                    and b["x"] >= m["x"] + m["w"] - 0.005 and b["x"] - (m["x"] + m["w"]) < 0.06), None)
        if row:
            row["w"] = b["x"] + b["w"] - row["x"]
            row["columns"] += 1
        else:
            merged.append({"x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"], "columns": 1})
    slots: list[dict] = []
    n = 0
    for b in blocks:
        if b.get("kind") == "text" and b.get("role") in ("body", "question"):
            continue
        role = _role_for(b, largest.get("id") if largest else None)
        if not role:
            continue
        n += 1
        slots.append({"id": f"s{n}", "role": role, "x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"]})
    for m in merged:
        n += 1
        slots.append({"id": f"s{n}", "role": "body", "x": m["x"], "y": m["y"], "w": m["w"], "h": m["h"],
                      "columns": m["columns"]})
    max_cols = max([1] + [m["columns"] for m in merged])
    desc = f"Reconstructed from page {page['pageNumber']} of {reference_title}: {len(slots)} frames"
    if any(m["columns"] > 1 for m in merged):
        desc += f", {max_cols}-column text"
    return {
        "id": ref_template_id(page["referenceId"], page["pageNumber"]),
        "name": f"{page_type_label(page['layoutType'])} — reference p.{page['pageNumber']}",
        "pageType": page["layoutType"], "source": "reference", "referencePageNumber": page["pageNumber"],
        "description": desc + ".", "slots": slots, "columns": max_cols,
    }


__all__ = ["BUILTIN_IDS", "DEFAULT_TEMPLATE_FOR", "builtin_templates", "derive_template", "is_builtin",
           "parse_ref_template_id", "ref_template_id", "resolve_slots", "SPEC_BY_ID"]
