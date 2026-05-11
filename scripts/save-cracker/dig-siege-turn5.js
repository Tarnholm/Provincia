// dig-siege-turn5.js
// Diff save_7 vs save_8 across the full siege-block region (0x152f520..0x152f600).
// Pinpoint every diff and decode candidates.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_7.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_8.1.sav"));

const blockStart = 0x152f529;
console.log("=== save_7 vs save_8 byte-by-byte at siege block region (block start = 0x152f529) ===");
for (let off = blockStart - 16; off < blockStart + 200; off++) {
  const a = A[off], b = B[off];
  if (a !== b) {
    console.log(`  abs 0x${off.toString(16)} (rel +${off - blockStart}): A=0x${a.toString(16).padStart(2,"0")} B=0x${b.toString(16).padStart(2,"0")}`);
  }
}

// Now also: between save_6 (no siege) and save_7 (Brundisium siege starts), the entire
// siege block was INSERTED. Diff those to see what bytes are inserted.

const C = fs.readFileSync(path.join(SAVE_DIR, "save_6.1.sav"));
console.log("\n=== save_6 vs save_7: was inserted? ===");
console.log(`save_6 size = ${C.length}, save_7 size = ${A.length}, diff = ${A.length - C.length}`);
console.log("\nBytes around 0x152f529 in save_6 (NO siege):");
for (let off = blockStart - 16; off < blockStart + 200; off += 8) {
  // save_6 is 73 bytes shorter, so the same content lives at offset off - 73 in save_6
  const c6 = C.slice(off - 73, off - 73 + 8).toString("hex");
  console.log(`  save_6 0x${(off-73).toString(16)}: ${c6}`);
}

// Also compare turn-7 → turn-8 (Brundisium siege ongoing in both). In save_7
// Brundisium was just sieged. In save_8 it's been 1+ turns.
// Wait — save_8 is "+ attack/betray Taras; siege of Tarentum" per brief. So save_8 has
// Tarentum siege block AND Brundisium siege should ALSO be ongoing. But we only find ONE
// block per save.

// Maybe siege blocks have a different signature when the siege has been going for multiple turns.
// Let me find any 73-byte similar structures with relaxed criteria.

function findRelaxedBlocks(buf) {
  const out = [];
  for (let off = 0x150000; off < buf.length - 73; off++) {
    if (buf[off] !== 0x01) continue;
    let nz = 0;
    for (let k = 1; k <= 12; k++) if (buf[off + k] !== 0) nz++;
    if (nz < 8) continue;
    // Allow some non-zero in middle
    let middleZeroes = 0;
    for (let k = 13; k <= 65; k++) if (buf[off + k] === 0) middleZeroes++;
    if (middleZeroes < 48) continue; // mostly zeros
    const u16 = buf.readUInt16LE(off + 66);
    if (u16 === 0) continue;
    out.push({ off, uuid: buf.slice(off + 1, off + 13).toString("hex"), u16, middleZeroes });
  }
  return out;
}

console.log("\n=== Relaxed siege-like blocks in save_8 ===");
const relaxed = findRelaxedBlocks(B).slice(0, 20);
for (const b of relaxed) {
  console.log(`  0x${b.off.toString(16)} u16=${b.u16} mZ=${b.middleZeroes} uuid=${b.uuid}`);
}
