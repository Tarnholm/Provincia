// dig-rle6.js — Catalogue per-record tail strings, decode the structure
// of the tail (it's an array of discovered-settlement entries with the
// W_<culture>_<size>_Town/City labels).
//
// Confirm major-faction count = recs 0..22 or similar, and the
// "tail diff in build-queue pair" is per-faction discovered-settlement
// list for Roma's buildings.

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

function findAllMagic(buf, hint = 0) {
  const o = [];
  let p = hint;
  while (true) {
    const i = buf.indexOf(MAGIC, p);
    if (i < 0) break;
    o.push(i);
    p = i + 4;
  }
  return o;
}

function loadAllRecs(name) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, name));
  const offs = findAllMagic(buf, 0x1f00000);
  const recs = [];
  for (let i = 0; i < offs.length; i++) {
    const start = offs[i] - 8;
    const next = i + 1 < offs.length ? offs[i + 1] - 8 : null;
    recs.push({ start, magicOff: offs[i], end: next, payloadStart: offs[i] + 12 });
  }
  return { buf, recs };
}

function findRleEnd(buf, payloadStart, payloadEnd, W = 1020, H = 700) {
  let cursor = 0;
  let p = payloadStart;
  while (p < payloadEnd - 1 && cursor < W * H) {
    const c = buf[p + 1];
    cursor += c;
    p += 2;
  }
  return p;
}

// Extract ASCII strings from a tail
function extractStrings(buf, start, end) {
  const strings = [];
  let p = start;
  while (p < end - 4) {
    // Look for u16 length prefix then ASCII run
    const len = buf.readUInt16LE(p);
    if (len > 4 && len < 64 && p + 2 + len <= end) {
      const slice = buf.subarray(p + 2, p + 2 + len);
      let ok = true;
      for (const c of slice) { if (c < 0x20 || c > 0x7e) { ok = false; break; } }
      if (ok) {
        strings.push({ off: p, str: slice.toString("ascii") });
        p += 2 + len;
        continue;
      }
    }
    p++;
  }
  return strings;
}

const A = loadAllRecs("save_1.2.sav");
console.log(`=== save_1.2 per-record summary (mask size, tail size, first tail strings) ===`);
console.log(`(Total: ${A.recs.length} records)`);
console.log(`rec | recLen | rleLen | tailLen | nzCells | first tail strings`);

function decodeNonZero(buf, payloadStart, rleEnd, W = 1020, H = 700) {
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  for (let p = payloadStart; p < rleEnd; p += 2) {
    const v = buf[p];
    const c = buf[p + 1];
    for (let k = 0; k < c && cursor < mask.length; k++) mask[cursor++] = v;
  }
  let nz = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) nz++;
  return nz;
}

const summary = [];
for (let i = 0; i < A.recs.length - 1; i++) {
  const r = A.recs[i];
  if (!r.end) continue;
  const rleEnd = findRleEnd(A.buf, r.payloadStart, r.end);
  const recLen = r.end - r.start;
  const rleLen = rleEnd - r.payloadStart;
  const tailLen = r.end - rleEnd;
  const nz = decodeNonZero(A.buf, r.payloadStart, rleEnd);
  const strings = extractStrings(A.buf, rleEnd, r.end);
  summary.push({ rec: i, recLen, rleLen, tailLen, nz, strings: strings.map(s => s.str).slice(0, 6) });
}

// Print first 50 + a sample of minor faction recs + last
const printRows = [...summary.slice(0, 50), ...summary.filter(s => s.rec >= 100 && s.rec <= 102 || s.rec === 237)];
for (const s of printRows) {
  const strs = s.strings.length > 0 ? s.strings.slice(0, 4).join(", ") : "(no strings)";
  console.log(`${s.rec.toString().padStart(3)} | ${s.recLen.toString().padStart(6)} | ${s.rleLen.toString().padStart(6)} | ${s.tailLen.toString().padStart(5)} | ${s.nz.toString().padStart(7)} | ${strs}`);
}

// Distribution of tailLen
const tailLens = summary.map(s => s.tailLen).sort((a, b) => a - b);
console.log(`\ntailLen distribution: min=${tailLens[0]} p25=${tailLens[Math.floor(tailLens.length / 4)]} med=${tailLens[Math.floor(tailLens.length / 2)]} p75=${tailLens[Math.floor(tailLens.length * 3 / 4)]} max=${tailLens.at(-1)}`);

// Group records by tailLen ranges
const tlBuckets = {
  "stub_148": summary.filter(s => s.tailLen === 148).length,
  "stub_160ish": summary.filter(s => s.tailLen >= 100 && s.tailLen <= 300 && s.tailLen !== 148).length,
  "small_300_1000": summary.filter(s => s.tailLen > 300 && s.tailLen <= 1000).length,
  "medium_1000_2000": summary.filter(s => s.tailLen > 1000 && s.tailLen <= 2000).length,
  "large_2000_5000": summary.filter(s => s.tailLen > 2000 && s.tailLen <= 5000).length,
  "huge_5000plus": summary.filter(s => s.tailLen > 5000).length,
};
console.log(`\nTail-length buckets:`, tlBuckets);

// nzCells distribution
const nzs = summary.map(s => s.nz).sort((a, b) => a - b);
console.log(`nz cells distribution: min=${nzs[0]} p25=${nzs[Math.floor(nzs.length / 4)]} med=${nzs[Math.floor(nzs.length / 2)]} p75=${nzs[Math.floor(nzs.length * 3 / 4)]} max=${nzs.at(-1)}`);

// How many records have non-stub tails (>200B) vs stub (148B / 168B)?
const nonStub = summary.filter(s => s.tailLen > 250).length;
console.log(`\nRecords with non-stub tail (>250B): ${nonStub}`);
const idsNonStub = summary.filter(s => s.tailLen > 250).map(s => s.rec);
console.log(`Non-stub record indices: ${idsNonStub.join(", ")}`);
