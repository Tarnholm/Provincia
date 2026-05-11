// dig-diplomacy20.js — Sliding window approach to locate diplomacy state matrix.
// Strategy: the diplomacy section should be SMALL (one byte per faction pair,
// or one record per faction pair). For ~286 factions = max 286*285=81,510 bytes
// for an upper-triangular byte matrix, or 81510*4=326KB for u32-stride records.
//
// Run a "fixed-stride low-rate-change" scan: find offsets where bytes change
// between A and B at a regular interval (k * stride), which would indicate a
// per-record updated field.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

const sz = Math.min(bA.length, bB.length);

// Step 1: build diff bitmap (1 if bytes differ at offset i)
console.log("computing diff bitmap...");
const diffBits = new Uint8Array(sz);
let totalDiff = 0;
for (let i = 0; i < sz; i++) {
  if (bA[i] !== bB[i]) { diffBits[i] = 1; totalDiff++; }
}
console.log(`Total diff: ${totalDiff}`);

// Step 2: find "ISOLATED" diffs — single-byte changes surrounded by identical bytes.
// These are highly indicative of state flags rather than churning runtime data.
const isolated = [];
for (let i = 1; i < sz - 1; i++) {
  if (!diffBits[i]) continue;
  // Check the surrounding 16 bytes for ZERO diffs (or only 1-2 small u32 diffs)
  let nearby = 0;
  for (let j = Math.max(0, i - 16); j < Math.min(sz, i + 17); j++) {
    if (j === i) continue;
    if (diffBits[j]) nearby++;
  }
  if (nearby <= 1) {
    isolated.push(i);
  }
}
console.log(`Isolated diffs (≤1 nearby byte changed in ±16B window): ${isolated.length}`);
if (isolated.length < 200) {
  for (const i of isolated) {
    console.log(`  0x${i.toString(16)}  A=${bA[i]}(0x${bA[i].toString(16)})  B=${bB[i]}(0x${bB[i].toString(16)})  context: ${Array.from(bA.subarray(Math.max(0,i-8), i+8)).map(x=>x.toString(16).padStart(2,'0')).join(' ')} | A=${bA[i].toString(16).padStart(2,'0')} B=${bB[i].toString(16).padStart(2,'0')} | ${Array.from(bA.subarray(i+1, i+17)).map(x=>x.toString(16).padStart(2,'0')).join(' ')}`);
  }
}
