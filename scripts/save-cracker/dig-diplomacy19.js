// dig-diplomacy19.js — Search for diplomacy state changes across the WHOLE save.
// Strategy: find offsets where the byte pattern is "small_int_0_to_6" in both
// saves AND changes between them. Use a coarse scan over the full file.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

// Goal 1: find ALL byte offsets where A==1 (peace) and B==0 (war) OR A==0 (war) and B==1
// Limit to first 32MB (smaller file).
const sz = Math.min(bA.length, bB.length);

// Bin diffs by "small enum value" pattern
let peaceToWar = 0, warToPeace = 0, otherSmallToSmall = 0, totalDiffs = 0, totalLargeDiffs = 0;
const candidates = [];
for (let i = 0; i < sz; i++) {
  if (bA[i] === bB[i]) continue;
  totalDiffs++;
  const a = bA[i], b = bB[i];
  if (a <= 6 && b <= 6) {
    otherSmallToSmall++;
    if ((a === 1 && b === 0) || (a === 0 && b === 1)) {
      // u8 peace<->war
      candidates.push({ off: i, a, b });
    }
  } else if (a > 6 || b > 6) totalLargeDiffs++;
}
console.log(`Total bytes: ${sz}`);
console.log(`Total diff bytes: ${totalDiffs}  (large/non-enum: ${totalLargeDiffs})`);
console.log(`Small-enum-to-small-enum diffs (both <=6): ${otherSmallToSmall}`);
console.log(`Peace<->War candidates (1<->0): ${candidates.length}`);

// Of all the candidate (1<->0) byte flips, find clusters at known fixed strides
// (which would indicate a per-faction-pair diplomacy array)
// Sort by offset
candidates.sort((a, b) => a.off - b.off);
console.log("\nFirst 50 candidates:");
for (const c of candidates.slice(0, 50)) {
  console.log(`  0x${c.off.toString(16)}  A=${c.a} B=${c.b}`);
}
console.log("Last 50 candidates:");
for (const c of candidates.slice(-50)) {
  console.log(`  0x${c.off.toString(16)}  A=${c.a} B=${c.b}`);
}

// Histogram by 64KB bucket
const bucket = new Map();
for (const c of candidates) {
  const b = c.off >>> 16; // 64KB bucket
  bucket.set(b, (bucket.get(b) || 0) + 1);
}
console.log("\nTop buckets (by 64KB-aligned chunk):");
const sorted = Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
for (const [b, c] of sorted.slice(0, 30)) {
  console.log(`  bucket 0x${b.toString(16).padStart(4,'0')}0000 .. 0x${b.toString(16).padStart(4,'0')}ffff : ${c}`);
}
