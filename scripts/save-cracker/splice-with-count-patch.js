// splice-with-count-patch.js — D5: splice + patch the 6 u32==21761 fields.
//
// dig-record-selfptr ruled out per-record self-pointers.
// dig-record-pointer-table ruled out a pointer table.
// But u32==21761 (= 21762 - 1, "max_index" pattern) appears 6 times in
// sec[1] in clustered structured records:
//   01 00 00 01 00 00 00 00 <8B var> 00 03 00 00 | 21761 | 00 64 00 00 ...
//
// Hypothesis: these are "max-element" cached values that need to be
// decremented to 21760 after splicing record #50.
//
// D5: splice record #50 + decrement all 6 u32==21761 hits to 21760.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D5_splice_countpatch.sav";
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
const SPLICE_FROM = r50.lenPrefixOff;
const SPLICE_TO   = r50.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;

console.log(`splice: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);

// Find all u32==21761 hits within sec[1] (0x1026c67..0x204d8d2). Trailer
// hit at 0x24001de is outside sec[1] and looks unrelated — skipping.
const SEC1_START = 0x1026c67;
const SEC1_END   = 0x204d8d2;
const hits = [];
for (let p = SEC1_START; p < SEC1_END - 3; p++) {
  if (buf.readUInt32LE(p) === 21761) hits.push(p);
}
console.log(`u32==21761 in sec[1]: ${hits.length} hits`);
for (const h of hits) console.log(`  0x${h.toString(16)}`);

// Build patched output: first splice, then decrement each count hit.
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

for (const h of hits) {
  // Hits are before splice point so positions unchanged in `out`.
  if (h >= SPLICE_FROM) {
    console.log(`  WARN: hit at 0x${h.toString(16)} is past splice point — skipping`);
    continue;
  }
  const cur = out.readUInt32LE(h);
  out.writeUInt32LE(cur - 1, h);
  console.log(`  patched 0x${h.toString(16)}: ${cur} -> ${cur - 1}`);
}

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
