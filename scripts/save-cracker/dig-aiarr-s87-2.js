// dig-aiarr-s87-2.js — Session 87 attempt 2.
//
// Attempt 1: alignment-agnostic xyz match rate for the 81 union values was
// 71.6%, but the CONTROL (random ints in 13..1306) hit 74.0% — i.e. the
// stride-9 zone is so dense (2.5M records, 46k distinct xyz) that ANY small
// int has ~74% chance of appearing. Cross-reference is uninformative without
// constraining to true stride-9-aligned records inside actual §16 RUNS.
//
// Refined method:
//   1. Re-implement §16 detector exactly: find unclaimed runs >= 100 B in
//      [0x14e5ac6, 0x20e6e8e), test all 9 alignments, pick best, accept if
//      >= 78% records match rigid pattern and total >= 50. (Approximates
//      cover.js without needing full claim bitmap.)
//   2. Harvest xyz only from records under the BEST alignment of each ACCEPTED
//      run.
//   3. Re-do cross-reference vs faction-array values.
//   4. For value 1074 specifically: locate it in §16 accepted runs only; for
//      each match, read backwards/forwards to find the terminator string
//      (length-prefixed pstr or length-prefixed pstr16le naming a unit type
//      / culture / faction) that names the table.
//   5. Compare to control again.
//
// We don't have access to the full claim bitmap, so we use an approximation:
// scan the entire zone with stride-9, identifying contiguous regions that
// pass the pattern test. This is good enough to bound the analysis.

const fs = require("fs");

const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const T1_PATH = `${ROME_DIR}/save_1.2.sav`;
const buf = fs.readFileSync(T1_PATH);

function findMajors(b) {
  const out = [];
  for (let p = 0; p < b.length - 64; p += 4) {
    if (b.readUInt32LE(p + 8) !== 100) continue;
    if (b.readUInt32LE(p + 12) !== 1) continue;
    if (b.readUInt32LE(p + 44) !== 6) continue;
    if (b.readUInt32LE(p + 24) !== p + 24) continue;
    if (b.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}
function extractArray(b, base) {
  const n = b.readUInt32LE(base + 48);
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(b.readUInt32LE(base + 52 + i * 4));
  return vals;
}

const majors = findMajors(buf);
const factionArrays = majors.map(p => extractArray(buf, p));
const union = new Set();
for (const arr of factionArrays) for (const v of arr) union.add(v);

const ZONE_START = 0x14e5ac6;
const ZONE_END   = Math.min(0x20e6e8e, buf.length);

function rigidMatch(p) {
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const nn = buf[p+3];
  if ((nn & 0x0f) !== 0) return false;
  if (nn > 0x80) return false;
  return true;
}

// === Find §16 runs: walk the zone in fixed windows that PASS the rigid
// test at the best of 9 alignments. We approximate by scanning sliding
// windows of ~200 B and accepting when both density and consistency are
// high. Specifically, we look for sequences of consecutive 9-byte aligned
// records that all match rigidMatch — when we find a run of >= 50 such
// records under the same alignment offset, we lock in that range as a §16
// table. ===

// Simpler: at each starting position, try all 9 offsets and find the
// longest contiguous run of rigid matches >= 50 records, then advance past.
const runs = []; // [{start, end, off, recordsTotal, recordsMatched, dominantMm}]

let cursor = ZONE_START;
while (cursor + 9 * 50 <= ZONE_END) {
  let best = null;
  for (let off = 0; off < 9; off++) {
    const startP = cursor + off;
    if (startP + 9 > ZONE_END) continue;
    if (!rigidMatch(startP)) continue;
    // count consecutive matches
    let n = 0;
    let mismatches = 0;
    const mmC = new Map();
    let lastMatchP = startP;
    for (let p = startP; p + 9 <= ZONE_END; p += 9) {
      if (rigidMatch(p)) {
        n++;
        const mm = buf[p+4];
        mmC.set(mm, (mmC.get(mm) || 0) + 1);
        lastMatchP = p;
      } else {
        mismatches++;
        if (mismatches > 5) break; // small gap tolerated within run
      }
    }
    if (n < 50) continue;
    if (!best || n > best.n) {
      let dominantMm = 0, dominantCnt = 0;
      for (const [m, c] of mmC) if (c > dominantCnt) { dominantCnt = c; dominantMm = m; }
      best = { start: startP, end: lastMatchP + 9, off, n, mmC, dominantMm, dominantCnt };
    }
  }
  if (!best) { cursor += 1; continue; }
  if (best.dominantCnt / best.n >= 0.78) {
    runs.push(best);
    cursor = best.end;
  } else {
    cursor += 9;
  }
}

console.log(`§16-style runs found: ${runs.length}`);
console.log(`total bytes covered: ${runs.reduce((a, r) => a + (r.end - r.start), 0)}`);

// === Harvest xyz from accepted runs only ===
const xyzCounts = new Map();
const xyzPositions = new Map();
const xyzRunIdx = new Map(); // xyz -> runIndex (first seen)
for (let i = 0; i < runs.length; i++) {
  const r = runs[i];
  for (let p = r.start; p + 9 <= r.end; p += 9) {
    if (!rigidMatch(p)) continue;
    const xyz = buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16);
    xyzCounts.set(xyz, (xyzCounts.get(xyz) || 0) + 1);
    if (!xyzPositions.has(xyz)) xyzPositions.set(xyz, []);
    if (xyzPositions.get(xyz).length < 5) xyzPositions.get(xyz).push(p);
    if (!xyzRunIdx.has(xyz)) xyzRunIdx.set(xyz, i);
  }
}

console.log(`distinct xyz harvested from §16 runs: ${xyzCounts.size}`);

// === Cross-reference ===
let hit = 0;
for (const v of union) if ((xyzCounts.get(v) || 0) > 0) hit++;
console.log(`\nunion match rate vs §16 xyz: ${hit}/${union.size} (${(hit / union.size * 100).toFixed(1)}%)`);

// control
let ctrlHit = 0;
const seed = 42;
function rnd(i) { return ((seed * 9301 + i * 49297) % 233280) / 233280; }
for (let i = 0; i < 1000; i++) {
  const v = 13 + Math.floor(rnd(i) * (1306 - 13 + 1));
  if ((xyzCounts.get(v) || 0) > 0) ctrlHit++;
}
console.log(`control random ints 13..1306 match rate: ${ctrlHit}/1000 (${(ctrlHit / 1000 * 100).toFixed(1)}%)`);

// === Look at terminator strings around accepted runs ===
// For each run, find the bytes immediately AFTER the run and check for a
// length-prefixed pstr8 (1-B length) or pstr16le (4-B length, ASCII chars).
function tryReadStrAfter(end) {
  // try pstr8: byte = length, then ASCII chars
  if (end + 1 >= buf.length) return null;
  const len8 = buf[end];
  if (len8 > 1 && len8 < 40 && end + 1 + len8 <= buf.length) {
    let ok = true;
    for (let i = 0; i < len8; i++) {
      const b = buf[end + 1 + i];
      if (!((b >= 0x20 && b < 0x7f) || b === 0)) { ok = false; break; }
    }
    if (ok) return { kind: "pstr8", len: len8, text: buf.slice(end + 1, end + 1 + len8).toString("ascii") };
  }
  // skip any ff bytes
  let p = end;
  while (p < buf.length && buf[p] === 0xff) p++;
  if (p > end && p + 1 < buf.length) {
    const len = buf[p];
    if (len > 1 && len < 40 && p + 1 + len <= buf.length) {
      let ok = true;
      for (let i = 0; i < len; i++) {
        const b = buf[p + 1 + i];
        if (!((b >= 0x20 && b < 0x7f) || b === 0)) { ok = false; break; }
      }
      if (ok) return { kind: "pstr8-after-ff", len, text: buf.slice(p + 1, p + 1 + len).toString("ascii"), skippedFf: p - end };
    }
  }
  return null;
}

// Annotate each run with its terminator string.
console.log(`\n=== Per-run terminator strings (first 30 runs) ===`);
const runLabels = [];
for (let i = 0; i < runs.length; i++) {
  const r = runs[i];
  const s = tryReadStrAfter(r.end);
  runLabels.push(s ? s.text : null);
  if (i < 30) {
    console.log(`  run ${i}: [0x${r.start.toString(16)}..0x${r.end.toString(16)}) n=${r.n} domMm=0x${r.dominantMm.toString(16)} term=${s ? `'${s.text}'` : 'none'}`);
  }
}

// === 1074 deep dive ===
console.log(`\n=== Value 1074 deep-dive (in §16 runs only) ===`);
const c1074 = xyzCounts.get(1074) || 0;
console.log(`  count in §16 runs: ${c1074}`);
if (c1074 > 0) {
  console.log(`  run-indices where 1074 appears:`);
  const runIdxSeen = new Set();
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    for (let p = r.start; p + 9 <= r.end; p += 9) {
      if (!rigidMatch(p)) continue;
      const xyz = buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16);
      if (xyz === 1074 && !runIdxSeen.has(i)) {
        runIdxSeen.add(i);
        console.log(`    run ${i}: [0x${r.start.toString(16)}..0x${r.end.toString(16)}) n=${r.n} domMm=0x${r.dominantMm.toString(16)} term='${runLabels[i] || 'none'}'`);
      }
    }
  }
}

// === For each union value: find which run it appears in (if any), record terminator ===
console.log(`\n=== Per-faction value->table-label mapping (R0 only) ===`);
const r0 = factionArrays[0];
for (const v of r0) {
  const runIdx = xyzRunIdx.get(v);
  if (runIdx === undefined) {
    console.log(`  ${v}: NOT FOUND in §16 runs`);
  } else {
    const r = runs[runIdx];
    console.log(`  ${v}: run ${runIdx} term='${runLabels[runIdx] || 'none'}' (count=${xyzCounts.get(v)})`);
  }
}

// === Histogram of terminator labels across all union values ===
console.log(`\n=== Terminator-label histogram for union values that match ===`);
const labelCounts = new Map();
for (const v of union) {
  const runIdx = xyzRunIdx.get(v);
  if (runIdx === undefined) continue;
  const lbl = runLabels[runIdx] || '(no-term)';
  labelCounts.set(lbl, (labelCounts.get(lbl) || 0) + 1);
}
const sorted = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [lbl, c] of sorted.slice(0, 20)) {
  console.log(`  '${lbl}': ${c}`);
}

// === Also check: among the 81 union values, what's the type-nibble (NN) distribution? ===
console.log(`\n=== NN-byte distribution for union values matched in §16 runs ===`);
const nnCounts = new Map();
for (let i = 0; i < runs.length; i++) {
  const r = runs[i];
  for (let p = r.start; p + 9 <= r.end; p += 9) {
    if (!rigidMatch(p)) continue;
    const xyz = buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16);
    if (union.has(xyz)) {
      const nn = buf[p+3];
      nnCounts.set(nn, (nnCounts.get(nn) || 0) + 1);
    }
  }
}
for (const [nn, c] of [...nnCounts.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  NN=0x${nn.toString(16).padStart(2, '0')}: ${c}`);
}
