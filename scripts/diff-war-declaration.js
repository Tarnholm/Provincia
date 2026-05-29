"use strict";
// Spain T4 Start (no war) vs Spain T4 "attack Carthage army (declaring war)"
// Diff: bytes that changed = what declaring war flips in the save.
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const BEFORE = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 Start.sav"));
const AFTER  = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"));

console.log(`BEFORE=${BEFORE.length}  AFTER=${AFTER.length}  delta=${AFTER.length - BEFORE.length}`);

const len = Math.min(BEFORE.length, AFTER.length);
let runs = [];
let runStart = -1;
for (let i = 0; i < len; i++) {
  if (BEFORE[i] !== AFTER[i]) {
    if (runStart < 0) runStart = i;
  } else if (runStart >= 0) {
    runs.push({ start: runStart, end: i - 1, len: i - runStart });
    runStart = -1;
  }
}
if (runStart >= 0) runs.push({ start: runStart, end: len - 1, len: len - runStart });

console.log(`total diff runs: ${runs.length}`);
console.log(`total diff bytes: ${runs.reduce((s, r) => s + r.len, 0)}`);

// Look for u32 values that went from a specific value to a specific value
// suggesting war state transition. The diplo matrix att=600 (war) value is
// what we're looking for. So at SOME (Spain row, Carthage col) cell:
//   BEFORE: att=200 (neutral)
//   AFTER:  att=600 (war)
// That's a u32 change from 200 to 600.
console.log("\n=== u32 cells that went 200 → 600 (probable attitude → war) ===");
{
  let count = 0;
  for (let o = 0; o + 4 <= len; o += 4) { // ALIGNED 4-byte cells
    const b = BEFORE.readUInt32LE(o);
    const a = AFTER.readUInt32LE(o);
    if (b === 200 && a === 600) {
      const ctx = AFTER.slice(Math.max(0, o-12), o+16).toString("hex");
      console.log(`  off=${o}  ctx(AFTER)=${ctx}`);
      count++;
      if (count > 20) { console.log("  ... truncated"); break; }
    }
  }
  console.log(`total 200→600: ${count}`);
}

console.log("\n=== u32 cells with att-style transitions (low value → high value) ===");
{
  const interesting = [];
  for (let o = 0; o + 4 <= len; o += 4) {
    const b = BEFORE.readUInt32LE(o);
    const a = AFTER.readUInt32LE(o);
    if (b === a) continue;
    // Look for plausible "stance" values
    if ([0, 200, 400, 600, 850, 1000].includes(b) && [0, 200, 400, 600, 850, 1000].includes(a)) {
      interesting.push({ o, b, a });
    }
  }
  console.log(`stance-value transitions: ${interesting.length}`);
  for (const { o, b, a } of interesting.slice(0, 20)) {
    console.log(`  off=${o}: ${b} → ${a}`);
  }
}

// Top 20 longest diff runs
console.log("\n=== top 20 longest diff runs ===");
runs.sort((a, b) => b.len - a.len);
for (const r of runs.slice(0, 20)) {
  const a4 = BEFORE.readUInt32LE(r.start);
  const b4 = AFTER.readUInt32LE(r.start);
  console.log(`  ${r.start}..${r.end} (${r.len}b)  BEFORE=${a4} AFTER=${b4}`);
}
