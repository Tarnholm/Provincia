// dig-alliance-deep6.js
// The big clusters 0x52ed..0x2d118 (200KB) likely contain the per-faction
// records. Per session 31 their schema includes 23 major-faction records
// (in vanilla rome10). For RIS mod with 239 factions, there are presumably
// many more records.
//
// The alliance state is likely stored as a per-faction-record list of allied
// faction IDs. Look for "added/removed entries" in these records.
//
// Strategy: locate the faction-records region in save_2.1 and save_3.1 by
// searching for a record-start signature. Per session 31, signature is
// "+8=100, +12=1, +40=self". Let's find those.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

// Search for "+8=100 (0x64), +12=1, +24 == +40" pattern across pre-matrix.
function findFactionRecords(buf, start, end) {
  const out = [];
  for (let i = start; i + 48 < end; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    const v24 = buf.readUInt32LE(i + 24);
    const v40 = buf.readUInt32LE(i + 40);
    if (v24 === v40 && v24 !== 0) {
      out.push({ off: i, self: v24, v44: buf.readUInt32LE(i + 44) });
    }
  }
  return out;
}

const facA = findFactionRecords(A, 0, 0xf8fd2);
const facB = findFactionRecords(B, 0, 0xf8fd2);
console.log(`Faction records found in A (save_2.1): ${facA.length}`);
console.log(`Faction records found in B (save_3.1): ${facB.length}`);

console.log("\nA records:");
for (const f of facA.slice(0, 30)) {
  console.log(`  0x${f.off.toString(16)} self=${f.self} v44=${f.v44}`);
}
console.log("\nB records:");
for (const f of facB.slice(0, 30)) {
  console.log(`  0x${f.off.toString(16)} self=${f.self} v44=${f.v44}`);
}
