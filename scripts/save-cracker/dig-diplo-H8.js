// dig-diplo-H8.js — session 109 step H8 — BREAKTHROUGH PROBE
//
// H7 found: 64B before each outside marker is `00 00 03 00 00 00 00 00 00
// 00 00 <FACTIONID:u32> 00 00 00 ...`. The byte at -53 (the u32 at -52)
// holds an INCREASING per-zone integer. Hypothesis: this is the FACTION
// INDEX of the zone-owner (0..238).
//
// CRITICAL TEST: for the 23 major markers, what's the u32 at -52? It
// should be the major's faction-index (0..22) or its global index.
//
// And: does the increment from major-index 0..22 plus the outside indexes
// span 0..N for some N?
//
// Usage: node dig-diplo-H8.js
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

// For EACH valid marker (both major and outside), dump u32 at -52 and
// neighbors. Pretty-print.
console.log(`=== Per-marker faction-id candidates (u32 at -52 and adjacent) ===`);
const factionIds = [];
for (let i = 0; i < valid.length; i++) {
  const off = valid[i];
  const isMajor = majorMarkerOffs.has(off);
  const u32_m52 = buf.readUInt32LE(off - 52);
  const u32_m48 = buf.readUInt32LE(off - 48);
  const u32_m44 = buf.readUInt32LE(off - 44);
  const u32_m56 = buf.readUInt32LE(off - 56);
  const u32_m60 = buf.readUInt32LE(off - 60);
  const u32_m64 = buf.readUInt32LE(off - 64);
  factionIds.push({ off, isMajor, u32_m52, u32_m48, u32_m44, u32_m56, u32_m60, u32_m64 });
  if (i < 30 || isMajor) {
    console.log(`  m[${i.toString().padStart(3)}] @0x${off.toString(16)} ${isMajor ? "MAJ" : "out"}  -64:${u32_m64}  -60:${u32_m60}  -56:${u32_m56}  -52:${u32_m52}  -48:${u32_m48}  -44:${u32_m44}`);
  }
}

console.log(`\n=== Distribution of u32 at -52 ===`);
const d52 = {};
factionIds.forEach((f) => { d52[f.u32_m52] = (d52[f.u32_m52] || 0) + 1; });
const top = Object.entries(d52).sort((a, b) => +a[0] - +b[0]).slice(0, 40);
console.log(`  distinct values: ${Object.keys(d52).length}`);
top.forEach(([k, v]) => console.log(`    ${k}: ${v}`));

console.log(`\n=== Is u32@-52 globally unique across ALL 219 markers? ===`);
const allIds52 = factionIds.map((f) => f.u32_m52).sort((a, b) => a - b);
const dups = allIds52.filter((v, i) => allIds52[i - 1] === v);
console.log(`  duplicates: ${dups.length}`);
console.log(`  min: ${allIds52[0]}, max: ${allIds52[allIds52.length - 1]}`);
console.log(`  first 30 sorted: ${allIds52.slice(0, 30).join(",")}`);
console.log(`  last 10 sorted: ${allIds52.slice(-10).join(",")}`);

// For majors only — what's u32@-52?
console.log(`\n=== Majors only: u32@-52 ===`);
factionIds.filter((f) => f.isMajor).forEach((f, mi) => {
  console.log(`  major[${mi}] @0x${f.off.toString(16)}  u32@-52 = ${f.u32_m52}`);
});

// Could u32@-52 be a faction-id 0..238 directly mappable to RIS imperial faction order?
// 219 markers, 219 distinct values?
const distinctIds = new Set(factionIds.map((f) => f.u32_m52));
console.log(`\nTotal distinct u32@-52: ${distinctIds.size}/${factionIds.length}`);
