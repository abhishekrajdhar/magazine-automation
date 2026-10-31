"""Safe extraction of the job's assets.zip.

Rejects (before anything is written): absolute paths, drive letters, ``..`` components,
symlinks, NUL/colon characters, too many entries and archives whose declared or actual
uncompressed size exceeds the limit (zip bombs).
"""

from __future__ import annotations

import re
import stat
import zipfile
from pathlib import Path, PurePosixPath


class UnsafeArchiveError(ValueError):
    pass


_DRIVE_RE = re.compile(r"^[A-Za-z]:")


def _member_parts(name: str) -> list[str]:
    if "\x00" in name or ":" in name:
        raise UnsafeArchiveError(f"illegal character in archive member name: {name!r}")
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or _DRIVE_RE.match(normalized):
        raise UnsafeArchiveError(f"absolute path in archive: {name!r}")
    parts = [p for p in PurePosixPath(normalized).parts if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise UnsafeArchiveError(f"path traversal in archive: {name!r}")
    return parts


def safe_extract_zip(
    zip_path: Path,
    dest: Path,
    *,
    max_files: int = 20000,
    max_total_bytes: int = 4 * 1024**3,
) -> list[Path]:
    """Extract ``zip_path`` into ``dest`` and return the extracted file paths."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise UnsafeArchiveError(f"not a valid zip archive: {exc}") from exc
    with zf:
        infos = zf.infolist()
        if len(infos) > max_files:
            raise UnsafeArchiveError(f"archive has {len(infos)} entries (limit {max_files})")
        plan: list[tuple[zipfile.ZipInfo, Path]] = []
        declared = 0
        # Pass 1: validate every member before writing anything.
        for info in infos:
            parts = _member_parts(info.filename)
            if not parts:
                continue
            mode = (info.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise UnsafeArchiveError(f"symlink in archive: {info.filename!r}")
            target = root.joinpath(*parts).resolve()
            if target != root and root not in target.parents:
                raise UnsafeArchiveError(f"archive member escapes destination: {info.filename!r}")
            declared += info.file_size
            if declared > max_total_bytes:
                raise UnsafeArchiveError(f"archive expands beyond {max_total_bytes} bytes")
            plan.append((info, target))
        # Pass 2: extract, enforcing the size limit on the actual decompressed bytes.
        written: list[Path] = []
        actual = 0
        for info, target in plan:
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                member_bytes = 0
                while True:
                    chunk = src.read(256 * 1024)
                    if not chunk:
                        break
                    member_bytes += len(chunk)
                    actual += len(chunk)
                    if member_bytes > info.file_size or actual > max_total_bytes:
                        raise UnsafeArchiveError(f"archive member {info.filename!r} decompresses beyond its declared size")
                    out.write(chunk)
            written.append(target)
        return written
