// Vanilla treasury hypothesis: faction records have a different signature
// than RIS imperial. Spain T1 treasury confirmed at 0x2c5e1 = 2500.
// Find ALL 20 faction treasuries by searching for similar structural patterns.
//
// Strategy: walk through the save looking for any u32 = 2500 at the
// confirmed offset (verify), then look for similar structures nearby that
// could be other factions' treasuries.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_17-05-2026   Spain   Turn 1.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const TREASURY_AT = 0x2c5e1;
console.log(`Spain treasury at 0x${TREASURY_AT.toString(16)}: ${u32(TREASURY_AT)}`);

// Dump 32 u32 fields from TREASURY_AT
console.log("\nu32 fields starting at treasury position:");
for (let off = -4; off <= 64; off += 4) {
  const o = TREASURY_AT + off;
  if (o + 4 > buf.length) continue;
  const v = u32(o);
  let note = "";
  if (v === 2500) note += " ← treasury";
  if (v >= 0x100 && v <= 0x10000) note += " (small)";
  console.log(`  +${off.toString().padStart(3)} (0x${o.toString(16)}): u32=${v.toString().padStart(10)} = 0x${v.toString(16)}${note}`);
}

// Look for the START of the structure that contains treasury. Search
// backwards for a likely "record start" marker. Settlement preamble is
// `00 00 00 fc fc fc fc 63 00 00 00`. Search.
const settlementPreamble = Buffer.from([0x00, 0x00, 0x00, 0xfc, 0xfc, 0xfc, 0xfc]);
const beforeTreasury = [];
let p = 0;
while ((p = buf.indexOf(settlementPreamble, p)) !== -1 && p < TREASURY_AT) {
  beforeTreasury.push(p);
  p += 7;
}
const closestPreamble = beforeTreasury[beforeTreasury.length - 1];
console.log(`\nClosest settlement preamble before treasury: 0x${closestPreamble?.toString(16)} (delta: -${TREASURY_AT - closestPreamble})`);

// Find ALL settlement preambles in the save and count
let total = 0;
p = 0;
while ((p = buf.indexOf(settlementPreamble, p)) !== -1) { total++; p += 7; }
console.log(`Total settlement preambles: ${total}`);
