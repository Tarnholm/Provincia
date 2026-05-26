// dig-post-grid-267-array.js — investigate the largest unknown blob found
// by cover.js: 650,802 bytes at 0x00f85f5c → 0x01024d8e (0.92% of the
// Turn-960 dummies save), sitting between the end of settlement-detail-0
// (or the tile-grid matrix' implicit settlement-0 placeholder) and the
// start of the building-chain section / first settlement marker.
//
// FINDINGS (2026-05-26 session):
//  * Blob is 91.3% zero bytes, 3.4% 0xff, 5.3% other.
//  * Contains exactly 2,272 records that share the SAME 267-byte stride
//    as the main tile-grid matrix (240×238 × 267 B).
//  * Stride breakdown: 267 (×2,142), 534 (×101), 801 (×22), 1068 (×5),
//    1602 (×1) — i.e. baseline 267 with occasional multi-tile entries.
//  * Of the 2,272 records, ONLY 418 differ from a common "default
//    template" record (offset 0). The other 1,854 are byte-identical.
//  * Record-0 layout (267 B):
//      +0x00  u32  0x000003c4 = 964   (record-type / pool size?)
//      +0x0c  u32  0x000003c9 = 969
//      +0x10  u32  200
//      +0x14  u32  200
//      +0x18  u32  2
//      +0x1c  u32  6
//      +0x20  u32  200
//      +0x44  u32  0xffffffff (sentinel)
//      +0x4c  u32  959
//      +0x54  u32  0x000005ff = 1535
//      +0x5c  u32  0xffffffff (sentinel)
//      +0x60  u32  166
//      (rest mostly zeros)
//  * Differing fields in a real record are sparse and single-byte —
//    looks like flag/level bitfields scattered through the template.
//
// INTERPRETATION:
//   This is an *auxiliary* tile-attribute array in the same 267-B-stride
//   format as the main 240×238 grid, but only ~2,272 entries (~4 % of the
//   full grid). The "default-template" copy of 1,854 entries strongly
//   suggests a sparsely-used pool — the engine reserves space for every
//   slot but only writes the ~418 ones that carry real data.
//
//   Settlement-detail tokens (`fc fc fc fc 64 …`, `hinterland_region`,
//   `core_building`) all have ZERO hits inside this blob — so it is NOT
//   per-settlement records. Likeliest candidates (need verification with
//   diffed saves): strategic-AI tile cache, trade-route waypoint array,
//   or a coarser sub-region grid (2,272 = 32×71).
//
// VERDICT (resources-table hypothesis, 2026-05-26 follow-up — see
// dig-resources-confirm.js):  blob is NOT the resources table.
//   * descr_strat (imperial_campaign) has 5,548 resource entries, none of
//     the natural filters (slaves-only=1311, non-slaves=4237) gives 2,272.
//   * Every u32 field in the record (0x10, 0x14, 0x20, 0x28, 0x2c, 0x4c, …)
//     has ≤ ~67 distinct values and clusters on magic constants
//     (200, 600, 959, 1535, 166) — nothing looks like an (x,y) tile coord.
//     Real resource coords span x∈[4..1019], y∈[1..698] with hundreds of
//     distinct values; we don't see that shape anywhere.
//   * Best (x,y) hit-rate against descr_strat coords was 57.9 % (u32 y,x
//     @ +0x10), and inspection shows all those hits are template-value
//     collisions on the lone Thamoudaia perfumes resource at (600,200) —
//     not a structural match.
//   Next hypotheses to test: AI strategic-target pool, diplomacy/trade
//   matrix, watchtower/fort pool, or a long-range AI tile-evaluation cache.
//
// Usage:  node dig-post-grid-267-array.js [savePath]

"use strict";
const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const BLOB_START = 0xf85f5c;
const BLOB_END   = 0x1024d8e;
const STRIDE     = 267;

const buf  = fs.readFileSync(SAVE);
const span = buf.slice(BLOB_START, BLOB_END);
console.log(`save:    ${SAVE}`);
console.log(`blob:    0x${BLOB_START.toString(16)}..0x${BLOB_END.toString(16)} (${span.length} B = ${(span.length/1024).toFixed(1)} KB)`);

// Locate cluster starts (`c4 03 00 00` after a zero byte).
const positions = [];
for (let i = 0; i + 4 <= span.length; i++) {
  if (span[i] === 0xc4 && span[i+1] === 0x03 && span[i+2] === 0x00 && span[i+3] === 0x00) {
    if (i === 0 || span[i-1] === 0) positions.push(i);
  }
}
console.log(`records: ${positions.length}`);

// Stride distribution.
const tally = new Map();
for (let i = 1; i < positions.length; i++) {
  const s = positions[i] - positions[i-1];
  tally.set(s, (tally.get(s) || 0) + 1);
}
console.log("strides (count × bytes):");
for (const [s, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(5)} × ${s} B   (= 267 × ${(s / STRIDE).toFixed(2)})`);
}

// Diff each record against record-0 (template) — count uniques.
const base = buf.slice(BLOB_START + positions[0], BLOB_START + positions[0] + STRIDE);
let uniques = 0;
for (let i = 1; i < positions.length; i++) {
  const o = BLOB_START + positions[i];
  if (!buf.slice(o, o + STRIDE).equals(base)) uniques++;
}
console.log(`unique records (vs template):  ${uniques} / ${positions.length} (${(100*uniques/positions.length).toFixed(1)}%)`);

// Magic-token presence — confirms it's NOT a settlement-detail array.
const TOKENS = ["hinterland_region", "core_building", "default_set", "settlement", "governor"];
console.log("settlement-detail tokens inside blob:");
for (const t of TOKENS) {
  const tb = Buffer.from(t);
  let count = 0, p = BLOB_START;
  while ((p = buf.indexOf(tb, p)) >= 0 && p < BLOB_END) { count++; p += 1; }
  console.log(`  ${JSON.stringify(t).padEnd(22)} : ${count} hit(s)`);
}

// Dump first record's u32 fields for the documented layout.
console.log("first record u32 layout:");
const o0 = BLOB_START + positions[0];
for (const off of [0x00, 0x04, 0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x44, 0x48, 0x4c, 0x50, 0x54, 0x58, 0x5c, 0x60]) {
  const v = buf.readUInt32LE(o0 + off);
  console.log(`  +0x${off.toString(16).padStart(2, "0")}  u32 = ${v} (0x${v.toString(16)})`);
}
