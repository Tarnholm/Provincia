// dig-rebellion6.js — Chrysaoria's payload is deterministically 4301 bytes across two
// saves with count=75. Look for natural division and what 75 represents.
//
// 4301 / 75 = 57.34. Not clean. So records are variable-length.
//
// Try: chrysaoria payload starts with first 26-byte init block, then variable records.
// 4301 - 26 = 4275 / 75 = 57. Better. So the records might be ~57 bytes each.
//
// Better: find ALL the boundaries between sub-records by looking at where the data
// pattern resets. The pattern of "self-ptr + small struct" appears repeatedly.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const chrysaoriaStart = 0x18d3741;
const chrysaoriaEnd = 0x18d480e;
const count = 75;

// Dump ALL of chrysaoria payload as 16-byte rows
console.log("=== Full chrysaoria payload (4301 bytes) ===");
for (let off = chrysaoriaStart; off < chrysaoriaEnd; off += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    if (off + j >= chrysaoriaEnd) break;
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  // Compute relative offset
  const rel = off - chrysaoriaStart;
  console.log(`  +0x${rel.toString(16).padStart(4, "0")} @0x${off.toString(16)}: ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`);
}
