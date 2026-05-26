// dig-tail-profile1.js — coarse content-type profile of the whole save, then
// zoom into the tail (>= 0xf84632 per prior geography). For each 64KB window:
//   - %zero, %ascii, %0xff, entropy bucket
//   - count of self-pointer hits (u32(p)==p) — record-array signature
//   - count of registry-type-marker-ish patterns
// Goal: find where the ~16MB settlement zone ends and the tail begins, and
// segment the tail by content family.
"use strict";
const fs = require("fs");

const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";

const buf = fs.readFileSync(SAVE);
const N = buf.length;
console.log(`SAVE=${SAVE}`);
console.log(`size=${N} (${(N/1048576).toFixed(2)} MiB)`);

const WIN = 65536;
const rows = [];
for (let base = 0; base < N; base += WIN) {
  const end = Math.min(base + WIN, N);
  let z = 0, asc = 0, ff = 0, selfptr = 0;
  for (let i = base; i < end; i++) {
    const v = buf[i];
    if (v === 0) z++;
    else if (v === 0xff) ff++;
    else if (v >= 0x20 && v < 0x7f) asc++;
  }
  // self-pointer scan (aligned)
  for (let i = base; i + 4 <= end; i += 4) {
    if (buf.readUInt32LE(i) === i) selfptr++;
  }
  const len = end - base;
  rows.push({
    base, len,
    pz: z / len, pa: asc / len, pf: ff / len,
    selfptr,
  });
}

// Print a compact map: only windows that differ in character from the previous
// row, plus every 16th row as an anchor.
function cls(r) {
  if (r.pz > 0.85) return "ZERO";
  if (r.pf > 0.5) return "FF";
  if (r.selfptr > 50) return "RECORDS";
  if (r.pa > 0.45) return "ASCII";
  if (r.pz > 0.5) return "SPARSE";
  return "BINARY";
}

console.log("\n=== 64KB window profile (showing class transitions) ===");
let prev = null;
let runStart = 0;
for (let i = 0; i < rows.length; i++) {
  const c = cls(rows[i]);
  if (c !== prev) {
    if (prev !== null) {
      console.log(`  0x${rows[runStart].base.toString(16).padStart(8,"0")} .. 0x${rows[i].base.toString(16).padStart(8,"0")}  ${prev}  (${i-runStart} win, ${(((i-runStart)*WIN)/1048576).toFixed(2)} MiB)`);
    }
    prev = c; runStart = i;
  }
}
console.log(`  0x${rows[runStart].base.toString(16).padStart(8,"0")} .. 0x${N.toString(16).padStart(8,"0")}  ${prev}  (${rows.length-runStart} win, end)`);

// Tail detail: from 0xf80000 onward, dump per-window detail every window.
const TAIL = 0xf80000;
console.log(`\n=== TAIL detail (from 0x${TAIL.toString(16)}) per-64KB window ===`);
console.log("offset      class   %zero %ascii %ff  selfptr");
for (const r of rows) {
  if (r.base < TAIL) continue;
  console.log(`0x${r.base.toString(16).padStart(8,"0")}  ${cls(r).padEnd(7)} ${(r.pz*100).toFixed(0).padStart(4)} ${(r.pa*100).toFixed(0).padStart(5)} ${(r.pf*100).toFixed(0).padStart(4)}  ${String(r.selfptr).padStart(5)}`);
}
