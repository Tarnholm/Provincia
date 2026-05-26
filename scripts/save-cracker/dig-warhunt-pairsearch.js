// dig-warhunt-pairsearch.js
// Search for a structure that tabulates faction-id PAIRS with stance.
// Cleanest distinctive wars:
//   seleucid(7) <-> seleucid_rebels(235), seleucid_rebels2(236)
//   antigonid(5) <-> epirus(98), galatians(102)
//   ptolemaic(6) <-> egypt(95), cyrene(85), kush(134)
// Look for any place where a warring pair's two faction-ids appear as u32 LE
// within a small window of each other. Report context.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const save = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);

// pairs to look for (a,b)
const pairs = [
  [7, 235], [7, 236], [5, 98], [5, 102], [6, 95], [6, 85], [6, 134], [98, 125], [206, 149],
];

function readU32(o) { return o + 4 <= buf.length ? buf.readUInt32LE(o) : -1; }

for (const [a, b] of pairs) {
  // Find all u32 LE == a, then check if b appears within +/- 32 bytes
  const ab = Buffer.alloc(4); ab.writeUInt32LE(a);
  const bb = Buffer.alloc(4); bb.writeUInt32LE(b);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(ab, p)) !== -1) {
    // search b within window [p-32, p+32]
    const ws = Math.max(0, p - 32), we = Math.min(buf.length, p + 36);
    const idx = buf.indexOf(bb, ws);
    if (idx >= ws && idx <= we) {
      hits.push({ aAt: p, bAt: idx, delta: idx - p });
    }
    p += 1;
    if (hits.length > 200) break;
  }
  // Only report if a appears as u32 but is "rare-ish" overall to reduce noise.
  // Count total a-occurrences
  let aCount = 0; let q = 0; while ((q = buf.indexOf(ab, q)) !== -1) { aCount++; q += 1; if (aCount > 100000) break; }
  console.log(`pair (${a},${b}): a-as-u32 occurs ~${aCount}x; pairs-within-32B: ${hits.length}`);
  for (const h of hits.slice(0, 6)) {
    console.log(`   a@0x${h.aAt.toString(16)} b@0x${h.bAt.toString(16)} delta=${h.delta}`);
  }
}
