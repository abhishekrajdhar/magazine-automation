/*
 * Minimal ZIP reader + raw DEFLATE decoder (RFC 1951) for the PressFlow UXP panel.
 * UXP has no built-in unzip, so assets.zip is unpacked here. Plain JS, no dependencies;
 * unit-tested under Node (services/indesign/tests/js/uxp_libs.test.js).
 *
 * Supports stored (0) and deflate (8) entries, verifies CRC-32, rejects encrypted entries,
 * ZIP64, symlinks, absolute paths and ".." traversal, and enforces an output size limit.
 */
"use strict";

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildHuffman(lengths) {
  const count = new Uint16Array(16);
  const offs = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let len = 1; len < 16; len++) offs[len] = offs[len - 1] + count[len - 1];
  const symbol = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}

let FIXED = null;
function fixedTables() {
  if (!FIXED) {
    const l = new Uint8Array(288);
    for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
    const d = new Uint8Array(30).fill(5);
    FIXED = { len: buildHuffman(l), dist: buildHuffman(d) };
  }
  return FIXED;
}

/** Decode raw DEFLATE data. maxSize guards against decompression bombs. */
function inflateRaw(input, expectedSize, maxSize) {
  const limit = maxSize || 1 << 30;
  let out = new Uint8Array(Math.min(limit, expectedSize > 0 ? expectedSize : Math.max(1024, input.length * 3)));
  let outPos = 0;
  let inPos = 0;
  let bitBuf = 0;
  let bitCnt = 0;

  function ensure(n) {
    if (outPos + n > limit) throw new Error("inflate: output exceeds size limit");
    if (outPos + n > out.length) {
      const bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, outPos + n)));
      bigger.set(out.subarray(0, outPos));
      out = bigger;
    }
  }
  function bits(n) {
    while (bitCnt < n) {
      if (inPos >= input.length) throw new Error("inflate: unexpected end of data");
      bitBuf |= input[inPos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  }
  function decode(h) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("inflate: invalid Huffman code");
  }
  function codes(lencode, distcode) {
    for (;;) {
      let sym = decode(lencode);
      if (sym < 256) {
        ensure(1);
        out[outPos++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        sym -= 257;
        if (sym >= 29) throw new Error("inflate: invalid length symbol");
        const len = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(distcode);
        if (ds >= 30) throw new Error("inflate: invalid distance symbol");
        const dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > outPos) throw new Error("inflate: distance too far back");
        ensure(len);
        for (let i = 0; i < len; i++) {
          out[outPos] = out[outPos - dist];
          outPos++;
        }
      }
    }
  }
  function stored() {
    bitBuf = 0;
    bitCnt = 0;
    if (inPos + 4 > input.length) throw new Error("inflate: truncated stored block");
    const len = input[inPos] | (input[inPos + 1] << 8);
    const nlen = input[inPos + 2] | (input[inPos + 3] << 8);
    inPos += 4;
    if (len !== (~nlen & 0xffff)) throw new Error("inflate: stored block length mismatch");
    if (inPos + len > input.length) throw new Error("inflate: truncated stored block");
    ensure(len);
    out.set(input.subarray(inPos, inPos + len), outPos);
    outPos += len;
    inPos += len;
  }
  function dynamic() {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new Error("inflate: bad dynamic block counts");
    const cl = new Uint8Array(19);
    for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
    const clcode = buildHuffman(cl);
    const lengths = new Uint8Array(nlen + ndist);
    let index = 0;
    while (index < nlen + ndist) {
      const sym = decode(clcode);
      if (sym < 16) {
        lengths[index++] = sym;
      } else {
        let len = 0;
        let rep;
        if (sym === 16) {
          if (index === 0) throw new Error("inflate: repeat with no previous length");
          len = lengths[index - 1];
          rep = 3 + bits(2);
        } else if (sym === 17) {
          rep = 3 + bits(3);
        } else {
          rep = 11 + bits(7);
        }
        if (index + rep > nlen + ndist) throw new Error("inflate: too many code lengths");
        while (rep--) lengths[index++] = len;
      }
    }
    if (lengths[256] === 0) throw new Error("inflate: missing end-of-block code");
    codes(buildHuffman(lengths.subarray(0, nlen)), buildHuffman(lengths.subarray(nlen)));
  }

  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) stored();
    else if (type === 1) { const f = fixedTables(); codes(f.len, f.dist); }
    else if (type === 2) dynamic();
    else throw new Error("inflate: invalid block type");
  } while (!last);
  return out.slice(0, outPos);
}

let CRC_TABLE = null;
function crc32(data) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Decode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let cp;
    if (b < 0x80) cp = b;
    else if (b >= 0xc0 && b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b >= 0xe0 && b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    s += String.fromCodePoint(cp);
  }
  return s;
}

/** Validate an archive member name; returns its path segments or throws. */
function safeEntryParts(name) {
  if (name.indexOf("\0") >= 0 || name.indexOf(":") >= 0) throw new Error(`unsafe archive member name: ${name}`);
  const n = name.replace(/\\/g, "/");
  if (n.charAt(0) === "/" || /^[A-Za-z]:/.test(n)) throw new Error(`absolute path in archive: ${name}`);
  const parts = n.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error(`path traversal in archive: ${name}`);
  return parts;
}

/**
 * Parse a ZIP archive. Returns [{name, parts, isDir, size, read(): Uint8Array}].
 * All member names are validated before anything is returned.
 */
function readZip(buffer, options) {
  const opts = options || {};
  const maxFiles = opts.maxFiles || 20000;
  const maxTotal = opts.maxTotalBytes || 4 * 1024 * 1024 * 1024;
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a ZIP archive (no end of central directory)");
  const total = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  if (total > maxFiles) throw new Error(`archive has ${total} entries (limit ${maxFiles})`);
  const entries = [];
  let p = cdOffset;
  let declared = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > data.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt central directory");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const extAttr = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    const nameBytes = data.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? utf8Decode(nameBytes) : String.fromCharCode.apply(null, Array.from(nameBytes));
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`encrypted archive member: ${name}`);
    if (((extAttr >>> 16) & 0xf000) === 0xa000) throw new Error(`symlink in archive: ${name}`);
    const parts = safeEntryParts(name);
    if (!parts.length) continue;
    const isDir = name.endsWith("/") || name.endsWith("\\");
    if (!isDir && method !== 0 && method !== 8) throw new Error(`unsupported compression method ${method} for ${name}`);
    declared += size;
    if (declared > maxTotal) throw new Error(`archive expands beyond ${maxTotal} bytes`);
    entries.push({
      name,
      parts,
      isDir,
      size,
      read() {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const raw = data.subarray(start, start + compSize);
        const out = method === 0 ? raw.slice() : inflateRaw(raw, size, size);
        if (out.length !== size) throw new Error(`size mismatch for ${name}`);
        if (crc32(out) !== crc) throw new Error(`CRC mismatch for ${name}`);
        return out;
      },
    });
  }
  return entries;
}

module.exports = { inflateRaw, readZip, safeEntryParts, crc32, utf8Decode };
