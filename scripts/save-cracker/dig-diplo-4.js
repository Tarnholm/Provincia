// dig-diplo-4.js — session 108 step 4
//
// STRONG signal from step 3: major-faction record [1] (the "treasury"
// faction record, 22 regions) contains a clear stride-16 pattern starting
// near the trailing zone, with separator `01 01 01 00` every 16 bytes:
//
//   <u32 A> <u32 B> <u32 C> <byte 01 01 01 00>
//
// Hypothesis: this is the per-other-faction diplomatic relations table —
// one entry per OTHER faction. RIS-imperial has 23 major factions; an
// entry table for each major would have 22 entries (other majors).
//
// Plan:
//   1. Find the start of the stride-16 region in each major record.
//   2. Count how many stride-16 entries fit before the pattern breaks.
//   3. Verify whether it's 22 (others), 21, 23, etc.
//   4. Dump the (A, B, C) values for major[1] and compare with descr_strat
//      starting alliances.
//
// Usage: node dig-diplo-4.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
const buf = fs.readFileSync(SAVE);

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

const major = readMajor(buf);

// Look at every major: scan for stride-16 runs of pattern <u32><u32><u32><01 01 01 00>
function findStride16(b, start, end) {
  const runs = [];
  let i = start;
  while (i + 16 <= end) {
    // Check if bytes at i+12..i+15 are exactly `01 01 01 00`
    if (b[i + 12] === 0x01 && b[i + 13] === 0x01 && b[i + 14] === 0x01 && b[i + 15] === 0x00) {
      // start of a run; extend as long as the pattern holds
      let j = i;
      let count = 0;
      while (j + 16 <= end &&
             b[j + 12] === 0x01 && b[j + 13] === 0x01 && b[j + 14] === 0x01 && b[j + 15] === 0x00) {
        count += 1;
        j += 16;
      }
      if (count >= 3) {
        runs.push({ start: i, count, end: j });
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return runs;
}

console.log(`Major-faction records: ${major.length}\n`);
console.log("Stride-16 `<u32><u32><u32><01 01 01 00>` runs per major record:");
const all = [];
for (let k = 0; k < major.length; k++) {
  const m = major[k];
  const next = k + 1 < major.length ? major[k + 1].pos : buf.length;
  const runs = findStride16(buf, m.pos, next);
  console.log(`  [${k}] pos=0x${m.pos.toString(16)} regions=${m.regions} size=${next - m.pos}`);
  for (const r of runs) {
    const rel = r.start - m.pos;
    console.log(`     run: rel=+${rel}/0x${rel.toString(16)}  count=${r.count}  (${r.count * 16} B)  endRel=+${r.end - m.pos}`);
  }
  all.push({ major: k, runs });
}

// Distribution of run-count
const runCounts = {};
for (const a of all) {
  for (const r of a.runs) {
    runCounts[r.count] = (runCounts[r.count] || 0) + 1;
  }
}
console.log("\nRun-count histogram:");
Object.keys(runCounts).sort((a, b) => +a - +b).forEach((k) => {
  console.log(`  ${k} entries: ${runCounts[k]} runs`);
});

// Look at major[1]'s first run in detail — dump each 16-byte entry as (u32, u32, u32, tail4)
console.log("\n=== major[1] first stride-16 run ===");
const m1 = major[1];
const runs1 = findStride16(buf, m1.pos, major[2].pos);
if (runs1.length > 0) {
  const r = runs1[0];
  console.log(`  start rel=+${r.start - m1.pos} count=${r.count}`);
  for (let i = 0; i < r.count; i++) {
    const p = r.start + i * 16;
    const a = buf.readUInt32LE(p);
    const b = buf.readUInt32LE(p + 4);
    const c = buf.readUInt32LE(p + 8);
    const d = buf.readUInt32LE(p + 12);
    console.log(`    [${i.toString().padStart(2)}] A=${a.toString().padStart(10)} B=${b.toString().padStart(10)} C=${c.toString().padStart(10)} D=0x${d.toString(16).padStart(8, "0")}`);
  }
}

// Also: major[0] first run
console.log("\n=== major[0] first stride-16 run ===");
const m0 = major[0];
const runs0 = findStride16(buf, m0.pos, major[1].pos);
if (runs0.length > 0) {
  const r = runs0[0];
  console.log(`  start rel=+${r.start - m0.pos} count=${r.count}`);
  for (let i = 0; i < r.count; i++) {
    const p = r.start + i * 16;
    const a = buf.readUInt32LE(p);
    const b = buf.readUInt32LE(p + 4);
    const c = buf.readUInt32LE(p + 8);
    const d = buf.readUInt32LE(p + 12);
    console.log(`    [${i.toString().padStart(2)}] A=${a.toString().padStart(10)} B=${b.toString().padStart(10)} C=${c.toString().padStart(10)} D=0x${d.toString(16).padStart(8, "0")}`);
  }
}

// Compare: any major with EXACTLY 22 entries?
console.log("\n=== Distribution of total entries per major across all its runs ===");
for (const a of all) {
  const total = a.runs.reduce((s, r) => s + r.count, 0);
  console.log(`  major[${a.major}] regions=${major[a.major].regions} total stride-16 entries=${total}  runs=${a.runs.length}`);
}
