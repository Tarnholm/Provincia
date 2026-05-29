"use strict";
// Hunt: what's distinctive about Dummies as the player? identifyPlayerFactionFromSave
// returns null because there's no captain_card_dummies.tga banner.
// Compare with a Julii save where player IS identified.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const DUMMIES = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Dummies   Turn 20 End.sav"));
const JULII   = fs.readFileSync(path.join(SAVE_DIR, "save_Julii turn7.sav"));

for (const [name, buf] of [["DUMMIES T20", DUMMIES], ["JULII T7", JULII]]) {
  console.log(`\n=== ${name} ===`);
  // Find "dummies" or "romans_julii" string anywhere in the save
  for (const needle of ["dummies", "romans_julii"]) {
    const pat = Buffer.from(needle, "ascii");
    const hits = [];
    let p = 0;
    while ((p = buf.indexOf(pat, p)) !== -1) { hits.push(p); p += pat.length; if (hits.length > 10) break; }
    console.log(`  "${needle}" hits (first 5): ${hits.slice(0, 5).join(",")} (total seen: ${hits.length})`);
  }
  // First sub6 record offset
  const records = xtras.parseFactionTreasuries(buf);
  const sub6 = records.filter(r => r.knowledgeSize !== undefined).sort((a,b)=>a.offset-b.offset);
  console.log(`  total sub6 records: ${sub6.length}, first @ ${sub6[0] && sub6[0].offset}`);
  if (sub6[0]) console.log(`  first record: knowledge=${sub6[0].knowledgeSize} treasury=${sub6[0].treasury}`);
  // Type A records (knowledge > 200)
  const typeA = sub6.filter(r => r.knowledgeSize > 200).sort((a,b)=>a.offset-b.offset);
  console.log(`  Type A records: ${typeA.length}`);
  for (const r of typeA.slice(0, 6)) console.log(`    off=${r.offset} knowledge=${r.knowledgeSize} treasury=${r.treasury}`);
}
