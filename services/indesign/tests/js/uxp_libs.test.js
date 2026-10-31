/*
 * Node unit tests for the UXP panel's host-independent libraries.
 * Run: node --test services/indesign/tests/js/uxp_libs.test.js   (pytest runs this too: tests/test_uxp.py)
 * Optional: PRESSFLOW_ZIP_FIXTURE=<zip made by Python zipfile> PRESSFLOW_ZIP_EXPECTED=<json {name: base64}>
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const UXP = path.resolve(__dirname, "../../uxp");
const { inflateRaw, readZip, safeEntryParts, crc32 } = require(path.join(UXP, "lib/unzip.js"));
const pf = require(path.join(UXP, "lib/pressflow.js"));

// ---------------------------------------------------------------- tiny ZIP writer for tests
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data || "");
    const comp = e.method === 0 ? data : zlib.deflateRawSync(data, { level: e.level === undefined ? 6 : e.level });
    const crc = crc32(new Uint8Array(data));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(e.method === 0 ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800 | (e.encrypted ? 1 : 0), 8);
    central.writeUInt16LE(e.method === 0 ? 0 : 8, 10);
    central.writeUInt32LE(e.badCrc ? (crc ^ 1) >>> 0 : crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode || 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

// ---------------------------------------------------------------- inflate
test("inflateRaw matches zlib for text, random, repetitive and empty data", () => {
  const samples = [
    Buffer.from(""),
    Buffer.from("Building the Rails for a Digital Bharat ".repeat(500)),
    crypto.randomBytes(70000),
    Buffer.alloc(200000, 7),
    Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 7919) % 251)),
  ];
  for (const s of samples) {
    for (const level of [0, 1, 6, 9]) {
      const comp = zlib.deflateRawSync(s, { level });
      const out = inflateRaw(new Uint8Array(comp), s.length);
      assert.equal(Buffer.compare(Buffer.from(out), s), 0, `level ${level} length ${s.length}`);
    }
  }
});

test("inflateRaw grows its buffer when size is unknown and enforces the limit", () => {
  const s = Buffer.from("abc".repeat(10000));
  const comp = new Uint8Array(zlib.deflateRawSync(s));
  assert.equal(Buffer.from(inflateRaw(comp, 0)).toString(), s.toString());
  assert.throws(() => inflateRaw(comp, 0, 1000), /size limit/);
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff]), 10), /inflate/);
});

// ---------------------------------------------------------------- zip reader
test("readZip extracts stored and deflated members with CRC verification", () => {
  const jpeg = crypto.randomBytes(30000);
  const zip = makeZip([
    { name: "photos/ast_0001.jpg", data: jpeg, method: 0 },
    { name: "text/caption.txt", data: "Delegates at the inaugural session ".repeat(100) },
    { name: "photos/", data: "" },
  ]);
  const entries = readZip(zip);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  assert.deepEqual(byName["photos/ast_0001.jpg"].parts, ["photos", "ast_0001.jpg"]);
  assert.equal(Buffer.compare(Buffer.from(byName["photos/ast_0001.jpg"].read()), jpeg), 0);
  assert.match(Buffer.from(byName["text/caption.txt"].read()).toString(), /^Delegates at/);
  assert.equal(byName["photos/"].isDir, true);
});

test("readZip rejects traversal, absolute paths, symlinks, encryption and bad CRCs", () => {
  for (const name of ["../evil", "a/../../evil", "/etc/passwd", "C:/x.dll", "..\\..\\evil", "a:b"]) {
    assert.throws(() => readZip(makeZip([{ name, data: "x" }])), /traversal|absolute|unsafe/, name);
  }
  assert.throws(() => readZip(makeZip([{ name: "link", data: "/etc/passwd", mode: 0o120777 }])), /symlink/);
  assert.throws(() => readZip(makeZip([{ name: "secret", data: "x", encrypted: true }])), /encrypted/);
  const bad = readZip(makeZip([{ name: "a.txt", data: "hello world", badCrc: true }]));
  assert.throws(() => bad[0].read(), /CRC/);
  assert.throws(() => readZip(new Uint8Array(100)), /not a ZIP/);
  assert.throws(() => readZip(makeZip([{ name: "a", data: "x" }, { name: "b", data: "y" }]), { maxFiles: 1 }), /entries/);
  assert.throws(() => readZip(makeZip([{ name: "a", data: "x".repeat(5000) }]), { maxTotalBytes: 100 }), /expands/);
});

test("safeEntryParts normalises harmless segments", () => {
  assert.deepEqual(safeEntryParts("./photos//a.jpg"), ["photos", "a.jpg"]);
  assert.deepEqual(safeEntryParts("photos\\b.jpg"), ["photos", "b.jpg"]);
});

test("readZip reads an archive produced by Python zipfile (when provided)", { skip: !process.env.PRESSFLOW_ZIP_FIXTURE }, () => {
  const zip = new Uint8Array(fs.readFileSync(process.env.PRESSFLOW_ZIP_FIXTURE));
  const expected = JSON.parse(fs.readFileSync(process.env.PRESSFLOW_ZIP_EXPECTED, "utf8"));
  const got = {};
  for (const e of readZip(zip)) if (!e.isDir) got[e.name] = Buffer.from(e.read()).toString("base64");
  assert.deepEqual(got, expected);
});

// ---------------------------------------------------------------- panel helpers
test("format mapping and render args mirror the Python bridge", () => {
  assert.deepEqual(pf.outputsForFormat("pdf"), ["indd", "pdf_digital"]);
  assert.deepEqual(pf.outputsForFormat("PDF_PRINT"), ["indd", "pdf_print"]);
  assert.throws(() => pf.outputsForFormat("docx"), /unsupported/);
  const { args, outputs } = pf.buildRenderArgs(
    { jobId: "job_1", exportId: "exp_1", format: "pdf_print", options: { pdfPreset: "[PDF/X-1a:2001]", includeBleed: true } },
    { contractPath: "/t/c.json", assetRoot: "/t/assets", outDir: "/t/out" },
    { keepOpen: true }
  );
  assert.deepEqual(outputs, ["indd", "pdf_print"]);
  assert.equal(args.outputs, "indd,pdf_print");
  assert.equal(args.pdfPresetPrint, "[PDF/X-1a:2001]");
  assert.equal(args.includeBleed, "true");
  assert.equal(args.closeDocument, "false");
  assert.equal(args.baseName, "pressflow-exp_1");
  assert.ok(Object.values(args).every((v) => typeof v === "string"));
});

test("token is only sent to the API origin", () => {
  const api = pf.normalizeApiUrl("https://api.pressflow.test/");
  assert.equal(api, "https://api.pressflow.test");
  const urls = pf.jobUrls(api, { jobId: "job 1", assetsUrl: "https://bucket.s3.amazonaws.com/a.zip?sig=1" });
  assert.equal(urls.contract.url, "https://api.pressflow.test/api/v1/indesign/bridge/jobs/job%201/contract");
  assert.equal(urls.contract.sendToken, true);
  assert.equal(urls.assets.sendToken, false);
  assert.equal(urls.result.url, "https://api.pressflow.test/api/v1/indesign/bridge/jobs/job%201/result");
  assert.throws(() => pf.normalizeApiUrl("ftp://x"), /http/);
});

test("resultFiles maps outputs to multipart fields", () => {
  const report = { ok: true, outputs: { indd: "/o/a.indd", pdf_print: "/o/a-print.pdf", pdf_digital: null } };
  assert.deepEqual(pf.resultFiles(report, ["indd", "pdf_print"]).map((f) => f.field), ["indd", "pdf"]);
  assert.throws(() => pf.resultFiles(report, ["indd", "pdf_digital"]), /pdf_digital/);
  assert.equal(pf.basename("C:\\out\\a.indd"), "a.indd");
});

test("buildMultipart produces a well-formed body", () => {
  const file = new Uint8Array([0, 1, 2, 255]);
  const { body, contentType } = pf.buildMultipart(
    [{ name: "status", value: "succeeded" }, { name: "report", value: "{\"x\":\"\u00e9\"}" }, { name: "indd", filename: "a.indd", data: file }],
    "BOUNDARY"
  );
  assert.equal(contentType, "multipart/form-data; boundary=BOUNDARY");
  const text = Buffer.from(body).toString("latin1");
  assert.ok(text.startsWith('--BOUNDARY\r\nContent-Disposition: form-data; name="status"\r\n\r\nsucceeded\r\n'));
  assert.ok(text.includes('name="indd"; filename="a.indd"\r\nContent-Type: application/octet-stream\r\n\r\n\x00\x01\x02\xff\r\n'));
  assert.ok(text.endsWith("--BOUNDARY--\r\n"));
  assert.ok(Buffer.from(body).includes(Buffer.from('{"x":"\u00e9"}', "utf8")));
});
