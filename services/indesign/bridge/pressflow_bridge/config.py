"""Bridge configuration, read from environment variables."""

from __future__ import annotations

import os
import re
import socket
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

_APP_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]*$")
_BRIDGE_ID_RE = re.compile(r"[^A-Za-z0-9_.\-]+")


def default_jsx_dir() -> Path:
    """Locate the ExtendScript folder: env override, packaged copy, then the repo layout."""
    here = Path(__file__).resolve().parent
    packaged = here / "extendscript"
    if (packaged / "pressflow-render.jsx").is_file():
        return packaged
    return here.parent.parent / "extendscript"  # services/indesign/extendscript


def _float(env: Mapping[str, str], key: str, default: float) -> float:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be a number, got {raw!r}") from exc


def _bool(env: Mapping[str, str], key: str, default: bool) -> bool:
    raw = env.get(key)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    api_url: str
    token: str = field(repr=False)
    mode: str = "desktop"  # desktop | server
    server_url: str = "http://localhost:18383"
    app_id: str = "com.adobe.InDesign"
    com_prog_id: str = "InDesign.Application"
    work_dir: Path = Path.home() / ".pressflow-bridge"
    poll_interval: float = 5.0
    heartbeat_interval: float = 30.0
    render_timeout: float = 1800.0
    http_timeout: float = 60.0
    bridge_id: str = ""
    jsx_dir: Path = field(default_factory=default_jsx_dir)
    template_root: Path | None = None
    keep_job_dirs: bool = False
    max_assets_bytes: int = 4 * 1024**3
    pdf_preset_digital: str = "[High Quality Print]"
    pdf_preset_print: str = "[PDF/X-4:2008]"
    log_format: str = "text"
    log_level: str = "INFO"

    @property
    def render_jsx(self) -> Path:
        return self.jsx_dir / "pressflow-render.jsx"

    @property
    def fonts_jsx(self) -> Path:
        return self.jsx_dir / "list-fonts.jsx"

    @property
    def platform(self) -> str:
        return sys.platform

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        env = os.environ if env is None else env
        mode = (env.get("INDESIGN_MODE") or "desktop").strip().lower()
        hostname = socket.gethostname()
        bridge_id = env.get("BRIDGE_ID") or f"{hostname}-{mode}"
        bridge_id = _BRIDGE_ID_RE.sub("-", bridge_id).strip("-")[:120] or "pressflow-bridge"
        work_dir = Path(env.get("BRIDGE_WORK_DIR") or (Path.home() / ".pressflow-bridge")).expanduser()
        jsx_dir = Path(env["PRESSFLOW_JSX_DIR"]).expanduser() if env.get("PRESSFLOW_JSX_DIR") else default_jsx_dir()
        template_root = Path(env["PRESSFLOW_TEMPLATE_ROOT"]).expanduser() if env.get("PRESSFLOW_TEMPLATE_ROOT") else None
        return cls(
            api_url=(env.get("PRESSFLOW_API_URL") or "").strip().rstrip("/"),
            token=(env.get("INDESIGN_BRIDGE_TOKEN") or "").strip(),
            mode=mode,
            server_url=(env.get("INDESIGN_SERVER_URL") or "http://localhost:18383").strip(),
            app_id=(env.get("INDESIGN_APP_ID") or "com.adobe.InDesign").strip(),
            com_prog_id=(env.get("INDESIGN_COM_PROGID") or "InDesign.Application").strip(),
            work_dir=work_dir,
            poll_interval=_float(env, "POLL_INTERVAL_SEC", 5.0),
            heartbeat_interval=_float(env, "HEARTBEAT_INTERVAL_SEC", 30.0),
            render_timeout=_float(env, "RENDER_TIMEOUT_SEC", 1800.0),
            http_timeout=_float(env, "HTTP_TIMEOUT_SEC", 60.0),
            bridge_id=bridge_id,
            jsx_dir=jsx_dir,
            template_root=template_root,
            keep_job_dirs=_bool(env, "BRIDGE_KEEP_JOB_DIRS", False),
            max_assets_bytes=int(_float(env, "BRIDGE_MAX_ASSETS_BYTES", float(4 * 1024**3))),
            pdf_preset_digital=env.get("PDF_PRESET_DIGITAL") or "[High Quality Print]",
            pdf_preset_print=env.get("PDF_PRESET_PRINT") or "[PDF/X-4:2008]",
            log_format=(env.get("LOG_FORMAT") or "text").strip().lower(),
            log_level=(env.get("LOG_LEVEL") or "INFO").strip().upper(),
        )

    def problems(self) -> list[str]:
        """Configuration errors that prevent the worker from running."""
        out: list[str] = []
        if not self.api_url:
            out.append("PRESSFLOW_API_URL is not set")
        elif not re.match(r"^https?://", self.api_url):
            out.append("PRESSFLOW_API_URL must start with http:// or https://")
        if not self.token:
            out.append("INDESIGN_BRIDGE_TOKEN is not set")
        if self.mode not in {"desktop", "server"}:
            out.append(f"INDESIGN_MODE must be 'desktop' or 'server', got {self.mode!r}")
        if self.mode == "server" and not re.match(r"^https?://", self.server_url):
            out.append("INDESIGN_SERVER_URL must be an http(s) URL of the InDesign Server SOAP endpoint")
        if not _APP_ID_RE.match(self.app_id):
            out.append(f"INDESIGN_APP_ID {self.app_id!r} is not a valid bundle identifier")
        if self.poll_interval <= 0 or self.heartbeat_interval <= 0 or self.render_timeout <= 0:
            out.append("POLL_INTERVAL_SEC, HEARTBEAT_INTERVAL_SEC and RENDER_TIMEOUT_SEC must be > 0")
        if not self.render_jsx.is_file():
            out.append(f"renderer script not found: {self.render_jsx} (set PRESSFLOW_JSX_DIR)")
        return out

    def redacted(self) -> dict[str, object]:
        """A loggable view of the configuration (the token is never included)."""
        return {
            "api_url": self.api_url,
            "token": "<set>" if self.token else "<missing>",
            "mode": self.mode,
            "server_url": self.server_url if self.mode == "server" else None,
            "app_id": self.app_id,
            "bridge_id": self.bridge_id,
            "work_dir": str(self.work_dir),
            "jsx_dir": str(self.jsx_dir),
            "poll_interval": self.poll_interval,
            "heartbeat_interval": self.heartbeat_interval,
            "render_timeout": self.render_timeout,
            "platform": self.platform,
        }
