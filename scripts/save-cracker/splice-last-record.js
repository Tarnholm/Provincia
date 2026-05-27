// splice-last-record.js — Test D-LR (last record).
//
// If the engine iterates dead records by walking until "no more valid u16
// path length", removing the LAST record just shortens iteration by one
// step (no overrun). If we still get "next < buffer_end", there IS a
// count somewhere and the engine validates it independently.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_DLR_splice_last.sav";
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
  // last: estimate using median (462 = most common dead-record body size)
  if (records.length >= 2) {
    const sizes = records.slice(0, -1).map(r => r.byteLen).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    const last = records[records.length - 1];
    last.endOff = last.lenPrefixOff + median;
    last.byteLen = median;
  }
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
const last = recs[recs.length - 1];
console.log(`last dead record (idx ${recs.length - 1}): 0x${last.lenPrefixOff.toString(16)} size~${last.byteLen}`);
console.log(`(size is estimated as median ${last.byteLen} since there's no successor)`);

// Splice it out.
const out = Buffer.concat([buf.slice(0, last.lenPrefixOff), buf.slice(last.endOff)]);
fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length}  (-${buf.length - out.length})`);
