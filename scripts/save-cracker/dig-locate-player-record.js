// Locate the player's faction record by finding the section containing
// the antigonid char roster. Compare its offset against the 23 major
// faction records.
const fs = require("fs");
const { parseFactionTreasuries, parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const treas = parseFactionTreasuries(buf);
const chars = parseCharacterExtras(buf);

console.log(`save size: 0x${buf.length.toString(16)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)\n`);

console.log("23 major faction records (sorted by offset):");
const sorted = [...treas].sort((a, b) => a.offset - b.offset);
for (const r of sorted) {
  console.log(`  0x${r.offset.toString(16).padStart(8,'0')}  treasury=${r.treasury.toString().padStart(6)}  ${r.regionCount}r`);
}

const antigonidRosterStart = 0x1517fe3;
console.log(`\nantigonid char roster at: 0x${antigonidRosterStart.toString(16)}`);

// Find which faction record (if any) the roster falls inside
const before = sorted.filter(r => r.offset < antigonidRosterStart);
const after = sorted.filter(r => r.offset > antigonidRosterStart);
const nearestBefore = before[before.length - 1];
const nearestAfter = after[0];
console.log(`nearest record before: ${nearestBefore ? "0x" + nearestBefore.offset.toString(16) + " treasury=" + nearestBefore.treasury : "(none — roster precedes all 23 records)"}`);
console.log(`nearest record after:  ${nearestAfter ? "0x" + nearestAfter.offset.toString(16) + " treasury=" + nearestAfter.treasury : "(none)"}`);

// Check: are antigonid chars in a 24th-major-faction-record we missed?
// Scan for the standard signature near 0x1517fe3
console.log("\nscanning ±200KB around the antigonid roster for major-class signatures...");
const scanStart = Math.max(0, antigonidRosterStart - 200000);
const scanEnd = Math.min(buf.length - 200, antigonidRosterStart + 100000);
let hits = 0;
for (let p = scanStart; p < scanEnd; p += 1) {
  // +8 = 100, +12 = 1, +24 self-ptr, +40 self-ptr, +44 = 6
  if (buf.readUInt32LE(p + 8) === 100 &&
      buf.readUInt32LE(p + 12) === 1 &&
      buf.readUInt32LE(p + 24) === p + 24 &&
      buf.readUInt32LE(p + 40) === p + 40 &&
      buf.readUInt32LE(p + 44) === 6) {
    const treasury = buf.readInt32LE(p);
    console.log(`  HIT 0x${p.toString(16)} treasury=${treasury}`);
    hits += 1;
  }
}
console.log(`(${hits} hits in scan range)`);

// Maybe player record has a DIFFERENT class tag (not 100). Look for any
// near-match patterns near the roster
console.log("\nscanning ±50KB around roster for SELF_PTR + SIZE signatures...");
const scanStart2 = Math.max(0, antigonidRosterStart - 50000);
const scanEnd2 = Math.min(buf.length - 200, antigonidRosterStart + 5000);
const candidates = [];
for (let p = scanStart2; p < scanEnd2; p += 4) {
  // Standard taw section header: {u32 ptr==pos, u32 size}
  if (buf.readUInt32LE(p) === p) {
    const size = buf.readUInt32LE(p + 4);
    if (size > 1000 && size < 10000000) {
      candidates.push({ pos: p, size });
    }
  }
}
console.log(`${candidates.length} taw-section candidates:`);
for (const c of candidates.slice(0, 20)) {
  console.log(`  0x${c.pos.toString(16).padStart(8,'0')}  size=${c.size.toLocaleString()} (ends at 0x${(c.pos + c.size).toString(16)})`);
}

// Also: where do the antigonid chars cluster relative to the LARGE preceding section?
console.log("\nfind taw section that CONTAINS the antigonid roster (size big enough):");
for (const c of candidates) {
  if (c.pos < antigonidRosterStart && c.pos + c.size > antigonidRosterStart) {
    console.log(`  CANDIDATE: pos=0x${c.pos.toString(16)} size=${c.size.toLocaleString()} (contains roster)`);
  }
}
