"""Application settings (environment variables / `.env`).

Every variable is documented in `.env.example`. Nothing here holds a real secret.
"""

from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from typing import Annotated

from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent.parent  # services/api
REPO_ROOT = API_ROOT.parent.parent

log = logging.getLogger("pressflow.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(API_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore")

    # --- core -------------------------------------------------------------
    env: Literal["development", "test", "production"] = "development"
    secret_key: str = ""
    database_url: str = "sqlite:///./var/pressflow.db"
    database_echo: bool = False
    frontend_url: str = "http://localhost:3000"
    public_api_url: str = ""  # e.g. https://api.example.com — used for absolute URLs handed to the InDesign bridge
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    log_level: str = "INFO"

    # --- auth -------------------------------------------------------------
    session_cookie_name: str = "pf_session"
    session_ttl_hours: int = 24 * 7
    cookie_secure: bool = False
    password_reset_ttl_minutes: int = 60
    email_backend: Literal["log", "none", "smtp"] = "log"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""  # e.g. PressFlow <pressflow@example.com>
    invite_ttl_hours: int = 24 * 7  # how long an invitation's set-password link stays valid
    token_encryption_key: str = ""  # Fernet key for OAuth tokens at rest
    allow_signup: bool = True  # false: nobody can create a new organisation (invited members still sign in)
    signup_allowed_domains: Annotated[list[str], NoDecode] = []  # e.g. elets.in,eletsonline.com; empty = any domain
    login_max_failures: int = 8  # failed sign-ins per e-mail or per client address before a temporary lock
    login_lock_minutes: int = 15

    # --- storage ----------------------------------------------------------
    storage_backend: Literal["local", "s3"] = "local"
    storage_local_root: str = "./var/storage"
    s3_bucket: str = ""
    s3_bucket_videos: str = ""
    s3_bucket_audio: str = ""
    s3_bucket_references: str = ""
    s3_bucket_extracted: str = ""
    s3_bucket_exports: str = ""
    s3_bucket_assets: str = ""
    s3_endpoint_url: str = ""
    s3_region: str = "us-east-1"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_presign_seconds: int = 300

    # --- uploads ----------------------------------------------------------
    max_video_upload_mb: int = 2048
    max_reference_upload_mb: int = 200
    max_asset_upload_mb: int = 50

    # --- jobs -------------------------------------------------------------
    run_worker_inline: bool = True
    worker_poll_seconds: float = 2.0
    job_lease_seconds: int = 900
    job_max_attempts: int = 3
    job_backoff_base_seconds: float = 10.0
    bridge_job_lease_seconds: int = 2400  # bridge render timeout is 30 min

    # --- LLM --------------------------------------------------------------
    # auto: OpenAI when OPENAI_API_KEY is set, otherwise Anthropic when
    # ANTHROPIC_API_KEY is set, otherwise none. Either key alone is enough.
    llm_provider: Literal["auto", "anthropic", "openai_compatible", "none"] = "auto"
    llm_model: str = ""  # overrides the per-provider default below when set
    anthropic_model: str = "claude-opus-5-5"
    openai_model: str = "gpt-4.1"
    llm_effort: Literal["low", "medium", "high", "xhigh", "max"] = "high"
    llm_max_tokens: int = 32000
    llm_timeout_seconds: float = 600.0
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    llm_vision_reference_analysis: bool = False
    llm_analysis_window_chars: int = 150_000

    # --- transcription ----------------------------------------------------
    transcription_provider: Literal["openai_compatible", "local_whisper", "none"] = "none"
    transcription_model: str = "whisper-1"
    transcription_api_key: str = ""  # falls back to OPENAI_API_KEY
    transcription_base_url: str = ""  # falls back to OPENAI_BASE_URL
    transcription_chunk_seconds: int = 600
    transcription_max_chunk_bytes: int = 24 * 1024 * 1024
    whisper_local_model: str = "small"

    # --- AI images ----------------------------------------------------------
    image_provider: Literal["auto", "none"] = "auto"  # auto: OpenAI /images/generations when OPENAI_API_KEY is set
    image_model: str = "gpt-image-2"
    image_quality: Literal["low", "medium", "high", "auto"] = "high"
    image_timeout_seconds: float = 240.0

    # --- YouTube / Google -------------------------------------------------
    youtube_api_key: str = ""
    youtube_allow_download: bool = False
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""  # default: {PUBLIC_API_URL or http://localhost:8000}/api/v1/integrations/google/callback

    # --- tooling ----------------------------------------------------------
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    yt_dlp_path: str = "yt-dlp"
    integration_network_checks: bool = True
    http_timeout_seconds: float = 8.0

    # --- InDesign bridge ---------------------------------------------------
    indesign_bridge_token: str = ""
    indesign_bridge_online_seconds: int = 120

    # --- demo -------------------------------------------------------------
    demo_user_password: str = ""

    @field_validator("cors_origins", "signup_allowed_domains", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # ------------------------------------------------------------------
    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def resolved_database_url(self) -> str:
        """Resolve relative SQLite paths against services/api so CLI + app agree."""
        url = self.database_url
        prefix = "sqlite:///"
        if url.startswith(prefix) and not url.startswith(prefix + "/") and ":memory:" not in url:
            rel = url[len(prefix):]
            path = (API_ROOT / rel).resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            return prefix + str(path)
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url

    @property
    def storage_root(self) -> Path:
        p = Path(self.storage_local_root)
        if not p.is_absolute():
            p = API_ROOT / p
        return p.resolve()

    @property
    def var_dir(self) -> Path:
        p = API_ROOT / "var"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def effective_secret_key(self) -> str:
        if self.env == "production":
            if not self.secret_key:
                raise RuntimeError("SECRET_KEY must be set in production")
            if len(self.secret_key) < 32 or self.secret_key.lower().startswith("change-me"):
                raise RuntimeError("SECRET_KEY is a placeholder or shorter than 32 characters; generate one with "
                                   "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"`")
        if self.secret_key:
            return self.secret_key
        # Development/test: persist a generated key so sessions + encrypted tokens survive restarts.
        key_file = self.var_dir / "dev-secret.key"
        if key_file.exists():
            return key_file.read_text().strip()
        key = secrets.token_urlsafe(48)
        key_file.write_text(key)
        key_file.chmod(0o600)
        log.warning("SECRET_KEY not set; generated a development key at %s", key_file)
        return key

    @property
    def effective_llm_provider(self) -> Literal["anthropic", "openai_compatible", "none"]:
        if self.llm_provider != "auto":
            return self.llm_provider
        if self.openai_api_key:
            return "openai_compatible"
        if self.anthropic_api_key:
            return "anthropic"
        return "none"

    @property
    def effective_llm_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        return self.openai_model if self.effective_llm_provider == "openai_compatible" else self.anthropic_model

    @property
    def transcription_key(self) -> str:
        return self.transcription_api_key or self.openai_api_key

    @property
    def transcription_url(self) -> str:
        return (self.transcription_base_url or self.openai_base_url).rstrip("/")

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    def production_issues(self) -> tuple[list[str], list[str]]:
        """(errors, warnings) for a production deployment. Errors mean the service must not go live as configured;
        `python -m app.checks` prints both and exits non-zero on errors."""
        errors: list[str] = []
        warnings: list[str] = []
        local = ("localhost", "127.0.0.1")
        try:
            self.effective_secret_key  # noqa: B018
        except RuntimeError as e:
            errors.append(str(e))
        if self.is_sqlite:
            errors.append("DATABASE_URL is SQLite; production needs PostgreSQL (the job queue and several replicas share it).")
        if not self.cookie_secure:
            errors.append("COOKIE_SECURE is false; session cookies would be sent over plain HTTP.")
        if any(h in self.frontend_url for h in local):
            errors.append("FRONTEND_URL still points at localhost; password-reset and OAuth links would be wrong.")
        if not self.cors_origins or any(h in o for o in self.cors_origins for h in local) or "*" in self.cors_origins:
            errors.append("CORS_ORIGINS must list only the deployed web origin(s).")
        if self.google_configured and not self.token_encryption_key:
            errors.append("TOKEN_ENCRYPTION_KEY is required when Google OAuth is configured (tokens are stored encrypted).")
        if self.storage_backend == "local":
            warnings.append("STORAGE_BACKEND=local: files live on this machine's disk. Use s3 unless the host has one "
                            "persistent volume shared by the API and the worker.")
        if self.run_worker_inline:
            warnings.append("RUN_WORKER_INLINE=true: jobs run inside the API process. Fine for one small instance; "
                            "set it to false and run `python -m app.worker` when you scale.")
        if self.allow_signup and not self.signup_allowed_domains:
            warnings.append("Sign-up is open to anyone. Set SIGNUP_ALLOWED_DOMAINS, or ALLOW_SIGNUP=false once your "
                            "organisation exists.")
        if not self.public_api_url:
            warnings.append("PUBLIC_API_URL is empty; the InDesign bridge and Google redirect need the API's public origin.")
        if self.email_backend != "smtp" or not (self.smtp_host and self.smtp_from):
            warnings.append("No mail server (EMAIL_BACKEND=smtp with SMTP_HOST and SMTP_FROM): nobody can reset a "
                            "forgotten password by themselves, and administrators must pass invitation links on by hand.")
        if self.effective_llm_provider == "none":
            warnings.append("No LLM key: article generation and AI assistance will report 'not configured'.")
        if self.transcription_provider == "none":
            warnings.append("TRANSCRIPTION_PROVIDER=none: recordings without captions cannot be transcribed.")
        if not self.indesign_bridge_token:
            warnings.append("INDESIGN_BRIDGE_TOKEN is empty: native .indd and PDF/X-4 stay unavailable (IDML export still works).")
        return errors, warnings

    def api_base(self, fallback: str = "http://localhost:8000") -> str:
        return (self.public_api_url or fallback).rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
