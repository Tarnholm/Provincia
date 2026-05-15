// dig-last075-3.js — Diagnose why stride9 detector misses the 1903-B runs.

"use strict";

const fs = require("fs");
const path = require("path");

const SAVE_PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE_PATH);

// Replicate the detector logic on the known unknowns.
const targets = [
  [0x15166cb, 0x15166cb + 1903],
  [0x1516f52, 0x1516f52 + 1903],
  [0x15144b7, 0x15144b7 + 1901],
  [0x1eddd7e, 0x1eddd7e + 1870],
  [0x1f16629, 0x1f16629 + 1897],
  [0x15128ff, 0x15128ff + 1494],
];

for (const [rs, re] of targets) {
  console.log(`\n=== Run 0x${rs.toString(16)}..0x${re.toString(16)} (${re-rs} B) ===`);
  // Dump bytes at offsets 0..18 for alignment intuition.
  const head = buf.slice(rs, rs + 36);
  console.log(`HEAD: ${[...head].map(b => b.toString(16).padStart(2,"0")).join(" ")}`);
  // Look for best stride 9 alignment.
  for (let off = 0; off < 9; off++) {
    let total = 0, okStrict = 0;
    const mmHist = new Map();
    for (let p = rs + off; p + 9 <= re; p += 9) {
      total++;
      const b3 = buf[p+3];
      if (buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
          (b3 & 0x0f) === 0 && b3 <= 0x80) {
        okStrict++;
        const mm = buf[p+4];
        mmHist.set(mm, (mmHist.get(mm) || 0) + 1);
      }
    }
    // Top MM
    let topMm = 0, topMmK = -1;
    for (const [k, v] of mmHist) if (v > topMm) { topMm = v; topMmK = k; }
    console.log(`  off=${off}: total=${total} okStrict=${okStrict} (${(okStrict/total*100).toFixed(1)}%)  topMm=${topMmK !== -1 ? "0x"+topMmK.toString(16) : "—"} (${topMm} hits)`);
  }
}

// The detector's criterion is `topMm / total >= 0.78` AND `total >= 50`.
// Let's see for 0x15166cb with best alignment if a SINGLE dominant MM exists.
console.log("\n=== MM histogram for 0x15166cb at all alignments ===");
const rs = 0x15166cb, re = rs + 1903;
for (let off = 0; off < 9; off++) {
  const mmHist = new Map();
  for (let p = rs + off; p + 9 <= re; p += 9) {
    const b3 = buf[p+3];
    if (buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
        (b3 & 0x0f) === 0 && b3 <= 0x80) {
      const mm = buf[p+4];
      mmHist.set(mm, (mmHist.get(mm) || 0) + 1);
    }
  }
  const total = Math.floor((re - rs - off) / 9);
  console.log(`off=${off} total=${total}:`, [...mmHist.entries()].sort((a,b)=>b[1]-a[1]));
}
