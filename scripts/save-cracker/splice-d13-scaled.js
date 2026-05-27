// splice-d13-scaled.js — scaled D13.
//
// If D13 works for splicing record #50 (1 record, -462 B), this scales the
// SAME mechanism to splice N consecutive records starting from some index.
//
// The math:
//   - Determine cumulative bytes removed by all spliced records
//   - For each remaining record, decrement its self-pointer by the
//     cumulative shift it has experienced
//   - For each non-character self-pointer AFTER the splice region, same
//
// Usage:  node splice-d13-scaled.js [startIdx] [count]
// Defaults: startIdx=100, count=10  (Test "F-10-D13" equivalent)
//
// CAUTION: only run if D13 (1-record splice) is proven to work in-game.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const DEAD = Buffer.from("/portraits/dead/", "ascii");

function locateDeadRecords(buf) {
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

const argv = process.argv.slice(2);
const START_IDX = parseInt(argv[0] ?? "100", 10);
const COUNT = parseInt(argv[1] ?? "10", 10);

const buf = fs.readFileSync(SRC);
const dead = locateDeadRecords(buf);
if (START_IDX + COUNT > dead.length) {
  console.log(`FATAL: have ${dead.length} dead records, can't splice ${COUNT} from index ${START_IDX}`);
  process.exit(1);
}

// Splice region: from first victim's lenPrefixOff to last victim's endOff.
const SPLICE_FROM = dead[START_IDX].lenPrefixOff;
const SPLICE_TO   = dead[START_IDX + COUNT - 1].endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;
console.log(`Splicing dead records ${START_IDX}..${START_IDX + COUNT - 1}`);
console.log(`Splice region: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} = ${SPLICE_BYTES} bytes`);

// Find all self-pointers in original
console.log(`Scanning for self-pointers...`);
const allSP = [];
for (let p = 0; p + 4 <= buf.length; p++) {
  if (buf.readUInt32LE(p) === p) allSP.push(p);
}
console.log(`  Found ${allSP.length} self-pointers total`);

// Build the spliced buffer
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

// Patch every self-pointer >= SPLICE_TO by -SPLICE_BYTES
let patched = 0;
for (const p of allSP) {
  if (p < SPLICE_TO) continue;
  const newPos = p - SPLICE_BYTES;
  if (newPos + 4 > out.length) continue;
  if (out.readUInt32LE(newPos) !== p) continue;
  out.writeUInt32LE(p - SPLICE_BYTES, newPos);
  patched++;
}
console.log(`  Patched ${patched} self-pointers (shift by -${SPLICE_BYTES})`);

const outName = `save_TEST_D13s_splice_${START_IDX}_${COUNT}.sav`;
fs.writeFileSync(OUT_DIR + outName, out);
console.log(`\nwrote ${outName}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${SPLICE_BYTES} bytes)`);
console.log();
console.log(`To test: load \"${outName}\" in RTW.`);
