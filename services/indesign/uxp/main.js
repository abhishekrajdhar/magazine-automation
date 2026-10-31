/*
 * PressFlow Render - UXP panel for Adobe InDesign (manifest v5).
 *
 * Settings (API URL, bridge ID) live in localStorage; the bridge token lives in UXP
 * secureStorage and is never hard-coded or written to disk by this plugin.
 *
 * "Render next job" claims a job (GET jobs/next), downloads the contract and assets.zip,
 * unpacks the zip (lib/unzip.js), runs the bundled ExtendScript renderer through
 * app.doScript(..., ScriptLanguage.JAVASCRIPT, [argsFile]) and uploads the result
 * (POST jobs/{id}/result) exactly like the Python bridge does.
 *
 * STATUS: not yet loaded into InDesign (see docs/indesign.md, "Testing status").
 */
"use strict";

const uxp = require("uxp");
const indesign = require("indesign");
const { readZip, utf8Decode } = require("./lib/unzip.js");
const pf = require("./lib/pressflow.js");

const { app, ScriptLanguage } = indesign;
const lfs = uxp.storage.localFileSystem;
const formats = uxp.storage.formats;
const secureStorage = uxp.storage.secureStorage;

const KEYS = {
  apiUrl: "pressflow.apiUrl",
  bridgeId: "pressflow.bridgeId",
  keepOpen: "pressflow.keepOpen",
  token: "pressflow.bridgeToken",
};

const el = (id) => document.getElementById(id);
let busy = false;

class JobFailure extends Error {
  constructor(message, report) {
    super(message);
    this.report = report || null;
  }
}

// ------------------------------------------------------------------ UI helpers
function log(message, cls) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  if (cls) line.className = cls;
  el("log").appendChild(line);
  el("log").scrollTop = el("log").scrollHeight;
}

function setStatus(message, cls) {
  el("status").textContent = message;
  el("status").className = cls || "muted";
}

function setBusy(value) {
  busy = value;
  el("renderJob").disabled = value;
  el("refreshJobs").disabled = value;
  el("saveSettings").disabled = value;
}

// ------------------------------------------------------------------ settings
async function getToken() {
  try {
    const v = await secureStorage.getItem(KEYS.token);
    if (!v) return "";
    return typeof v === "string" ? v : utf8Decode(new Uint8Array(v));
  } catch (e) {
    return "";
  }
}

async function loadSettings() {
  el("apiUrl").value = localStorage.getItem(KEYS.apiUrl) || "";
  let bridgeId = localStorage.getItem(KEYS.bridgeId);
  if (!bridgeId) {
    bridgeId = `uxp-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEYS.bridgeId, bridgeId);
  }
  el("bridgeId").value = bridgeId;
  el("keepOpen").checked = localStorage.getItem(KEYS.keepOpen) !== "false";
  const token = await getToken();
  el("token").placeholder = token ? "saved (leave empty to keep)" : "not set";
}

async function saveSettings() {
  try {
    const apiUrl = pf.normalizeApiUrl(el("apiUrl").value);
    localStorage.setItem(KEYS.apiUrl, apiUrl);
    localStorage.setItem(KEYS.bridgeId, el("bridgeId").value.trim() || `uxp-${Math.random().toString(36).slice(2, 10)}`);
    localStorage.setItem(KEYS.keepOpen, el("keepOpen").checked ? "true" : "false");
    const token = el("token").value.trim();
    if (token) {
      await secureStorage.setItem(KEYS.token, token);
      el("token").value = "";
    }
    await loadSettings();
    el("settingsStatus").textContent = "Saved.";
  } catch (e) {
    el("settingsStatus").textContent = String(e.message || e);
  }
}

async function currentSettings() {
  const apiUrl = pf.normalizeApiUrl(localStorage.getItem(KEYS.apiUrl));
  const token = await getToken();
  if (!token) throw new Error("Bridge token is not set (Settings).");
  return { apiUrl, token, bridgeId: localStorage.getItem(KEYS.bridgeId), keepOpen: localStorage.getItem(KEYS.keepOpen) !== "false" };
}

// ------------------------------------------------------------------ HTTP
async function apiFetch(settings, target, init) {
  const opts = Object.assign({}, init || {});
  opts.headers = Object.assign({}, opts.headers || {});
  // The token only goes to the configured PressFlow API origin (not to e.g. presigned storage URLs).
  if (target.sendToken) opts.headers.Authorization = `Bearer ${settings.token}`;
  const res = await fetch(target.url, opts);
  if (res.status === 401 || res.status === 403) throw new Error(`The API rejected the bridge token (HTTP ${res.status}).`);
  return res;
}

// ------------------------------------------------------------------ queue listing
function renderJobList(jobs, note) {
  const ul = el("jobs");
  ul.innerHTML = "";
  if (note) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = note;
    ul.appendChild(li);
  }
  for (const job of jobs) {
    const li = document.createElement("li");
    li.textContent = `${job.jobId || job.id}  ${job.format || ""}  ${job.exportId ? `(${job.exportId})` : ""}  ${job.createdAt || ""}`;
    ul.appendChild(li);
  }
}

async function refreshJobs() {
  if (busy) return;
  setBusy(true);
  try {
    const s = await currentSettings();
    // Optional listing endpoint; jobs are always claimed through jobs/next.
    const res = await apiFetch(s, pf.resolveUrl(s.apiUrl, `${pf.BRIDGE_PREFIX}/jobs?status=queued`));
    if (res.status === 404 || res.status === 405) {
      renderJobList([], "This API does not offer a queue listing; use \"Render next job\".");
      return;
    }
    if (!res.ok) throw new Error(`Queue listing failed: HTTP ${res.status}`);
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : data.items || data.jobs || [];
    renderJobList(jobs, jobs.length ? null : "No queued jobs.");
    setStatus(`${jobs.length} queued job(s).`);
  } catch (e) {
    setStatus(String(e.message || e), "err");
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ rendering
async function ensureFolder(root, parts) {
  let cur = root;
  for (const part of parts) {
    let next = null;
    try {
      next = await cur.getEntry(part);
    } catch (e) {
      next = null;
    }
    if (next && !next.isFolder) throw new Error(`asset path conflict at ${part}`);
    cur = next || (await cur.createFolder(part));
  }
  return cur;
}

function normalizePath(p) {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

async function unpackAssets(zipBytes, assetsFolder) {
  const entries = readZip(zipBytes); // validates every member name before anything is written
  let files = 0;
  for (const entry of entries) {
    const folder = await ensureFolder(assetsFolder, entry.isDir ? entry.parts : entry.parts.slice(0, -1));
    if (entry.isDir) continue;
    const data = entry.read();
    const file = await folder.createFile(entry.parts[entry.parts.length - 1], { overwrite: true });
    await file.write(data.buffer, { format: formats.binary });
    files++;
  }
  return files;
}

async function processJob(s, job) {
  const urls = pf.jobUrls(s.apiUrl, job);
  const temp = await lfs.getTemporaryFolder();
  const jobFolder = await temp.createFolder(`pressflow-${pf.safeName(job.jobId)}-${Date.now()}`);
  const assetsFolder = await jobFolder.createFolder("assets");
  const outFolder = await jobFolder.createFolder("out");

  setStatus("Downloading contract...");
  let res = await apiFetch(s, urls.contract);
  if (!res.ok) throw new JobFailure(`contract download failed: HTTP ${res.status}`);
  const contractText = await res.text();
  let contract;
  try {
    contract = JSON.parse(contractText);
  } catch (e) {
    throw new JobFailure(`contract is not valid JSON: ${e.message}`);
  }
  const contractFile = await jobFolder.createFile("contract.json", { overwrite: true });
  await contractFile.write(contractText, { format: formats.utf8 });

  setStatus("Downloading assets...");
  res = await apiFetch(s, urls.assets);
  if (res.status === 404 || res.status === 204) {
    if (contract.assets && contract.assets.length) throw new JobFailure("contract lists assets but assets.zip is not available");
    log("No assets.zip for this job.");
  } else if (!res.ok) {
    throw new JobFailure(`assets download failed: HTTP ${res.status}`);
  } else {
    const zip = new Uint8Array(await res.arrayBuffer());
    setStatus(`Unpacking assets (${Math.round(zip.length / 1024)} KB)...`);
    let count;
    try {
      count = await unpackAssets(zip, assetsFolder);
    } catch (e) {
      throw new JobFailure(`unsafe or invalid assets.zip: ${e.message}`);
    }
    log(`Unpacked ${count} asset file(s).`);
  }

  const { args, outputs } = pf.buildRenderArgs(job, {
    contractPath: contractFile.nativePath,
    assetRoot: assetsFolder.nativePath,
    outDir: outFolder.nativePath,
  }, { keepOpen: s.keepOpen });
  const argsFile = await jobFolder.createFile("render-args.json", { overwrite: true });
  await argsFile.write(JSON.stringify(args, null, 2), { format: formats.utf8 });

  setStatus("Rendering in InDesign (the application is busy until this finishes)...");
  log(`Running renderer: outputs ${args.outputs}`);
  const plugin = await lfs.getPluginFolder();
  const jsxText = await (await plugin.getEntry("jsx/pressflow-render.jsx")).read({ format: formats.utf8 });
  let scriptError = null;
  // The args file goes in as doScript's withArguments (arguments[0] in ExtendScript) and, as a
  // fallback, as app.scriptArgs "argsFile"; scriptArgs are cleared afterwards so they cannot leak
  // into a later interactive run of the script.
  try { app.scriptArgs.setValue("argsFile", argsFile.nativePath); } catch (e) { /* optional */ }
  try {
    await Promise.resolve(app.doScript(jsxText, ScriptLanguage.JAVASCRIPT, [argsFile.nativePath]));
  } catch (e) {
    scriptError = String(e.message || e);
    log(`doScript raised: ${scriptError}`, "err");
  } finally {
    try { app.scriptArgs.clear(); } catch (e) { /* optional */ }
  }

  let report;
  try {
    const entry = await outFolder.getEntry("report.json");
    report = JSON.parse(await entry.read({ format: formats.utf8 }));
  } catch (e) {
    throw new JobFailure(`InDesign did not write report.json${scriptError ? ` (${scriptError})` : ""}`);
  }
  log(`Report: ok=${report.ok} pages=${report.pages} overset=${(report.overset || []).length} ` +
    `fontSubstitutions=${(report.substitutedFonts || []).length} missingLinks=${(report.missingLinks || []).length}`);
  for (const sub of report.substitutedFonts || []) log(`Font substituted: ${sub.requested} -> ${sub.used || "(InDesign default)"}`);
  for (const o of report.overset || []) log(`Overset text: page ${o.page} frame ${o.frameId}`, "err");
  if (!report.ok) throw new JobFailure(report.error || "renderer reported failure", report);

  let files;
  try {
    files = pf.resultFiles(report, outputs);
  } catch (e) {
    throw new JobFailure(e.message, report);
  }
  const outRoot = normalizePath(outFolder.nativePath);
  const parts = [{ name: "status", value: "succeeded" }, { name: "report", value: JSON.stringify(report) }];
  for (const f of files) {
    if (normalizePath(f.path).indexOf(`${outRoot}/`) !== 0) throw new JobFailure(`output ${f.kind} is outside the job folder`, report);
    const name = pf.basename(f.path);
    const entry = await outFolder.getEntry(name);
    const data = new Uint8Array(await entry.read({ format: formats.binary }));
    if (!data.length) throw new JobFailure(`output ${f.kind} is empty`, report);
    parts.push({ name: f.field, filename: name, data, contentType: pf.contentTypeFor(name) });
  }

  setStatus("Uploading results...");
  const mp = pf.buildMultipart(parts);
  res = await apiFetch(s, urls.result, { method: "POST", headers: { "Content-Type": mp.contentType }, body: mp.body.buffer });
  if (!res.ok) throw new Error(`result upload failed: HTTP ${res.status}`);
  return report;
}

async function reportFailure(s, job, message, report) {
  try {
    const parts = [{ name: "status", value: "failed" }, { name: "error", value: message.slice(0, 8000) }];
    if (report) parts.push({ name: "report", value: JSON.stringify(report) });
    const mp = pf.buildMultipart(parts);
    const res = await apiFetch(s, pf.jobUrls(s.apiUrl, job).result, { method: "POST", headers: { "Content-Type": mp.contentType }, body: mp.body.buffer });
    log(res.ok ? "Failure reported to PressFlow." : `Could not report failure: HTTP ${res.status}`, res.ok ? null : "err");
  } catch (e) {
    log(`Could not report failure: ${e.message || e}`, "err");
  }
}

async function renderNextJob() {
  if (busy) return;
  setBusy(true);
  let s = null;
  let job = null;
  try {
    s = await currentSettings();
    setStatus("Claiming next job...");
    const res = await apiFetch(s, pf.resolveUrl(s.apiUrl, `${pf.BRIDGE_PREFIX}/jobs/next?bridgeId=${encodeURIComponent(s.bridgeId)}`));
    if (res.status === 204) {
      setStatus("No queued jobs.");
      return;
    }
    if (!res.ok) throw new Error(`jobs/next failed: HTTP ${res.status}`);
    job = await res.json();
    if (!job || !job.jobId) throw new Error("jobs/next returned an unexpected payload");
    log(`Claimed job ${job.jobId} (format ${job.format}, export ${job.exportId || "-"})`);
    const report = await processJob(s, job);
    setStatus(`Job ${job.jobId} rendered and uploaded (${report.pages} page(s)).`, "ok");
    log("Done.", "ok");
  } catch (e) {
    const message = String(e.message || e);
    setStatus(message, "err");
    log(message, "err");
    if (job && s) await reportFailure(s, job, message, e.report || null);
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ wiring
function init() {
  el("saveSettings").addEventListener("click", saveSettings);
  el("refreshJobs").addEventListener("click", refreshJobs);
  el("renderJob").addEventListener("click", renderNextJob);
  loadSettings().catch((e) => setStatus(String(e.message || e), "err"));
}

try {
  uxp.entrypoints.setup({ panels: { pressflowPanel: { show() {} } } });
} catch (e) {
  // entrypoints.setup is optional for HTML panels and may only be called once.
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
