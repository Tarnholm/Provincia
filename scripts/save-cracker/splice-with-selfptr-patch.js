// splice-with-selfptr-patch.js — D7: THE pruner candidate.
//
// 🎯 BREAKTHROUGH: every dead record has a SELF-POINTER at relative offset
// (pathLen + 9). The u32 value equals (record_start + pathLen + 9). 100%
// of 21,762 records satisfy this invariant.
//
// When we splice out a record, every downstream record is now at a NEW
// file position (offset -462 from before), but their stored self-pointer
// still points to their OLD position. The engine validates `self_ptr ==
// current_position`, sees mismatch, tries to seek to the stale pointer
// (which is past the actual file), trips `next < buffer_end Failed`.
//
// D7 fixes this: splice + decrement every downstream record's self-pointer
// u32 by SPLICE_BYTES (462).

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D7_splice_selfptr.sav";
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
    records.push({ lenPrefixOff, pathLen, selfPtrOff: lenPrefixOff + pathLen + 9 });
    from = dataOff + pathLen;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
console.log(`records: ${recs.length}`);

const TARGET = 50;
const victim = recs[TARGET];
const SPLICE_FROM = victim.lenPrefixOff;
const SPLICE_TO   = victim.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;
console.log(`splice victim #${TARGET}: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);

// Verify the victim itself has the self-pointer invariant.
const expectedVPtr = victim.selfPtrOff;
const actualVPtr = buf.readUInt32LE(victim.selfPtrOff);
console.log(`victim self-ptr check: u32@0x${victim.selfPtrOff.toString(16)} = 0x${actualVPtr.toString(16)} expected 0x${expectedVPtr.toString(16)}  ${actualVPtr === expectedVPtr ? "✓" : "✗"}`);

// Splice it.
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

// Patch every record AFTER the victim. Each record's self-pointer at
// (lenPrefixOff + pathLen + 9) in the ORIGINAL file is now at
// (lenPrefixOff + pathLen + 9 - SPLICE_BYTES) in the spliced file, and
// its value should also be decremented by SPLICE_BYTES.
let patched = 0, skippedAlreadyOK = 0, anomalies = 0;
for (let i = TARGET + 1; i < recs.length; i++) {
  const r = recs[i];
  const newPos = r.selfPtrOff - SPLICE_BYTES; // position in spliced buf
  if (newPos + 4 > out.length) { anomalies++; continue; }
  const cur = out.readUInt32LE(newPos);
  if (cur === r.selfPtrOff) {
    // Stale value — fix it.
    out.writeUInt32LE(r.selfPtrOff - SPLICE_BYTES, newPos);
    patched++;
  } else if (cur === r.selfPtrOff - SPLICE_BYTES) {
    skippedAlreadyOK++;
  } else {
    anomalies++;
    if (anomalies <= 3) console.log(`  anomaly @ rec #${i}: u32@0x${newPos.toString(16)} = 0x${cur.toString(16)}, expected 0x${r.selfPtrOff.toString(16)}`);
  }
}
console.log(`\npatched ${patched} self-pointers (-${SPLICE_BYTES} each)`);
console.log(`already-correct: ${skippedAlreadyOK}`);
console.log(`anomalies: ${anomalies}`);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
