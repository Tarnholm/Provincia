// dig-diplo-C.js — session 108 step C
//
// Pivot search: scan the WHOLE file for a contiguous region of ~4-8 KB
// where bytes have very low entropy (a few discrete values, like a war/peace
// matrix). Focus search outside the faction-record zone.
//
// RIS imperial has ~25 factions total (23 majors + senate + rebels). A
// 25x25 byte matrix = 625 bytes; 25x25 u32 = 2500 bytes.
//
// Strategy: sliding window where:
//   - distinct byte values ≤ 6
//   - non-zero density > 30%
//   - window divides cleanly by 25 (or 23, 24, 26)
//
// For each hit, dump the window.
//
// Usage: node dig-diplo-C.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
const buf = fs.readFileSync(SAVE);
console.log(`save_1.2.sav: ${buf.length} B`);

// Find faction record zone bounds to exclude
const { findFactionRecords } = require("../../src/factionRecordParser");
const recs = findFactionRecords(buf);
const factionStart = recs[0].offset;
const factionEnd = recs[recs.length - 1].offset + recs[recs.length - 1].size;
console.log(`Faction-record zone: 0x${factionStart.toString(16)} .. 0x${factionEnd.toString(16)}`);
console.log(`Bytes outside: 0..0x${factionStart.toString(16)} and 0x${factionEnd.toString(16)}..end`);

// Find major-record zone bounds too
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
const majorStart = majors[0].pos;
const majorEnd = majors[22].pos + 100000; // rough
console.log(`Major-faction-record zone (approx): 0x${majorStart.toString(16)} ..`);

// Search the file in WINDOWS, calculating entropy and divisibility.
const WIN = 1024;
const STEP = 256;

const candidates = [];
for (let off = 0x80000; off + WIN <= buf.length - 0x10000; off += STEP) {
  // skip the faction record zone and major record zone
  if (off >= factionStart - 1024 && off <= factionEnd + 1024) continue;
  // count distinct byte values
  const seen = new Set();
  let nz = 0;
  for (let i = 0; i < WIN; i++) {
    seen.add(buf[off + i]);
    if (buf[off + i] !== 0) nz++;
  }
  if (seen.size > 8) continue;
  if (nz < WIN * 0.25) continue;
  if (nz > WIN * 0.75) continue; // skip uniform
  // window should look enum-like
  candidates.push({ off, distinct: seen.size, nz, values: [...seen].sort((a, b) => a - b) });
}
console.log(`\nLow-entropy candidates: ${candidates.length}`);
candidates.slice(0, 30).forEach((c) => {
  console.log(`  pos=0x${c.off.toString(16)} distinct=${c.distinct} nz=${c.nz}/${WIN} vals=[${c.values.slice(0, 8).join(",")}]`);
});

// Look at the tail (after the faction record zone)
console.log(`\n\nLow-entropy candidates in tail (after faction records):`);
const tail = candidates.filter((c) => c.off > factionEnd);
tail.slice(0, 20).forEach((c) => {
  console.log(`  pos=0x${c.off.toString(16)} distinct=${c.distinct} nz=${c.nz}/${WIN} vals=[${c.values.slice(0, 8).join(",")}]`);
});

// And: pre-faction record zone (between body and major faction records)
console.log(`\n\nLow-entropy candidates BEFORE major faction records (0x80000..0x${majorStart.toString(16)}):`);
const pre = candidates.filter((c) => c.off < majorStart);
pre.slice(0, 30).forEach((c) => {
  console.log(`  pos=0x${c.off.toString(16)} distinct=${c.distinct} nz=${c.nz}/${WIN} vals=[${c.values.slice(0, 8).join(",")}]`);
});

// Top 5 most-promising: dump first 256 bytes
console.log(`\n\nTop 5 most-promising — first 256 bytes:`);
candidates.slice(0, 5).forEach((c) => {
  console.log(`\n--- pos=0x${c.off.toString(16)} distinct=${c.distinct} ---`);
  for (let i = 0; i < 256; i += 32) {
    let h = "  ";
    for (let j = 0; j < 32 && i + j < 256; j++) {
      h += buf[c.off + i + j].toString(16).padStart(2, "0") + " ";
    }
    console.log(h);
  }
});
