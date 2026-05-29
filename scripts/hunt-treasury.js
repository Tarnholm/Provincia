"use strict";
// Parser reads Julii treasury = 24,740. User says it's 23,856 (delta = +884).
// Find ALL occurrences of 23856 in the save; one might be near Julii's
// faction record at a different field offset than what we're currently
// reading.
const fs = require("fs");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Julii turn7.sav";
const buf = fs.readFileSync(SAVE);
const TRUTH = 23856;
const PARSED = 24740;

// Find the record that crackSave used for Julii — it has treasury=24740.
const records = xtras.parseFactionTreasuries(buf);
console.log("records count:", records.length);
const julii = records.find(r => r.treasury === 24740);
if (!julii) {
  console.log("no record with treasury=24740 found; listing top 10 by knowledgeSize:");
  for (const r of records.slice().sort((a,b)=>b.knowledgeSize-a.knowledgeSize).slice(0, 10)) {
    console.log(`  offset=${r.offset} fid=${r.factionId} treasury=${r.treasury} knowledge=${r.knowledgeSize} regions=${r.regionCount}`);
  }
  process.exit(1);
}
console.log(`Julii record: offset=${julii.offset} fid=${julii.factionId} treasury=${julii.treasury} regionCount=${julii.regionCount} knowledgeSize=${julii.knowledgeSize} turnStart=${julii.turnStartTreasury} net=${julii.netThisTurn}`);

// Scan ±2048 bytes around julii.offset for the TRUTH value, the PARSED value,
// and the delta.
console.log(`\nScanning ±2048 around Julii record for u32=${TRUTH} (truth) and u32=${PARSED} (parser):`);
const ranges = [
  { label: "TRUTH=23856", val: TRUTH },
  { label: "PARSED=24740", val: PARSED },
  { label: "DELTA=884", val: 884 },
  { label: "TRUTH+1=23857", val: 23857 }, // sanity ± 1
];
for (const r of ranges) {
  console.log(`\n  ${r.label}:`);
  for (let d = -2048; d <= 2048; d += 1) {
    const o = julii.offset + d;
    if (o < 0 || o + 4 > buf.length) continue;
    if (buf.readUInt32LE(o) === r.val) {
      console.log(`    +${d}: ${r.val}  (8-byte ctx: ${buf.slice(Math.max(0,o-4), o+8).toString("hex")})`);
    }
  }
}

// Also: list ALL u32 fields within the Julii record (first 256 bytes) so we
// can see what's actually there.
console.log(`\n=== First 64 u32 fields of Julii record ===`);
for (let k = 0; k < 64; k++) {
  const o = julii.offset + k * 4;
  if (o + 4 > buf.length) break;
  const v = buf.readUInt32LE(o);
  const si = buf.readInt32LE(o);
  console.log(`  +${(k * 4).toString().padStart(3)}: u32=${v.toString().padStart(10)} i32=${si.toString().padStart(11)}`);
}

// Search EVERYWHERE in the save for 23856 — might not be in this record.
console.log(`\n=== Every absolute offset where u32=23856 ===`);
{
  let count = 0;
  for (let o = 0; o + 4 <= buf.length; o += 1) {
    if (buf.readUInt32LE(o) === 23856) {
      const ctx = buf.slice(Math.max(0, o-8), o+12).toString("hex");
      console.log(`  off=${o}: ctx=${ctx}`);
      count++;
      if (count > 30) { console.log("  ... truncated"); break; }
    }
  }
  console.log(`total: ${count} (capped)`);
}
