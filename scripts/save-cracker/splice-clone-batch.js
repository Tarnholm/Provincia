// splice-clone-batch.js — same-size clone variant of batch splice.
//
// E proved single-record clone (record #49 → #50) loads fine. This script
// scales: pick N victim records, for each find the nearest same-size donor,
// overwrite victim bytes with donor bytes. File size unchanged.
//
// Generates Test E-batch saves matching F/G targets:
//   E100mid  — overwrite records 100..199 with same-size donors
//   E100late — overwrite records 21000..21099 with same-size donors
//
// File size preserved → no section-header issues → if the engine accepts
// these, we've confirmed clone-at-scale.
//
// Caveat: this doesn't directly free pointer-registry slots if the engine
// allocates per-record (one slot per record regardless of content). It DOES
// test whether the engine de-dupes by UUID, which would be a happy accident.

"use strict";
const fs = require("fs");
const path = require("path");

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
      if (buf[p] === 0x64 && buf[p+1] === 0x61 && buf[p+2] === 0x74 && buf[p+3] === 0x61 && buf[p+4] === 0x2f) {
        dataOff = p; break;
      }
    }
    if (dataOff < 0) { from = i + DEAD.length; continue; }
    const lenPrefixOff = dataOff - 2;
    const pathLen = buf.readUInt16LE(lenPrefixOff);
    if (pathLen < 16 || pathLen > 200) { from = i + DEAD.length; continue; }
    records.push({ lenPrefixOff, pathStart: dataOff, pathLen });
    from = dataOff + pathLen;
  }
  for (let k = 0; k < records.length - 1; k++) {
    records[k].endOff = records[k + 1].lenPrefixOff;
    records[k].byteLen = records[k].endOff - records[k].lenPrefixOff;
  }
  if (records.length >= 2) {
    const median = records.slice(0, -1).map(r => r.byteLen).sort((a, b) => a - b)[Math.floor((records.length - 1) / 2)];
    const last = records[records.length - 1];
    last.endOff = last.lenPrefixOff + median;
    last.byteLen = median;
  }
  return records;
}

// Find nearest same-size donor that's NOT in the victim range.
function findDonor(recs, victimIdx, victimStart, victimEnd) {
  const targetSize = recs[victimIdx].byteLen;
  for (let delta = 1; delta < recs.length; delta++) {
    for (const candIdx of [victimIdx - delta, victimIdx + delta]) {
      if (candIdx < 0 || candIdx >= recs.length) continue;
      if (candIdx >= victimStart && candIdx < victimEnd) continue; // skip other victims
      if (recs[candIdx].byteLen === targetSize) return candIdx;
    }
  }
  return -1;
}

function cloneBatch(buf, recs, startIdx, count, outPath, label) {
  const out = Buffer.from(buf);
  let cloned = 0, skipped = 0;
  const sizeHisto = new Map();
  for (let v = startIdx; v < startIdx + count; v++) {
    const victim = recs[v];
    const donorIdx = findDonor(recs, v, startIdx, startIdx + count);
    if (donorIdx < 0) {
      skipped++;
      continue;
    }
    const donor = recs[donorIdx];
    buf.copy(out, victim.lenPrefixOff, donor.lenPrefixOff, donor.endOff);
    cloned++;
    sizeHisto.set(victim.byteLen, (sizeHisto.get(victim.byteLen) || 0) + 1);
  }
  fs.writeFileSync(outPath, out);
  console.log(`${label}: cloned ${cloned} / skipped ${skipped} of ${count} target records  -> ${path.basename(outPath)}`);
  if (skipped > 0) {
    console.log(`  (skipped = no same-size donor outside the victim range — rare for big buckets)`);
  }
  console.log(`  size buckets cloned: ${[...sizeHisto.entries()].sort((a,b)=>a[0]-b[0]).map(([s,n])=>`${s}=${n}`).slice(0,8).join(", ")}${sizeHisto.size > 8 ? ", ..." : ""}`);
  console.log(`  file size unchanged: ${out.length}`);
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
console.log(`source: ${path.basename(SRC)}  records=${recs.length}`);
console.log();

cloneBatch(buf, recs, 100,   100, OUT_DIR + "save_TEST_E100mid.sav",  "TEST E-100 mid  (records 100..199)");
cloneBatch(buf, recs, 21000, 100, OUT_DIR + "save_TEST_E100late.sav", "TEST E-100 late (records 21000..21099)");

console.log();
console.log("These should load fine if clone-at-scale works (E proved single clone OK).");
console.log("If they load AND end-turn, we have a same-size pruner — though it won't");
console.log("free pointer-registry slots unless the engine dedupes by content/UUID.");
