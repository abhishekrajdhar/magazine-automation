"""Streaming multipart/form-data encoder (stdlib only).

Large INDD/PDF files are streamed from disk instead of being loaded into memory.
"""

from __future__ import annotations

import mimetypes
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


def _quote(value: str) -> str:
    # RFC 7578: escape quotes and line breaks in header parameter values.
    return value.replace("\\", "\\\\").replace('"', "%22").replace("\r", "%0D").replace("\n", "%0A")


@dataclass(frozen=True)
class FieldPart:
    name: str
    value: str


@dataclass(frozen=True)
class FilePart:
    name: str
    path: Path
    filename: str | None = None
    content_type: str | None = None


class MultipartBody:
    """File-like object yielding a multipart/form-data body; pass it as ``data`` to urllib."""

    CHUNK = 256 * 1024

    def __init__(self, parts: list[FieldPart | FilePart], boundary: str | None = None) -> None:
        self.boundary = boundary or f"----pressflow{secrets.token_hex(16)}"
        self.parts = list(parts)
        self._iter: Iterator[bytes] | None = None
        self._buffer = b""

    @property
    def content_type(self) -> str:
        return f"multipart/form-data; boundary={self.boundary}"

    def _headers(self, part: FieldPart | FilePart) -> bytes:
        if isinstance(part, FieldPart):
            head = f'--{self.boundary}\r\nContent-Disposition: form-data; name="{_quote(part.name)}"\r\n\r\n'
        else:
            filename = part.filename or part.path.name
            ctype = part.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            head = (
                f"--{self.boundary}\r\n"
                f'Content-Disposition: form-data; name="{_quote(part.name)}"; filename="{_quote(filename)}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n"
            )
        return head.encode("utf-8")

    def _closing(self) -> bytes:
        return f"--{self.boundary}--\r\n".encode("ascii")

    def __len__(self) -> int:
        total = 0
        for part in self.parts:
            total += len(self._headers(part))
            if isinstance(part, FieldPart):
                total += len(part.value.encode("utf-8"))
            else:
                total += os.path.getsize(part.path)
            total += 2  # CRLF after the part body
        return total + len(self._closing())

    def iter_chunks(self) -> Iterator[bytes]:
        for part in self.parts:
            yield self._headers(part)
            if isinstance(part, FieldPart):
                yield part.value.encode("utf-8")
            else:
                with open(part.path, "rb") as fh:
                    while True:
                        chunk = fh.read(self.CHUNK)
                        if not chunk:
                            break
                        yield chunk
            yield b"\r\n"
        yield self._closing()

    def read(self, size: int = -1) -> bytes:
        if self._iter is None:
            self._iter = self.iter_chunks()
        if size is None or size < 0:
            data = self._buffer + b"".join(self._iter)
            self._buffer = b""
            return data
        while len(self._buffer) < size:
            try:
                self._buffer += next(self._iter)
            except StopIteration:
                break
        data, self._buffer = self._buffer[:size], self._buffer[size:]
        return data

    def to_bytes(self) -> bytes:
        return b"".join(self.iter_chunks())
