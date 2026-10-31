from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.config import get_settings
from app.deps import DB
from app.ids import iso, utcnow

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: DB) -> dict:
    s = get_settings()
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "service": "pressflow-api", "version": "0.1.0", "env": s.env,
            "database": "ok" if db_ok else "error", "time": iso(utcnow())}
