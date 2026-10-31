"""ffmpeg / ffprobe / yt-dlp helpers (subprocess, with timeouts)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from app.config import get_settings


class MediaToolError(RuntimeError):
    pass


def which(tool: str) -> str | None:
    return shutil.which(tool)


def tool_version(path: str) -> str | None:
    try:
        out = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=10)
        if out.returncode == 0:
            return out.stdout.splitlines()[0][:120]
    except (OSError, subprocess.TimeoutExpired):
        return None
    return None


def probe(path: str | Path) -> dict:
    s = get_settings()
    try:
        out = subprocess.run(
            [s.ffprobe_path, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=60,
        )
    except FileNotFoundError as e:
        raise MediaToolError("ffprobe is not installed or not on PATH") from e
    except subprocess.TimeoutExpired as e:
        raise MediaToolError("ffprobe timed out") from e
    if out.returncode != 0:
        raise MediaToolError(f"ffprobe could not read the file: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout or "{}")


def probe_duration(path: str | Path) -> float | None:
    info = probe(path)
    dur = (info.get("format") or {}).get("duration")
    try:
        return round(float(dur), 2) if dur else None
    except ValueError:
        return None


def has_audio(info: dict) -> bool:
    return any(s.get("codec_type") == "audio" for s in info.get("streams", []))


def extract_audio(src: str | Path, dst: str | Path, timeout: int = 3 * 3600) -> Path:
    """Extract 16 kHz mono FLAC (lossless, ~half the size of WAV)."""
    s = get_settings()
    cmd = [s.ffmpeg_path, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
           "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac", str(dst)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        raise MediaToolError("ffmpeg is not installed or not on PATH") from e
    except subprocess.TimeoutExpired as e:
        raise MediaToolError("ffmpeg timed out extracting audio") from e
    if out.returncode != 0 or not Path(dst).exists():
        raise MediaToolError(f"ffmpeg failed: {out.stderr.strip()[:400]}")
    return Path(dst)


def split_for_upload(src: str | Path, out_dir: Path, chunk_seconds: int, max_bytes: int) -> list[tuple[Path, float]]:
    """Split audio into MP3 chunks (64 kbps mono) each below `max_bytes`. Returns [(path, offset_sec)]."""
    s = get_settings()
    duration = probe_duration(src) or 0.0
    chunk = max(30, chunk_seconds)
    while True:
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("chunk-*.mp3"):
            old.unlink()
        pattern = out_dir / "chunk-%04d.mp3"
        cmd = [s.ffmpeg_path, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vn", "-ac", "1",
               "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "segment", "-segment_time", str(chunk),
               "-reset_timestamps", "1", str(pattern)]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=3 * 3600)
        except FileNotFoundError as e:
            raise MediaToolError("ffmpeg is not installed or not on PATH") from e
        if out.returncode != 0:
            raise MediaToolError(f"ffmpeg segmenting failed: {out.stderr.strip()[:400]}")
        parts = sorted(out_dir.glob("chunk-*.mp3"))
        if not parts:
            raise MediaToolError("ffmpeg produced no audio chunks")
        if all(p.stat().st_size <= max_bytes for p in parts) or chunk <= 30:
            # offsets: segment muxer cuts at ~chunk boundaries; use measured durations for accuracy
            result, offset = [], 0.0
            for p in parts:
                result.append((p, offset))
                offset += probe_duration(p) or chunk
            if duration and abs(offset - duration) > 5:
                pass  # informational only; per-chunk durations are authoritative
            return result
        chunk = chunk // 2


def yt_dlp_download_audio(url: str, out_dir: Path, timeout: int = 3 * 3600) -> Path:
    """Only used when YOUTUBE_ALLOW_DOWNLOAD=true, for media the organisation owns/has rights to."""
    s = get_settings()
    exe = which(s.yt_dlp_path)
    if not exe:
        raise MediaToolError("yt-dlp is not installed")
    out_tpl = str(out_dir / "source.%(ext)s")
    cmd = [exe, "--no-playlist", "-f", "bestaudio/best", "-o", out_tpl, "--no-progress", url]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise MediaToolError("yt-dlp timed out") from e
    if out.returncode != 0:
        raise MediaToolError(f"yt-dlp failed: {out.stderr.strip()[:400]}")
    files = sorted(out_dir.glob("source.*"))
    if not files:
        raise MediaToolError("yt-dlp produced no file")
    return files[0]
