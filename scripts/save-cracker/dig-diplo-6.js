// dig-diplo-6.js — session 108 step 6
//
// Step 5 found 100% symmetric windows at several offsets. We must
// distinguish "all-zero (trivially symmetric)" from "actual data symmetric".
// Dump and characterize each candidate:
//   * 0x3c80, 0x2e600 — early in file, before body root; likely all zero
//   * 0x1547710 — inside major[0] (0x1541d67) — this is the 23×23 u32 zone
//     hypothesis location!
//   * 0x1f21490 — just before NPC[1] (0x1f21d48), in faction-record zone
//
// For each candidate, print non-zero stats, byte histogram, and the 23x23
// matrix (as u32 values).
//
// Usage: node dig-diplo-6.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
const buf = fs.readFileSync(SAVE);

function checkSymmetricMatrix(b, start, N, cellSize) {
  let matches = 0, total = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const aOff = start + (i * N + j) * cellSize;
      const bOff = start + (j * N + i) * cellSize;
      let ok = true;
      for (let k = 0; k < cellSize; k++) if (b[aOff + k] !== b[bOff + k]) { ok = false; break; }
      if (ok) matches++; total++;
    }
  }
  return { matches, total };
}

function dumpU32Matrix(b, start, N) {
  console.log(`\n--- ${N}x${N} u32 matrix at 0x${start.toString(16)} ---`);
  let line = "    ";
  for (let j = 0; j < N; j++) line += j.toString().padStart(7);
  console.log(line);
  for (let i = 0; i < N; i++) {
    line = i.toString().padStart(3) + " ";
    for (let j = 0; j < N; j++) {
      const v = b.readUInt32LE(start + (i * N + j) * 4);
      const s = v > 100 ? "#" + v.toString(16) : v.toString();
      line += s.padStart(7);
    }
    console.log(line);
  }
}

function nonZeroStats(b, start, len) {
  let nz = 0;
  const histogram = {};
  for (let i = 0; i < len; i++) {
    if (b[start + i] !== 0) nz++;
    histogram[b[start + i]] = (histogram[b[start + i]] || 0) + 1;
  }
  return { nonZero: nz, total: len, histogram };
}

const candidates = [
  { off: 0x3c80, N: 23, cellSize: 1, label: "0x3c80 1B" },
  { off: 0x2e600, N: 23, cellSize: 2, label: "0x2e600 2B" },
  { off: 0x1547710, N: 23, cellSize: 4, label: "0x1547710 4B inside major[0]" },
  { off: 0x1f91160, N: 23, cellSize: 8, label: "0x1f91160 8B" },
  { off: 0x1fd8110, N: 23, cellSize: 16, label: "0x1fd8110 16B" },
  { off: 0x1f21490, N: 22, cellSize: 4, label: "0x1f21490 4B (N=22)" },
];

for (const c of candidates) {
  const winSize = c.N * c.N * c.cellSize;
  const stats = nonZeroStats(buf, c.off, winSize);
  const sym = checkSymmetricMatrix(buf, c.off, c.N, c.cellSize);
  console.log(`\n${c.label}: ${stats.nonZero}/${stats.total} non-zero bytes; sym=${sym.matches}/${sym.total} (${(sym.matches / sym.total * 100).toFixed(1)}%)`);
  const top = Object.entries(stats.histogram).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  top byte values: ${top.map(([v, c]) => `${v}:${c}`).join(", ")}`);
  if (stats.nonZero > 50 && c.cellSize === 4 && c.N === 23) {
    dumpU32Matrix(buf, c.off, c.N);
  }
}

// Now: scan whole file for 23×23 u32 with high non-zero density AND symmetry.
// Strict filters:
//   - >100 non-zero bytes
//   - symmetric ratio > 95%
//   - U32 values bounded to a small set (<= 8 distinct values)
console.log("\n\n=== STRICT scan: 23×23 u32, >100 nonZero, sym >95%, ≤16 distinct u32s ===");
const N = 23;
const cellSize = 4;
const winSize = N * N * cellSize;
const hits = [];
const step = 4;
for (let off = 0x1000; off + winSize < buf.length - 0x10000; off += step) {
  // Quick non-zero check at byte level
  let nz = 0;
  for (let i = 0; i < winSize; i++) if (buf[off + i] !== 0) nz++;
  if (nz < 100) continue;
  const sym = checkSymmetricMatrix(buf, off, N, cellSize);
  if (sym.matches / sym.total < 0.95) continue;
  // u32-distinct values
  const distinct = new Set();
  for (let i = 0; i < N * N; i++) distinct.add(buf.readUInt32LE(off + i * 4));
  if (distinct.size > 16) continue;
  hits.push({ off, nz, symRatio: sym.matches / sym.total, distinctValues: distinct.size, values: [...distinct].sort((a, b) => a - b) });
}
console.log(`\nTotal hits: ${hits.length}`);
hits.slice(0, 20).forEach((h) => {
  console.log(`  pos=0x${h.off.toString(16)} nz=${h.nz} sym=${(h.symRatio * 100).toFixed(1)}% distinct=${h.distinctValues} vals=[${h.values.slice(0, 8).join(",")}${h.values.length > 8 ? "..." : ""}]`);
});
