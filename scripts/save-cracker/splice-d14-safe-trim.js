// splice-d14-safe-trim.js — splice a DEAD CHARACTER WITH NO CROSS-REFERENCES.
//
// 🎯 KEY DISCOVERY: each character record has a UUID at +(pathLen+13).
// On average, each UUID is referenced ~2.8 times across the file (= the
// record itself + ~1.8 external cross-references, likely family-tree
// pointers). Splicing a character with external refs leaves dangling
// pointers that the engine probably fails on.
//
// 307 dead records have refs=1 (truly orphaned). D14 splices one of these
// using the same D13 self-pointer-patching mechanism.
//
// Recommended victim: rec @0x18ad23d, UUID 0x918fb35e
//   - Verified: UUID appears EXACTLY ONCE in entire file
//   - Size: 920 bytes (= meaningful splice)
//   - pathLen: 49
//
// If THIS loads, the failure of D7..D13 was indeed dangling UUID refs,
// and we have a working pruner (gated on finding safe-to-trim records).
//
// Run with:  node scripts/save-cracker/splice-d14-safe-trim.js

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_TEST_D14_safe_trim.sav";

const SPLICE_FROM = 0x18ad23d;
const SPLICE_TO   = 0x18ad5d5;

const buf = fs.readFileSync(SRC);
const SPLICE_BYTES = SPLICE_TO - SPLICE_FROM;
console.log(`Splicing safe-to-trim victim:`);
console.log(`  position: 0x${SPLICE_FROM.toString(16)}..0x${SPLICE_TO.toString(16)}`);
console.log(`  size: ${SPLICE_BYTES} bytes`);
console.log(`  UUID: 0x918fb35e (verified: 1 occurrence in file = self only)`);
console.log();

// Find all self-pointers in original
console.log(`Scanning self-pointers...`);
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
console.log(`  Patched ${patched} self-pointers`);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}`);
console.log(`file size: ${buf.length} -> ${out.length} (-${SPLICE_BYTES} bytes)`);
console.log();
console.log(`This save is the strongest "should work" hypothesis combining:`);
console.log(`  - All self-pointer patches (D13 mechanism)`);
console.log(`  - Safe-to-trim victim (no dangling UUID refs)`);
console.log(`If D14 loads, the pruner works and just needs to filter for safe records.`);
