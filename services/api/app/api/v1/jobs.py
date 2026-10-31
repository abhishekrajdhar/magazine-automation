from __future__ import annotations

from fastapi import APIRouter

from app.deps import DB, CurrentAuth, not_found
from app.models import Job
from app.schemas.pages import Job as JobSchema
from app.services import serializers as ser

from .common import PFRoute

router = APIRouter(prefix="/jobs", tags=["jobs"], route_class=PFRoute)


@router.get("/{job_id}", response_model=JobSchema)
def get_job(job_id: str, ctx: CurrentAuth, db: DB) -> JobSchema:
    j = db.get(Job, job_id)
    if j is None or j.org_id != ctx.org_id:
        raise not_found("Job")
    return ser.job(j)
