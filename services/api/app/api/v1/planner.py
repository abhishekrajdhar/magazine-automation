"""Page planner: ordered MagazinePage[] (bulk replace respecting locks) + heuristic recommendation."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, select

from app.deps import DB, CurrentAuth, require
from app.ids import new_id
from app.models import Article, ExtractedFact, MagazinePage, Speaker
from app.schemas.pages import MagazinePage as PageSchema
from app.schemas.pages import PagesPutRequest, PagesPutResponse, PlanRecommendRequest, PlanRecommendResponse
from app.services import planner
from app.services import serializers as ser
from app.services.activity import record_activity
from app.services.project_context import assets_by_id, dump, pages_dicts, profile_for_project
from app.services.template_store import reference_templates, template_exists

from .common import PFRoute, get_project

router = APIRouter(tags=["planner"], route_class=PFRoute)


@router.get("/projects/{project_id}/pages", response_model=list[PageSchema])
def get_pages(project_id: str, ctx: CurrentAuth, db: DB) -> list[PageSchema]:
    p = get_project(db, ctx, project_id)
    rows = db.scalars(select(MagazinePage).where(MagazinePage.project_id == p.id).order_by(MagazinePage.position))
    return [ser.page(r) for r in rows]


@router.put("/projects/{project_id}/pages", response_model=PagesPutResponse)
def put_pages(project_id: str, body: PagesPutRequest, db: DB, ctx=require("design.write")) -> PagesPutResponse:
    p = get_project(db, ctx, project_id)
    existing = {r.id: r for r in db.scalars(select(MagazinePage).where(MagazinePage.project_id == p.id))}
    locked = {i: r for i, r in existing.items() if r.locked}
    incoming_ids = [pg.id for pg in body.pages if pg.id]
    if len(set(incoming_ids)) != len(incoming_ids):
        raise HTTPException(status_code=422, detail="Duplicate page ids in request")
    missing_locked = [i for i in locked if i not in incoming_ids]
    if missing_locked:
        raise HTTPException(status_code=409, detail={"message": "Locked pages cannot be removed; unlock them first.",
                                                     "lockedPageIds": missing_locked})
    articles = set(db.scalars(select(Article.id).where(Article.project_id == p.id)))
    unknown = sorted({pg.template_id for pg in body.pages if not template_exists(db, ctx.org_id, pg.template_id)})
    if unknown:
        raise HTTPException(status_code=422, detail={
            "message": "Unknown templateId(s). Use a built-in id, a stored template, or tpl_ref_<referenceId>_p<page> "
                       "for an analysed page of one of your references.", "templateIds": unknown})
    approved_articles = {a.id for a in db.scalars(select(Article).where(Article.project_id == p.id,
                                                                        Article.status == "approved"))}
    preserved: list[str] = []
    db.execute(delete(MagazinePage).where(MagazinePage.project_id == p.id, MagazinePage.locked.is_(False)))
    for pos, pg in enumerate(body.pages):
        if pg.article_id and pg.article_id not in articles:
            raise HTTPException(status_code=422, detail=f"Page {pos + 1}: articleId does not belong to this project")
        if pg.id and pg.id in locked:
            row = locked[pg.id]
            row.position = pos  # locked pages keep their content but follow the new order
            preserved.append(row.id)
            continue
        status = pg.editorial_status
        if status == "approved" and pg.article_id and pg.article_id not in approved_articles:
            status = "pending"  # cannot mark a page approved when its article is not approved
        db.add(MagazinePage(
            id=pg.id if (pg.id and pg.id not in locked) else new_id("pg"), project_id=p.id, position=pos,
            page_type=pg.page_type, template_id=pg.template_id, label=pg.label, article_id=pg.article_id,
            article_part=pg.article_part, elements=[e.model_dump(by_alias=True, exclude_none=True) for e in pg.elements],
            editorial_status=status, design_status=pg.design_status, locked=pg.locked, notes=pg.notes))
    if p.status in ("setup", "ingesting", "analysing", "editorial"):
        p.status = "design"
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"saved {len(body.pages)} pages", target=p.title,
                    kind="page", project_id=p.id)
    db.commit()
    rows = db.scalars(select(MagazinePage).where(MagazinePage.project_id == p.id).order_by(MagazinePage.position))
    return PagesPutResponse(pages=[ser.page(r) for r in rows], preserved_locked=preserved)


@router.post("/projects/{project_id}/plan/recommend", response_model=PlanRecommendResponse)
def recommend(project_id: str, db: DB, body: PlanRecommendRequest | None = None,
              ctx=require("design.write")) -> PlanRecommendResponse:
    p = get_project(db, ctx, project_id)
    profile, source = profile_for_project(db, p)
    project = dump(ser.project(p))
    articles = [dump(ser.article(a)) for a in db.scalars(select(Article).where(Article.project_id == p.id)
                                                        .order_by(Article.created_at))]
    speakers = [dump(ser.speaker(s)) for s in db.scalars(select(Speaker).where(Speaker.project_id == p.id))]
    facts = [dump(ser.fact(f)) for f in db.scalars(select(ExtractedFact).where(ExtractedFact.project_id == p.id))]
    pages, rationale = planner.recommend(project, project["config"], articles, list(assets_by_id(db, p.id).values()),
                                         profile, pages_dicts(db, p.id), target=(body.target_page_count if body else None),
                                         speakers=speakers, facts=facts,
                                         reference_templates=reference_templates(db, ctx.org_id))
    if source == "house_style":
        rationale.insert(1, "No design profile linked to this project: using the PressFlow house style (A4, 3 columns).")
    elif source == "draft":
        rationale.insert(1, "Design profile is still a draft; approve it before final layout.")
    return PlanRecommendResponse(pages=[PageSchema.model_validate(pg) for pg in pages], rationale=rationale)
