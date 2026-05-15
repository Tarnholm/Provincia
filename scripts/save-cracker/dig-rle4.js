// dig-rle4.js — Verify rec 0 == Romans (player) by checking:
//   (a) ship moved from game-tile (172,92) -> (171,99).
//   (b) tile-grid 1020x700 = high-res RIS region map.
//   (c) game-tile-to-pixel scale should map (171,99) -> ~(340, 380).
//
// Also: are the 23 records that have PAYLOAD diffs after build-queue change
// exactly recs 0..22 = the 23 majors?
//
// And: header-only-diff means a -8..0 header field changed; the magic+4/+8
// width/height stayed. So the "header" diff is one of the -24..-1 bytes.
// Let's see WHICH bytes inside the header changed across many records to
// classify it as: hash-rotation / counter / etc.

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

// Q1: which records have PAYLOAD diffs in build-queue change?
const A = loadAllRecs("save_1.2.sav");
const B = loadAllRecs("save_2.2.sav");
const recsWithPayloadDiff = [];
for (let i = 0; i < A.recs.length - 1; i++) {
  const a = A.recs[i], b = B.recs[i];
  if (a.end - a.start !== b.end - b.start) {
    recsWithPayloadDiff.push({ rec: i, sizeChange: true });
    continue;
  }
  const headLen = a.payloadStart - a.start;
  let payloadDiff = 0;
  for (let k = headLen; k < a.end - a.start; k++) {
    if (A.buf[a.start + k] !== B.buf[b.start + k]) payloadDiff++;
  }
  if (payloadDiff > 0) recsWithPayloadDiff.push({ rec: i, payloadDiff });
}
console.log(`save_1.2 -> save_2.2: records with PAYLOAD diff:`);
for (const r of recsWithPayloadDiff) console.log(`  ${JSON.stringify(r)}`);

// Q2: For each such record, what's the bbox of changed cells (centroid)?
function decodeRle(buf, start, end, W = 1020, H = 700) {
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  let p = start;
  while (p < end - 1 && cursor < mask.length) {
    const v = buf[p];
    const c = buf[p + 1];
    for (let k = 0; k < c && cursor < mask.length; k++) mask[cursor++] = v;
    p += 2;
  }
  return mask;
}

console.log(`\nPer-changed-record cell-diff bbox:`);
for (const r of recsWithPayloadDiff) {
  if (r.sizeChange) continue;
  const a = A.recs[r.rec], b = B.recs[r.rec];
  const ma = decodeRle(A.buf, a.payloadStart, a.end);
  const mb = decodeRle(B.buf, b.payloadStart, b.end);
  let cellDiffs = 0;
  let bbox = { minX: 1020, maxX: 0, minY: 700, maxY: 0 };
  let sumX = 0, sumY = 0;
  for (let y = 0; y < 700; y++) for (let x = 0; x < 1020; x++) {
    const i = y * 1020 + x;
    if (ma[i] !== mb[i]) {
      cellDiffs++;
      sumX += x; sumY += y;
      if (x < bbox.minX) bbox.minX = x;
      if (x > bbox.maxX) bbox.maxX = x;
      if (y < bbox.minY) bbox.minY = y;
      if (y > bbox.maxY) bbox.maxY = y;
    }
  }
  // Total non-zero in A
  let nzA = 0, sxA = 0, syA = 0;
  for (let y = 0; y < 700; y++) for (let x = 0; x < 1020; x++) {
    const i = y * 1020 + x;
    if (ma[i] !== 0) { nzA++; sxA += x; syA += y; }
  }
  const cx = cellDiffs ? sumX / cellDiffs : 0;
  const cy = cellDiffs ? sumY / cellDiffs : 0;
  const acx = nzA ? sxA / nzA : 0;
  const acy = nzA ? syA / nzA : 0;
  console.log(`  rec ${r.rec.toString().padStart(3)}: bytePD=${(r.payloadDiff || "size").toString().padStart(3)} cellDiffs=${cellDiffs.toString().padStart(4)} bbox=X[${bbox.minX}..${bbox.maxX}] Y[${bbox.minY}..${bbox.maxY}] diff-centroid=(${cx.toFixed(0)},${cy.toFixed(0)}) faction-centroid(A)=(${acx.toFixed(0)},${acy.toFixed(0)}) nzA=${nzA}`);
}

// Q3: rec 0 in save_5 -> save_6 ship-move pair, header bytes -8..-1
const C = loadAllRecs("save_5.2.sav");
const D = loadAllRecs("save_6.2.sav");
function hex24(buf, off) {
  return [...buf.subarray(off - 24, off + 12)].map(b => b.toString(16).padStart(2, "0")).join(" ");
}
console.log(`\nrec 0 header pre-magic ship-move:`);
console.log(`A:  ${hex24(C.buf, C.recs[0].magicOff)}`);
console.log(`B:  ${hex24(D.buf, D.recs[0].magicOff)}`);
console.log(`(rec 0 header has 0 diffs per dig-rle3 — confirmed via payloadDiff=403, headerDiff=0)`);

// Q4: in save_1 -> save_2, the 214 records with ONLY-header diff — what
// bytes change? Sample a few.
console.log(`\nHeader-only-diff sample (save_1 -> save_2):`);
let samples = 0;
for (let i = 0; i < A.recs.length - 1 && samples < 5; i++) {
  const a = A.recs[i], b = B.recs[i];
  if (a.end - a.start !== b.end - b.start) continue;
  const headLen = a.payloadStart - a.start;
  let payloadDiff = 0;
  for (let k = headLen; k < a.end - a.start; k++) {
    if (A.buf[a.start + k] !== B.buf[b.start + k]) payloadDiff++;
  }
  if (payloadDiff !== 0) continue;
  // print header bytes
  const ha = [...A.buf.subarray(a.start, a.payloadStart)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const hb = [...B.buf.subarray(b.start, b.payloadStart)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  let xors = [];
  for (let k = 0; k < a.payloadStart - a.start; k++) {
    if (A.buf[a.start + k] !== B.buf[b.start + k]) xors.push(`+${k}`);
  }
  console.log(`  rec ${i}: diffOffs=${xors.join(",")}`);
  console.log(`    A: ${ha}`);
  console.log(`    B: ${hb}`);
  samples++;
}
