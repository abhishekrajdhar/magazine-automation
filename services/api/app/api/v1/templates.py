"""Templates: built-ins (IDs owned by the frontend, apps/web/src/lib/templates/specs.ts) + reference-derived."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from app.deps import DB, CurrentAuth, require
from app.models import DesignProfile, ReferencePage, Template
from app.schemas.reference import DeriveTemplateRequest
from app.schemas.reference import Template as TemplateSchema
from app.services import serializers as ser
from app.services.house_style import house_profile
from app.services.project_context import dump
from app.services.template_store import ensure_reference_template
from app.services.templates import builtin_templates, is_builtin, ref_template_id

from .common import PFRoute, get_reference

router = APIRouter(prefix="/templates", tags=["templates"], route_class=PFRoute)


@router.get("", response_model=list[TemplateSchema])
def list_templates(ctx: CurrentAuth, db: DB, design_profile_id: str | None = None) -> list[TemplateSchema]:
    """Built-ins are normalised against `designProfileId` (or the house style) on a recto page."""
    profile = house_profile()
    if design_profile_id:
        d = db.get(DesignProfile, design_profile_id)
        if d is None or d.org_id != ctx.org_id:
            raise HTTPException(status_code=404, detail="Design profile not found")
        profile = dump(ser.design_profile(d))
    out = [TemplateSchema.model_validate(t) for t in builtin_templates(profile)]
    rows = db.scalars(select(Template).where(Template.org_id == ctx.org_id).order_by(Template.created_at))
    out += [ser.template_row(t) for t in rows if not is_builtin(t.id)]
    return out


@router.post("/derive", response_model=TemplateSchema, status_code=201)
def derive(body: DeriveTemplateRequest, response: Response, db: DB, ctx=require("design.write")) -> TemplateSchema:
    ref = get_reference(db, ctx, body.reference_id)
    page = db.scalar(select(ReferencePage).where(ReferencePage.reference_id == ref.id,
                                                 ReferencePage.page_number == body.page_number))
    if page is None:
        raise HTTPException(status_code=404, detail="That page has not been analysed yet.")
    existed = db.get(Template, ref_template_id(ref.id, body.page_number)) is not None
    row = ensure_reference_template(db, ctx.org_id, ref.id, body.page_number)
    if row is None or not row.slots:
        raise HTTPException(status_code=422, detail="No layout blocks on this page to derive a template from.")
    if body.name:
        row.name = body.name
    db.commit()
    if existed:
        response.status_code = 200
    return ser.template_row(row)
