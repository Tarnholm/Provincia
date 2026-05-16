// dig-diplo-H4.js — session 109 step H4
//
// H3 found there are 219 valid 0x39240005 marker zones in save_10_fresh.
// 23 are inside major records. The other 196 are at file offsets
// 0x154e338..end. These are AFTER the 23 major records (which start at
// 0x1541d67 in save_1.2).
//
// HYPOTHESIS: there's a SECOND family of "faction" records starting at
// 0x154e338. These are NOT the ff0aaff0 records (which start later).
//
// Each such record has the preamble `00 00 00 01 00 00 00 00 07 00 00 00`
// before the marker. Working backward, what's the record HEADER?
//
// Also: each marker has its own A-range (m[3] count=41 has high A values,
// m[14] count=3 has different A). Maybe A values are DENSE per faction.
//
// IMPORTANT: H found that the AA values in the 32 "other" hits (NOT in
// major-records) were DIFFERENT from the major-record A values. E.g.:
//   hit at 0x1554ba8 run=41: A=1078, 1024, 1003, 1011, 1089, 893, ...
//   hit at 0x1842b3c run=5:  A=203, 191, 229, 217, 192, ...
// And the FIRST hit at 0x1554ba8 has 41 entries — that's a LOT.
//
// Let's verify the hypothesis: are these the diplomatic relations from
// the OTHER side? I.e., the major-record list has relations FROM that
// major's perspective, and these other records have the OTHER faction's
// list?
//
// Test: count total entries across all 219 marker zones. If diplomacy is
// stored TWO-SIDED, total should be 2 × sum-of-major-record-entries =
// 2 × 292 = 584. Or some related total.
//
// Usage: node dig-diplo-H4.js
"use strict";

const fs = require("fs");
const path = require("path");
const { findFactionRecords } = require("../../src/factionRecordParser");

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
const npcRecs = findFactionRecords(buf);
console.log(`Majors: ${majors.length}, ff0aaff0 records: ${npcRecs.length}`);
if (npcRecs.length > 0) {
  const npcStart = npcRecs[0].offset;
  const npcEnd = npcRecs[npcRecs.length - 1].offset + npcRecs[npcRecs.length - 1].size;
  console.log(`ff0aaff0 records: 0x${npcStart.toString(16)} .. 0x${npcEnd.toString(16)} (${((npcEnd - npcStart) / 1024 / 1024).toFixed(1)} MB)`);
}
console.log(`Majors first: 0x${majors[0].pos.toString(16)}, last: 0x${majors[majors.length - 1].pos.toString(16)}`);

// All markers
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
console.log(`Total valid markers: ${valid.length}`);

// Per-major marker positions
const majorMarkers = majors.map((m, i) => ({ majorIdx: i, off: m.pos + 244 + 4 * m.regions, regions: m.regions, recOff: m.pos }));
const majorMarkerSet = new Set(majorMarkers.map((m) => m.off));

// Classify each valid marker
const outsideMajor = valid.filter((off) => !majorMarkerSet.has(off));
console.log(`Markers in 23 majors: ${valid.length - outsideMajor.length}`);
console.log(`Markers NOT in majors: ${outsideMajor.length}`);

// Where do the outside markers live?
// Major-record range:
const majorMin = majors[0].pos;
const majorMax = majors[majors.length - 1].pos + 16384;
let beforeMajor = 0, betweenMajor = 0, afterMajor = 0, inNpc = 0;
for (const off of outsideMajor) {
  if (off < majorMin) beforeMajor++;
  else if (off < majorMax) betweenMajor++;
  else {
    // Check if inside an NPC record
    const found = npcRecs.find((r) => off >= r.offset && off < r.offset + r.size);
    if (found) inNpc++;
    else afterMajor++;
  }
}
console.log(`Outside-major markers: before-major=${beforeMajor} between-major=${betweenMajor} in-npc=${inNpc} after-npc=${afterMajor}`);
console.log(`majorRange: 0x${majorMin.toString(16)}..0x${majorMax.toString(16)}`);

// Compute Total entries summed
let totalEntries = 0;
for (const off of valid) {
  totalEntries += buf.readUInt32LE(off + 4);
}
console.log(`\nTotal entries across all ${valid.length} valid markers: ${totalEntries}`);
const majorEntries = majorMarkers.reduce((s, m) => s + buf.readUInt32LE(m.off + 4), 0);
console.log(`  Inside 23 majors: ${majorEntries}`);
console.log(`  Outside 23 majors: ${totalEntries - majorEntries}`);

// For each "outside" marker, dump first 8 entries
console.log(`\n=== First few outside markers, full entry dump ===`);
const outsideValid = outsideMajor.slice(0, 6);
for (const off of outsideValid) {
  const count = buf.readUInt32LE(off + 4);
  console.log(`\n  marker @0x${off.toString(16)} count=${count}`);
  for (let k = 0; k < Math.min(count, 8); k++) {
    const e = off + 8 + k * 16;
    console.log(`    [${k}] A=${buf.readUInt32LE(e)} B=${buf.readUInt32LE(e + 4)} C=${buf.readUInt32LE(e + 8)} D=0x${buf.readUInt32LE(e + 12).toString(16).padStart(8, "0")}`);
  }
}

// HYPOTHESIS: each "outside" marker is the START of a different record
// type (perhaps NPC faction records of a DIFFERENT magic). Let's look at
// what's exactly N bytes before each outside marker. Common preamble.
// Pre-marker 12B pattern observed: `00 00 00 01 00 00 00 00 07 00 00 00`
// → that's 3 u32: 0x01000000, 0, 7. Then `00 00 00 00` and marker.
// Actually re-read: "pre16: 00 00 00 01 00 00 00 00 07 00 00 00 00 00 00 00"
// at offset -16..-1. So that's:
//   off-16: 00 00 00 01 → u32 = 0x01000000 = 16777216  (a 32-bit "1" little-endian??)
// Wait: little-endian: bytes 00 00 00 01 → 0x01000000 = 16777216 BIG-endian.
// Little-endian = the bytes 00 00 00 01 = the u32 with value: byte[0] + (byte[1]<<8) + (byte[2]<<16) + (byte[3]<<24) = 0 + 0 + 0 + 0x01000000 = 16777216.
// So that's 16M as a u32. Suspicious — but the pre-pattern is constant.

// Look for the start of each "record" preceding outside markers. Maybe
// each record has a recognizable head (a magic, or self-pointer).
console.log(`\n=== Look BACKWARD from each outside marker to find record-head ===`);
// We have 100KB+ gaps between outside markers (look at gaps from H3:
// 6549..230431 bytes). So each marker has a LARGE preceding chunk of
// data. Find a recognizable head pattern by scanning backward.

// Test 1: scan 32B before each marker, look for repeated 4B sequences.
for (let i = 0; i < Math.min(outsideMajor.length, 6); i++) {
  const off = outsideMajor[i];
  console.log(`\n  marker @0x${off.toString(16)}: 64B before`);
  const start = Math.max(0, off - 64);
  for (let p = start; p < off; p += 16) {
    const bytes = [];
    for (let k = 0; k < 16 && p + k < off; k++) bytes.push(buf[p + k].toString(16).padStart(2, "0"));
    const ascii = [];
    for (let k = 0; k < 16 && p + k < off; k++) {
      const c = buf[p + k];
      ascii.push(c >= 32 && c < 127 ? String.fromCharCode(c) : ".");
    }
    console.log(`    -${(off - p).toString().padStart(3)}: ${bytes.join(" ")}  ${ascii.join("")}`);
  }
}

// Look at the first marker @ 0x154e338 — what's at the START of this section?
const firstOutsideMarker = outsideMajor[0];
console.log(`\n=== First outside marker: 0x${firstOutsideMarker.toString(16)}; scan 256B before ===`);
const lookback = 1024;
for (let p = firstOutsideMarker - lookback; p < firstOutsideMarker; p += 32) {
  const bytes = [];
  for (let k = 0; k < 32 && p + k < firstOutsideMarker; k++) bytes.push(buf[p + k].toString(16).padStart(2, "0"));
  const ascii = [];
  for (let k = 0; k < 32 && p + k < firstOutsideMarker; k++) {
    const c = buf[p + k];
    ascii.push(c >= 32 && c < 127 ? String.fromCharCode(c) : ".");
  }
  console.log(`  -${(firstOutsideMarker - p).toString().padStart(4)}: ${bytes.slice(0, 16).join(" ")}  ${bytes.slice(16, 32).join(" ")}  ${ascii.join("")}`);
}
