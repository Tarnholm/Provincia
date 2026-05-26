// dig-post-fow-35.js — investigate the 35-byte stride table.
// Session 57 noted: starts at 0x4564 (after ~140 B header), `1e 00 00 00`
// appears every 35 bytes. Worth checking if this is the road table.
"use strict";
const fs = require("fs");

const SAVES = [
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t960",           "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1018",          "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

for (const [tag, path] of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${tag} ===`);
  // Look at the 35-stride table
  const STRIDE = 35;
  const start = 0x4564;
  // Count records that have `1e 00 00 00` (i.e. u32 = 30) at offset +0 (or wherever it sits)
  // Search for the position of the sentinel in the stride
  // Try every alignment 0..34 — find the one where the byte sequence appears regularly
  for (let off = 0; off <= 34; off++) {
    let hits = 0;
    let p = start + off;
    while (p + 4 < 0x2a25d) {
      if (buf[p] === 0x1e && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) hits++;
      p += STRIDE;
    }
    if (hits > 100) {
      console.log(`  alignment +${off}: ${hits} sentinel hits`);
    }
  }
  // Just count `1e 00 00 00` overall in the zone
  let p = start, hits = 0;
  while (p < 0x2a25d - 4) {
    if (buf[p] === 0x1e && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) hits++;
    p++;
  }
  console.log(`  Total 1e 00 00 00 occurrences in zone: ${hits}`);
  // Dump first 5 35-byte records
  console.log(`  First 5 records (35 B each, starting at 0x${start.toString(16)}):`);
  for (let i = 0; i < 5; i++) {
    const off = start + i * 35;
    const slice = buf.slice(off, off + 35);
    const hex = slice.toString("hex").match(/.{2}/g).join(" ");
    console.log(`    0x${off.toString(16)}: ${hex}`);
  }
}
