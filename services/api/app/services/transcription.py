"""Transcription provider abstraction: TRANSCRIPTION_PROVIDER=openai_compatible|local_whisper|none.

* openai_compatible: POST {base}/audio/transcriptions (multipart). Audio is chunked under the
  25 MB request limit and segment timestamps are offset by each chunk's start.
* local_whisper: faster-whisper if importable (optional extra `whisper-local`).
* none: transcription is unavailable (the pipeline marks the video `unavailable`).
"""

from __future__ import annotations

import importlib.util
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.config import get_settings
from app.services.media_tools import split_for_upload

log = logging.getLogger("pressflow.transcription")


@dataclass
class Segment:
    start: float
    end: float
    text: str
    speaker: str | None = None


@dataclass
class TranscriptResult:
    segments: list[Segment]
    language: str | None
    method: str = "whisper"


class TranscriptionUnavailable(Exception):
    pass


class TranscriptionFailed(Exception):
    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


Progress = Callable[[float, str], None]


class TranscriptionProvider:
    name = "none"

    def configured(self) -> tuple[bool, str]:
        return False, "TRANSCRIPTION_PROVIDER=none — no speech-to-text configured."

    def check(self) -> tuple[bool, str]:
        return self.configured()

    def transcribe(self, audio: Path, work_dir: Path, progress: Progress) -> TranscriptResult:
        raise TranscriptionUnavailable(
            "No transcription provider is configured (TRANSCRIPTION_PROVIDER=none). Configure an OpenAI-compatible "
            "Whisper endpoint or install the whisper-local extra."
        )


class OpenAICompatibleTranscriber(TranscriptionProvider):
    name = "openai_compatible"

    def __init__(self):
        s = get_settings()
        self.key = s.transcription_key
        self.base = s.transcription_url
        self.model = s.transcription_model
        self.chunk_seconds = s.transcription_chunk_seconds
        self.max_bytes = s.transcription_max_chunk_bytes

    def configured(self) -> tuple[bool, str]:
        if not self.key:
            return False, "TRANSCRIPTION_PROVIDER=openai_compatible but no TRANSCRIPTION_API_KEY/OPENAI_API_KEY is set."
        return True, f"{self.base}/audio/transcriptions, model {self.model}"

    def check(self) -> tuple[bool, str]:
        ok, detail = self.configured()
        if not ok:
            return ok, detail
        try:
            r = httpx.get(f"{self.base}/models", headers={"Authorization": f"Bearer {self.key}"}, timeout=8.0)
            return (r.status_code == 200, "Endpoint reachable." if r.status_code == 200 else f"/models returned HTTP {r.status_code}")
        except httpx.HTTPError as e:
            return False, f"Could not reach {self.base}: {e}"

    def transcribe(self, audio: Path, work_dir: Path, progress: Progress) -> TranscriptResult:
        ok, detail = self.configured()
        if not ok:
            raise TranscriptionUnavailable(detail)
        chunks = split_for_upload(audio, work_dir / "chunks", self.chunk_seconds, self.max_bytes)
        segments: list[Segment] = []
        language = None
        for i, (path, offset) in enumerate(chunks):
            progress(100 * i / len(chunks), f"Transcribing chunk {i + 1} of {len(chunks)}")
            with open(path, "rb") as f:
                files = {"file": (path.name, f, "audio/mpeg")}
                data = {"model": self.model, "response_format": "verbose_json", "timestamp_granularities[]": "segment"}
                try:
                    r = httpx.post(f"{self.base}/audio/transcriptions", headers={"Authorization": f"Bearer {self.key}"},
                                   files=files, data=data, timeout=600.0)
                except httpx.HTTPError as e:
                    raise TranscriptionFailed(f"Transcription request failed: {e}", retryable=True) from e
            if r.status_code == 401:
                raise TranscriptionFailed("Transcription endpoint rejected the API key (401).")
            if r.status_code == 429 or r.status_code >= 500:
                raise TranscriptionFailed(f"Transcription endpoint returned HTTP {r.status_code}", retryable=True)
            if r.status_code >= 400:
                raise TranscriptionFailed(f"Transcription endpoint returned HTTP {r.status_code}: {r.text[:300]}")
            body = r.json()
            language = language or body.get("language")
            segs = body.get("segments") or []
            if segs:
                for sg in segs:
                    text = (sg.get("text") or "").strip()
                    if text:
                        segments.append(Segment(start=round(offset + float(sg["start"]), 2),
                                                end=round(offset + float(sg["end"]), 2), text=text))
            elif (body.get("text") or "").strip():
                # Endpoint returned text only: one coarse segment for the chunk (timestamps approximate).
                from app.services.media_tools import probe_duration

                dur = probe_duration(path) or self.chunk_seconds
                segments.append(Segment(start=round(offset, 2), end=round(offset + dur, 2), text=body["text"].strip()))
        progress(100, "Transcription complete")
        return TranscriptResult(segments=segments, language=language, method="whisper")


class LocalWhisperTranscriber(TranscriptionProvider):
    name = "local_whisper"

    def configured(self) -> tuple[bool, str]:
        if importlib.util.find_spec("faster_whisper") is None:
            return False, "TRANSCRIPTION_PROVIDER=local_whisper but faster-whisper is not installed (uv sync --extra whisper-local)."
        return True, f"faster-whisper model '{get_settings().whisper_local_model}' (CPU)"

    def transcribe(self, audio: Path, work_dir: Path, progress: Progress) -> TranscriptResult:
        ok, detail = self.configured()
        if not ok:
            raise TranscriptionUnavailable(detail)
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]

        progress(2, "Loading local Whisper model")
        model = WhisperModel(get_settings().whisper_local_model, device="cpu", compute_type="int8")
        segs, info = model.transcribe(str(audio), vad_filter=True)
        out: list[Segment] = []
        total = float(getattr(info, "duration", 0) or 0)
        for sg in segs:
            if sg.text.strip():
                out.append(Segment(start=round(sg.start, 2), end=round(sg.end, 2), text=sg.text.strip()))
            if total:
                progress(min(99.0, 100 * sg.end / total), "Transcribing locally")
        return TranscriptResult(segments=out, language=getattr(info, "language", None), method="whisper")


def get_transcriber() -> TranscriptionProvider:
    p = get_settings().transcription_provider
    if p == "openai_compatible":
        return OpenAICompatibleTranscriber()
    if p == "local_whisper":
        return LocalWhisperTranscriber()
    return TranscriptionProvider()


# ---------------------------------------------------------------- caption parsing (YouTube captions.download)

def parse_vtt_or_srt(text: str) -> list[Segment]:
    import re

    segs: list[Segment] = []
    ts = re.compile(r"(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})")

    def to_sec(m: re.Match) -> float:
        h = int(m.group(1)[:-1]) if m.group(1) else 0
        return h * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000

    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n"))
    for b in blocks:
        lines = [ln for ln in b.strip().split("\n") if ln.strip()]
        for i, ln in enumerate(lines):
            if "-->" in ln:
                parts = ln.split("-->")
                m1, m2 = ts.search(parts[0]), ts.search(parts[1])
                if not (m1 and m2):
                    break
                body = " ".join(re.sub(r"<[^>]+>", "", x).strip() for x in lines[i + 1:]).strip()
                if body:
                    segs.append(Segment(start=round(to_sec(m1), 2), end=round(to_sec(m2), 2), text=body))
                break
    # collapse rolling-caption duplicates
    out: list[Segment] = []
    for s in segs:
        if out and s.text == out[-1].text:
            out[-1].end = s.end
        else:
            out.append(s)
    return out
