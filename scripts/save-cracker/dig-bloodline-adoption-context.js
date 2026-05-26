// dig-bloodline-adoption-context.js
//
// Identify the campaign / faction / player for the adoption-experiment saves
// (save_t0..t7 + the *adoption variants). These are the controlled ground-truth
// pairs for the family-edge / succession crack. Report header + faction-record
// info so we know who the player faction is and how many characters exist.

const fs = require("fs");
const path = require("path");
const { parseHeader, parseFactionTreasuries, identifyPlayerFactionFromSave } = require("../../src/saveCrackerExtras.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

const FILES = [
  "save_t0.sav", "save_t1.sav", "save_t1adoption.sav",
  "save_t2.sav", "save_t2declineadoption.sav",
  "save_t3.sav", "save_t3a adoption.sav",
  "save_t4.sav", "save_t4 adoption.sav",
  "save_t5.sav", "save_t5 adoption.sav",
];

for (const f of FILES) {
  const p = path.join(SAVES, f);
  if (!fs.existsSync(p)) { console.log(f, "MISSING"); continue; }
  const buf = fs.readFileSync(p);
  const h = parseHeader(buf);
  const t = parseFactionTreasuries(buf);
  const pf = identifyPlayerFactionFromSave(buf, t);
  console.log(`${f.padEnd(34)} | ${(buf.length/1e6).toFixed(1)}MB | campaign="${h.campaignName}" type=0x${h.campaignTypeFlag.toString(16)} | player=${pf} | factionRecs=${t.length}`);
}
