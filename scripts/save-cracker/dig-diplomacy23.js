// dig-diplomacy23.js — Look for u32 fields that flip between A and B in a
// fixed-stride array structure. Specifically, scan for arrays where many
// adjacent u32 fields all have small int values 0..6 AND at least one
// differs between A and B.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

const sz = Math.min(bA.length, bB.length);

// scan: at each 4-byte-aligned offset, read u32 from both. If u32A != u32B AND both <= 6,
// record. This is more restrictive than byte-level.
const candidates = [];
for (let i = 0; i + 4 < sz; i += 1) {
  const va = bA.readUInt32LE(i);
  const vb = bB.readUInt32LE(i);
  if (va === vb) continue;
  // both must be in enum range
  if (va > 6 || vb > 6) continue;
  candidates.push({ i, va, vb });
}
console.log(`u32-aligned enum diffs (both <=6): ${candidates.length}`);

// Look for clusters of consecutive small u32 diffs at stride 4 — would
// indicate a fixed-stride enum array.
let runs = [];
let curStart = -1, curEnd = -1;
for (let k = 0; k < candidates.length; k++) {
  const c = candidates[k];
  if (curStart === -1) { curStart = c.i; curEnd = c.i; continue; }
  if (c.i - curEnd < 64) { curEnd = c.i; continue; } // allow gaps up to 64 bytes
  runs.push({ start: curStart, end: curEnd });
  curStart = c.i;
  curEnd = c.i;
}
if (curStart !== -1) runs.push({ start: curStart, end: curEnd });
console.log(`runs (gap<=64): ${runs.length}`);
runs.sort((a, b) => (b.end - b.start) - (a.end - a.start));
for (const r of runs.slice(0, 30)) {
  const span = r.end - r.start;
  const count = candidates.filter(c => c.i >= r.start && c.i <= r.end).length;
  console.log(`  0x${r.start.toString(16)}..0x${r.end.toString(16)}  span=${span}  diffs=${count}`);
}

// For top runs, dump the actual u32 array around them
console.log("\n=== Top 5 runs detail ===");
for (const r of runs.slice(0, 5)) {
  console.log(`\nRun 0x${r.start.toString(16)}..0x${r.end.toString(16)}:`);
  // dump 8 bytes before and 8 bytes after, with u32 array
  const start = Math.max(0, r.start - 16);
  const end = Math.min(sz, r.end + 16);
  for (let i = start & ~3; i < end; i += 4) {
    const a = bA.readUInt32LE(i);
    const b = bB.readUInt32LE(i);
    const mark = a === b ? '  ' : '*';
    console.log(`  0x${i.toString(16)}  A=${String(a).padStart(12)} B=${String(b).padStart(12)} ${mark}`);
  }
}
