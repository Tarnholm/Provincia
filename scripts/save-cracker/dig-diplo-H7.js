// dig-diplo-H7.js — session 109 step H7
//
// H6 confirmed: each of 780 A values is GLOBALLY UNIQUE. So A is a
// relation-UUID and lives in only one zone (the OWNING faction).
//
// To find the OTHER faction, we need to either:
//   a) Find a global table {A → (factionA, factionB)}
//   b) Find an embedded faction-id in each marker zone (so we know
//      which faction owns each zone)
//
// Step 1: locate the head of each "outside" marker zone (the record
// containing the marker). Look for a faction-id field.
//
// Hypothesis: each zone is a record like:
//   [head with faction-id and self-pointers]
//   [marker 0x39240005]
//   [u32 count]
//   [count × 16B entries]
//
// We've seen the preamble: `... d0 fc 54 01 00 00 00 00 01 00 00 00 00 07
// 00 00 00 00 00 00 00 [MARKER]`. The `d0 fc 54 01` at offset -28..-25
// looks like a self-pointer (0x0154fcd0 — close to the marker offset
// 0x0154fce5).
//
// Look further back: is there an obvious faction-id at offset -32..-28
// or -64..-32?
//
// Approach: for several outside markers, fully dump the 256B preceding,
// look for a u32 in range 0..200 (faction-id) or matching faction names.
//
// Usage: node dig-diplo-H7.js
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_10_fresh.sav");
const buf = fs.readFileSync(SAVE);

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}
const majors = readMajor(buf);
const markers = [];
for (let i = 0; i + 4 < buf.length; i++) {
  if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
}
const valid = markers.filter((off) => {
  const count = buf.readUInt32LE(off + 4);
  if (count > 200 || count === 0) return false;
  for (let k = 0; k < count; k++) {
    const e = off + 8 + k * 16;
    if (e + 16 > buf.length) return false;
    if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
  }
  return true;
});
const majorMarkerOffs = new Set(majors.map((m) => m.pos + 244 + 4 * m.regions));
const outside = valid.filter((off) => !majorMarkerOffs.has(off));
console.log(`Outside markers: ${outside.length}`);

// For first 10 outside markers, dump 128B before, looking for ANY u32 in
// 0..300 that might be a faction-id
console.log(`\n=== 128B-before dump for first 10 outside markers ===`);
for (let mi = 0; mi < 10 && mi < outside.length; mi++) {
  const off = outside[mi];
  const count = buf.readUInt32LE(off + 4);
  console.log(`\nMarker @0x${off.toString(16)} count=${count}`);
  // Find every u32 in -128..-1 that's a "small id" (0..300)
  const smallU32s = [];
  for (let p = off - 128; p < off; p += 1) {
    if (p < 0 || p + 4 > buf.length) continue;
    const v = buf.readUInt32LE(p);
    if (v > 0 && v < 300) smallU32s.push({ rel: p - off, val: v });
  }
  console.log(`  small u32s (rel offset, value): ${smallU32s.slice(0, 20).map((s) => `(${s.rel},${s.val})`).join(" ")}`);
  // Dump 64B before
  for (let p = off - 64; p < off; p += 16) {
    const bytes = [];
    for (let k = 0; k < 16 && p + k < off; k++) bytes.push(buf[p + k].toString(16).padStart(2, "0"));
    console.log(`    -${(off - p).toString().padStart(3)}: ${bytes.join(" ")}`);
  }
}

// Look at the preamble more carefully. The 16B immediately before marker
// is `00 00 00 01 00 00 00 00 07 00 00 00 00 00 00 00`.
// Bytes -16..-13: 00 00 00 01 → 0x01000000 LE = 16777216. That's 0x01000000.
// Bytes -12..-9:  00 00 00 00 = 0
// Bytes -8..-5:   07 00 00 00 = 7  (CONSTANT)
// Bytes -4..-1:   00 00 00 00 = 0
//
// At -20..-17 we'd have the byte BEFORE the constant 0x01000000. Let me
// dump that consistently across all outside markers.
console.log(`\n=== u32 distribution at -20..-17 (just before 0x01000000) ===`);
const u32_neg20 = {};
for (const off of outside) {
  const v = buf.readUInt32LE(off - 20);
  u32_neg20[v] = (u32_neg20[v] || 0) + 1;
}
const distinct_neg20 = Object.entries(u32_neg20).sort((a, b) => +b[1] - +a[1]);
console.log(`  ${distinct_neg20.length} distinct values, top 20:`);
distinct_neg20.slice(0, 20).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

// at -24..-21 (4-byte u32 before that)
console.log(`\n=== u32 at -24..-21 ===`);
const u32_neg24 = {};
for (const off of outside) {
  const v = buf.readUInt32LE(off - 24);
  u32_neg24[v] = (u32_neg24[v] || 0) + 1;
}
const distinct_neg24 = Object.entries(u32_neg24).sort((a, b) => +b[1] - +a[1]);
console.log(`  ${distinct_neg24.length} distinct values, top 20:`);
distinct_neg24.slice(0, 20).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

// at -28..-25 (probable self-pointer in major-records)
console.log(`\n=== u32 at -28..-25 (potential self-ptr) ===`);
let isSelfPtr = 0, isNotSelfPtr = 0;
const samplesNotSelf = [];
for (const off of outside) {
  const v = buf.readUInt32LE(off - 28);
  // Self-pointer would be `marker - 28` (i.e., it points to its own location)
  if (v === off - 28) isSelfPtr++;
  else {
    isNotSelfPtr++;
    if (samplesNotSelf.length < 10) samplesNotSelf.push({ markerOff: off, val: v });
  }
}
console.log(`  u32 == offset (self-ptr): ${isSelfPtr}/${outside.length}`);
console.log(`  not self-ptr: ${isNotSelfPtr}`);
samplesNotSelf.forEach((s) => console.log(`    marker=0x${s.markerOff.toString(16)} val=0x${s.val.toString(16)}=${s.val} delta=${s.val - s.markerOff}`));

// Compute (val - markerOff) histogram — if it's a constant delta, that's a self-ptr to record-head
const deltas = [];
for (const off of outside) {
  const v = buf.readUInt32LE(off - 28);
  if (v > 0 && v < buf.length) deltas.push(v - off);
}
const deltaHisto = {};
deltas.forEach((d) => { deltaHisto[d] = (deltaHisto[d] || 0) + 1; });
console.log(`\n=== Delta (u32@-28 minus markerOff) histogram top 20 ===`);
const dtop = Object.entries(deltaHisto).sort((a, b) => +b[1] - +a[1]).slice(0, 20);
dtop.forEach(([k, v]) => console.log(`  delta=${k}: ${v}`));
