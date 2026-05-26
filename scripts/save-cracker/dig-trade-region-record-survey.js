// dig-trade-region-record-survey.js
// Survey region records for a per-region resource field. Strategy:
//  - region records (paired self-ptrs, regionId@+12) come in two flavours:
//    a small ~252b "neighbour list" record and larger records.
//  - Walk each record to its natural end (next self-ptr record start) and
//    dump a structural view: u32 stream + look for a contiguous run that
//    could be a resource bitmask (41 resource types -> 6 bytes) or a list
//    of resource enum ids.
"use strict";
const fs = require("fs");
const X = require("../../src/saveCrackerExtras.js");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);

let regs = X.findRegionRecords(buf).filter(r => r.regionId > 0 && r.regionId < 2000);
regs.sort((a, b) => a.offset - b.offset);

// Determine each record's extent = up to next record offset.
for (let i = 0; i < regs.length; i++) {
  regs[i].size = (i + 1 < regs.length ? regs[i + 1].offset : buf.length) - regs[i].offset;
}

// Size histogram
const sizeHist = {};
for (const r of regs) {
  const bucket = Math.min(r.size, 3000);
  const key = Math.floor(bucket / 100) * 100;
  sizeHist[key] = (sizeHist[key] || 0) + 1;
}
console.log("region record count:", regs.length);
console.log("size histogram (100-byte buckets):");
for (const k of Object.keys(sizeHist).sort((a, b) => a - b)) console.log("  ", k, "->", sizeHist[k]);

// Dump a few records of differing sizes in u32 view
function dumpU32(r, max = 64) {
  const n = Math.min(Math.floor(r.size / 4), max);
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(buf.readUInt32LE(r.offset + i * 4));
  return vals;
}

console.log("\n=== sample small record ===");
const small = regs.find(r => r.size < 300);
console.log("offset", small.offset.toString(16), "regionId", small.regionId, "size", small.size);
console.log(dumpU32(small).map((v, i) => `+${i * 4}=${v}`).join(" "));

console.log("\n=== sample mid record ===");
const mid = regs.find(r => r.size >= 600 && r.size < 800);
if (mid) {
  console.log("offset", mid.offset.toString(16), "regionId", mid.regionId, "size", mid.size);
  console.log(dumpU32(mid, 120).map((v, i) => `+${i * 4}=${v}`).join(" "));
}

console.log("\n=== sample large record ===");
const large = regs.filter(r => r.size > 1000).sort((a, b) => b.size - a.size)[0];
if (large) {
  console.log("offset", large.offset.toString(16), "regionId", large.regionId, "size", large.size);
  console.log(dumpU32(large, 160).map((v, i) => `+${i * 4}=${v}`).join(" "));
}
