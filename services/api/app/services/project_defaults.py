from __future__ import annotations

from app.schemas.project import GenerationConfig


def default_config(target_page_count: int | None = None) -> GenerationConfig:
    cfg = GenerationConfig()
    if target_page_count:
        cfg.target_page_count = target_page_count
    return cfg
