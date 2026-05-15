// dig-35stride1.js
// Session 66 attempt 1: decode the 35-byte stride table at 0x44e2..~0x2a25d
// Session 57 confirmed 35-byte stride via 1e 00 00 00 markers every 35 bytes.
// Goal: row semantics.
//
// Plan:
// 1. Sweep the region from 0x44e2..0x2a25d looking for the precise stride
//    anchor — what's the FIRST offset that opens a 35-byte run?
// 2. Walk all rows, dumping each as bytes + parsed candidate fields.
// 3. Aggregate stats per column offset (within the 35-byte row):
//      - distinct value count
//      - min/max
//      - monotonic flag
//      - constancy
//      - matches against known UUID/character/settlement maps
// 4. Print first/last 8 rows raw + first/last 8 fields summary.
// 5. Count total rows; check divisibility by known entity counts.

const fs = require("fs");
const PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(PATH);
console.log(`save size: ${buf.length} bytes (0x${buf.length.toString(16)})`);

const START = 0x44e2;
const END   = 0x2a25d; // session 57 boundary
console.log(`region: 0x${START.toString(16)}..0x${END.toString(16)}  (${END-START} bytes)`);

// ------------------------------------------------------------
// Step 1: confirm stride anchor.
// Session 57 said "1e 00 00 00" every 35 bytes from 0x4564.
// Sweep all offsets 0..40 to find the best 1e-aligned start.
// ------------------------------------------------------------
console.log("\n=== stride anchor sweep ===");
let bestAnchor = -1, bestCount = -1, bestStride = -1;
for (let stride = 33; stride <= 40; stride++) {
  for (let phase = 0; phase < stride; phase++) {
    let count = 0;
    let p = START + phase;
    while (p < END - 4) {
      if (buf.readUInt32LE(p) === 0x0000001e) count++;
      p += stride;
    }
    if (count > bestCount) {
      bestCount = count; bestStride = stride; bestAnchor = phase;
    }
  }
}
console.log(`best: stride=${bestStride}, phase=${bestAnchor}, count=${bestCount}`);

// More targeted: find first byte after 0x44e2 with 1e at +N within stride 35
// for a long run of 35-stride matches.
function countAt(start, stride) {
  let c = 0, p = start;
  while (p + 4 <= END) {
    if (buf.readUInt32LE(p) === 0x0000001e) c++;
    p += stride;
  }
  return c;
}
console.log("\n=== probing anchors around 0x4564 (35-stride) ===");
for (let a = 0x4560; a <= 0x4580; a++) {
  const c = countAt(a, 35);
  if (c > 50) console.log(`  anchor 0x${a.toString(16)}: ${c} hits at +0`);
}
// Try a few likely byte offsets of the 1e marker within row
for (let inner = 0; inner < 35; inner++) {
  const anchor = 0x4564 + inner;
  const c = countAt(anchor, 35);
  if (c > 1000) console.log(`  anchor 0x${anchor.toString(16)} (offset+${inner}): ${c} hits`);
}

// ------------------------------------------------------------
// Step 2: scan 1e 00 00 00 occurrences and confirm spacing
// ------------------------------------------------------------
console.log("\n=== 1e marker spacing histogram ===");
const positions = [];
for (let p = START; p + 4 <= END; p++) {
  if (buf.readUInt32LE(p) === 0x0000001e) positions.push(p);
}
console.log(`total 0x1e000000 markers in region: ${positions.length}`);
const deltaHist = new Map();
for (let i = 1; i < positions.length; i++) {
  const d = positions[i] - positions[i - 1];
  deltaHist.set(d, (deltaHist.get(d) || 0) + 1);
}
const topDeltas = [...deltaHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [d, c] of topDeltas) console.log(`  delta=${d} count=${c}`);
console.log(`first 5 positions: ${positions.slice(0, 5).map(p => "0x" + p.toString(16)).join(" ")}`);
console.log(`last  5 positions: ${positions.slice(-5).map(p => "0x" + p.toString(16)).join(" ")}`);

// ------------------------------------------------------------
// Step 3: lock in row start. Try positions[0] - K for K=0..34
// and pick the K that yields the most 35-strides covering the region.
// ------------------------------------------------------------
let firstRow = positions[0]; // candidate
// But the 1e is probably the LAST 4 bytes of each row (sentinel/terminator).
// So row starts at positions[i] + 4 - 35 = positions[i] - 31.
const rowStart0 = positions[0] - 31;
console.log(`\nassumed row start: 0x${rowStart0.toString(16)}  (1e at row offset 31..34)`);
console.log(`first row context: ${buf.slice(rowStart0 - 4, rowStart0 + 35).toString("hex")}`);

// ------------------------------------------------------------
// Step 4: walk rows; gather first 10 + last 10
// ------------------------------------------------------------
const STRIDE = 35;
// Determine plausible row count: walk forward while +31..+34 == 0x1e000000
function walkRows(rowStart) {
  const rows = [];
  let p = rowStart;
  while (p + STRIDE <= END) {
    if (buf.readUInt32LE(p + 31) !== 0x0000001e) break;
    rows.push(p);
    p += STRIDE;
  }
  return rows;
}
let rows = walkRows(rowStart0);
console.log(`\nwalked ${rows.length} rows from 0x${rowStart0.toString(16)} (forward, contiguous)`);
if (rows.length < 100) {
  // try without strict check: just stride blindly
  console.log("strict walk too short — try blind walk");
  rows = [];
  for (let p = rowStart0; p + STRIDE <= END; p += STRIDE) rows.push(p);
}
console.log(`blind walk: ${rows.length} rows`);

// ------------------------------------------------------------
// Step 5: per-column stats
// ------------------------------------------------------------
console.log("\n=== per-column stats (over all blind-walked rows) ===");
const N = rows.length;
console.log(`N rows = ${N}`);
console.log(`predicted ÷239 factions = ${(N/239).toFixed(2)}`);
console.log(`predicted ÷200 settlements = ${(N/200).toFixed(2)}`);
console.log(`predicted ÷5000 characters = ${(N/5000).toFixed(2)}`);
console.log(`predicted ÷1310 settlements = ${(N/1310).toFixed(2)}`);

// For each byte offset, compute: distinct, min, max, constancy
function colStats() {
  for (let off = 0; off < STRIDE; off++) {
    const seen = new Set();
    let mn = 0xff, mx = 0;
    for (const r of rows) {
      const v = buf[r + off];
      seen.add(v);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    console.log(`  byte +${off.toString().padStart(2)}: distinct=${seen.size.toString().padStart(4)}  min=0x${mn.toString(16).padStart(2,"0")}  max=0x${mx.toString(16).padStart(2,"0")}`);
  }
}
colStats();

// u32 stats at offsets 0..31
console.log("\n=== per-u32 stats (at offsets 0..31) ===");
for (let off = 0; off <= STRIDE - 4; off++) {
  const seen = new Set();
  let mono = true, prev = -1, mn = 0xffffffff, mx = 0, zeros = 0;
  for (const r of rows) {
    const v = buf.readUInt32LE(r + off);
    if (v === 0) zeros++;
    seen.add(v);
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (prev >= 0 && v < prev) mono = false;
    prev = v;
  }
  if (seen.size > 1) {
    console.log(`  u32 +${off.toString().padStart(2)}: distinct=${seen.size.toString().padStart(4)}  min=${mn}  max=${mx}  zeros=${zeros}  mono=${mono}`);
  } else {
    console.log(`  u32 +${off.toString().padStart(2)}: CONST = 0x${[...seen][0].toString(16)}`);
  }
}

// ------------------------------------------------------------
// Step 6: print first 12 rows and last 6 rows as hex + parsed
// ------------------------------------------------------------
console.log("\n=== first 12 rows (hex) ===");
for (let i = 0; i < Math.min(12, rows.length); i++) {
  const r = rows[i];
  const h = buf.slice(r, r + STRIDE).toString("hex");
  console.log(`row ${i.toString().padStart(4)} @0x${r.toString(16)}: ${h}`);
}
console.log("\n=== last 6 rows (hex) ===");
for (let i = Math.max(0, rows.length - 6); i < rows.length; i++) {
  const r = rows[i];
  const h = buf.slice(r, r + STRIDE).toString("hex");
  console.log(`row ${i.toString().padStart(4)} @0x${r.toString(16)}: ${h}`);
}

// ------------------------------------------------------------
// Step 7: did we exit before END? what bytes follow?
// ------------------------------------------------------------
const after = rows.length ? rows[rows.length - 1] + STRIDE : rowStart0;
console.log(`\nafter last row: 0x${after.toString(16)} (target end 0x${END.toString(16)}, diff = ${END - after})`);
console.log(`bytes after last row: ${buf.slice(after, Math.min(after + 64, END)).toString("hex")}`);

// ------------------------------------------------------------
// Step 8: where does 'oVBn' appear?
// ------------------------------------------------------------
console.log("\n=== 'oVBn' scan ===");
const oVBn = Buffer.from("oVBn", "ascii");
const oList = [];
for (let p = START; p + 4 <= END; p++) {
  if (buf[p] === oVBn[0] && buf[p+1] === oVBn[1] && buf[p+2] === oVBn[2] && buf[p+3] === oVBn[3]) oList.push(p);
}
console.log(`oVBn hits: ${oList.length}`);
console.log(`first 8: ${oList.slice(0, 8).map(p => "0x" + p.toString(16)).join(" ")}`);
if (oList.length >= 2) {
  const deltas = [];
  for (let i = 1; i < oList.length; i++) deltas.push(oList[i] - oList[i - 1]);
  const dh = new Map();
  for (const d of deltas) dh.set(d, (dh.get(d) || 0) + 1);
  const top = [...dh.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [d, c] of top) console.log(`  oVBn delta=${d} count=${c}`);
}
// What offset within the row does oVBn fall on?
if (oList.length && rows.length) {
  const rowOff = new Map();
  for (const p of oList) {
    // find containing row
    const i = Math.floor((p - rowStart0) / STRIDE);
    if (i < 0 || i >= rows.length) continue;
    const off = p - rows[i];
    rowOff.set(off, (rowOff.get(off) || 0) + 1);
  }
  console.log("  oVBn intra-row offset histogram:");
  for (const [k, v] of [...rowOff.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    +${k}: ${v}`);
  }
}
