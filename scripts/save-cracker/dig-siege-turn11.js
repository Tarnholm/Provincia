// dig-siege-turn11.js
// Find what each occurrence of u16=2261 means in save_6 (no siege).
// 22 occurrences. Show 16 bytes of context.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_6.1.sav"));

function findU16(buf, val) {
  const out = [];
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf.readUInt16LE(i) === val) out.push(i);
  }
  return out;
}

const occs = findU16(buf, 2261);
console.log(`Total occurrences of u16=2261 in save_6: ${occs.length}`);
for (const off of occs) {
  const ctx = buf.slice(Math.max(0, off - 8), off + 16).toString("hex");
  console.log(`  0x${off.toString(16)}: ${ctx}`);
}

// Specifically: is 2261 the value at some specific BYTE offset (not just any u16) — like
// "u16 at +66 of every 73-byte block"? Probably not, since save_6 has no siege.
// More likely: it's just numerically common.

// Alternative: could be the engine's STARTING SIEGE TURN COUNT = 0 for siege progress (0 of 8 turns)?
// 2261 doesn't fit "0 of N".

// Could be a tile-coordinate. Compute coords if u16=2261 was a tile X or Y.

// Check if 2261 appears as a value for "settlements-not-yet-captured" or "siege turns elapsed":
// In RTW, sieges typically last 4-8 turns. A counter near 0/1/2/3 wouldn't be 2261.
// 2261 might be a HASH-DERIVED value or a constant.

// Try other interpretations: u8 at +66 = 0xd5 = 213; u8 at +67 = 0x08 = 8.
// "0x08" at +67 might be "siege duration max = 8 turns"! And 0xd5 at +66 might be 213 (something).
//
// OR: u16 LE = 0x08d5 = 2261. As big-endian = 0xd508 = 54536. Neither obvious.

// Let me check if the value 0x08 = 8 (a likely siege-turn-max-value) appears at +67 consistently.
console.log("\nByte at +66 and +67 in save_7 siege block:");
const A7 = fs.readFileSync(path.join(SAVE_DIR, "save_7.1.sav"));
const A8 = fs.readFileSync(path.join(SAVE_DIR, "save_8.1.sav"));
console.log(`  save_7 block@0x152f529+66 = 0x${A7[0x152f529 + 66].toString(16)} (= ${A7[0x152f529 + 66]})`);
console.log(`  save_7 block@0x152f529+67 = 0x${A7[0x152f529 + 67].toString(16)} (= ${A7[0x152f529 + 67]})`);
console.log(`  save_8 block@0x152f529+66 = 0x${A8[0x152f529 + 66].toString(16)} (= ${A8[0x152f529 + 66]})`);
console.log(`  save_8 block@0x152f529+67 = 0x${A8[0x152f529 + 67].toString(16)} (= ${A8[0x152f529 + 67]})`);
