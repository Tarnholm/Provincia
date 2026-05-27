// splice-dead-batch.js — splice a contiguous batch of dead-pool records
// out of a save. Generates a smaller save file.
//
// Use AFTER Test D and Test E have a verdict:
//   - if D loads → splice IS the pruner path; this tool scales it.
//   - if D crashes → don't bother running this; rethink first.
//
// Usage:
//   node scripts/save-cracker/splice-dead-batch.js              # generates F + G presets
//   node scripts/save-cracker/splice-dead-batch.js <startIdx> <count> [outname]
//
// Presets:
//   Test F: records 100..199  (100 records from the middle of the pool)
//   Test G: records 21000..21099 (100 records near the END of the pool)
//
// Both let us answer: does splice scale linearly, and does position matter?

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT_DIR = "C:/Users/vtarn/Downloads/";
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
  // last record's end is unknown; estimate by median.
  if (records.length >= 2) {
    const median = records.slice(0, -1).map(r => r.byteLen).sort((a, b) => a - b)[Math.floor((records.length - 1) / 2)];
    const last = records[records.length - 1];
    last.endOff = last.lenPrefixOff + median;
    last.byteLen = median;
  }
  return records;
}

function spliceBatch(buf, recs, startIdx, count, outPath, label) {
  if (startIdx < 0 || startIdx + count > recs.length) {
    console.log(`SKIP ${label}: out of range (have ${recs.length} records, asked ${startIdx}..${startIdx + count - 1})`);
    return;
  }
  const from = recs[startIdx].lenPrefixOff;
  const to   = recs[startIdx + count - 1].endOff;
  const bytesRemoved = to - from;
  const out = Buffer.concat([buf.slice(0, from), buf.slice(to)]);
  fs.writeFileSync(outPath, out);
  console.log(`${label}: records ${startIdx}..${startIdx + count - 1}  spliced from 0x${from.toString(16)}..0x${to.toString(16)}  (-${bytesRemoved} B)  -> ${path.basename(outPath)}`);
  console.log(`         file size: ${buf.length} -> ${out.length}`);
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
console.log(`source: ${path.basename(SRC)}  records=${recs.length}`);
console.log();

const argv = process.argv.slice(2);
if (argv.length >= 2) {
  // CLI mode
  const startIdx = parseInt(argv[0], 10);
  const count = parseInt(argv[1], 10);
  const out = OUT_DIR + (argv[2] || `save_TEST_splice_${startIdx}_${count}.sav`);
  spliceBatch(buf, recs, startIdx, count, out, "CLI");
} else {
  // Preset mode: F and G
  spliceBatch(buf, recs, 100, 100, OUT_DIR + "save_TEST_F_splice100.sav", "TEST F (records 100..199, middle of pool)");
  spliceBatch(buf, recs, 21000, 100, OUT_DIR + "save_TEST_G_splice100late.sav", "TEST G (records 21000..21099, late in pool)");

  // Also: small batches (10) at the same two positions, in case 100 is too aggressive.
  spliceBatch(buf, recs, 100, 10, OUT_DIR + "save_TEST_F10_splice10.sav", "TEST F-10 (records 100..109, smaller batch middle)");
  spliceBatch(buf, recs, 21000, 10, OUT_DIR + "save_TEST_G10_splice10late.sav", "TEST G-10 (records 21000..21009, smaller batch late)");
}

console.log();
console.log("Load order suggestion (run only if Test D loaded successfully):");
console.log("  1. F-10 (10 records from middle) — quickest validation of batch splice");
console.log("  2. G-10 (10 records late) — does position matter?");
console.log("  3. F   (100 records from middle) — scale test");
console.log("  4. G   (100 records late) — scale + position");
