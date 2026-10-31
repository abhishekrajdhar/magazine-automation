from __future__ import annotations

from sqlalchemy.orm import Session

from app.ids import new_id
from app.models import Activity, Approval


def record_activity(
    db: Session, *, org_id: str, actor_id: str, verb: str, target: str, kind: str, project_id: str | None = None
) -> None:
    db.add(Activity(id=new_id("act"), org_id=org_id, project_id=project_id, actor_id=actor_id, verb=verb,
                    target=target[:400], kind=kind))


def record_approval(
    db: Session,
    *,
    org_id: str,
    actor_id: str,
    target_kind: str,
    target_id: str,
    action: str,
    project_id: str | None = None,
    note: str | None = None,
    version: int | None = None,
) -> None:
    db.add(Approval(id=new_id("apr"), org_id=org_id, project_id=project_id, target_kind=target_kind,
                    target_id=target_id, action=action, actor_id=actor_id, note=note, version=version))
