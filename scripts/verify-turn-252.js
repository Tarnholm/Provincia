"use strict";
// Verify that +252 of the player's faction record holds the turn number,
// across all 5 saves we have.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T7  ", expected: 7,  treasury: 24740, file: "save_Julii turn7.sav" },
  { name: "T6E ", expected: 6,  treasury: null,  file: "save_Autosave   Republic of Rome   Turn 6 End.sav" },
  { name: "T7S ", expected: 7,  treasury: null,  file: "save_Autosave   Republic of Rome   Turn 7 Start.sav" },
  { name: "T1  ", expected: 1,  treasury: null,  file: "save_Autosave   Republic of Rome   Turn 1.sav" },
  { name: "T20 ", expected: 20, treasury: null,  file: "save_Autosave   Dummies   Turn 20 End.sav" },
];

for (const s of SAVES) {
  const p = path.join(SAVE_DIR, s.file);
  if (!fs.existsSync(p)) { console.log(`${s.name} missing`); continue; }
  const buf = fs.readFileSync(p);
  const records = xtras.parseFactionTreasuries(buf);
  // The "right" Julii record at T7 had treasury=24740 with knowledgeSize that
  // wasn't 414 (T7 has expanded). For T1, Julii=414. Find by knowledge=414
  // (T1) or knowledge >= 414 (later turns).
  let player = records.find(r => r.knowledgeSize === 414);
  if (!player) {
    // T7+: knowledge expands. Pick the record with highest knowledgeSize?
    // Actually crackSave does something specific. Look for records with
    // knowledgeSize >= 414 (Julii's lower bound).
    const cands = records.filter(r => r.knowledgeSize >= 414).sort((a,b) => a.knowledgeSize - b.knowledgeSize);
    player = cands[0];
  }
  if (!player) { console.log(`${s.name} no Julii-ish record`); continue; }
  const t252 = buf.readUInt32LE(player.offset + 252);
  console.log(`${s.name} expected=${s.expected}  off=${player.offset} treasury=${player.treasury} knowledge=${player.knowledgeSize}  +252=${t252}`);
  // Dump 0..400 in 4-byte u32s, showing only non-zero ones in interesting range
  const found = [];
  for (let k = 0; k <= 400; k += 4) {
    const v = buf.readUInt32LE(player.offset + k);
    if (v === s.expected) found.push(`+${k}=${v}`);
  }
  console.log(`      offsets reading exactly ${s.expected}: ${found.join(" | ") || "<none>"}`);
}
