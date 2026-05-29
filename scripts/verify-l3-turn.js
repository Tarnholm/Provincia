"use strict";
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T7  ", expected: 7,  file: "save_Julii turn7.sav" },
  { name: "T6E ", expected: 6,  file: "save_Autosave   Republic of Rome   Turn 6 End.sav" },
  { name: "T7S ", expected: 7,  file: "save_Autosave   Republic of Rome   Turn 7 Start.sav" },
  { name: "T1  ", expected: 1,  file: "save_Autosave   Republic of Rome   Turn 1.sav" },
  { name: "T20 ", expected: 20, file: "save_Autosave   Dummies   Turn 20 End.sav" },
];

for (const s of SAVES) {
  const p = path.join(SAVE_DIR, s.file);
  if (!fs.existsSync(p)) { console.log(`${s.name} missing`); continue; }
  const buf = fs.readFileSync(p);
  const records = xtras.parseFactionTreasuries(buf);
  // Find the record with the largest knowledgeSize that's also > 200 = Type A player record
  const playerRec = records
    .filter(r => r.knowledgeSize > 200)
    .sort((a, b) => a.offset - b.offset)[0];
  if (!playerRec) { console.log(`${s.name} no Type A record`); continue; }
  // Dump relevant offsets
  const get = (d) => playerRec.offset + d <= buf.length - 4 ? buf.readUInt32LE(playerRec.offset + d) : null;
  const turnCandidates = [];
  for (let d = 0; d <= 1024; d += 4) {
    if (get(d) === s.expected) turnCandidates.push(d);
  }
  console.log(`${s.name} expected=${s.expected}  off=${playerRec.offset} treasury=${playerRec.treasury} knowledge=${playerRec.knowledgeSize}  offsets reading ${s.expected}: ${turnCandidates.join(",") || "<none>"}`);
}

// Find offsets where ALL saves read their expected turn
console.log("\n=== CROSS-VALIDATION: offsets where all 5 saves match expected turn ===");
const loaded = SAVES.map(s => {
  const p = path.join(SAVE_DIR, s.file);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  const records = xtras.parseFactionTreasuries(buf);
  const playerRec = records.filter(r => r.knowledgeSize > 200).sort((a,b)=>a.offset-b.offset)[0];
  return playerRec ? { ...s, buf, off: playerRec.offset } : null;
}).filter(Boolean);

for (let d = 0; d <= 4096; d += 4) {
  const reads = loaded.map(s => s.buf.readUInt32LE(s.off + d));
  if (loaded.every((s, i) => reads[i] === s.expected)) {
    console.log(`  d=+${d}: reads=${reads.join(",")}`);
  }
}
console.log("(scan to +4096 complete)");
