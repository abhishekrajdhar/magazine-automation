"""Processing of a single render job: download, unpack, render, upload."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .api import ApiClient, ApiError, NotFoundError
from .config import Config
from .runners import RunResult, Runner
from .safezip import UnsafeArchiveError, safe_extract_zip

log = logging.getLogger("pressflow.job")

# Job "format" -> renderer outputs. The INDD is always produced (useful for review).
FORMAT_OUTPUTS: dict[str, list[str]] = {
    "indd": ["indd"],
    "idml": ["indd", "idml"],
    "pdf": ["indd", "pdf_digital"],
    "pdf_digital": ["indd", "pdf_digital"],
    "digital_pdf": ["indd", "pdf_digital"],
    "pdf_print": ["indd", "pdf_print"],
    "print_pdf": ["indd", "pdf_print"],
}

_SAFE_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,100}$")


class JobError(Exception):
    """A job failure with a message suitable for the API."""

    def __init__(self, message: str, report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.report = report


@dataclass
class JobOutcome:
    job_id: str
    ok: bool
    error: str | None = None
    report: dict[str, Any] | None = None
    uploaded: bool = False


def outputs_for_format(fmt: str | None) -> list[str]:
    key = (fmt or "").strip().lower()
    if key not in FORMAT_OUTPUTS:
        raise JobError(f"unsupported export format {fmt!r} (supported: {', '.join(sorted(FORMAT_OUTPUTS))})")
    return list(FORMAT_OUTPUTS[key])


def safe_dir_name(job_id: str) -> str:
    if _SAFE_ID.match(job_id) and job_id not in (".", ".."):
        return job_id
    return "job-" + hashlib.sha256(job_id.encode("utf-8")).hexdigest()[:24]


def build_render_args(config: Config, job: dict[str, Any], *, contract_path: Path, asset_root: Path, out_dir: Path, outputs: list[str]) -> dict[str, str]:
    """Arguments for pressflow-render.jsx (all strings: InDesign Server scriptArgs are strings)."""
    options = job.get("options") or {}
    preset = options.get("pdfPreset")
    args = {
        "contractPath": str(contract_path),
        "assetRoot": str(asset_root),
        "outDir": str(out_dir),
        "outputs": ",".join(outputs),
        "pdfPresetDigital": config.pdf_preset_digital,
        "pdfPresetPrint": config.pdf_preset_print,
        "includeBleed": "true" if options.get("includeBleed") else "false",
        "jobId": str(job["jobId"]),
        "baseName": "pressflow-" + safe_dir_name(str(job.get("exportId") or job["jobId"])),
        "closeDocument": "true",
        "showWindow": "false",
        "force": "true" if options.get("force") is True else "false",
    }
    if preset:
        if "pdf_print" in outputs:
            args["pdfPresetPrint"] = str(preset)
        else:
            args["pdfPresetDigital"] = str(preset)
    if config.template_root:
        args["templateRoot"] = str(config.template_root)
    return args


def read_report(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise JobError(f"renderer wrote an unreadable report.json: {exc}") from exc
    if not isinstance(data, dict):
        raise JobError("renderer report.json is not a JSON object")
    return data


def collect_output_files(report: dict[str, Any], out_dir: Path, outputs: list[str]) -> dict[str, Path]:
    """Map multipart field name -> file, verifying every requested output exists inside out_dir."""
    reported = report.get("outputs") or {}
    root = out_dir.resolve()
    files: dict[str, Path] = {}
    for kind in outputs:
        raw = reported.get(kind)
        if not raw:
            raise JobError(f"renderer did not produce the requested '{kind}' output", report)
        path = Path(raw).resolve()
        if root not in path.parents:
            raise JobError(f"renderer output {kind} is outside the job output folder: {raw}", report)
        if not path.is_file() or path.stat().st_size == 0:
            raise JobError(f"renderer output {kind} is missing or empty: {raw}", report)
        field = "pdf" if kind in ("pdf_digital", "pdf_print") else kind
        files[field] = path
    return files


class JobProcessor:
    def __init__(self, config: Config, api: ApiClient, runner: Runner) -> None:
        self.config = config
        self.api = api
        self.runner = runner

    def process(self, job: dict[str, Any]) -> JobOutcome:
        job_id = str(job.get("jobId") or "")
        if not job_id:
            raise ValueError("job without jobId")
        job_dir = self.config.work_dir / "jobs" / safe_dir_name(job_id)
        t0 = time.monotonic()
        extra = {"job_id": job_id, "export_id": job.get("exportId"), "format": job.get("format")}
        log.info("job claimed", extra=extra)
        report: dict[str, Any] | None = None
        try:
            report = self._render(job, job_dir, extra)
            outputs = outputs_for_format(job.get("format"))
            files = collect_output_files(report, job_dir / "out", outputs)
            self.api.post_result_success(job_id, files, report)
            log.info("job succeeded", extra={**extra, "duration_ms": int((time.monotonic() - t0) * 1000),
                                             "overset": len(report.get("overset") or []),
                                             "substituted_fonts": len(report.get("substitutedFonts") or [])})
            return JobOutcome(job_id, True, report=report, uploaded=True)
        except Exception as exc:  # noqa: BLE001 - every failure must be reported to the API
            if isinstance(exc, JobError) and exc.report is not None:
                report = exc.report
            message = str(exc) if isinstance(exc, (JobError, ApiError, UnsafeArchiveError)) else f"{type(exc).__name__}: {exc}"
            log.error("job failed", extra={**extra, "error": message})
            uploaded = False
            try:
                self.api.post_result_failure(job_id, message, report)
                uploaded = True
            except Exception as up_exc:  # noqa: BLE001
                log.error("could not report job failure to the API", extra={**extra, "error": str(up_exc)})
            return JobOutcome(job_id, False, error=message, report=report, uploaded=uploaded)
        finally:
            if not self.config.keep_job_dirs:
                shutil.rmtree(job_dir, ignore_errors=True)

    def _render(self, job: dict[str, Any], job_dir: Path, extra: dict[str, Any]) -> dict[str, Any]:
        outputs = outputs_for_format(job.get("format"))
        if job_dir.exists():
            shutil.rmtree(job_dir)
        (job_dir / "out").mkdir(parents=True)
        contract_path = job_dir / "contract.json"
        asset_root = job_dir / "assets"
        asset_root.mkdir()

        self.api.download(self.api.contract_url(job), contract_path, max_bytes=50 * 1024 * 1024)
        try:
            contract = json.loads(contract_path.read_text(encoding="utf-8-sig"))
        except ValueError as exc:
            raise JobError(f"contract is not valid JSON: {exc}") from exc
        if not isinstance(contract, dict):
            raise JobError("contract is not a JSON object")
        needs_assets = bool(contract.get("assets"))

        zip_path = job_dir / "assets.zip"
        try:
            size = self.api.download(self.api.assets_url(job), zip_path, max_bytes=self.config.max_assets_bytes)
            files = safe_extract_zip(zip_path, asset_root, max_total_bytes=self.config.max_assets_bytes)
            zip_path.unlink(missing_ok=True)
            log.info("assets unpacked", extra={**extra, "zip_bytes": size, "files": len(files)})
        except NotFoundError:
            if needs_assets:
                raise JobError("contract lists assets but assets.zip is not available") from None
            log.info("no assets.zip for this job", extra=extra)

        missing = [a.get("file") for a in contract.get("assets") or [] if isinstance(a, dict) and a.get("file")
                   and not (asset_root / str(a["file"])).is_file()]
        if missing:
            log.warning("assets referenced by the contract are missing from assets.zip", extra={**extra, "missing": missing[:20]})

        out_dir = job_dir / "out"
        args = build_render_args(self.config, job, contract_path=contract_path, asset_root=asset_root, out_dir=out_dir, outputs=outputs)
        args_file = job_dir / "render-args.json"
        args_file.write_text(json.dumps(args, indent=2), encoding="utf-8")

        log.info("rendering", extra={**extra, "runner": self.runner.name, "outputs": ",".join(outputs)})
        result: RunResult = self.runner.run_script(self.config.render_jsx, args, args_file, self.config.render_timeout)
        report = read_report(out_dir / "report.json")
        if report is None:
            raise JobError(f"InDesign did not write report.json ({result.error or 'no error reported by the runner'})")
        if not result.ok:
            log.warning("runner reported an error but a report exists", extra={**extra, "runner_error": result.error})
        if not report.get("ok"):
            raise JobError(str(report.get("error") or "renderer reported failure"), report)
        return report
