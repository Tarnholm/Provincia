// dig-hst-idx-scan.js — scan body for section type tags
//
// HST indices of interest:
//   WATCHTOWER_MANAGER = 32 = 0x20  (v=1)
//   PORT_MANAGER       = 37 = 0x25  (v=1)
//   ROAD_MANAGER       = 55 = 0x37  (v=1)
//   WATCHTOWER         = 60 = 0x3c  (v=2)
//   FORT               = 56 = 0x38  (v=6)
//   FORT_MANAGER       = 27 = 0x1b  (v=1)
//   PORT_SHROUD        = 42 = 0x2a  (v=3)
//   WATCHTOWER_SHROUD  = 40 = 0x28  (v=1)
//   FORT_SHROUD        = ?? — search
//
// If sections are emitted as `[u32 selfPtr][u32 size][u16 hstIdx][u16 version]`
// or similar, then for a stride-N records section we'd see the type tag
// once. For an array of WATCHTOWER records, the type tag might be followed
// by a u32 count.
"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save: ${SAVE} (${buf.length} B)`);

// Re-read HST to confirm indices
const HST_START = 0x3328;
const HST_END = 0x3bad;
const hst = [];
let p = HST_START;
while (p < HST_END) {
  const s = p;
  while (p < HST_END && buf[p] !== 0) p++;
  if (p >= HST_END) break;
  const name = buf.slice(s, p).toString("ascii");
  p++;
  if (p + 4 > HST_END) break;
  const v = buf.readUInt32LE(p);
  p += 4;
  if (name && /^[A-Z][A-Z_0-9]*$/.test(name)) {
    hst.push({ idx: hst.length, name, version: v, off: s });
  }
}
console.log(`HST: ${hst.length} entries`);
const want = ["WATCHTOWER_MANAGER","PORT_MANAGER","ROAD_MANAGER","WATCHTOWER","FORT","FORT_MANAGER","PORT_SHROUD","WATCHTOWER_SHROUD","FORT_SHROUD"];
const idx = {};
for (const w of want) {
  const e = hst.find(h => h.name === w);
  if (e) idx[w] = e.idx;
  console.log(`  ${w} = ${e ? e.idx : "?"} (v=${e?.version})`);
}

// Now scan the body for places where these indices appear as u16/u32
// The body root is at 0x3b99, size 6,488,090. End ~= 0x3b99 + 0x630a3a = 0x636d3
// Wait that's odd — body root is way smaller. Let me check actual.
// Bound the scan to the tile-grid start (which marks end of body root grammar).
const bodyEnd = Math.min(buf.length, 0xf8fd2);
console.log(`body end (capped at tile-grid start 0xf8fd2): 0x${bodyEnd.toString(16)}`);

// Scan: look for `<selfPtr_at_i><size><u16 idx>` patterns where idx is in our set
// The version-suffix lets us validate: WATCHTOWER has v=2, FORT v=6 etc.
console.log("\n=== Search body for taw sections with HST-idx + version match ===");
const hstByIdx = new Map();
for (const e of hst) hstByIdx.set(e.idx, e);

// Multiple layout attempts to find section type tags.
// Layout A: [u32 selfPtr][u32 size][u16 idx][u16 ver]
// Layout B: [u32 selfPtr][u32 size][u8 idx][u8 ver][u16 pad]
// Layout C: just look for "<u8 idx><u8 ver>" pattern anywhere
console.log("\n--- Layout C: scan for u8(idx) immediately followed by u8(version) ---");
const tally = {};
for (let i = 0x3ba1; i + 1 < bodyEnd; i++) {
  const a = buf[i], b = buf[i+1];
  if (hstByIdx.has(a) && hstByIdx.get(a).version === b) {
    const name = hstByIdx.get(a).name;
    tally[name] = (tally[name] || 0) + 1;
  }
}
for (const [n, c] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${n.padEnd(40)} ${c}`);
}

console.log("\n--- Layout D: scan for u32(idx-only) + look for sentinel patterns ---");
const tallyD = {};
for (let i = 0x3ba1; i + 4 < bodyEnd; i++) {
  const v = buf.readUInt32LE(i);
  if (hstByIdx.has(v)) {
    const name = hstByIdx.get(v).name;
    tallyD[name] = (tallyD[name] || 0) + 1;
  }
}
const showD = ["WATCHTOWER_MANAGER","PORT_MANAGER","ROAD_MANAGER","WATCHTOWER","FORT","FORT_MANAGER","PORT_SHROUD","WATCHTOWER_SHROUD","FORT_SHROUD"];
for (const n of showD) {
  if (tallyD[n]) console.log(`  ${n.padEnd(40)} ${tallyD[n]}`);
}
