import pytest

from app.config import get_settings


@pytest.fixture
def google_client(monkeypatch):
    """An OAuth client configured on the server; get_settings() is cached, so re-read it."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_unconnected_google_is_a_step_not_a_failure(client, owner, google_client):
    st = {i["key"]: i for i in client.get("/api/v1/integrations/status", headers=owner["headers"]).json()}
    assert st["google_drive"]["configured"] and not st["google_drive"]["available"]
    assert st["google_drive"]["action"] == "connect_google"
    assert st["youtube_captions"]["action"] == "connect_google"
    assert st["ffmpeg"].get("action") is None


def test_no_connect_action_without_an_oauth_client(client, owner):
    st = {i["key"]: i for i in client.get("/api/v1/integrations/status", headers=owner["headers"]).json()}
    assert st["google_drive"].get("action") is None


def test_authorize_returns_the_google_url_as_json(client, owner, google_client):
    r = client.get("/api/v1/integrations/google/authorize", headers={**owner["headers"], "Accept": "application/json"})
    assert r.status_code == 200
    assert r.json()["authorizeUrl"].startswith("https://accounts.google.com/")


@pytest.mark.parametrize(("query", "suffix"), [
    ({"error": "access_denied"}, "&google=error&reason=access_denied"),
    ({"code": "x", "state": "forged"}, "&google=error&reason=invalid_state"),
])
def test_callback_returns_to_the_integrations_tab(client, query, suffix):
    r = client.get("/api/v1/integrations/google/callback", params=query, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "http://localhost:3000/app/settings?tab=integrations" + suffix
