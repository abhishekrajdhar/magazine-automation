"""Load a project's design profile, articles, assets and pages as API-shaped dicts."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ids import as_utc, utcnow
from app.models import Article, Asset, DesignProfile, IndesignBridge, MagazinePage, Project
from app.services import serializers as ser
from app.services.contract import build_contract
from app.services.house_style import house_profile
from app.services.preflight import AssetInfo, PreflightContext
from app.services.storage import get_storage


def dump(model) -> dict:
    return model.model_dump(by_alias=True, mode="json")


def profile_for_project(db: Session, project: Project) -> tuple[dict, str]:
    """Returns (profile dict, source) where source is 'approved' | 'draft' | 'house_style'."""
    if project.design_profile_id:
        d = db.get(DesignProfile, project.design_profile_id)
        if d is not None and d.org_id == project.org_id:
            return dump(ser.design_profile(d)), d.status
    return house_profile(), "house_style"


def articles_by_id(db: Session, project_id: str) -> dict[str, dict]:
    return {a.id: dump(ser.article(a)) for a in db.scalars(select(Article).where(Article.project_id == project_id))}


def assets_by_id(db: Session, project_id: str) -> dict[str, dict]:
    return {a.id: dump(ser.asset(a)) for a in db.scalars(select(Asset).where(Asset.project_id == project_id))}


def page_rows(db: Session, project_id: str) -> list[MagazinePage]:
    return list(db.scalars(select(MagazinePage).where(MagazinePage.project_id == project_id)
                           .order_by(MagazinePage.position)).all())


def pages_dicts(db: Session, project_id: str) -> list[dict]:
    return [{**dump(ser.page(p)), "position": p.position} for p in page_rows(db, project_id)]


def project_contract(db: Session, project: Project, markup_out: dict[str, str] | None = None) -> dict:
    """Layout contract built from the project's saved pages (dynamic folio/contents filled, markup -> plain)."""
    from app.models import Speaker

    profile, _ = profile_for_project(db, project)
    pages = pages_dicts(db, project.id)
    speakers = [dump(ser.speaker(s)) for s in db.scalars(select(Speaker).where(Speaker.project_id == project.id))]
    return build_contract(dump(ser.project(project)), profile, pages, articles_by_id(db, project.id),
                          assets_by_id(db, project.id), speakers=speakers, markup_out=markup_out)


def placeholder_asset_ids(db: Session, project_id: str) -> set[str]:
    """Demo/simulated assets have no file; the preview renderer draws a labelled placeholder for them."""
    return {a.id for a in db.scalars(select(Asset).where(Asset.project_id == project_id, Asset.simulated.is_(True)))}


def page_ids(db: Session, project_id: str) -> list[str]:
    return [p.id for p in page_rows(db, project_id)]


def online_bridges(db: Session) -> list[IndesignBridge]:
    cutoff = utcnow() - timedelta(seconds=get_settings().indesign_bridge_online_seconds)
    return [b for b in db.scalars(select(IndesignBridge)).all()
            if b.last_heartbeat_at is not None and as_utc(b.last_heartbeat_at) >= cutoff]


def preflight_context(db: Session, project: Project, contract: dict) -> PreflightContext:
    profile, source = profile_for_project(db, project)
    storage = get_storage()
    assets = {}
    rows = {a.id: a for a in db.scalars(select(Asset).where(Asset.project_id == project.id))}
    for a in contract.get("assets", []):
        row = rows.get(a["id"])
        exists = bool(row and row.storage_key and storage.exists(row.storage_key))
        assets[a["id"]] = AssetInfo(exists=exists, width_px=row.width_px if row else None,
                                    height_px=row.height_px if row else None, simulated=bool(row and row.simulated))
    status = {a.id: a.status for a in db.scalars(select(Article).where(Article.project_id == project.id))}
    bridges = [b for b in db.scalars(select(IndesignBridge)).all() if b.fonts]
    latest = max(bridges, key=lambda b: as_utc(b.last_heartbeat_at) or utcnow() - timedelta(days=3650), default=None)
    return PreflightContext(
        profile_page=(float(profile["page"]["widthPt"]), float(profile["page"]["heightPt"])),
        assets=assets, article_status=status, bridge_fonts=list(latest.fonts) if latest else None,
    )


def asset_resolver(db: Session, project_id: str):
    storage = get_storage()
    rows = {a.id: a.storage_key for a in db.scalars(select(Asset).where(Asset.project_id == project_id))}

    def resolve(asset_id: str) -> bytes | None:
        key = rows.get(asset_id)
        if not key or not storage.exists(key):
            return None
        return storage.get_bytes(key)

    return resolve
