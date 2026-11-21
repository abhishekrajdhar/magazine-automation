"""Deployment guards: placeholder secrets, the production check list, sign-up restriction, failed-login lock."""

import pytest

from app.config import Settings, get_settings, reset_settings_cache
from app.services import login_throttle
from tests.conftest import unique_email

GOOD_SECRET = "k" * 48


@pytest.fixture()
def settings_env(monkeypatch):
    def apply(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        reset_settings_cache()
        login_throttle.reset()

    yield apply
    monkeypatch.undo()
    reset_settings_cache()
    login_throttle.reset()


def test_production_refuses_missing_short_or_placeholder_secrets():
    for bad in ("", "short", "change-me-local-dev-secret-key-0123456789"):
        with pytest.raises(RuntimeError):
            Settings(env="production", secret_key=bad, _env_file=None).effective_secret_key  # noqa: B018
    assert Settings(env="production", secret_key=GOOD_SECRET, _env_file=None).effective_secret_key == GOOD_SECRET


def test_production_issues_lists_blockers_and_clears_when_configured():
    errors, _ = Settings(env="production", secret_key=GOOD_SECRET, database_url="sqlite:///./var/pressflow.db",
                         _env_file=None).production_issues()
    text = " ".join(errors)
    for needle in ("SQLite", "COOKIE_SECURE", "FRONTEND_URL", "CORS_ORIGINS"):
        assert needle in text
    ready = Settings(env="production", secret_key=GOOD_SECRET, database_url="postgresql://u:p@db.example.com/pf",
                     cookie_secure=True, frontend_url="https://magazine.example.com",
                     cors_origins=["https://magazine.example.com"], storage_backend="s3", run_worker_inline=False,
                     allow_signup=False, public_api_url="https://api.example.com", _env_file=None)
    errors, warnings = ready.production_issues()
    assert errors == []
    assert not any("Sign-up" in w or "STORAGE_BACKEND" in w or "RUN_WORKER_INLINE" in w for w in warnings)
    assert ready.resolved_database_url.startswith("postgresql+psycopg://")
    google = ready.model_copy(update={"google_client_id": "x", "google_client_secret": "y"})
    assert any("TOKEN_ENCRYPTION_KEY" in e for e in google.production_issues()[0])


def test_checks_command_reports_the_test_environment(capsys):
    from app.checks import run

    code = run()
    out = capsys.readouterr().out
    assert "database reachable and migrated" in out and "storage:" in out
    assert code == 1 and "FRONTEND_URL" in out      # the test environment is, correctly, not production-ready
    assert ("SQLite" in out) == get_settings().is_sqlite   # the suite also runs on PostgreSQL in CI


def _signup(client, email):
    return client.post("/api/v1/auth/signup", json={"name": "New Person", "email": email, "password": "correct horse 1",
                                                    "organisationName": "New Org"})


def test_signup_can_be_closed_or_limited_to_domains(client, settings_env):
    settings_env(SIGNUP_ALLOWED_DOMAINS="elets.in, @eletsonline.com")
    assert get_settings().signup_allowed_domains == ["elets.in", "@eletsonline.com"]
    r = _signup(client, unique_email("outsider"))
    assert r.status_code == 403 and "elets.in" in r.json()["detail"]
    assert _signup(client, f"editor-{unique_email('x').split('@')[0]}@ELETS.in").status_code == 201
    assert _signup(client, f"desk-{unique_email('y').split('@')[0]}@eletsonline.com").status_code == 201
    settings_env(ALLOW_SIGNUP="false", SIGNUP_ALLOWED_DOMAINS="")
    r = _signup(client, unique_email("late"))
    assert r.status_code == 403 and "closed" in r.json()["detail"]


def test_repeated_failed_logins_lock_the_account_for_a_while(client, owner, settings_env):
    settings_env(LOGIN_MAX_FAILURES="3", LOGIN_LOCK_MINUTES="15")
    bad = {"email": owner["email"], "password": "wrong password"}
    for _ in range(3):
        assert client.post("/api/v1/auth/login", json=bad).status_code == 401
    r = client.post("/api/v1/auth/login", json=bad)
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 60
    # the right password is refused too while locked, so guessing cannot continue
    assert client.post("/api/v1/auth/login", json={"email": owner["email"], "password": owner["password"]}).status_code == 429
    other = client.post("/api/v1/auth/login", json={"email": unique_email("nobody"), "password": "x" * 10})
    assert other.status_code == 401                 # other accounts on the same address are not locked yet
    login_throttle.reset()
    assert client.post("/api/v1/auth/login", json={"email": owner["email"], "password": owner["password"]}).status_code == 200


def test_a_successful_login_clears_the_count(client, owner, settings_env):
    settings_env(LOGIN_MAX_FAILURES="3")
    good = {"email": owner["email"], "password": owner["password"]}
    for _ in range(4):
        assert client.post("/api/v1/auth/login", json={**good, "password": "nope nope"}).status_code == 401
        assert client.post("/api/v1/auth/login", json={**good, "password": "nope nope"}).status_code == 401
        assert client.post("/api/v1/auth/login", json=good).status_code == 200


def test_invited_member_gets_a_one_time_link_and_can_join_with_signup_closed(client, owner, settings_env):
    h = owner["headers"]
    email = unique_email("invitee")
    r = client.post("/api/v1/orgs/current/members", headers=h, json={"email": email, "name": "New Designer", "role": "designer"})
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["status"] == "invited" and m["inviteEmailed"] is False
    token = m["inviteLink"].split("token=")[1].split("&")[0]
    assert m["inviteLink"].startswith("http://localhost:3000/reset-password?token=") and len(token) > 20
    members = client.get("/api/v1/orgs/current/members", headers=h).json()
    assert not any("inviteLink" in x for x in members)             # the link is shown once, to the inviter
    settings_env(ALLOW_SIGNUP="false")
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "designer pass 1"}).status_code == 200
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "another pass 2"}).status_code == 400
    s = client.post("/api/v1/auth/login", json={"email": email, "password": "designer pass 1"})
    assert s.status_code == 200 and s.json()["role"] == "designer" and s.json()["organisation"]["id"] == owner["org"]["id"]


def test_inviting_someone_who_already_has_an_account_gives_no_password_link(client, owner):
    other = unique_email("existing")
    assert _signup(client, other).status_code == 201
    r = client.post("/api/v1/orgs/current/members", headers=owner["headers"], json={"email": other, "name": "Existing", "role": "editor"})
    assert r.status_code == 201 and "inviteLink" not in r.json()


def test_smtp_backend_sends_reset_and_invitation_mail(client, owner, settings_env, monkeypatch):
    from app.services import mailer

    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent.append({"host": host, "port": port})

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self, context=None):
            sent[-1]["tls"] = True

        def login(self, user, password):
            sent[-1]["login"] = user

        def send_message(self, msg):
            sent[-1].update(to=msg["To"], subject=msg["Subject"], body=msg.get_content(), sender=msg["From"])

    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    settings_env(EMAIL_BACKEND="smtp", SMTP_HOST="smtp.example.com", SMTP_USERNAME="apikey", SMTP_PASSWORD="x",
                 SMTP_FROM="PressFlow <pressflow@example.com>", FRONTEND_URL="https://magazine.example.com")
    assert client.post("/api/v1/auth/forgot-password", json={"email": owner["email"]}).status_code == 202
    assert sent[-1]["to"] == owner["email"] and sent[-1]["tls"] and sent[-1]["login"] == "apikey"
    assert "https://magazine.example.com/reset-password?token=" in sent[-1]["body"]
    assert client.post("/api/v1/auth/forgot-password", json={"email": unique_email("ghost")}).status_code == 202
    assert len(sent) == 1                                          # unknown addresses get the same answer, no mail
    email = unique_email("mailed")
    m = client.post("/api/v1/orgs/current/members", headers=owner["headers"],
                    json={"email": email, "name": "Mailed", "role": "editor"}).json()
    assert m["inviteEmailed"] is True and sent[-1]["to"] == email and "invited you" in sent[-1]["subject"]
    assert m["inviteLink"] in sent[-1]["body"]
