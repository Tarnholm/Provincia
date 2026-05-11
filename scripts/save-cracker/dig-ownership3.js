// dig-ownership3.js — Dump bytes around isolated diffs in Brundisium area.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

function hex(buf, o, n) {
  return Array.from(buf.subarray(o, o + n)).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

// Show side by side
function side(o, len = 48) {
  const sA = hex(bA, o, len);
  const sB = hex(bB, o, len);
  console.log(`  0x${o.toString(16)} A: ${sA}`);
  console.log(`  0x${o.toString(16)} B: ${sB}`);
  // mark diffs
  let diffs = "             ";
  for (let i = 0; i < len; i++) {
    if (bA[o + i] !== bB[o + i]) diffs += "** ";
    else diffs += "   ";
  }
  console.log(`              ${diffs}`);
}

console.log("=== Brundisium area ===");
console.log("Brundisium starts at 0x1263b02 (name UTF-16LE), record start probably ~0x1263ae0");
console.log("Record header (back 32 bytes):");
side(0x1263ae0, 64);
console.log("\nName + payload start:");
side(0x1263b00, 64);
console.log("\nMiddle payload (first diffs at 0x1263b9a..1263b9d, 1263be7..bea):");
side(0x1263b80, 64);
console.log("\nLater payload (1263c1c, 1263d1f..d22):");
side(0x1263c00, 64);
side(0x1263d00, 64);
console.log("\nDiff at 0x1263d54 (ff→01) and 0x1263f84 (00→01):");
side(0x1263d40, 32);
side(0x1263f78, 32);
console.log("\nBefore Uria (0x1264864) area:");
side(0x1264840, 64);
console.log("\nUria record:");
side(0x1264860, 80);

// Look at all diffs in this whole range
console.log("\n\n=== ALL DIFFS in 0x1263b00..0x1264a00 ===");
for (let i = 0x1263b00; i < 0x1264a00; i++) {
  if (bA[i] !== bB[i]) {
    const a = bA[i], b = bB[i];
    const aHex = a.toString(16).padStart(2, '0'), bHex = b.toString(16).padStart(2, '0');
    const aDec = (a <= 100) ? `=${a}` : '';
    const bDec = (b <= 100) ? `=${b}` : '';
    console.log(`  0x${i.toString(16)}  A=${aHex}${aDec}  B=${bHex}${bDec}`);
  }
}
