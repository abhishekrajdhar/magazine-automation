"""Design-profile PATCH semantics: deep-merge + record changed dotted paths in `overrides`."""

from __future__ import annotations

import copy
from typing import Any


def _walk(prefix: str, old: Any, new: Any, changed: list[str]) -> Any:
    if isinstance(new, dict) and isinstance(old, dict):
        out = dict(old)
        for k, v in new.items():
            out[k] = _walk(f"{prefix}.{k}" if prefix else k, old.get(k), v, changed)
        return out
    if old != new:
        changed.append(prefix)
    return new


def merge_patch(profile: dict, patch: dict) -> tuple[dict, list[str]]:
    changed: list[str] = []
    merged = _walk("", copy.deepcopy(profile), patch, changed)
    return merged, changed


def _get(d: dict, path: list[str]) -> tuple[bool, Any]:
    cur: Any = d
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return False, None
        cur = cur[p]
    return True, cur


def _set(d: dict, path: list[str], value: Any) -> None:
    cur = d
    for p in path[:-1]:
        cur = cur.setdefault(p, {})
    cur[path[-1]] = value


def apply_overrides(fresh: dict, previous: dict, overrides: list[str]) -> dict:
    """Re-analysis result with human-overridden paths restored from the previous profile."""
    out = copy.deepcopy(fresh)
    for path in overrides:
        parts = path.split(".")
        ok, val = _get(previous, parts)
        if ok:
            _set(out, parts, val)
    return out
