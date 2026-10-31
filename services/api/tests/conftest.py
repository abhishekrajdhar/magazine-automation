"""Test session setup: temp SQLite DB + temp storage, no inline worker, no external providers."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="pf-test-"))
os.environ.update({
    "ENV": "test",
    "SECRET_KEY": "test-secret-key-not-for-production-0123456789",
    "DATABASE_URL": f"sqlite:///{_TMP / 'test.db'}",
    "STORAGE_BACKEND": "local",
    "STORAGE_LOCAL_ROOT": str(_TMP / "storage"),
    "RUN_WORKER_INLINE": "false",
    "LLM_PROVIDER": "none",
    "TRANSCRIPTION_PROVIDER": "none",
    "INTEGRATION_NETWORK_CHECKS": "false",
    "INDESIGN_BRIDGE_TOKEN": "test-bridge-token",
    "GOOGLE_CLIENT_ID": "",
    "GOOGLE_CLIENT_SECRET": "",
    "YOUTUBE_API_KEY": "",
    "ANTHROPIC_API_KEY": "",
    # Never let a developer's real key from services/api/.env reach a paid API from the test suite.
    "OPENAI_API_KEY": "",
    "OPENAI_BASE_URL": "https://api.openai.invalid/v1",
    "TRANSCRIPTION_API_KEY": "",
    "JOB_BACKOFF_BASE_SECONDS": "0",
})

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_PDF = FIXTURES / "sample-reference.pdf"


@pytest.fixture(scope="session", autouse=True)
def _database():
    from alembic import command
    from alembic.config import Config

    from app.config import API_ROOT, reset_settings_cache

    reset_settings_cache()
    cfg = Config(str(API_ROOT / "alembic.ini"))
    command.upgrade(cfg, "head")  # exercises the real migration
    yield
    from app.db import reset_engine

    reset_engine()
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(scope="session")
def app():
    from app.main import create_app
    from app.services.jobs.runner import load_handlers

    load_handlers()
    return create_app()


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


_counter = {"n": 0}


def unique_email(prefix: str = "user") -> str:
    _counter["n"] += 1
    return f"{prefix}{_counter['n']}-{os.getpid()}@example.test"


@pytest.fixture()
def owner(client):
    """Signed-in owner of a fresh organisation (cookie session on `client`)."""
    email = unique_email("owner")
    r = client.post("/api/v1/auth/signup", json={"name": "Asha Owner", "email": email, "password": "correct horse 1",
                                                 "organisationName": "Test Media Org"})
    assert r.status_code == 201, r.text
    body = r.json()
    return {"email": email, "password": "correct horse 1", "token": body["token"], "org": body["organisation"],
            "user": body["user"], "headers": {"Authorization": f"Bearer {body['token']}"}}


def run_jobs():
    from app.services.jobs.queue import run_pending

    return run_pending(ignore_schedule=True)
