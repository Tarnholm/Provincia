// dig-record-selfptr.js — does each dead record have an internal u32 that
// equals its own file position? If so, splicing invalidates them all
// downstream and we need to either: (a) patch them post-splice, or
// (b) realize the splice path is structurally infeasible.

"use strict";
const fs = require("fs");
const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");
const buf = fs.readFileSync(SRC);

function locateRecords() {
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
    records.push({ lenPrefixOff, dataOff, pathLen, pathEnd: dataOff + pathLen });
    from = dataOff + pathLen;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const recs = locateRecords();
console.log(`records: ${recs.length}`);

// For each record, look for u32 values within the record that equal any of:
//   the record's lenPrefixOff
//   the record's dataOff
//   the record's pathEnd (start of binary body)
//   the record's endOff (start of next record)
// Build histogram of WHICH relative offset (within record) the self-ptr lives at.

const targets = ["lenPrefixOff", "dataOff", "pathEnd"];
const offsetHisto = {}; // target -> Map(relOff -> count)
for (const t of targets) offsetHisto[t] = new Map();

const SAMPLE = Math.min(2000, recs.length);
for (let i = 0; i < SAMPLE; i++) {
  const r = recs[i];
  if (!r.endOff) continue;
  for (let p = r.lenPrefixOff; p + 4 <= r.endOff; p++) {
    const v = buf.readUInt32LE(p);
    for (const t of targets) {
      if (v === r[t]) {
        const rel = p - r.lenPrefixOff;
        offsetHisto[t].set(rel, (offsetHisto[t].get(rel) || 0) + 1);
      }
    }
  }
}

console.log(`\nself-pointer pattern (scanned first ${SAMPLE} records):`);
for (const t of targets) {
  console.log(`\nu32 == record.${t}:`);
  const sorted = [...offsetHisto[t].entries()].sort((a, b) => b[1] - a[1]);
  for (const [rel, count] of sorted.slice(0, 10)) {
    const pct = (100 * count / SAMPLE).toFixed(1);
    console.log(`  rel +${String(rel).padStart(3)}  in ${String(count).padStart(4)} records  (${pct}%)`);
  }
}

// Bonus: look at the FIRST 4 bytes immediately after the path (rel = pathLen + 2)
// — typical place for "char ID" or self-marker.
console.log(`\nfirst 16 bytes immediately after path (rel = pathLen + 2):`);
const postPathVals = new Map();
for (let i = 0; i < SAMPLE; i++) {
  const r = recs[i];
  if (!r.endOff) continue;
  const pp = r.pathEnd;
  if (pp + 4 > r.endOff) continue;
  const v = buf.readUInt32LE(pp);
  // Is this value related to the record's position?
  if (v === r.lenPrefixOff) postPathVals.set("== lenPrefixOff", (postPathVals.get("== lenPrefixOff") || 0) + 1);
  else if (v === r.dataOff)  postPathVals.set("== dataOff",      (postPathVals.get("== dataOff")      || 0) + 1);
  else if (v === r.pathEnd)  postPathVals.set("== pathEnd",       (postPathVals.get("== pathEnd")       || 0) + 1);
  else if (v < 100000)       postPathVals.set("small int (<100k)",(postPathVals.get("small int (<100k)")|| 0) + 1);
  else if (v < buf.length)   postPathVals.set("file-position-range",(postPathVals.get("file-position-range")|| 0) + 1);
  else                       postPathVals.set("other",            (postPathVals.get("other")            || 0) + 1);
}
for (const [k, v] of postPathVals) console.log(`  ${k}: ${v}`);
