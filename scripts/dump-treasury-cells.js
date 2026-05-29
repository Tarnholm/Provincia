"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const T7M = fs.readFileSync(path.join(SAVE_DIR, "save_Julii turn7.sav"));

for (const off of [23146189, 23147945]) {
  console.log(`\n=== ±64 bytes around offset ${off} (where 23856 lives) ===`);
  for (let d = -64; d <= 64; d += 4) {
    const o = off + d;
    if (o < 0 || o + 4 > T7M.length) continue;
    const u = T7M.readUInt32LE(o);
    const i = T7M.readInt32LE(o);
    const marker = (d === 0) ? "  ← HERE" : "";
    console.log(`  ${(d >= 0 ? "+" : "")}${d.toString().padStart(4)}: u32=${u.toString().padStart(10)}  i32=${i.toString().padStart(11)}${marker}`);
  }
}

// Also: how many 414 markers in the whole save? Each represents Julii's knowledge?
console.log("\n=== Every offset where u32=414 (Julii knowledge sig) ===");
{
  let count = 0;
  for (let o = 0; o + 4 <= T7M.length; o += 1) {
    if (T7M.readUInt32LE(o) !== 414) continue;
    // Filter to those with treasury-like u32 right after
    const next = T7M.readUInt32LE(o + 4);
    if (next < 0 || next > 1000000) continue; // plausible treasury
    console.log(`  off=${o}  +4(treasury?)=${next}  +8=${T7M.readUInt32LE(o+8)}  +12=${T7M.readUInt32LE(o+12)}`);
    count++;
    if (count > 30) { console.log("  ..."); break; }
  }
}
