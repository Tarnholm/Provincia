// Do any +44=8 minor records reference antigonid character UUIDs?
// If yes, that minor record IS the player's.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const chars = parseCharacterExtras(buf);
const antigonid = new Set(chars.filter(c => c.culture === "antigonid").map(c => c.ownUuid));
console.log(`looking for ${antigonid.size} antigonid char UUIDs in +44=8 records`);

// Find all +44=8 records
const recs = [];
for (let i = 0; i + 200 < buf.length; i += 1) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 8) continue;
  recs.push(i);
}
console.log(`scanning ${recs.length} records for antigonid UUIDs...`);

let bestRec = null;
let bestMatches = 0;
for (let r = 0; r < recs.length; r++) {
  const off = recs[r];
  const nextOff = r + 1 < recs.length ? recs[r + 1] : off + 50000;
  const matches = new Set();
  for (let p = off; p + 4 < nextOff; p += 1) {
    const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
    if (antigonid.has(v)) matches.add(v);
  }
  if (matches.size > bestMatches) {
    bestRec = { off, matches: matches.size };
    bestMatches = matches.size;
  }
  if (matches.size > 0) {
    // Find the banner in this record
    const region = buf.slice(off, nextOff);
    const idx = region.indexOf("captain_card_");
    let banner = "(no banner)";
    if (idx !== -1) {
      let end = idx + "captain_card_".length;
      while (end < idx + 60 && region[end] !== 0x2e && region[end] >= 0x20 && region[end] < 0x7f) end++;
      banner = region.slice(idx + "captain_card_".length, end).toString("ascii");
    }
    console.log(`  rec @ 0x${off.toString(16)}: ${matches.size} antigonid matches, banner=${banner}, span=${nextOff - off}`);
  }
}

if (bestRec) {
  console.log(`\nbest match: 0x${bestRec.off.toString(16)} with ${bestRec.matches} antigonid UUIDs`);
} else {
  console.log("\nNO +44=8 record contains antigonid char UUIDs.");
}

// Also check the SPACE between the 23 major records and 216 minor records
// (or before the major records). Maybe player has a +44=10 or different
// +44 value.
console.log("\n=== Look for OTHER +44 values in records containing antigonid UUIDs ===");
const antigonidOccurrences = new Map(); // record offset -> count
for (let i = 0; i + 200 < buf.length; i += 1) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  const v44 = buf.readUInt32LE(i + 44);
  // Now scan within reasonable range (next 50KB or to next record)
  const region = buf.slice(i, Math.min(i + 50000, buf.length));
  const matches = new Set();
  for (let p = 0; p + 4 < region.length; p += 1) {
    const v = (region[p] | (region[p + 1] << 8) | (region[p + 2] << 16) | (region[p + 3] << 24)) >>> 0;
    if (antigonid.has(v)) matches.add(v);
  }
  if (matches.size >= 5) {
    antigonidOccurrences.set(i, { v44, matches: matches.size });
  }
}
console.log(`records with >=5 antigonid UUIDs nearby:`);
for (const [off, info] of antigonidOccurrences.entries()) {
  console.log(`  0x${off.toString(16)}  v44=${info.v44}  matches=${info.matches}`);
}
