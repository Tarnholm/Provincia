// splice-with-65k-patch.js — D6: splice record #50 + decrement the u32
// at 0x106c3ac (value 65312 in T960 Start → 65322 in T960 End, delta +10
// matching the +10 dead-record delta).
//
// 65,312 is close to the 65,536 pointer-registry cap and lives in sec[1].
// One of the more suspicious +10 deltas — could be the engine's registry-
// count cache.

"use strict";
const fs = require("fs");
const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D6_splice_65kpatch.sav";
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
    records.push({ lenPrefixOff });
    from = dataOff + pathLen;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
const r50 = recs[50];

const out = Buffer.from(Buffer.concat([buf.slice(0, r50.lenPrefixOff), buf.slice(r50.endOff)]));
const PATCH_OFF = 0x106c3ac;
const before = out.readUInt32LE(PATCH_OFF);
out.writeUInt32LE(before - 1, PATCH_OFF);
console.log(`patched 0x${PATCH_OFF.toString(16)}: ${before} -> ${before - 1}`);

fs.writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
