"""Password hashing (bcrypt), session JWTs, Fernet encryption for OAuth tokens."""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import timedelta
from typing import Any

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings
from app.ids import utcnow

JWT_ALG = "HS256"


# ---------------------------------------------------------------- passwords

def hash_password(password: str) -> str:
    # bcrypt only uses the first 72 bytes; pre-hash so long passphrases are not silently truncated.
    digest = base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    digest = base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())
    try:
        return bcrypt.checkpw(digest, hashed.encode("ascii"))
    except ValueError:
        return False


# Constant-time dummy check so unknown e-mails take as long as wrong passwords.
_DUMMY_HASH: str | None = None


def dummy_verify(password: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_hex(8))
    verify_password(password, _DUMMY_HASH)


# ---------------------------------------------------------------- JWT sessions

def create_session_token(user_id: str, org_id: str, token_version: int) -> str:
    s = get_settings()
    now = utcnow()
    payload = {
        "sub": user_id,
        "org": org_id,
        "tv": token_version,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=s.session_ttl_hours)).timestamp()),
        "jti": secrets.token_hex(8),
        "typ": "session",
    }
    return jwt.encode(payload, s.effective_secret_key, algorithm=JWT_ALG)


def decode_token(token: str, typ: str = "session") -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, get_settings().effective_secret_key, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    if payload.get("typ") != typ:
        return None
    return payload


def create_signed_state(data: dict[str, Any], minutes: int = 10, typ: str = "oauth_state") -> str:
    now = utcnow()
    payload = {**data, "typ": typ, "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=minutes)).timestamp())}
    return jwt.encode(payload, get_settings().effective_secret_key, algorithm=JWT_ALG)


# ---------------------------------------------------------------- reset tokens

def new_reset_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_reset_token(raw)


def hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- Fernet

def _fernet() -> Fernet:
    s = get_settings()
    key = s.token_encryption_key
    if not key:
        if s.env == "production":
            raise RuntimeError("TOKEN_ENCRYPTION_KEY must be set in production")
        # Development: derive a stable key from the secret key.
        key = base64.urlsafe_b64encode(hashlib.sha256(("fernet:" + s.effective_secret_key).encode()).digest()).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None


def initials_for(name: str) -> str:
    parts = [p for p in name.replace("-", " ").split() if p and p[0].isalpha()]
    if not parts:
        return (name[:2] or "?").upper()
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()
