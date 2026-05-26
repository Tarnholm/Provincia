// dig-agent-v1parse.js
// Use the v1 characterParser (role byte +42/+38) to enumerate all characters in
// the Spain saves and bucket by role byte. Agents (spy/diplomat/assassin/merchant)
// have no traits typically, so the tc=0 admiral gate may catch some. Print role
// histogram + per-character summary so we can find the spy/diplomat.
const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");

const VANILLA = "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data";
const names = fs.readFileSync(path.join(VANILLA, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(VANILLA, "export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
console.log(`names=${names.length} traits=${traits.length}`);

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const saves = [
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
];

for (const name of saves) {
  const buf = fs.readFileSync(SAVE_DIR + name);
  const recs = findCharacterRecords(buf, names, traits, null);
  const hist = {};
  for (const r of recs) hist[r.role] = (hist[r.role] || 0) + 1;
  console.log(`\n=== ${name} : ${recs.length} chars  roleHist=${JSON.stringify(hist)} ===`);
  for (const r of recs) {
    // Print non-general (role != 0) candidates and any with no traits
    console.log(`  role=${r.role} ${r.firstName} ${r.lastName || ""} age=${r.age} tile=(${r.tileX},${r.tileY}) traits=${r.traits.length} off=0x${r.offset.toString(16)} pUuid=${r.primaryUuid} sUuid=${r.secondaryUuid} mp=${r.mpRemaining}`);
  }
}
