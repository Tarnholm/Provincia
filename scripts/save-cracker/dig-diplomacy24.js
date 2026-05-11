// dig-diplomacy24.js — Focus on small isolated regions only. Look for u8 byte
// changes within a stable area where the surrounding bytes are NOT changed.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

const sz = Math.min(bA.length, bB.length);

// Diff bitmap
const diffBits = new Uint8Array(sz);
for (let i = 0; i < sz; i++) if (bA[i] !== bB[i]) diffBits[i] = 1;

// Find ranges where the file is identical EXCEPT for a small number of bytes
// (= "calm" regions). Look for spans of 4096 bytes with <= 10 diff bytes.
const WIN = 4096;
const MAX_DIFFS = 10;
console.log("scanning for calm windows...");
let calmRegions = [];
// We scan windowed sum of diffBits.
let sum = 0;
for (let i = 0; i < WIN; i++) sum += diffBits[i];
for (let i = WIN; i < sz; i++) {
  sum += diffBits[i];
  sum -= diffBits[i - WIN];
  if (sum > 0 && sum <= MAX_DIFFS) {
    calmRegions.push({ end: i, diffs: sum });
  }
}
console.log(`calm windows: ${calmRegions.length}`);

// Coalesce overlapping windows into "calm bands"
calmRegions.sort((a, b) => a.end - b.end);
const bands = [];
for (const r of calmRegions) {
  const start = r.end - WIN;
  if (bands.length && start - bands[bands.length-1].end < WIN) {
    bands[bands.length-1].end = r.end;
  } else {
    bands.push({ start, end: r.end });
  }
}
console.log(`coalesced bands: ${bands.length}`);
for (const b of bands.slice(0, 50)) {
  const ndiff = Array.from(diffBits.subarray(b.start, b.end)).reduce((s, x) => s + x, 0);
  console.log(`  0x${b.start.toString(16)}..0x${b.end.toString(16)}  span=${b.end-b.start}  total diffs=${ndiff}`);
}
