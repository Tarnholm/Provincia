// splice-with-all-internal-ptrs.js — D8: extension of D7 that patches
// ALL internal self-pointers within each downstream record, not just the
// primary +9.
//
// D7 patches the primary self-pointer at +(pathLen+9), which is in 100%
// of records. But some records (~1-2%) also have ancillary internal
// pointers at +(pathLen+479), +(pathLen+483), etc. These might also
// be self-referential (pointing within the same record).
//
// D8 scans every u32 in every downstream record. If the u32's value is
// within the SAME record's byte range, treat it as an intra-record
// self-pointer and decrement by SPLICE_BYTES.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D8_splice_allptr.sav";
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
    const lp = dataOff - 2;
    const pl = buf.readUInt16LE(lp);
    if (pl < 16 || pl > 200) { from = i + DEAD.length; continue; }
    records.push({ lenPrefixOff: lp, pathLen: pl });
    from = dataOff + pl;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
const victim = recs[50];
const SPLICE_FROM = victim.lenPrefixOff;
const SPLICE_TO   = victim.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;

console.log(`splice victim #50: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);

const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

// For every downstream record, scan its bytes for u32 values that fall
// within the same record's range (intra-record self-pointers). Decrement
// each by SPLICE_BYTES.
let totalPatched = 0;
let recordsWithMultiPtr = 0;
let recordsWithPrimaryOnly = 0;
let recordsWithNoPtr = 0;

for (let i = 51; i < recs.length; i++) {
  const r = recs[i];
  const recStartOrig = r.lenPrefixOff;            // original position
  const recEndOrig   = r.endOff || (recStartOrig + 462);  // estimate for last
  const recStartNew  = recStartOrig - SPLICE_BYTES; // position in `out`
  const recLen = recEndOrig - recStartOrig;
  let patched = 0;
  for (let off = 0; off + 4 <= recLen; off++) {
    const p = recStartNew + off;
    if (p + 4 > out.length) break;
    const v = out.readUInt32LE(p);
    // Is v a stale intra-record pointer? Original pointer values point
    // within [recStartOrig, recEndOrig). If so, decrement by SPLICE_BYTES.
    if (v >= recStartOrig && v < recEndOrig) {
      out.writeUInt32LE(v - SPLICE_BYTES, p);
      patched++;
    }
  }
  if (patched === 0) recordsWithNoPtr++;
  else if (patched === 1) recordsWithPrimaryOnly++;
  else recordsWithMultiPtr++;
  totalPatched += patched;
}

console.log(`\ntotal pointer patches applied: ${totalPatched}`);
console.log(`records with 1 pointer (primary only): ${recordsWithPrimaryOnly}`);
console.log(`records with 2+ pointers (multi-ptr): ${recordsWithMultiPtr}`);
console.log(`records with 0 pointers (unusual!):  ${recordsWithNoPtr}`);
console.log(`(downstream records total: ${recs.length - 51})`);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
