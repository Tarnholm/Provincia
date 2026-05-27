// splice-d13-all-self-pointers.js — D13: maximally comprehensive.
//
// D12 still misses ~5,560 non-character self-pointers in sec[7]. The
// trailer brute-force covers sec[7]_end..EOF but sec[7] (32MB) itself has
// 28,760 self-pointers, of which only ~19,563 are character records.
//
// D13 strategy: brute-force scan the ENTIRE FILE for self-pointers
// (u32@p == p). For each one whose position is AFTER the splice, patch
// by decrementing the value by SPLICE_BYTES.
//
// Total estimated patches: ~70,000+ (vs D11's 56,931 and D12's ~60,000)
//
// Risk: even higher false-positive rate from brute-force matching of
// random bytes that happen to equal their position. But every real
// self-pointer is included.
//
// Run with:  node scripts/save-cracker/splice-d13-all-self-pointers.js

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D13_splice_all_self_ptrs.sav";
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
    records.push({ lenPrefixOff: lp });
    from = dataOff + pl;
  }
  for (let k = 0; k < records.length - 1; k++) records[k].endOff = records[k + 1].lenPrefixOff;
  return records;
}

const buf = fs.readFileSync(SRC);
const dead = locateDeadRecords(buf);
const victim = dead[50];
const SPLICE_FROM = victim.lenPrefixOff;
const SPLICE_TO   = victim.endOff;
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;

console.log(`splice: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)} (-${SPLICE_BYTES} B)`);
console.log();

// Step 1: brute-force find ALL self-pointers in original buf.
// A self-pointer is a u32 at file position p whose value equals p.
console.log("scanning entire file for self-pointers (this takes ~30s)...");
const allSelfPtrs = [];
const fileLen = buf.length;
for (let p = 0; p + 4 <= fileLen; p++) {
  if (buf.readUInt32LE(p) === p) allSelfPtrs.push(p);
}
console.log(`Total self-pointers in file: ${allSelfPtrs.length}`);

// Step 2: build the spliced buffer.
const out = Buffer.from(Buffer.concat([buf.slice(0, SPLICE_FROM), buf.slice(SPLICE_TO)]));

// Step 3: for each self-pointer > SPLICE_FROM, patch by -SPLICE_BYTES.
// Sanity check that the value at the new position still equals the
// ORIGINAL position (= stale pointer) before patching.
let patched = 0, skipped = 0;
for (const p of allSelfPtrs) {
  if (p < SPLICE_FROM) continue; // before splice = no shift needed
  if (p >= SPLICE_FROM && p < SPLICE_TO) continue; // this self-pointer was in the spliced bytes, no longer exists
  const newPos = p - SPLICE_BYTES;
  if (newPos + 4 > out.length) { skipped++; continue; }
  const cur = out.readUInt32LE(newPos);
  if (cur !== p) { skipped++; continue; } // mismatch = something off
  out.writeUInt32LE(p - SPLICE_BYTES, newPos);
  patched++;
}
console.log(`patched: ${patched}`);
console.log(`skipped: ${skipped} (oob or value mismatch)`);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${buf.length - out.length})`);
