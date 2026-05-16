// dig-diplo-8.js — session 108 step 8
//
// Faction-record-aligned diff. Major-faction records have a stable INDEX
// across saves (player at 0, then descr_strat order). For each major record,
// diff its first 1 KB across pairs:
//   * save_mp_before vs save_mp_after  (1-tile move; expected: tiny/no diff)
//   * ror_t11s vs ror_t11e             (within turn; diplo should be stable)
//   * save_10_fresh vs ror_t1e         (T0 vs T1 end; diplo could change)
//   * save_10_fresh vs save_1.2        (T0 baseline vs mid-campaign)
//
// If a region inside the major record consistently differs only between
// turns (not within), AND that region is small (< few KB), that's the
// diplomacy candidate.
//
// Usage: node dig-diplo-8.js
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "fixtures", "feral");
const PAIRS = [
  ["save_mp_before.sav", "save_mp_after.sav", "1-tile move"],
  ["ror_t11s.sav", "ror_t11e.sav", "within turn 11"],
  ["save_10_fresh.sav", "ror_t1e.sav", "T0 → T1 end"],
  ["save_10_fresh.sav", "save_1.2.sav", "T0 → mid-campaign"],
];

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

function diffWindow(a, aOff, b, bOff, len) {
  // self-pointer fields shift — strip them out by ignoring offsets +24..+28
  // and +40..+44 (the self-pointer fields).
  let diffs = 0;
  const positions = [];
  for (let i = 0; i < len; i++) {
    if (a[aOff + i] !== b[bOff + i]) {
      // ignore positions within 24..28 and 40..44 (self pointers)
      if (i >= 24 && i < 28) continue;
      if (i >= 40 && i < 44) continue;
      diffs += 1;
      positions.push(i);
    }
  }
  return { diffs, positions };
}

for (const [fA, fB, label] of PAIRS) {
  const a = fs.readFileSync(path.join(root, fA));
  const b = fs.readFileSync(path.join(root, fB));
  const ma = readMajor(a);
  const mb = readMajor(b);
  console.log(`\n=== ${label}: ${fA} vs ${fB}  (majors a=${ma.length} b=${mb.length}) ===`);
  const n = Math.min(ma.length, mb.length);
  for (let k = 0; k < n; k++) {
    // diff first 4096 bytes of each (skip self-pointer-shift artifacts)
    const len = Math.min(4096, ma[k+1] ? ma[k+1].pos - ma[k].pos : a.length - ma[k].pos,
                         mb[k+1] ? mb[k+1].pos - mb[k].pos : b.length - mb[k].pos);
    const d = diffWindow(a, ma[k].pos, b, mb[k].pos, len);
    console.log(`  major[${k}] regA=${ma[k].regions} regB=${mb[k].regions} diffs=${d.diffs}/${len} firstDiffs=[${d.positions.slice(0, 8).join(",")}]`);
  }
}

// Now for "T0 → T1 end" (1 turn played), look at major[0] in detail —
// what bytes near the start of the record changed?
console.log(`\n\n=== Detail: T0 (save_10_fresh) → T1 (ror_t1e) major[0] full diff (first 4 KB) ===`);
const fresh = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
const t1 = fs.readFileSync(path.join(root, "ror_t1e.sav"));
const mFresh = readMajor(fresh);
const mT1 = readMajor(t1);

const m0F = mFresh[0];
const m0T = mT1[0];
console.log(`fresh major[0] pos=0x${m0F.pos.toString(16)} regions=${m0F.regions}`);
console.log(`t1    major[0] pos=0x${m0T.pos.toString(16)} regions=${m0T.regions}`);

const len = 4096;
const d = diffWindow(fresh, m0F.pos, t1, m0T.pos, len);
console.log(`Diffs in first ${len} B: ${d.diffs}`);
console.log(`First 50 diff positions (rel to major-record-start): ${d.positions.slice(0, 50).join(",")}`);

// Group diff positions into ranges
function group(positions, gap) {
  if (!positions.length) return [];
  const r = [{ start: positions[0], end: positions[0] }];
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - r[r.length - 1].end <= gap) {
      r[r.length - 1].end = positions[i];
    } else {
      r.push({ start: positions[i], end: positions[i] });
    }
  }
  return r;
}
const ranges = group(d.positions, 8);
console.log(`Grouped ranges (gap=8):`);
ranges.slice(0, 30).forEach((r) => {
  console.log(`  +${r.start} .. +${r.end} (len ${r.end - r.start + 1})`);
});
