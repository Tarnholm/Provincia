// test-dead-pool-splice.js — Test D / E for the dead-pool pruner.
//
// Premise from dig-v4: records are length-prefixed and packed tight, no
// inter-record header. We could not find a global count u32 == 21762 in
// header areas. Two hypotheses:
//   (1) the engine walks until a terminator (then splice-out shrinks the
//       file and works directly),
//   (2) the engine reads a count from a pointer-registry rebuild (then
//       file size doesn't matter, only record continuity does).
//
// Test D — SPLICE: remove record #50 entirely. File shrinks by ~462 B.
// Test E — CLONE: overwrite record #50 with a byte-equal copy of record #49.
//          File size unchanged. Tests whether the engine cares about record
//          UNIQUENESS (duplicate UUID) vs validity.
//
// Run:  node scripts/save-cracker/test-dead-pool-splice.js

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/Downloads/";
const DEAD = Buffer.from("/portraits/dead/", "ascii");

// Find each dead-record's TRUE start, which is the position of the u16
// length prefix that precedes the 'data/' bytes.
function locateRecords(buf) {
  const records = []; // { lenPrefixOff, pathStart, pathLen, nextLenPrefixOff (or null) }
  let from = 0;
  while (true) {
    const i = buf.indexOf(DEAD, from);
    if (i < 0) break;
    // Walk back to 'data/'.
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
    // Validate: pathLen bytes from dataOff should match a valid path ending in .tga\0 or .tga.
    records.push({ lenPrefixOff, pathStart: dataOff, pathLen });
    from = dataOff + pathLen;
  }
  // Compute each record's end as the NEXT record's lenPrefixOff (which is
  // where its body bytes implicitly stop). Final record has no successor —
  // skip for splice purposes.
  for (let k = 0; k < records.length - 1; k++) {
    records[k].endOff = records[k + 1].lenPrefixOff;
    records[k].byteLen = records[k].endOff - records[k].lenPrefixOff;
  }
  return records;
}

const buf = fs.readFileSync(SRC);
const recs = locateRecords(buf);
console.log(`located ${recs.length} dead-pool records`);
console.log(`record sizes: first 6 =`, recs.slice(0, 6).map(r => r.byteLen));

const TARGET_IDX = 50;
const r = recs[TARGET_IDX];
console.log();
console.log(`target: record #${TARGET_IDX} at 0x${r.lenPrefixOff.toString(16)}  size=${r.byteLen} bytes`);

// === TEST D: splice out (shrink file) ===
{
  const out = Buffer.concat([
    buf.slice(0, r.lenPrefixOff),
    buf.slice(r.endOff),
  ]);
  const outPath = OUT + "save_TEST_D_splice.sav";
  fs.writeFileSync(outPath, out);
  console.log(`TEST D (splice record #${TARGET_IDX}) -> ${outPath}`);
  console.log(`  file size: ${buf.length} -> ${out.length}  (delta: -${buf.length - out.length})`);
}

// === TEST E: clone (replace with byte-equal copy of record #49) ===
// Only viable if record #49 is the same size as record #50. Pick the
// nearest same-size neighbour from {49, 48, 51, 52, ...} instead.
{
  let donorIdx = -1;
  for (const candIdx of [TARGET_IDX - 1, TARGET_IDX + 1, TARGET_IDX - 2, TARGET_IDX + 2, TARGET_IDX - 3, TARGET_IDX + 3]) {
    if (candIdx >= 0 && candIdx < recs.length - 1 && recs[candIdx].byteLen === r.byteLen) {
      donorIdx = candIdx; break;
    }
  }
  if (donorIdx < 0) {
    console.log(`TEST E SKIPPED: no same-size neighbour to record #${TARGET_IDX} (size ${r.byteLen})`);
  } else {
    const donor = recs[donorIdx];
    const donorBytes = buf.slice(donor.lenPrefixOff, donor.endOff);
    const out = Buffer.from(buf);
    donorBytes.copy(out, r.lenPrefixOff);
    const outPath = OUT + "save_TEST_E_clone.sav";
    fs.writeFileSync(outPath, out);
    console.log(`TEST E (clone record #${donorIdx} over #${TARGET_IDX}) -> ${outPath}`);
    console.log(`  donor: #${donorIdx} at 0x${donor.lenPrefixOff.toString(16)}  size=${donor.byteLen}`);
    console.log(`  file size unchanged: ${out.length}`);
  }
}

console.log();
console.log("How to test:");
console.log("  1. Rename test save to: save_Autosave   Dummies   Turn 960 Start.sav");
console.log("  2. Drop into RTW saves dir.");
console.log("  3. Load in-game. Report:");
console.log("     a) does it load? b) does dynasty view show? c) does end-turn complete?");
console.log("  D loads = splice-and-shrink is the pruner path.");
console.log("  D crashes, E loads = engine needs file integrity; we must clone-then-rebuild-index.");
console.log("  Both crash = pointer-registry or absolute-offset dependency we haven't found yet.");
