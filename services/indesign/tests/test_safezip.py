"""assets.zip extraction must reject anything that could write outside the job folder."""

from __future__ import annotations

import io
import stat
import zipfile

import pytest

from conftest import make_zip
from pressflow_bridge.safezip import UnsafeArchiveError, safe_extract_zip


def _write(tmp_path, data: bytes):
    p = tmp_path / "assets.zip"
    p.write_bytes(data)
    return p


def test_extracts_normal_archive(tmp_path):
    z = _write(tmp_path, make_zip({"photos/ast_0001.jpg": b"jpeg", "logos/a.png": b"png", "./x/./y.txt": b"y"}))
    files = safe_extract_zip(z, tmp_path / "out")
    assert (tmp_path / "out/photos/ast_0001.jpg").read_bytes() == b"jpeg"
    assert (tmp_path / "out/x/y.txt").read_bytes() == b"y"
    assert len(files) == 3


@pytest.mark.parametrize("name", [
    "../evil.txt",
    "photos/../../evil.txt",
    "/etc/evil",
    "..\\..\\evil.txt",
    "C:/Windows/evil.dll",
    "c:evil",
    "photos/a:stream",
])
def test_rejects_traversal_and_absolute_paths(tmp_path, name):
    z = _write(tmp_path, make_zip({"ok.txt": b"fine", name: b"bad"}))
    with pytest.raises(UnsafeArchiveError):
        safe_extract_zip(z, tmp_path / "out")
    # Validation happens before extraction: nothing at all is written.
    assert not (tmp_path / "out" / "ok.txt").exists()
    assert not (tmp_path / "evil.txt").exists()


def test_rejects_symlink_entries(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("photos/link")
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(info, "/etc/passwd")
    with pytest.raises(UnsafeArchiveError, match="symlink"):
        safe_extract_zip(_write(tmp_path, buf.getvalue()), tmp_path / "out")


def test_rejects_oversized_archives(tmp_path):
    z = _write(tmp_path, make_zip({"big.bin": b"\0" * 10_000}))
    with pytest.raises(UnsafeArchiveError, match="expands beyond"):
        safe_extract_zip(z, tmp_path / "out", max_total_bytes=1_000)


def test_rejects_too_many_entries(tmp_path):
    z = _write(tmp_path, make_zip({f"f{i}.txt": b"x" for i in range(5)}))
    with pytest.raises(UnsafeArchiveError, match="entries"):
        safe_extract_zip(z, tmp_path / "out", max_files=3)


def test_rejects_lying_size_header(tmp_path):
    """A member whose real decompressed size exceeds its declared size is a zip bomb."""
    payload = b"A" * 50_000
    data = bytearray(make_zip({"bomb.bin": payload}))
    # Patch the declared uncompressed size (central directory + local header) down to 10 bytes.
    for sig, offset in ((b"PK\x01\x02", 24), (b"PK\x03\x04", 22)):
        i = data.find(sig)
        data[i + offset:i + offset + 4] = (10).to_bytes(4, "little")
    with pytest.raises((UnsafeArchiveError, zipfile.BadZipFile)):
        safe_extract_zip(_write(tmp_path, bytes(data)), tmp_path / "out")


def test_rejects_non_zip(tmp_path):
    with pytest.raises(UnsafeArchiveError, match="not a valid zip"):
        safe_extract_zip(_write(tmp_path, b"this is not a zip"), tmp_path / "out")
