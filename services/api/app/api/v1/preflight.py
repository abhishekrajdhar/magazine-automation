"""Preflight a layout contract (body) or the project's current pages (no body)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from app.deps import DB, CurrentAuth
from app.ids import iso, utcnow
from app.schemas.pages import PreflightResponse
from app.services.contract import validate_contract
from app.services.preflight import run_preflight, summarise
from app.services.project_context import page_ids, preflight_context, project_contract

from .common import PFRoute, get_project

router = APIRouter(tags=["preflight"], route_class=PFRoute)


@router.post("/projects/{project_id}/preflight", response_model=PreflightResponse)
def preflight(project_id: str, ctx: CurrentAuth, db: DB,
              contract: dict[str, Any] | None = Body(default=None)) -> PreflightResponse:
    p = get_project(db, ctx, project_id)
    if contract is None or contract == {}:
        contract = project_contract(db, p)
    errors = validate_contract(contract)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Layout contract failed schema validation.",
                                                     "errors": errors})
    if contract.get("project_id") and contract["project_id"] != p.id:
        raise HTTPException(status_code=422, detail="contract.project_id does not match this project")
    ids = page_ids(db, p.id)
    for page in contract["pages"]:
        n = page["page_number"]
        if 1 <= n <= len(ids):
            page["_page_id"] = ids[n - 1]
    issues, notes = run_preflight(contract, preflight_context(db, p, contract))
    return PreflightResponse(checked_at=iso(utcnow()), issues=issues, summary=summarise(issues), notes=notes)
