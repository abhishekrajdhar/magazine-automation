"""Elets CMS import: browse the public WordPress sites and bring published copy in as article drafts."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings
from app.deps import DB, CurrentAuth, require
from app.ids import new_id
from app.models import Article, Asset
from app.schemas.editorial import CmsImportRequest, CmsImportResult, CmsKind, CmsPost, CmsSources
from app.services import cms_import as cms
from app.services import serializers as ser
from app.services.activity import record_activity
from app.services.storage import get_storage

from .common import PFRoute, get_project, safe_filename

router = APIRouter(tags=["cms"], route_class=PFRoute)


@router.get("/cms/sources", response_model=CmsSources)
def sources(ctx: CurrentAuth) -> CmsSources:
    return CmsSources.model_validate({
        "sites": [{"key": k, "name": name, "url": url} for k, (name, url) in cms.SITES.items()],
        "kinds": [{"key": k, "label": v["label"], "articleType": v["type"]} for k, v in cms.KINDS.items()],
    })


@router.get("/cms/posts", response_model=list[CmsPost])
def posts(ctx: CurrentAuth, site: str, kind: CmsKind, search: str | None = Query(None, max_length=120),
          limit: int = Query(12, ge=1, le=30)) -> list[CmsPost]:
    try:
        return [CmsPost.model_validate(p) for p in cms.list_posts(site, kind, search, limit)]
    except cms.CmsError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e


@router.post("/projects/{project_id}/articles/import-cms", response_model=CmsImportResult, status_code=201)
def import_posts(project_id: str, body: CmsImportRequest, db: DB, ctx=require("content.write")) -> CmsImportResult:
    """Each post becomes a draft article with its pictures as project assets. Drafts carry no transcript sources,
    so they need the same review and approval as any other copy before they can be published."""
    p = get_project(db, ctx, project_id)
    s = get_settings()
    storage = get_storage()
    articles: list[Article] = []
    skipped: list[dict] = []
    images = 0
    for post_id in dict.fromkeys(body.post_ids):
        try:
            draft = cms.draft_from_post(cms.fetch_post(body.site, post_id), body.site, body.kind)
        except cms.CmsError as e:
            if e.status == 422:
                raise HTTPException(status_code=422, detail=str(e)) from e
            skipped.append({"postId": post_id, "reason": str(e)})
            continue
        if not draft["headline"] or not draft["body"]:
            skipped.append({"postId": post_id, "reason": "The post has no headline or no body copy."})
            continue
        image_ids: list[str] = []
        captions: dict[str, str] = {}
        for im in draft["images"] if body.include_images else []:
            got = cms.download_image(im["url"], s.max_asset_upload_mb * 1024 * 1024)
            if got is None:
                continue
            data, w, h, ext, ctype = got
            aid = new_id("ast")
            key = f"assets/{ctx.org_id}/{p.id}/{aid}{ext}"
            storage.put_bytes(key, data, ctype)
            db.add(Asset(id=aid, org_id=ctx.org_id, project_id=p.id, kind="photo",
                         file_name=safe_filename(im["url"].rsplit("/", 1)[-1], f"image{ext}"), content_type=ctype,
                         size_bytes=len(data), width_px=w, height_px=h, tags=["cms-import", body.site],
                         caption=im["caption"] or None, credit="Elets Technomedia",
                         seed=int(hashlib.sha256(aid.encode()).hexdigest()[:8], 16), storage_key=key, simulated=False))
            image_ids.append(aid)
            if im["caption"]:
                captions[aid] = im["caption"]
            images += 1
        a = Article(id=new_id("art"), project_id=p.id, type=draft["type"], kicker=draft["kicker"],
                    headline=draft["headline"], subheadline=draft["subheadline"], byline=draft["byline"],
                    intro=draft["intro"], body=draft["body"], quote_fact_ids=[], speaker_ids=[], session_ids=[],
                    suggested_image_ids=image_ids, captions=captions, status="draft", generated_by="human",
                    review_note=f"Imported from the Elets CMS ({draft['date']}): {draft['source_url']}")
        db.add(a)
        articles.append(a)
    if articles:
        record_activity(db, org_id=ctx.org_id, actor_id=ctx.user_id,
                        verb=f"imported {len(articles)} article(s) from the Elets CMS", target=p.title, kind="article",
                        project_id=p.id)
    db.commit()
    return CmsImportResult.model_validate({"articles": [ser.article(a) for a in articles], "imagesImported": images,
                                           "skipped": skipped})
