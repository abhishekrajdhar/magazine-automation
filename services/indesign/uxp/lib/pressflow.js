/*
 * Host-independent helpers for the PressFlow UXP panel (no UXP/InDesign APIs here, so the
 * module is unit-tested under Node: services/indesign/tests/js/uxp_libs.test.js).
 */
"use strict";

const BRIDGE_PREFIX = "/api/v1/indesign/bridge";

// Same mapping as the Python bridge (bridge/pressflow_bridge/jobs.py).
const FORMAT_OUTPUTS = {
  indd: ["indd"],
  idml: ["indd", "idml"],
  pdf: ["indd", "pdf_digital"],
  pdf_digital: ["indd", "pdf_digital"],
  digital_pdf: ["indd", "pdf_digital"],
  pdf_print: ["indd", "pdf_print"],
  print_pdf: ["indd", "pdf_print"],
};

function outputsForFormat(fmt) {
  const key = String(fmt || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FORMAT_OUTPUTS, key)) {
    throw new Error(`unsupported export format '${fmt}'`);
  }
  return FORMAT_OUTPUTS[key].slice();
}

function normalizeApiUrl(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(u)) throw new Error("API URL must start with http:// or https://");
  return u;
}

function originOf(url) {
  const m = /^(https?):\/\/([^/?#]+)/i.exec(url);
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : "";
}

/** Resolve a job URL (absolute or API-relative) and decide whether the bearer token may be sent. */
function resolveUrl(apiUrl, pathOrUrl) {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${apiUrl}/${String(pathOrUrl).replace(/^\/+/, "")}`;
  return { url, sendToken: originOf(url) === originOf(apiUrl) };
}

function jobUrls(apiUrl, job) {
  const id = encodeURIComponent(job.jobId);
  return {
    contract: resolveUrl(apiUrl, job.contractUrl || `${BRIDGE_PREFIX}/jobs/${id}/contract`),
    assets: resolveUrl(apiUrl, job.assetsUrl || `${BRIDGE_PREFIX}/jobs/${id}/assets.zip`),
    result: resolveUrl(apiUrl, `${BRIDGE_PREFIX}/jobs/${id}/result`),
  };
}

function safeName(s) {
  const v = String(s || "");
  return /^[A-Za-z0-9_.-]{1,100}$/.test(v) && v !== "." && v !== ".." ? v : `job-${Math.abs(hashCode(v)).toString(36)}`;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function buildRenderArgs(job, paths, settings) {
  const options = job.options || {};
  const outputs = outputsForFormat(job.format);
  const args = {
    contractPath: paths.contractPath,
    assetRoot: paths.assetRoot,
    outDir: paths.outDir,
    outputs: outputs.join(","),
    pdfPresetDigital: "[High Quality Print]",
    pdfPresetPrint: "[PDF/X-4:2008]",
    includeBleed: options.includeBleed ? "true" : "false",
    jobId: String(job.jobId),
    baseName: `pressflow-${safeName(job.exportId || job.jobId)}`,
    closeDocument: settings && settings.keepOpen ? "false" : "true",
    showWindow: settings && settings.keepOpen ? "true" : "false",
    force: options.force === true ? "true" : "false",
  };
  if (options.pdfPreset) {
    if (outputs.indexOf("pdf_print") >= 0) args.pdfPresetPrint = String(options.pdfPreset);
    else args.pdfPresetDigital = String(options.pdfPreset);
  }
  return { args, outputs };
}

/** Map report.outputs to multipart file fields ({field, kind, path}); throws if a requested output is missing. */
function resultFiles(report, outputs) {
  const reported = (report && report.outputs) || {};
  return outputs.map((kind) => {
    if (!reported[kind]) throw new Error(`renderer did not produce the requested '${kind}' output`);
    return { field: kind === "pdf_digital" || kind === "pdf_print" ? "pdf" : kind, kind, path: String(reported[kind]) };
  });
}

function basename(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1];
}

function utf8Encode(str) {
  const out = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/**
 * Build a multipart/form-data body. parts: [{name, value}] or [{name, filename, data: Uint8Array, contentType}].
 * Returns {body: Uint8Array, contentType}.
 */
function buildMultipart(parts, boundary) {
  const b = boundary || `----pressflowuxp${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const q = (s) => String(s).replace(/"/g, "%22").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const chunks = [];
  for (const part of parts) {
    if (part.data) {
      chunks.push(utf8Encode(`--${b}\r\nContent-Disposition: form-data; name="${q(part.name)}"; filename="${q(part.filename)}"\r\nContent-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`));
      chunks.push(part.data instanceof Uint8Array ? part.data : new Uint8Array(part.data));
    } else {
      chunks.push(utf8Encode(`--${b}\r\nContent-Disposition: form-data; name="${q(part.name)}"\r\n\r\n${part.value}`));
    }
    chunks.push(utf8Encode("\r\n"));
  }
  chunks.push(utf8Encode(`--${b}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    body.set(c, pos);
    pos += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${b}` };
}

function contentTypeFor(name) {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.indd$/i.test(name)) return "application/x-indesign";
  if (/\.idml$/i.test(name)) return "application/vnd.adobe.indesign-idml-package";
  return "application/octet-stream";
}

module.exports = {
  BRIDGE_PREFIX,
  outputsForFormat,
  normalizeApiUrl,
  resolveUrl,
  jobUrls,
  safeName,
  buildRenderArgs,
  resultFiles,
  basename,
  utf8Encode,
  buildMultipart,
  contentTypeFor,
};
