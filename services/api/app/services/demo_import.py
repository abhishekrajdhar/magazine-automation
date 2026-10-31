"""Import `packages/demo-data/workspace.json` (exported by the frontend seed) into the database.

Tolerant: every record is validated against the API schemas; invalid records are skipped with a
warning. Original IDs are kept so cross-references survive. Imported rows are marked as demo
(is_demo / simulated) and demo media has no files behind it.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models as m
from app.ids import new_id, utcnow
from app.schemas import editorial as se
from app.schemas import identity as si
from app.schemas import pages as sp
from app.schemas import project as sproj
from app.schemas import reference as sr

log = logging.getLogger("pressflow.demo_import")


def _dt(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None


class Importer:
    def __init__(self, db: Session, org: m.Organisation, owner: m.User):
        self.db = db
        self.org = org
        self.owner = owner
        self.counts: dict[str, int] = {}
        self.warnings: list[str] = []
        self.user_map: dict[str, str] = {}

    def _ok(self, key: str) -> None:
        self.counts[key] = self.counts.get(key, 0) + 1

    def _parse(self, schema: type[BaseModel], raw: Any, what: str):
        try:
            return schema.model_validate(raw)
        except ValidationError as e:
            rid = raw.get("id") if isinstance(raw, dict) else None
            self.warnings.append(f"skipped {what} {rid or ''}: {e.errors()[0].get('msg')} at {e.errors()[0].get('loc')}")
            return None

    def uid(self, user_id: str | None) -> str:
        return self.user_map.get(user_id or "", user_id or self.owner.id)

    # ------------------------------------------------------------------ identity
    def users(self, users: list, members: list) -> None:
        roles = {}
        for raw in members or []:
            mem = self._parse(si.Member, raw, "member")
            if mem:
                roles[mem.user_id] = mem
        # Members may reference people who are not in `users`: create those users from the member record.
        listed = {(r or {}).get("id") for r in users or [] if isinstance(r, dict)}
        all_users = list(users or []) + [{"id": mem.user_id, "name": mem.name, "email": mem.email, "title": mem.title,
                                          "initials": mem.initials} for mem in roles.values() if mem.user_id not in listed]
        for raw in all_users:
            u = self._parse(si.User, raw, "user")
            if not u:
                continue
            email = u.email.lower()
            if email == self.owner.email:
                self.user_map[u.id] = self.owner.id
                continue
            existing = self.db.scalar(select(m.User).where(m.User.email == email))
            if existing and existing.id != u.id:
                self.user_map[u.id] = existing.id
                row = existing
            else:
                row = self.db.merge(m.User(id=u.id, name=u.name, email=email, title=u.title, password_hash=None,
                                           is_demo=True))
                self.db.flush()  # user row must exist before its membership (FK)
            mem = roles.get(u.id)
            role = mem.role if mem else "viewer"
            if role == "owner":
                role = "admin"  # the seeded demo user is the owner
            ms = self.db.scalar(select(m.Membership).where(m.Membership.org_id == self.org.id,
                                                           m.Membership.user_id == row.id))
            if ms is None:
                self.db.add(m.Membership(id=new_id("mem"), org_id=self.org.id, user_id=row.id, role=role,
                                         status="invited", last_active_at=_dt(mem.last_active_at) if mem else None))
            self._ok("users")

    # ------------------------------------------------------------------ references
    def references(self, refs: list, pages: list, profiles: list, templates: list) -> None:
        for raw in refs or []:
            r = self._parse(sr.ReferenceMagazine, raw, "reference")
            if not r:
                continue
            self.db.merge(m.ReferenceMagazine(
                id=r.id, org_id=self.org.id, title=r.title, file_name=r.file_name, file_size_bytes=r.file_size_bytes,
                page_count=r.page_count, status=r.status, analysis_progress=r.analysis.progress,
                analysis_message=r.analysis.message, analyser="demo_seed", completed_at=_dt(r.analysis.completed_at),
                design_profile_id=r.design_profile_id, storage_key=None, indd_key=None, is_demo=True,
                created_at=_dt(r.uploaded_at) or utcnow()))
            self._ok("references")
        self.db.flush()
        from sqlalchemy import delete

        demo_refs = {r.get("id") for r in refs or [] if isinstance(r, dict)}
        for rid in demo_refs:
            ref = self.db.get(m.ReferenceMagazine, rid)
            if ref is not None and ref.is_demo:
                self.db.execute(delete(m.ReferencePage).where(m.ReferencePage.reference_id == rid))
        self.db.flush()
        for raw in pages or []:
            p = self._parse(sr.ReferencePage, raw, "referencePage")
            if not p:
                continue
            self.db.merge(m.ReferencePage(
                id=p.id, reference_id=p.reference_id, page_number=p.page_number, layout_type=p.layout_type,
                confidence=p.confidence, width_pt=p.width_pt, height_pt=p.height_pt,
                blocks=[b.model_dump(by_alias=True, exclude_none=True) for b in p.blocks],
                properties=p.properties.model_dump(by_alias=True), corrected=p.corrected))
            self._ok("referencePages")
        for raw in profiles or []:
            d = self._parse(sr.DesignProfile, raw, "designProfile")
            if not d:
                continue
            body = d.model_dump(by_alias=True, exclude_none=True)
            for k in ("id", "referenceId", "name", "status", "version", "overrides", "approvedAt", "approvedBy"):
                body.pop(k, None)
            self.db.merge(m.DesignProfile(
                id=d.id, org_id=self.org.id, reference_id=d.reference_id, name=d.name, status=d.status,
                version=d.version, profile=body, overrides=d.overrides, approved_at=_dt(d.approved_at),
                approved_by=self.uid(d.approved_by) if d.approved_by else None, is_demo=True))
            self._ok("designProfiles")
        from app.services.templates import is_builtin

        for raw in templates or []:
            t = self._parse(sr.Template, raw, "template")
            if not t:
                continue
            if is_builtin(t.id):  # built-ins are defined in code (same ids/geometry as the frontend specs)
                self._ok("templatesBuiltin")
                continue
            self.db.merge(m.Template(
                id=t.id, org_id=self.org.id, reference_id=None, name=t.name, page_type=t.page_type, source=t.source,
                reference_page_number=t.reference_page_number, description=t.description,
                slots=[s.model_dump(by_alias=True, exclude_none=True) for s in t.slots], columns=t.columns,
                is_demo=True))
            self._ok("templates")

    # ------------------------------------------------------------------ workspaces
    def workspace(self, raw: dict) -> None:
        from app.schemas.workspace import ProjectWorkspace

        try:
            ws = ProjectWorkspace.model_validate(raw)
        except ValidationError:
            ws = None
        if ws is None:  # tolerate partial workspaces: validate project, then each list item separately
            proj = self._parse(sproj.Project, (raw or {}).get("project"), "project")
            if not proj:
                return
            items = {k: raw.get(k) or [] for k in ("videos", "segments", "speakers", "sessions", "facts", "articles",
                                                     "assets", "pages", "exports")}
        else:
            proj = ws.project
            items = None
        db = self.db
        existing = db.get(m.Project, proj.id)
        if existing is not None and not existing.is_demo:
            self.warnings.append(f"skipped workspace {proj.id}: a non-demo project with this id exists")
            return
        if existing is not None:  # re-seed: replace the demo project's content wholesale (no stale rows)
            self._wipe_project(proj.id)
        db.merge(m.Project(
            id=proj.id, org_id=self.org.id, title=proj.title, event_name=proj.event_name, category=proj.category,
            issue_number=proj.issue_number, publication_date=proj.publication_date, publisher=proj.publisher,
            target_page_count=proj.target_page_count, description=proj.description, status=proj.status,
            reference_id=proj.reference_id, design_profile_id=proj.design_profile_id,
            config=proj.config.model_dump(by_alias=True), owner_id=self.uid(proj.owner_id), is_demo=True,
            created_at=_dt(proj.created_at) or utcnow()))
        db.flush()
        self._ok("projects")

        def each(key, schema):
            if ws is not None:
                return getattr(ws, key)
            return [x for x in (self._parse(schema, r, key[:-1]) for r in items[key]) if x]

        for v in each("videos", sproj.VideoSource):
            db.merge(m.VideoSource(
                id=v.id, org_id=self.org.id, project_id=proj.id, source_type=v.source_type, url=v.url,
                external_id=v.external_id, file_name=v.file_name, file_size_bytes=v.file_size_bytes, title=v.title,
                duration_sec=v.duration_sec, thumbnail_url=v.thumbnail_url, session_id=v.session_id,
                processing_state=v.processing.state, processing_progress=v.processing.progress,
                processing_message=v.processing.message, processing_updated_at=_dt(v.processing.updated_at),
                transcription_state=v.transcription.state, transcription_method=v.transcription.method,
                transcription_language=v.transcription.language, word_count=v.transcription.word_count,
                analysis_complete=v.processing.state == "ready", simulated=True, created_at=_dt(v.added_at) or utcnow()))
            self._ok("videos")
        db.flush()
        for i, s in enumerate(each("segments", sproj.TranscriptSegment)):
            db.merge(m.TranscriptSegment(id=s.id, project_id=proj.id, video_id=s.video_id, idx=i, start=s.start,
                                         end=s.end, speaker_id=s.speaker_id, speaker_label=s.speaker_label, text=s.text))
            self._ok("segments")
        for s in each("speakers", sproj.Speaker):
            db.merge(m.Speaker(id=s.id, project_id=proj.id, name=s.name, designation=s.designation,
                               organisation=s.organisation, verification=s.verification, video_ids=s.video_ids,
                               labels=[], bio=s.bio, portrait_asset_id=s.portrait_asset_id))
            self._ok("speakers")
        for s in each("sessions", sproj.EventSession):
            db.merge(m.EventSession(id=s.id, project_id=proj.id, video_id=s.video_id, title=s.title, kind=s.kind,
                                    speaker_ids=s.speaker_ids, summary=s.summary, topics=s.topics, status=s.status))
            self._ok("sessions")
        for f in each("facts", sproj.ExtractedFact):
            db.merge(m.ExtractedFact(id=f.id, project_id=proj.id, video_id=f.video_id, segment_id=f.segment_id,
                                     kind=f.kind, text=f.text, speaker_id=f.speaker_id, timestamp=f.timestamp,
                                     provenance=f.provenance, status=f.status, confidence=f.confidence))
            self._ok("facts")
        for a in each("articles", se.Article):
            db.merge(m.Article(
                id=a.id, project_id=proj.id, type=a.type, kicker=a.kicker, headline=a.headline,
                subheadline=a.subheadline, byline=a.byline, intro=a.intro,
                body=[b.model_dump(by_alias=True, exclude_none=True) for b in a.body], quote_fact_ids=a.quote_fact_ids,
                speaker_ids=a.speaker_ids, session_ids=a.session_ids, suggested_image_ids=a.suggested_image_ids,
                captions=a.captions, status=a.status, generated_by=a.generated_by,
                approved_by=self.uid(a.approved_by) if a.approved_by else None, approved_at=_dt(a.approved_at),
                review_note=a.review_note,
                variants=a.variants.model_dump(by_alias=True, exclude_none=True) if a.variants else None))
            self._ok("articles")
        for a in each("assets", sp.Asset):
            db.merge(m.Asset(id=a.id, org_id=self.org.id, project_id=proj.id, kind=a.kind, file_name=a.file_name,
                             width_px=a.width_px, height_px=a.height_px, session_id=a.session_id, video_id=a.video_id,
                             speaker_id=a.speaker_id, tags=a.tags, caption=a.caption, credit=a.credit, seed=a.seed,
                             storage_key=None, simulated=True))
            self._ok("assets")
        for pos, pg in enumerate(each("pages", sp.MagazinePage)):
            db.merge(m.MagazinePage(
                id=pg.id, project_id=proj.id, position=pos, page_type=pg.page_type, template_id=pg.template_id,
                label=pg.label, article_id=pg.article_id, article_part=pg.article_part,
                elements=[e.model_dump(by_alias=True, exclude_none=True) for e in pg.elements],
                editorial_status=pg.editorial_status, design_status=pg.design_status, locked=pg.locked, notes=pg.notes))
            self._ok("pages")
        for e in each("exports", sp.ExportRecord):
            db.merge(m.Export(
                id=e.id, org_id=self.org.id, project_id=proj.id, format=e.format,
                status=e.status, renderer=e.renderer,
                file_name=e.file_name, size_bytes=e.size_bytes, storage_key=None,
                message=(e.message or "") + " (demo record — no file stored)", created_by=self.uid(e.created_by),
                completed_at=_dt(e.completed_at), created_at=_dt(e.created_at) or utcnow()))
            self._ok("exports")

    def _wipe_project(self, project_id: str) -> None:
        from sqlalchemy import delete

        db = self.db
        vids = list(db.scalars(select(m.VideoSource.id).where(m.VideoSource.project_id == project_id)))
        if vids:
            db.execute(delete(m.TranscriptSegment).where(m.TranscriptSegment.video_id.in_(vids)))
        for model in (m.ExtractedFact, m.EventSession, m.Speaker, m.Article, m.MagazinePage, m.Asset, m.VideoSource,
                      m.Export):
            db.execute(delete(model).where(model.project_id == project_id))
        db.flush()
        self._ok("projectsReplaced")

    def activity(self, items: list) -> None:
        for raw in items or []:
            a = self._parse(sp.ActivityItem, raw, "activity")
            if not a:
                continue
            self.db.merge(m.Activity(id=a.id, org_id=self.org.id, project_id=a.project_id, actor_id=self.uid(a.actor_id),
                                     verb=a.verb, target=a.target, kind=a.kind, is_demo=True,
                                     created_at=_dt(a.at) or utcnow()))
            self._ok("activity")


def import_workspace_file(db: Session, path: Path, org: m.Organisation, owner: m.User) -> Importer:
    data = json.loads(path.read_text())
    imp = Importer(db, org, owner)
    imp.users(data.get("users"), data.get("members"))
    db.flush()
    imp.references(data.get("references"), data.get("referencePages"), data.get("designProfiles"), data.get("templates"))
    db.flush()
    for ws in data.get("workspaces") or []:
        try:
            with db.begin_nested():
                imp.workspace(ws)
        except Exception as e:  # noqa: BLE001 - tolerate one bad workspace
            imp.warnings.append(f"skipped workspace: {type(e).__name__}: {e}")
    imp.activity(data.get("activity"))
    return imp
