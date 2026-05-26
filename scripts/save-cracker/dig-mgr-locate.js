// dig-mgr-locate.js — locate ROAD_MANAGER / PORT_MANAGER / WATCHTOWER_MANAGER
// sections in the body. Each is `v=1` so there should be exactly ONE of each.
//
// Strategy: find self-pointer-framed sections in the body root and look for
// ones that:
//   - sit before the tile-grid matrix (0xf8fd2)
//   - have sizes proportional to the entity count × per-entity record size
//
// Estimate sizes:
//   * ROAD_MANAGER:       3957 roads × ~16-32 B = 60-130 KB
//   * PORT_MANAGER:       1276 ports × ~16-32 B = 20-40 KB
//   * WATCHTOWER_MANAGER: 363 watchtowers × ~16-32 B = 5-12 KB
"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save: ${SAVE} (${buf.length} B)`);

// Re-read HST
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
  if (name && /^[A-Z][A-Z_0-9]*$/.test(name)) hst.push({ idx: hst.length, name, version: v });
}

// Find self-pointer-anchored sections in the body root [0x44e2..0xf8fd2)
// (skipping the toggle_fow + post-fow regions before)
console.log("\n=== Self-pointer-anchored sections in body root ===");
const sections = [];
for (let i = 0x44e2; i + 16 < 0xf8fd2; i++) {
  if (buf.readUInt32LE(i) !== i) continue;
  const size = buf.readUInt32LE(i + 4);
  if (size < 8 || size > 0xf8fd2 - i) continue;
  sections.push({ off: i, size });
}
console.log(`Total candidate sections: ${sections.length}`);

// For sections fitting our size bands, dump head bytes
const bands = [
  ["WATCHTOWER_MANAGER (~5-15 KB)", 4_000, 16_000],
  ["PORT_MANAGER (~15-50 KB)",       15_000, 50_000],
  ["ROAD_MANAGER (~50-200 KB)",      50_000, 200_000],
];
for (const [label, lo, hi] of bands) {
  const matches = sections.filter(s => s.size >= lo && s.size <= hi);
  console.log(`\n${label}: ${matches.length} matches`);
  for (const s of matches.slice(0, 5)) {
    const head = buf.slice(s.off, s.off + 32).toString("hex").match(/.{2}/g).join(" ");
    console.log(`  0x${s.off.toString(16)}: size=${s.size}  head=${head}`);
  }
}

// Also: in case sections aren't strict self-pointer-on-int-boundary, scan
// for size + N matching one of our target counts. Each manager section
// usually starts with `[u32 selfPtr][u32 size][u32 count]`. If count is at
// +8 and matches dev target, we found it.
const TARGETS = { 3957: "roads", 1276: "ports", 363: "watchtowers", 372: "ports-start", 589: "roads-start" };
console.log("\n=== Sections with u32 at +8 matching a target count ===");
for (const s of sections) {
  const c = buf.readUInt32LE(s.off + 8);
  if (TARGETS[c]) {
    const head = buf.slice(s.off, s.off + 32).toString("hex").match(/.{2}/g).join(" ");
    console.log(`  0x${s.off.toString(16)}: size=${s.size}, +8=${c} (${TARGETS[c]})  head=${head}`);
  }
}

// Also try u32 at +12, +16, +20 (count might be at various offsets)
for (const offset of [12, 16, 20, 24, 28]) {
  console.log(`\n=== Sections with u32 at +${offset} matching a target count ===`);
  for (const s of sections) {
    if (s.off + offset + 4 > buf.length) continue;
    const c = buf.readUInt32LE(s.off + offset);
    if (TARGETS[c]) {
      const head = buf.slice(s.off, s.off + 32).toString("hex").match(/.{2}/g).join(" ");
      console.log(`  0x${s.off.toString(16)}: size=${s.size}, +${offset}=${c} (${TARGETS[c]})  head=${head}`);
    }
  }
}
