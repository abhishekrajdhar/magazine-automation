"""Deployment check: `python -m app.checks`.

Prints what would stop or weaken a production deployment with the current environment, checks that the database
answers and is migrated to the latest revision, and that storage is writable. Exits 1 on any error.
"""

from __future__ import annotations

import sys

from app.config import API_ROOT, get_settings


def run() -> int:
    s = get_settings()
    errors, warnings = s.production_issues()
    try:
        from alembic.config import Config
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory

        from app.db import get_engine

        head = ScriptDirectory.from_config(Config(str(API_ROOT / "alembic.ini"))).get_current_head()
        with get_engine().connect() as conn:
            current = MigrationContext.configure(conn).get_current_revision()
        if current != head:
            errors.append(f"Database is at revision {current or 'none'}, the code expects {head}: run `alembic upgrade head`.")
        else:
            print(f"ok       database reachable and migrated ({head})")
    except Exception as e:  # noqa: BLE001 - report any connection or driver failure
        errors.append(f"Database check failed: {type(e).__name__}: {str(e).splitlines()[0][:200]}")
    try:
        from app.services.storage import get_storage

        ok, detail = get_storage().check()
        if ok:
            print(f"ok       storage: {detail}")
        else:
            errors.append(f"Storage check failed: {detail}")
    except Exception as e:  # noqa: BLE001
        errors.append(f"Storage check failed: {type(e).__name__}: {str(e)[:200]}")
    for w in warnings:
        print(f"warning  {w}")
    for e in errors:
        print(f"ERROR    {e}")
    print(f"\n{len(errors)} error(s), {len(warnings)} warning(s) for ENV={s.env}.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(run())
