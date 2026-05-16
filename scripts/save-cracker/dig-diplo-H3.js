// dig-diplo-H3.js — session 109 step H3
//
// H2 found there are 32 additional 0x39240005 marker zones OUTSIDE the
// 23 major records. They live in some "other" zone (not inside NPC
// ff0aaff0 records either). What zone is that?
//
// 23 + 32 = 55 marker hits in save_10_fresh. Whole-file scan for the
// marker. Locate each + dump a 64B window around it.
//
// HYPOTHESIS: each major faction has TWO marker zones:
//   * one inside its major record (entries list)
//   * one in a global "diplomatic-relations" section
//
// Or: the 32 extras are for "alliance documents" / "treaties" / sub-factions
// like senate + faction-leaders.
//
// Usage: node dig-diplo-H3.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_10_fresh.sav");
const buf = fs.readFileSync(SAVE);

// All marker positions
const markers = [];
for (let i = 0; i + 4 < buf.length; i++) {
  if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) {
    markers.push(i);
  }
}
console.log(`Total 0x39240005 markers in save: ${markers.length}`);
console.log(`Position range: 0x${markers[0].toString(16)} .. 0x${markers[markers.length - 1].toString(16)}`);

// For each marker, read u32 count following and verify the next `count*16`
// bytes are entries of the form <u32><u32><u32><01 01 01 00>
function isValidMarkerZone(off) {
  const count = buf.readUInt32LE(off + 4);
  if (count > 200 || count === 0) return { valid: false, count };
  for (let k = 0; k < count; k++) {
    const e = off + 8 + k * 16;
    if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) {
      return { valid: false, count };
    }
  }
  return { valid: true, count };
}

const validMarkers = markers.map((off) => ({ off, ...isValidMarkerZone(off) }));
const valid = validMarkers.filter((m) => m.valid);
console.log(`Valid marker zones (count ≤200, all entries end in 01 01 01 00): ${valid.length}`);
console.log(`Counts:`, valid.map((m) => m.count).join(","));

// For each valid marker, what immediately PRECEDES it? Look at 16B before.
console.log(`\n=== 16B context BEFORE each valid marker ===`);
for (let mi = 0; mi < Math.min(valid.length, 60); mi++) {
  const off = valid[mi].off;
  const pre = [];
  for (let k = -16; k < 0; k++) {
    if (off + k >= 0) pre.push(buf[off + k].toString(16).padStart(2, "0"));
    else pre.push("..");
  }
  console.log(`  marker[${mi.toString().padStart(2)}] @0x${off.toString(16)} count=${valid[mi].count}  pre16: ${pre.join(" ")}`);
}

// Each valid marker — is there a SHORT preceding header? Look at u32s
// immediately before. Hypothesis: preceded by self-pointer or small u32.
console.log(`\n=== u32 sequence at -32..-4 for each valid marker (4 u32s before count) ===`);
for (let mi = 0; mi < Math.min(valid.length, 30); mi++) {
  const off = valid[mi].off;
  const before = [];
  for (let k = -32; k < 0; k += 4) {
    if (off + k >= 0) before.push(buf.readUInt32LE(off + k));
  }
  console.log(`  m[${mi.toString().padStart(2)}] @0x${off.toString(16)} count=${valid[mi].count}: pre=[${before.join(", ")}]`);
}

// Show all 32 "other" markers (= valid markers NOT in major records).
// Already enumerated above. Now: are they sequentially placed? Compute
// distance between adjacent markers in file order.
console.log(`\n=== Gaps between adjacent valid markers ===`);
for (let mi = 1; mi < valid.length; mi++) {
  const prev = valid[mi - 1];
  const cur = valid[mi];
  const blockSize = prev.count * 16 + 8;
  const gap = cur.off - prev.off - blockSize;
  console.log(`  m[${(mi - 1).toString().padStart(2)}] @0x${prev.off.toString(16)} count=${prev.count} block-size=${blockSize}  →  m[${mi.toString().padStart(2)}] @0x${cur.off.toString(16)} gap-after-block=${gap}`);
}
