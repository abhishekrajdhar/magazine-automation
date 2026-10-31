"""Seed a demo organisation + demo user, and import packages/demo-data/workspace.json if present.

    uv run python scripts/seed.py

* Organisation "Elets Technomedia (Demo)", user demo@pressflow.local (owner).
* Password from DEMO_USER_PASSWORD; if unset, a random password is generated and written to
  services/api/var/demo-credentials.txt (mode 600). It is never printed.
* Idempotent: re-running updates rows in place.
"""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.config import REPO_ROOT, get_settings  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.ids import new_id, utcnow  # noqa: E402
from app.models import Membership, Organisation, User  # noqa: E402
from app.security import hash_password  # noqa: E402

DEMO_EMAIL = "demo@pressflow.local"
DEMO_ORG = "Elets Technomedia (Demo)"
DEMO_SLUG = "elets-technomedia-demo"
WORKSPACE = REPO_ROOT / "packages" / "demo-data" / "workspace.json"


def main() -> int:
    s = get_settings()
    creds = s.var_dir / "demo-credentials.txt"
    with session_factory()() as db:
        org = db.scalar(select(Organisation).where(Organisation.slug == DEMO_SLUG))
        if org is None:
            org = Organisation(id=new_id("org"), name=DEMO_ORG, slug=DEMO_SLUG, plan="demo", is_demo=True)
            db.add(org)
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        password = os.environ.get("DEMO_USER_PASSWORD") or s.demo_user_password
        generated = False
        if user is None:
            user = User(id=new_id("usr"), name="Demo Editor", email=DEMO_EMAIL, title="Managing Editor", is_demo=True)
            db.add(user)
            if not password:
                password, generated = secrets.token_urlsafe(18), True
        elif not password and not creds.exists():
            password, generated = secrets.token_urlsafe(18), True
        if password:
            if user.password_hash:
                user.token_version = (user.token_version or 0) + 1  # sign out sessions using the old password
            user.password_hash = hash_password(password)
        db.flush()
        ms = db.scalar(select(Membership).where(Membership.org_id == org.id, Membership.user_id == user.id))
        if ms is None:
            db.add(Membership(id=new_id("mem"), org_id=org.id, user_id=user.id, role="owner", status="active",
                              last_active_at=utcnow()))
        else:
            ms.role, ms.status = "owner", "active"
        db.flush()

        if WORKSPACE.exists():
            from app.services.demo_import import import_workspace_file

            imp = import_workspace_file(db, WORKSPACE, org, user)
            print(f"Imported {WORKSPACE.relative_to(REPO_ROOT)}: " +
                  ", ".join(f"{k}={v}" for k, v in sorted(imp.counts.items())))
            for w in imp.warnings[:50]:
                print(f"  warning: {w}")
            if len(imp.warnings) > 50:
                print(f"  ... {len(imp.warnings) - 50} more warnings")
        else:
            print(f"warning: {WORKSPACE.relative_to(REPO_ROOT)} not found; seeded organisation + demo user only.")
        db.commit()

    if generated:
        creds.write_text(f"email={DEMO_EMAIL}\npassword={password}\n")
        creds.chmod(0o600)
        print(f"Demo user {DEMO_EMAIL} created; password written to {creds} (not printed).")
    elif password:
        print(f"Demo user {DEMO_EMAIL} password set from DEMO_USER_PASSWORD.")
    else:
        print(f"Demo user {DEMO_EMAIL} unchanged (password in {creds}).")
    print(f"Organisation: {DEMO_ORG}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
