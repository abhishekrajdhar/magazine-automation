"""Design profiles: read, patch (records overrides, bumps version), approve."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.deps import DB, CurrentAuth, require
from app.ids import utcnow
from app.models import ReferenceMagazine
from app.schemas.reference import DesignProfile as ProfileSchema
from app.schemas.reference import DesignProfilePatch
from app.services import serializers as ser
from app.services.activity import record_activity, record_approval
from app.services.profiles import merge_patch

from .common import PFRoute, get_profile

router = APIRouter(prefix="/design-profiles", tags=["design-profiles"], route_class=PFRoute)

PATCHABLE = ("page", "margins", "grid", "typography", "colors", "folio", "images", "pullQuote")


@router.get("/{profile_id}", response_model=ProfileSchema)
def get_profile_route(profile_id: str, ctx: CurrentAuth, db: DB) -> ProfileSchema:
    return ser.design_profile(get_profile(db, ctx, profile_id))


@router.patch("/{profile_id}", response_model=ProfileSchema)
def patch_profile(profile_id: str, body: DesignProfilePatch, db: DB, ctx=require("design.write")) -> ProfileSchema:
    d = get_profile(db, ctx, profile_id)
    raw = body.model_dump(by_alias=True, exclude_unset=True)
    patch = {k: v for k, v in raw.items() if k in PATCHABLE}
    merged, changed = merge_patch(d.profile or {}, patch)
    if body.name is not None and body.name != d.name:
        d.name = body.name
        changed.append("name")
    # validate the merged result against the DesignProfile schema before saving
    try:
        ProfileSchema.model_validate({**merged, "id": d.id, "referenceId": d.reference_id, "name": d.name,
                                      "status": d.status, "version": d.version, "overrides": list(d.overrides or [])})
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid design profile values: {e.errors()[:3]}") from e
    if not changed:
        return ser.design_profile(d)
    d.profile = merged
    d.overrides = sorted(set(d.overrides or []) | set(changed))
    d.version += 1
    if d.status == "approved":  # edits after approval require re-approval
        d.status = "draft"
        d.approved_at = None
        d.approved_by = None
        record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="profile", target_id=d.id,
                        action="revoked", note="edited after approval", version=d.version)
    db.commit()
    return ser.design_profile(d)


@router.post("/{profile_id}/approve", response_model=ProfileSchema)
def approve_profile(profile_id: str, db: DB, ctx=require("profile.approve")) -> ProfileSchema:
    d = get_profile(db, ctx, profile_id)
    d.status = "approved"
    d.approved_at = utcnow()
    d.approved_by = ctx.user_id
    ref = db.get(ReferenceMagazine, d.reference_id)
    if ref is not None and ref.status == "analysed":
        ref.status = "approved"
    record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="profile", target_id=d.id,
                    action="approved", version=d.version)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="approved design profile", target=d.name,
                    kind="reference")
    db.commit()
    return ser.design_profile(d)
