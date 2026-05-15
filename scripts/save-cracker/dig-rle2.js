// dig-rle2.js — Focus on rec 0 across ship-move (save_5.2 → save_6.2).
// Only rec 0 changed bytes (403 diffs in 12346 B). Decode both records'
// RLE payloads and find which CELLS changed: do they map to tiles
// near the ship's new position? Also confirm rec 0 is the player faction
// (Romans), as session 17 suggested via centroid (339,374) ≈ Italy.

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

function loadRecord0(name) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, name));
  const offs = findAllMagic(buf, 0x1f00000);
  const rec0Magic = offs[0];
  const rec0Start = rec0Magic - 8;
  const rec1Magic = offs[1];
  const rec1Start = rec1Magic - 8;
  const payloadStart = rec0Magic + 12; // after magic(4) + width(4) + height(4)
  const payloadEnd = rec1Start;        // ends at start of next record
  return { name, buf, rec0Start, rec0Magic, payloadStart, payloadEnd, recBytes: buf.subarray(rec0Start, rec1Start) };
}

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
  return { mask, bytesRead: p - start, cursorFilled: cursor };
}

const A = loadRecord0("save_5.2.sav");
const B = loadRecord0("save_6.2.sav");

console.log(`rec0 A range = 0x${A.rec0Start.toString(16)} .. 0x${A.payloadEnd.toString(16)}  bytes=${A.payloadEnd - A.rec0Start}`);
console.log(`rec0 B range = 0x${B.rec0Start.toString(16)} .. 0x${B.payloadEnd.toString(16)}  bytes=${B.payloadEnd - B.rec0Start}`);
console.log(`payloadA bytes = ${A.payloadEnd - A.payloadStart}`);
console.log(`payloadB bytes = ${B.payloadEnd - B.payloadStart}`);

// Where exactly do the bytes differ inside rec0?
const bytesA = A.recBytes;
const bytesB = B.recBytes;
const diffs = [];
const len = Math.min(bytesA.length, bytesB.length);
for (let k = 0; k < len; k++) {
  if (bytesA[k] !== bytesB[k]) diffs.push(k);
}
console.log(`\nByte diffs in rec0: ${diffs.length}`);
console.log(`First 30 diff offsets (rec-relative): ${diffs.slice(0, 30).join(", ")}`);
console.log(`Last 10 diff offsets: ${diffs.slice(-10).join(", ")}`);

// Header diff (first 24 B)
console.log(`\nHeader bytes A vs B (first 32 B):`);
console.log(`A: ${[...bytesA.subarray(0, 32)].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
console.log(`B: ${[...bytesB.subarray(0, 32)].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);

// Decode the masks
const decA = decodeRle(A.buf, A.payloadStart, A.payloadEnd);
const decB = decodeRle(B.buf, B.payloadStart, B.payloadEnd);
console.log(`\ndecode A: bytesRead=${decA.bytesRead}/${A.payloadEnd - A.payloadStart} cells=${decA.cursorFilled} (expected 714000)`);
console.log(`decode B: bytesRead=${decB.bytesRead}/${B.payloadEnd - B.payloadStart} cells=${decB.cursorFilled}`);

// Compare cells, log a count by region (which cells changed?)
const W = 1020, H = 700;
let cellDiffs = 0;
let nonZeroA = 0, nonZeroB = 0;
const cellsChanged = [];
let bboxC = { minX: W, maxX: 0, minY: H, maxY: 0 };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (decA.mask[i] !== 0) nonZeroA++;
    if (decB.mask[i] !== 0) nonZeroB++;
    if (decA.mask[i] !== decB.mask[i]) {
      cellDiffs++;
      if (cellsChanged.length < 100) cellsChanged.push({ x, y, a: decA.mask[i], b: decB.mask[i] });
      if (x < bboxC.minX) bboxC.minX = x;
      if (x > bboxC.maxX) bboxC.maxX = x;
      if (y < bboxC.minY) bboxC.minY = y;
      if (y > bboxC.maxY) bboxC.maxY = y;
    }
  }
}
console.log(`\nrec0 mask: A nonZero=${nonZeroA}  B nonZero=${nonZeroB}`);
console.log(`Cells changed: ${cellDiffs}`);
console.log(`Changed bbox: X=[${bboxC.minX}..${bboxC.maxX}] Y=[${bboxC.minY}..${bboxC.maxY}]`);
console.log(`\nFirst 30 changed cells:`);
for (const c of cellsChanged.slice(0, 30)) {
  console.log(`  (${c.x},${c.y}) A=${c.a} B=${c.b}`);
}

// Ship moved from (172,92) to (171,99) per session 37.
// These are tile coords. The mask is 1020x700; map_regions_large.tga
// is 1020x700. Are tile coords (172,92) directly in the mask space, or
// scaled? Session 17 said map_regions_large.tga is 1020x700 — implying
// the mask IS the high-res RIS region map.
//
// In the RIS save's expected tile space (1020,700 is the high-res),
// the ship at (172, 99) in the game's tile coords would not be at
// pixel (172,99) — game tiles are coarser. But let's just look at
// the changed-cell region.
console.log(`\nShip moved (172,92) -> (171,99). Changed bbox covers? Yes if minX<=171<=maxX & minY<=99<=maxY: ${bboxC.minX <= 172 && bboxC.maxX >= 171 && bboxC.minY <= 99 && bboxC.maxY >= 99 ? "YES" : "NO"}`);

// Get centroid of changed cells
let sumX = 0, sumY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (decA.mask[i] !== decB.mask[i]) { sumX += x; sumY += y; }
  }
}
if (cellDiffs > 0) {
  console.log(`Centroid of changed cells: (${(sumX / cellDiffs).toFixed(1)}, ${(sumY / cellDiffs).toFixed(1)})`);
}

// What VALUES appear in the diff (going from A->B)?
const transitionHist = new Map();
for (let i = 0; i < W * H; i++) {
  if (decA.mask[i] !== decB.mask[i]) {
    const k = `${decA.mask[i]}->${decB.mask[i]}`;
    transitionHist.set(k, (transitionHist.get(k) || 0) + 1);
  }
}
console.log(`\nValue transitions (top 20):`);
const top = [...transitionHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [k, c] of top) console.log(`  ${k}: ${c} cells`);
