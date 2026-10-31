"""Template lookup for API routes: built-ins (frontend IDs), DB rows, and on-the-fly `tpl_ref_<ref>_p<n>` derivation."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ReferenceMagazine, ReferencePage, Template
from app.services import serializers as ser
from app.services.templates import derive_template, is_builtin, parse_ref_template_id


def _dump(model) -> dict:
    return model.model_dump(by_alias=True, mode="json", exclude_none=True)


def ensure_reference_template(db: Session, org_id: str, reference_id: str, page_number: int) -> Template | None:
    """Return the stored template for a reference page, deriving + storing it if missing. None if not derivable."""
    from app.services.templates import ref_template_id

    tid = ref_template_id(reference_id, page_number)
    row = db.get(Template, tid)
    if row is not None:
        return row if row.org_id == org_id else None
    ref = db.get(ReferenceMagazine, reference_id)
    if ref is None or ref.org_id != org_id:
        return None
    page = db.scalar(select(ReferencePage).where(ReferencePage.reference_id == ref.id,
                                                 ReferencePage.page_number == page_number))
    if page is None:
        return None
    t = derive_template(_dump(ser.reference_page(page, bool(ref.storage_key))), ref.title)
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
