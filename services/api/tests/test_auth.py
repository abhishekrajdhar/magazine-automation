import logging
import re

from sqlalchemy import select

from app.db import session_factory
from app.models import User
from app.security import hash_password
from tests.conftest import unique_email


def test_signup_login_me_logout(client):
    email = unique_email("signup")
    r = client.post("/api/v1/auth/signup", json={"name": "Meera Iyer", "email": email, "password": "s3cret-pass",
                                                 "organisationName": "Elets Test"})
    assert r.status_code == 201
    body = r.json()
    assert body["role"] == "owner" and body["user"]["initials"] == "MI"
    assert body["organisation"]["slug"].startswith("elets-test")
    assert "pf_session" in r.cookies
    cookie_header = r.headers["set-cookie"].lower()
    assert "httponly" in cookie_header and "samesite=lax" in cookie_header

    me = client.get("/api/v1/auth/me")  # cookie session
    assert me.status_code == 200 and me.json()["user"]["email"] == email
    assert "title" not in me.json()["user"]  # nulls are omitted (TS optional fields)

    assert client.post("/api/v1/auth/signup", json={"name": "x", "email": email, "password": "another-pass",
                                                    "organisationName": "y"}).status_code == 409
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    assert client.get("/api/v1/auth/me").status_code == 401

    bad = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401
    ok = client.post("/api/v1/auth/login", json={"email": email.upper(), "password": "s3cret-pass"})
    assert ok.status_code == 200
    token = ok.json()["token"]
    client.cookies.clear()
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_forgot_and_reset_password(client, owner, caplog):
    caplog.set_level(logging.WARNING, logger="pressflow.auth")
    r = client.post("/api/v1/auth/forgot-password", json={"email": owner["email"]})
    assert r.status_code == 202
    assert "token" not in r.text.lower() or "reset link" in r.text.lower()
    m = re.search(r"reset-password\?token=([\w-]+)", caplog.text)
    assert m, "reset link should be logged in dev"
    # unknown e-mail: same response, nothing leaked
    assert client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.test"}).status_code == 202
    rr = client.post("/api/v1/auth/reset-password", json={"token": m.group(1), "password": "brand-new-pass"})
    assert rr.status_code == 200
    # old session invalidated (token_version bump)
    assert client.get("/api/v1/auth/me", headers=owner["headers"]).status_code == 401
    assert client.post("/api/v1/auth/reset-password", json={"token": m.group(1), "password": "x" * 10}).status_code == 400
    client.cookies.clear()
    assert client.post("/api/v1/auth/login", json={"email": owner["email"], "password": "brand-new-pass"}).status_code == 200


def test_rbac_viewer_is_read_only(client, owner):
    h = owner["headers"]
    viewer_email = unique_email("viewer")
    inv = client.post("/api/v1/orgs/current/members", json={"email": viewer_email, "name": "Vik Viewer", "role": "viewer"},
                      headers=h)
    assert inv.status_code == 201 and inv.json()["status"] == "invited"
    proj = client.post("/api/v1/projects", json={"title": "Summit issue"}, headers=h).json()
    with session_factory()() as db:  # simulate the invitee setting a password via the reset flow
        u = db.scalar(select(User).where(User.email == viewer_email))
        u.password_hash = hash_password("viewer-pass-1")
        db.commit()
    client.cookies.clear()
    login = client.post("/api/v1/auth/login", json={"email": viewer_email, "password": "viewer-pass-1"})
    assert login.status_code == 200 and login.json()["role"] == "viewer"
    vh = {"Authorization": f"Bearer {login.json()['token']}"}
    client.cookies.clear()
    assert client.get("/api/v1/projects", headers=vh).status_code == 200
    assert client.get(f"/api/v1/projects/{proj['id']}/workspace", headers=vh).status_code == 200
    denied = client.post("/api/v1/projects", json={"title": "nope"}, headers=vh)
    assert denied.status_code == 403 and "viewer" in denied.json()["detail"]
    assert client.patch(f"/api/v1/projects/{proj['id']}", json={"title": "x"}, headers=vh).status_code == 403
    assert client.post("/api/v1/orgs/current/members", json={"email": unique_email(), "name": "x", "role": "admin"},
                       headers=vh).status_code == 403
    assert client.put(f"/api/v1/projects/{proj['id']}/pages", json={"pages": []}, headers=vh).status_code == 403
    # owner promotes viewer to editor -> can create projects but not manage members
    uid = login.json()["user"]["id"]
    assert client.patch(f"/api/v1/orgs/current/members/{uid}", json={"role": "editor"}, headers=h).status_code == 200
    assert client.post("/api/v1/projects", json={"title": "Editor project"}, headers=vh).status_code == 201
    assert client.post("/api/v1/orgs/current/members", json={"email": unique_email(), "name": "x", "role": "viewer"},
                       headers=vh).status_code == 403
    members = client.get("/api/v1/orgs/current/members", headers=h).json()
    assert {m["role"] for m in members} == {"owner", "editor"}


def test_org_isolation(client, owner):
    proj = client.post("/api/v1/projects", json={"title": "Private"}, headers=owner["headers"]).json()
    client.cookies.clear()
    other = client.post("/api/v1/auth/signup", json={"name": "Other Org", "email": unique_email("other"),
                                                     "password": "other-pass-1", "organisationName": "Rival"}).json()
    oh = {"Authorization": f"Bearer {other['token']}"}
    client.cookies.clear()
    assert client.get(f"/api/v1/projects/{proj['id']}", headers=oh).status_code == 404
    assert client.get(f"/api/v1/projects/{proj['id']}/workspace", headers=oh).status_code == 404
    assert proj["id"] not in [p["id"] for p in client.get("/api/v1/projects", headers=oh).json()]
