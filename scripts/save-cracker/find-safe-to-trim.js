// find-safe-to-trim.js — find dead character records with no external UUID references.
//
// CRITICAL DISCOVERY: each character record has a UUID at +(pathLen+13).
// On average each UUID is referenced ~2.8 times in the file (= the record
// itself + ~1.8 cross-references from other records, likely family-tree
// pointers).
//
// If we splice a character whose UUID is referenced ELSEWHERE, those
// cross-references become dangling. Engine likely fails on lookup.
//
// A "safe to trim" character has refs = 1 (only its own UUID slot, no
// external references). Splicing those should be the truly safe option.
//
// Trim_analysis from rtw-sav-parser repo session 1 used the same logic
// and found Wahab AliYahbir as the one safe-to-trim char in Athens
// campaign. This tool finds the equivalent for Dummies/T960 Start.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");

const buf = fs.readFileSync(SRC);
const recs = [];
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
  const uuid = buf.readUInt32LE(lp + pl + 13);
  recs.push({ lp, pl, uuid });
  from = dataOff + pl;
}
for (let k = 0; k < recs.length - 1; k++) recs[k].endOff = recs[k + 1].lp;

console.log(`Total dead character records: ${recs.length}`);

// Build histogram of u32 -> count for the entire file
// (fast lookup of how many times each UUID appears)
console.log("Building u32 histogram across the whole file (~10s)...");
const u32Counts = new Map();
for (let p = 0; p + 4 <= buf.length; p++) {
  const v = buf.readUInt32LE(p);
  // Only track values that COULD be a UUID (skip 0, FFFFFFFF, very small)
  if (v < 0x10000 || v === 0xffffffff) continue;
  u32Counts.set(v, (u32Counts.get(v) || 0) + 1);
}
console.log(`Distinct u32 values >= 0x10000 in file: ${u32Counts.size}`);

// For each dead record, look up its UUID's total occurrence count
const refsByRec = recs.map(r => ({
  ...r,
  refs: u32Counts.get(r.uuid) || 0,
}));

// Distribution
const distribution = new Map();
for (const r of refsByRec) distribution.set(r.refs, (distribution.get(r.refs) || 0) + 1);
console.log();
console.log("UUID reference count distribution (per dead record):");
for (const [refs, count] of [...distribution.entries()].sort((a, b) => a[0] - b[0]).slice(0, 15)) {
  console.log(`  refs=${refs}: ${count} records`);
}

// Show records with refs=1 (= truly orphaned, safe to splice)
const safe = refsByRec.filter(r => r.refs === 1);
console.log();
console.log(`SAFE-TO-TRIM candidates (refs=1, only self-reference): ${safe.length}`);
if (safe.length > 0) {
  console.log('First 10:');
  for (const r of safe.slice(0, 10)) {
    console.log(`  rec @0x${r.lp.toString(16)}  uuid=0x${r.uuid.toString(16)}  pathLen=${r.pl}`);
  }
}

// Also: how many dead records have <= 2 refs (= ONE external reference, harder but maybe doable)?
const twoRef = refsByRec.filter(r => r.refs === 2);
console.log();
console.log(`Records with refs=2 (one external reference, riskier): ${twoRef.length}`);
const threeRef = refsByRec.filter(r => r.refs === 3);
console.log(`Records with refs=3 (two external references): ${threeRef.length}`);

// Pick the SINGLE best candidate for splicing
if (safe.length > 0) {
  const best = safe[0];
  console.log();
  console.log('=== RECOMMENDED splice victim ===');
  console.log(`  Position: 0x${best.lp.toString(16)}`);
  console.log(`  UUID: 0x${best.uuid.toString(16)}`);
  console.log(`  Size: ${(best.endOff || best.lp + 462) - best.lp} bytes`);
  console.log();
  console.log('To splice this record with D13 mechanism, modify D13 script to use this position.');
}
