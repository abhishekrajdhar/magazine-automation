"""Articles: generation (LLM job), CRUD, assist (LLM), deterministic verification, approval workflow."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.deps import DB, CurrentAuth, require
from app.ids import new_id, utcnow
from app.models import Article, EventSession, ExtractedFact, MagazinePage, Speaker
from app.schemas.editorial import (
    Article as ArticleSchema,
    ArticleCreate,
    ArticleUpdate,
    AssistRequest,
    AssistResponse,
    GenerateArticlesRequest,
    RejectRequest,
    VerificationResult,
)
from app.schemas.pages import JobRef
from app.services import editorial as ed
from app.services import serializers as ser
from app.services.activity import record_activity, record_approval
from app.services.jobs.queue import enqueue
from app.services.llm import LLMError, LLMNotConfigured, require_llm

from .common import PFRoute, get_article, get_project

router = APIRouter(tags=["editorial"], route_class=PFRoute)
CONTENT_FIELDS = {"kicker", "headline", "subheadline", "byline", "intro", "body"}


@router.post("/projects/{project_id}/articles/generate", response_model=JobRef, status_code=202)
def generate(project_id: str, body: GenerateArticlesRequest, db: DB, ctx=require("content.write")) -> JobRef:
    p = get_project(db, ctx, project_id)
    require_llm()  # 503 with a helpful message when no provider is configured
    if body.session_ids:
        found = {s.id for s in db.scalars(select(EventSession).where(EventSession.project_id == p.id,
                                                                     EventSession.id.in_(body.session_ids)))}
        missing = [s for s in body.session_ids if s not in found]
        if missing:
            raise HTTPException(status_code=422, detail=f"Unknown session ids: {missing}")
    approved = db.scalar(select(ExtractedFact.id).where(ExtractedFact.project_id == p.id,
                                                        ExtractedFact.status == "approved").limit(1))
    if approved is None:
        raise HTTPException(status_code=409, detail="No approved facts yet. Review and approve extracted facts first; "
                                                    "articles are generated only from approved material.")
    job = enqueue(db, "article_generation", {"projectId": p.id, "types": list(body.types),
                                             "sessionIds": list(body.session_ids), "userId": ctx.user_id},
                  org_id=ctx.org_id, result_ref=p.id)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb=f"requested {len(body.types)} article(s)",
                    target=p.title, kind="article", project_id=p.id)
    db.commit()
    return JobRef(job_id=job.id, job=ser.job(job))


@router.get("/projects/{project_id}/articles", response_model=list[ArticleSchema])
def list_articles(project_id: str, ctx: CurrentAuth, db: DB) -> list[ArticleSchema]:
    p = get_project(db, ctx, project_id)
    return [ser.article(a) for a in db.scalars(select(Article).where(Article.project_id == p.id).order_by(Article.created_at))]


@router.post("/projects/{project_id}/articles", response_model=ArticleSchema, status_code=201)
def create_article(project_id: str, body: ArticleCreate, db: DB, ctx=require("content.write")) -> ArticleSchema:
    p = get_project(db, ctx, project_id)
    a = Article(id=new_id("art"), project_id=p.id, type=body.type, kicker=body.kicker, headline=body.headline,
                subheadline=body.subheadline, byline=body.byline, intro=body.intro,
                body=[b.model_dump(by_alias=True, exclude_none=True) for b in body.body], quote_fact_ids=[],
                speaker_ids=body.speaker_ids, session_ids=body.session_ids, suggested_image_ids=[], captions={},
                status="draft", generated_by="human")
    db.add(a)
    db.commit()
    return ser.article(a)


@router.get("/articles/{article_id}", response_model=ArticleSchema)
def get_article_route(article_id: str, ctx: CurrentAuth, db: DB) -> ArticleSchema:
    return ser.article(get_article(db, ctx, article_id))


@router.patch("/articles/{article_id}", response_model=ArticleSchema)
def update_article(article_id: str, body: ArticleUpdate, db: DB, ctx=require("content.write")) -> ArticleSchema:
    a = get_article(db, ctx, article_id)
    data = body.model_dump(exclude_unset=True, by_alias=False)
    if "speaker_ids" in data:
        valid = {s.id for s in db.scalars(select(Speaker).where(Speaker.project_id == a.project_id))}
        if any(x not in valid for x in data["speaker_ids"] or []):
            raise HTTPException(status_code=422, detail="speakerIds must belong to this project")
    for k, v in data.items():
        if k == "body":
            a.body = [b.model_dump(by_alias=True, exclude_none=True) for b in body.body or []]
        else:
            setattr(a, k, v)
    if a.status == "approved" and CONTENT_FIELDS & data.keys():
        # editing approved copy revokes approval; it must be re-approved before it can be published
        a.status = "in_review"
        a.approved_at = None
        a.approved_by = None
        record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="article", target_id=a.id,
                        action="revoked", project_id=a.project_id, note="content edited after approval")
        for pg in db.scalars(select(MagazinePage).where(MagazinePage.article_id == a.id)):
            pg.editorial_status = "pending"
    if a.generated_by == "llm" and CONTENT_FIELDS & data.keys():
        pass  # provenance of LLM drafts is kept; humans can still edit
    db.commit()
    return ser.article(a)


@router.post("/articles/{article_id}/assist", response_model=AssistResponse)
def assist(article_id: str, body: AssistRequest, db: DB, ctx=require("content.write")) -> AssistResponse:
    a = get_article(db, ctx, article_id)
    llm = require_llm()
    if body.action == "change_tone" and not body.tone:
        raise HTTPException(status_code=422, detail="tone is required for change_tone")
    try:
        suggestions = ed.assist(db, llm, a, body.action, body.block_id, body.tone)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except LLMNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except LLMError as e:
        raise HTTPException(status_code=502, detail=f"The AI provider failed: {e}") from e
    db.commit()
    return AssistResponse(action=body.action, block_id=body.block_id, suggestions=suggestions, provider=llm.name,
                          model=llm.model)


@router.post("/articles/{article_id}/verify", response_model=VerificationResult)
def verify(article_id: str, ctx: CurrentAuth, db: DB) -> VerificationResult:
    a = get_article(db, ctx, article_id)
    result = ed.verify(db, a)
    db.commit()
    return VerificationResult.model_validate(result)


@router.post("/articles/{article_id}/approve", response_model=ArticleSchema)
def approve(article_id: str, db: DB, ctx=require("article.approve")) -> ArticleSchema:
    a = get_article(db, ctx, article_id)
    if not (a.headline or "").strip() or not (a.body or a.intro):
        raise HTTPException(status_code=409, detail="An article needs a headline and body copy before approval.")
    a.status = "approved"
    a.approved_by = ctx.user_id
    a.approved_at = utcnow()
    a.review_note = None
    for pg in db.scalars(select(MagazinePage).where(MagazinePage.article_id == a.id)):
        pg.editorial_status = "approved"
    record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="article", target_id=a.id,
                    action="approved", project_id=a.project_id)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="approved article", target=a.headline,
                    kind="article", project_id=a.project_id)
    db.commit()
    return ser.article(a)


@router.post("/articles/{article_id}/reject", response_model=ArticleSchema)
def reject(article_id: str, body: RejectRequest, db: DB, ctx=require("article.approve")) -> ArticleSchema:
    a = get_article(db, ctx, article_id)
    a.status = "rejected"
    a.review_note = body.note
    a.approved_at = None
    a.approved_by = None
    for pg in db.scalars(select(MagazinePage).where(MagazinePage.article_id == a.id)):
        pg.editorial_status = "pending"
    record_approval(db, org_id=ctx.org_id, actor_id=ctx.user_id, target_kind="article", target_id=a.id,
                    action="rejected", project_id=a.project_id, note=body.note)
    record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id, verb="rejected article", target=a.headline,
                    kind="article", project_id=a.project_id)
    db.commit()
    return ser.article(a)
