// splice-d14-scaled.js — multi-record splice of safe-to-trim characters.
//
// If D14 works for ONE safe-to-trim record, this scales the mechanism
// to splice ALL N safe-to-trim records at once.
//
// Algorithm:
//   1. Find all safe-to-trim dead records (refs=1)
//   2. Sort by position DESCENDING (process highest-position first)
//   3. For each, splice + patch self-pointers within the resulting buffer
//   4. Cumulative effect: each subsequent splice operates on smaller buffer
//
// Usage:  node scripts/save-cracker/splice-d14-scaled.js [count]
//   count = number of safe-to-trim records to splice (default: 10, max: 307)
//
// Generates: save_TEST_D14s_safe_trim_N.sav

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const DEAD = Buffer.from("/portraits/dead/", "ascii");

function locateRecords(buf) {
  const records = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(DEAD, from);
    if (i < 0) break;
    let dataOff = -1;
    for (let p = i - 1; p >= i - 64; p--) {
      if (buf[p] === 0x64 && buf[p+1] === 0x61 && buf[p+2] === 0x74 && buf[p+3] === 0x61 && buf[p+4] === 0x2f) { dataOff = p; break; }
    }
    if (dataOff < 0) { from = i + DEAD.length; continue; }
    const lp = dataOff - 2;
    const pl = buf.readUInt16LE(lp);
    if (pl < 16 || pl > 200) { from = i + DEAD.length; continue; }
    records.push({ lp, pl, uuid: buf.readUInt32LE(lp + pl + 13) });
    from = dataOff + pl;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lp;
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);

// Build u32 histogram (= UUID reference counts)
console.log("Building u32 histogram (~10s)...");
const u32Counts = new Map();
for (let p = 0; p + 4 <= buf.length; p++) {
  const v = buf.readUInt32LE(p);
  if (v < 0x10000 || v === 0xffffffff) continue;
  u32Counts.set(v, (u32Counts.get(v) || 0) + 1);
}

// Filter to safe-to-trim records (refs=1)
const safe = recs.filter(r => r.endOff && (u32Counts.get(r.uuid) || 0) === 1);
console.log(`Safe-to-trim dead records found: ${safe.length}`);

const COUNT = parseInt(process.argv[2] ?? "10", 10);
const victims = safe.slice(0, Math.min(COUNT, safe.length));
console.log(`Splicing ${victims.length} records...`);

// Sort victims by position DESCENDING — splice highest first to keep earlier positions stable
victims.sort((a, b) => b.lp - a.lp);

// Total bytes that will be removed
let totalBytes = 0;
for (const v of victims) totalBytes += v.endOff - v.lp;
console.log(`Total bytes to remove: ${totalBytes}`);

// Find all self-pointers in original (we'll patch them at the end based on
// cumulative shift)
console.log(`Scanning original self-pointers...`);
const allSP = [];
for (let p = 0; p + 4 <= buf.length; p++) {
  if (buf.readUInt32LE(p) === p) allSP.push(p);
}
console.log(`  Found ${allSP.length} self-pointers`);

// Build the spliced buffer by removing each victim's bytes
let out = Buffer.from(buf);
const splicedRanges = victims.map(v => ({ from: v.lp, to: v.endOff, bytes: v.endOff - v.lp }));
// Sort by from descending
splicedRanges.sort((a, b) => b.from - a.from);
for (const range of splicedRanges) {
  out = Buffer.concat([out.slice(0, range.from), out.slice(range.to)]);
}
console.log(`File size: ${buf.length} -> ${out.length} (-${buf.length - out.length} bytes)`);

// Patch self-pointers: each self-pointer's new value = original - (sum of bytes removed BEFORE this self-pointer's original position)
// To compute: sort splicedRanges by `from` ASCENDING, then for each self-pointer p in original,
// shift = sum of bytes of ranges where range.from < p AND range.to <= p
const sortedRanges = [...splicedRanges].sort((a, b) => a.from - b.from);
function shiftAt(originalP) {
  let s = 0;
  for (const r of sortedRanges) {
    if (r.to <= originalP) s += r.bytes;
    else if (r.from < originalP) {
      // partially overlaps — shouldn't happen if originalP isn't inside a splice region
      return null;
    } else {
      break;
    }
  }
  return s;
}

let patched = 0;
for (const p of allSP) {
  const shift = shiftAt(p);
  if (shift === null) continue; // self-pointer is inside a spliced region — was removed
  if (shift === 0) continue; // before any splice, no shift needed
  const newPos = p - shift;
  if (newPos + 4 > out.length) continue;
  // Original value at newPos should be the stale self-pointer = p
  if (out.readUInt32LE(newPos) !== p) continue;
  out.writeUInt32LE(p - shift, newPos);
  patched++;
}
console.log(`Self-pointers patched: ${patched}`);

const outName = `save_TEST_D14s_safe_trim_${victims.length}.sav`;
fs.writeFileSync(OUT_DIR + outName, out);
console.log(`\nwrote ${outName}`);
