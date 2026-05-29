"use strict";
// Look for the turn counter relative to the player's faction record. The
// per-faction record is found at a known offset by parseFactionTreasuries.
// The turn number is likely a small u32 either inside that record or in a
// game-state section nearby. Cross-check against multiple saves.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T7",  expected: 7,  file: "save_Julii turn7.sav" },
  { name: "T6E", expected: 6,  file: "save_Autosave   Republic of Rome   Turn 6 End.sav" },
  { name: "T7S", expected: 7,  file: "save_Autosave   Republic of Rome   Turn 7 Start.sav" },
  { name: "T1",  expected: 1,  file: "save_Autosave   Republic of Rome   Turn 1.sav" },
  { name: "T20", expected: 20, file: "save_Autosave   Dummies   Turn 20 End.sav" },
];

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}

const loaded = SAVES.map(s => ({
  ...s,
  buf: fs.existsSync(path.join(SAVE_DIR, s.file)) ? fs.readFileSync(path.join(SAVE_DIR, s.file)) : null,
}));

// For each save, find ALL parseFactionTreasuries records (per-faction blocks),
// then for each, look for the expected turn value in a +window.
for (const s of loaded) {
  if (!s.buf) { console.log(`${s.name}: file missing`); continue; }
  const records = xtras.parseFactionTreasuries(s.buf);
  console.log(`\n${s.name} (turn=${s.expected}): ${records.length} faction records`);
  // The expected turn is `s.expected`. Look for that u32 within 256 bytes
  // BEFORE and AFTER the first record's offset.
  if (records.length === 0) continue;
  const r = records[0];
  console.log(`  record[0] offset=${r.offset}, looking for u32=${s.expected} in ±256:`);
  for (let d = -256; d <= 256; d += 4) {
    const o = r.offset + d;
    if (o < 0 || o + 4 > s.buf.length) continue;
    if (s.buf.readUInt32LE(o) === s.expected) {
      console.log(`    +${d}: ${s.buf.readUInt32LE(o)}`);
    }
  }
}

// Anchor on the campaign-name end (stable size for same campaign).
console.log("\n=== Scan relative to campaign-name end (header) ===");
function findCampaignNameEnd(buf) {
  const len = buf.readUInt16LE(0x3a);
  return 0x3c + len * 2;
}
const refs = loaded.filter(s => s.buf);
for (const s of refs) {
  const end = findCampaignNameEnd(s.buf);
  s.headerEnd = end;
}
// Try every 4-byte offset from headerEnd up to +8192 looking for one where
// every save reads its expected turn at the same relative offset.
for (let d = 0; d <= 65536; d += 4) {
  const reads = refs.map(s => {
    const o = s.headerEnd + d;
    if (o + 4 > s.buf.length) return null;
    return s.buf.readUInt32LE(o);
  });
  if (refs.every((s, i) => reads[i] === s.expected)) {
    console.log(`  d=+${d} from headerEnd: ALL match — reads=${reads.join(",")}`);
  }
}
console.log("(scan complete; if nothing printed, turn isn't at a fixed header-relative offset)");

// Last-resort: scan EVERY u32 position for any offset where all saves match.
console.log("\n=== Brute-force absolute u32 offsets where all saves read expected turn ===");
{
  const minLen = Math.min(...refs.map(s => s.buf.length));
  let count = 0;
  for (let o = 0; o + 4 <= minLen; o += 4) {
    let ok = true;
    for (const s of refs) {
      if (s.buf.readUInt32LE(o) !== s.expected) { ok = false; break; }
    }
    if (ok) { console.log(`  abs offset ${o}`); count++; if (count > 20) { console.log("  ... (truncated)"); break; } }
  }
  console.log(`total ${count} absolute matches`);
}
