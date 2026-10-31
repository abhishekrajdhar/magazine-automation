"""Storage abstraction: local filesystem or S3-compatible object storage.

Keys always start with one of the known prefixes (videos/, audio/, references/,
extracted/, exports/, assets/). Raw filesystem paths are never exposed to clients;
every download goes through an authorised API endpoint.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO, Protocol

from app.config import Settings, get_settings

PREFIXES = ("videos", "audio", "references", "extracted", "exports", "assets")


class StorageError(RuntimeError):
    pass


def _check_key(key: str) -> str:
    key = key.lstrip("/")
    if ".." in key.split("/") or not key or key.split("/", 1)[0] not in PREFIXES:
        raise StorageError(f"Invalid storage key: {key!r}")
    return key


class Storage(Protocol):
    backend: str

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None: ...
    def put_file(self, key: str, path: str | Path, content_type: str | None = None) -> None: ...
    def put_stream(self, key: str, stream: BinaryIO, content_type: str | None = None) -> int: ...
    def get_bytes(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def size(self, key: str) -> int: ...
    def delete(self, key: str) -> None: ...
    def iter_chunks(self, key: str, chunk_size: int = 1024 * 1024) -> Iterator[bytes]: ...
    def local_path(self, key: str): ...  # context manager yielding a Path
    def presigned_url(self, key: str, filename: str | None = None, content_type: str | None = None) -> str | None: ...
    def check(self) -> tuple[bool, str]: ...


class LocalStorage:
    backend = "local"

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        key = _check_key(key)
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise StorageError("Key escapes storage root")
        return p

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, p)

    def put_file(self, key: str, path: str | Path, content_type: str | None = None) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        shutil.copyfile(path, tmp)
        os.replace(tmp, p)

    def put_stream(self, key: str, stream: BinaryIO, content_type: str | None = None) -> int:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        n = 0
        with open(tmp, "wb") as f:
            while chunk := stream.read(1024 * 1024):
                f.write(chunk)
                n += len(chunk)
        os.replace(tmp, p)
        return n

    def get_bytes(self, key: str) -> bytes:
        p = self._path(key)
        if not p.exists():
            raise StorageError(f"Object not found: {key}")
        return p.read_bytes()

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).exists()
        except StorageError:
            return False

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    def iter_chunks(self, key: str, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
        with open(self._path(key), "rb") as f:
            while chunk := f.read(chunk_size):
                yield chunk

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]:
        p = self._path(key)
        if not p.exists():
            raise StorageError(f"Object not found: {key}")
        yield p

    def presigned_url(self, key: str, filename: str | None = None, content_type: str | None = None) -> str | None:
        return None

    def check(self) -> tuple[bool, str]:
        try:
            probe = self.root / ".probe"
            probe.write_bytes(b"ok")
            probe.unlink()
            return True, f"Local storage writable ({self.root.name}/ under services/api)"
        except OSError as e:
            return False, f"Local storage not writable: {e}"


class S3Storage:
    backend = "s3"

    def __init__(self, settings: Settings):
        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError as e:  # pragma: no cover - depends on optional extra
            raise StorageError("STORAGE_BACKEND=s3 requires the [s3] extra (boto3)") from e
        self.settings = settings
        kwargs: dict = {"region_name": settings.s3_region}
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url
        if settings.s3_access_key_id:
            kwargs["aws_access_key_id"] = settings.s3_access_key_id
            kwargs["aws_secret_access_key"] = settings.s3_secret_access_key
        self.client = boto3.client("s3", **kwargs)

    def _loc(self, key: str) -> tuple[str, str]:
        key = _check_key(key)
        prefix = key.split("/", 1)[0]
        bucket = getattr(self.settings, f"s3_bucket_{prefix}", "") or self.settings.s3_bucket
        if not bucket:
            raise StorageError("S3_BUCKET is not configured")
        return bucket, key

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        bucket, k = self._loc(key)
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=bucket, Key=k, Body=data, **extra)

    def put_file(self, key: str, path: str | Path, content_type: str | None = None) -> None:
        bucket, k = self._loc(key)
        extra = {"ExtraArgs": {"ContentType": content_type}} if content_type else {}
        self.client.upload_file(str(path), bucket, k, **extra)

    def put_stream(self, key: str, stream: BinaryIO, content_type: str | None = None) -> int:
        bucket, k = self._loc(key)
        extra = {"ExtraArgs": {"ContentType": content_type}} if content_type else {}
        self.client.upload_fileobj(stream, bucket, k, **extra)
        return self.size(key)

    def get_bytes(self, key: str) -> bytes:
        bucket, k = self._loc(key)
        try:
            return self.client.get_object(Bucket=bucket, Key=k)["Body"].read()
        except Exception as e:  # noqa: BLE001
            raise StorageError(f"Object not found: {key}") from e

    def exists(self, key: str) -> bool:
        try:
            bucket, k = self._loc(key)
            self.client.head_object(Bucket=bucket, Key=k)
            return True
        except Exception:  # noqa: BLE001
            return False

    def size(self, key: str) -> int:
        bucket, k = self._loc(key)
        return int(self.client.head_object(Bucket=bucket, Key=k)["ContentLength"])

    def delete(self, key: str) -> None:
        bucket, k = self._loc(key)
        self.client.delete_object(Bucket=bucket, Key=k)

    def iter_chunks(self, key: str, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
        bucket, k = self._loc(key)
        body = self.client.get_object(Bucket=bucket, Key=k)["Body"]
        while chunk := body.read(chunk_size):
            yield chunk

    @contextmanager
    def local_path(self, key: str) -> Iterator[Path]:
        bucket, k = self._loc(key)
        suffix = Path(k).suffix
        fd, tmp = tempfile.mkstemp(suffix=suffix, prefix="pf-")
        os.close(fd)
        try:
            self.client.download_file(bucket, k, tmp)
            yield Path(tmp)
        finally:
            Path(tmp).unlink(missing_ok=True)

    def presigned_url(self, key: str, filename: str | None = None, content_type: str | None = None) -> str | None:
        bucket, k = self._loc(key)
        params: dict = {"Bucket": bucket, "Key": k}
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        if content_type:
            params["ResponseContentType"] = content_type
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=self.settings.s3_presign_seconds)

    def check(self) -> tuple[bool, str]:
        try:
            bucket = self.settings.s3_bucket or self.settings.s3_bucket_exports
            self.client.head_bucket(Bucket=bucket)
            return True, f"S3 bucket '{bucket}' reachable"
        except Exception as e:  # noqa: BLE001
            return False, f"S3 check failed: {type(e).__name__}: {e}"


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage(s) if s.storage_backend == "s3" else LocalStorage(s.storage_root)
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None


@contextmanager
def temp_dir(prefix: str = "pf-") -> Iterator[Path]:
    d = tempfile.mkdtemp(prefix=prefix)
    try:
        yield Path(d)
    finally:
        shutil.rmtree(d, ignore_errors=True)
