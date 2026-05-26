// dig-find363.js — exhaustively search every save zone for any consistent
// per-record array whose count is near 363 (watchtowers).
//
// We try strides 4..256 for every claimed zone, and for the un-decoded ZoneA.
// Then we test alignment 0..stride-1 and see if a pattern repeats.
"use strict";
const fs = require("fs");

const SAVES = [
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t960",           "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1018",          "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

// Compute correlation: at stride s and alignment a, check if buf[a + k*s] is
// fixed (matches some specific byte) for most k. Treat as a strong stride
// candidate.
function findStrideFixedByte(buf, start, end, s, a) {
  if (start + a >= end) return 0;
  const n = Math.floor((end - start - a) / s);
  if (n < 50) return 0;
  const tally = new Array(256).fill(0);
  for (let k = 0; k < n; k++) {
    tally[buf[start + a + k * s]]++;
  }
  let topVal = 0, topCount = 0;
  for (let i = 0; i < 256; i++) if (tally[i] > topCount) { topCount = tally[i]; topVal = i; }
  return topCount / n;
}

// For each save, look at unclaimed-ish zones for any periodic patterns
// matching cardinality 363 (with ±20% tolerance).
for (const [tag, path] of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${tag} ===`);
  const zones = [
    ["post-fow-35-stride", 0x44e2,   0x2a25d],
    ["diplo-event-log",    0x2a25d,  0x2d4a9],
    ["diplo-slot-table",   0x2d4a9,  0x61c47],
    ["ZoneA-log-slots",    0x61c47,  0x846af],
    ["ZoneB-scripted",     0x846af,  0xa8beb],
    ["character-paths",    0xa8beb,  0xf8fd2],
    // Post-grid 267-stride array — start varies per save; use 0xf85f5c..0x1025000
    ["post-grid-aux",      0xf85f5c, 0x1025000],
  ];
  for (const [name, st, en] of zones) {
    const span = en - st;
    // Try common strides; find ones where the FIRST byte at +0 of each record is
    // a fixed value (e.g. record-type tag).
    const TARGET_LOW = 300, TARGET_HIGH = 450;
    for (let s = 4; s <= 200; s++) {
      const n = Math.floor(span / s);
      if (n < TARGET_LOW || n > TARGET_HIGH) continue;
      // Test alignment 0..s-1 for the strongest fixed-byte at any column
      let best = 0, bestCol = -1, bestVal = -1;
      for (let col = 0; col < Math.min(s, 32); col++) {
        const tally = new Array(256).fill(0);
        for (let k = 0; k < n; k++) tally[buf[st + col + k * s]]++;
        let topV = 0, topC = 0;
        for (let i = 0; i < 256; i++) if (tally[i] > topC) { topC = tally[i]; topV = i; }
        const frac = topC / n;
        if (frac > best) { best = frac; bestCol = col; bestVal = topV; }
      }
      if (best > 0.6) {
        console.log(`  ${name}: stride=${s} n=${n} bestCol=+${bestCol} val=0x${bestVal.toString(16)} frac=${best.toFixed(2)}`);
      }
    }
  }
}
