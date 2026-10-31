"""Template lookup for API routes: built-ins (frontend IDs), DB rows, and on-the-fly `tpl_ref_<ref>_p<n>` derivation."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Asset, ReferenceMagazine, ReferencePage, Template
from app.services import serializers as ser
from app.services.templates import derive_template, is_builtin, parse_ref_template_id


def _dump(model) -> dict:
    return model.model_dump(by_alias=True, mode="json", exclude_none=True)


def ensure_reference_template(db: Session, org_id: str, reference_id: str, page_number: int,
                              refresh: bool = False) -> Template | None:
    """Return the stored template for a reference page, deriving + storing it if missing. None if not derivable.

    `refresh` re-derives the frames of an existing template from the page's current analysis (Reconstruct after a
    re-analysis), keeping its name."""
    from app.services.templates import ref_template_id

    tid = ref_template_id(reference_id, page_number)
    row = db.get(Template, tid)
    if row is not None and row.org_id != org_id:
        return None
    if row is not None and not refresh:
        return row
    ref = db.get(ReferenceMagazine, reference_id)
    if ref is None or ref.org_id != org_id:
        return None
    page = db.scalar(select(ReferencePage).where(ReferencePage.reference_id == ref.id,
                                                 ReferencePage.page_number == page_number))
    if page is None:
        return None
    t = derive_template(_dump(ser.reference_page(page, bool(ref.storage_key))), ref.title)
    if row is not None:
        row.page_type, row.description, row.slots, row.columns = t["pageType"], t["description"], t["slots"], t["columns"]
        db.flush()
        return row
    row = Template(id=t["id"], org_id=org_id, reference_id=ref.id, name=t["name"], page_type=t["pageType"],
                   source="reference", reference_page_number=page_number, description=t["description"],
                   slots=t["slots"], columns=t["columns"], is_demo=ref.is_demo)
    db.add(row)
    db.flush()
    return row


def template_exists(db: Session, org_id: str, template_id: str) -> bool:
    if is_builtin(template_id):
        return True
    row = db.get(Template, template_id)
    if row is not None:
        return row.org_id == org_id
    parsed = parse_ref_template_id(template_id)
    if parsed:
        return ensure_reference_template(db, org_id, parsed[0], parsed[1]) is not None
    return False


def reference_templates(db: Session, org_id: str) -> dict[str, dict]:
    """Non-built-in templates of the organisation as API dicts (normalised slots)."""
    out = {}
    for t in db.scalars(select(Template).where(Template.org_id == org_id)):
        if is_builtin(t.id):
            continue
        out[t.id] = _dump(ser.template_row(t))
    return out


def ensure_reference_logos(db: Session, org_id: str, project_id: str, template: dict) -> list[Asset]:
    """Logo frames of a reconstructed reference page are filled with artwork cropped from that page at 300 ppi.

    Each crop is stored once per project as a `logo` asset tagged with the frame's `assetTag`; returns the project's
    logo assets for the template (existing and new)."""
    import hashlib

    import pymupdf

    from app.ids import new_id
    from app.services.storage import get_storage

    tagged = [s for s in template.get("slots") or [] if s.get("assetTag")]
    parsed = parse_ref_template_id(template.get("id") or "")
    if not tagged or parsed is None:
        return []
    ref = db.get(ReferenceMagazine, parsed[0])
    if ref is None or ref.org_id != org_id or not ref.storage_key:
        return []
    have = {t: a for a in db.scalars(select(Asset).where(Asset.project_id == project_id, Asset.kind == "logo"))
            for t in (a.tags or [])}
    missing = [s for s in tagged if s["assetTag"] not in have]
    if missing:
        doc = pymupdf.open(stream=get_storage().get_bytes(ref.storage_key), filetype="pdf")
        try:
            page = doc[parsed[1] - 1]
            W, H = page.rect.width, page.rect.height
            for s in missing:
                clip = pymupdf.Rect(s["x"] * W, s["y"] * H, (s["x"] + s["w"]) * W, (s["y"] + s["h"]) * H)
                png = page.get_pixmap(matrix=pymupdf.Matrix(300 / 72, 300 / 72), clip=clip, alpha=False).tobytes("png")
                aid = new_id("ast")
                key = f"assets/{org_id}/{project_id}/{aid}.png"
                get_storage().put_bytes(key, png, "image/png")
                pw, ph = round(clip.width * 300 / 72), round(clip.height * 300 / 72)
                a = Asset(id=aid, org_id=org_id, project_id=project_id, kind="logo", file_name=f"logo-{s['id']}.png",
                          content_type="image/png", size_bytes=len(png), width_px=pw, height_px=ph,
                          tags=[s["assetTag"]], caption=(s.get("name") or "Logo").removeprefix("Logo: "),
                          credit=f"From {ref.title}, p.{parsed[1]}",
                          seed=int(hashlib.sha256(aid.encode()).hexdigest()[:8], 16), storage_key=key, simulated=False)
                db.add(a)
                have[s["assetTag"]] = a
        finally:
            doc.close()
        db.flush()
    return [have[s["assetTag"]] for s in tagged]
