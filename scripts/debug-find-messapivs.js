const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav';
const MOD = 'C:/RIS/RIS/data';

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, 'descr_names_lookup.txt'),'utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, 'export_descr_character_traits.txt'),'utf8').split(/\r?\n/)) {
  const m=line.match(/^Trait\s+(\S+)/); if(m) traitNames.push(m[1]);
}
console.log("traits loaded:", traitNames.length);
console.log("Has RomanConquerorMessapians?", traitNames.includes("RomanConquerorMessapians"));
console.log("Has Legendary_Siege_Expert?", traitNames.includes("Legendary_Siege_Expert"));
// Note: Legendary_Siege_Expert is a LEVEL name, not a Trait name. The parent is some other trait.
const idx = traitNames.indexOf("RomanConquerorMessapians");
console.log("RomanConquerorMessapians index:", idx);

const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
const hits = chars.filter(c => (c.traits||[]).some(t => /messap|sieg|wallbreak/i.test(t.name)));
console.log("\nCharacters with messapian/siege traits:");
for (const c of hits.slice(0, 10)) {
  const ts = (c.traits||[]).filter(t => /messap|sieg|wallbreak|roman/i.test(t.name)).map(t => t.name + ":" + t.level).join(" / ");
  console.log("  " + c.firstName + " " + (c.lastName||"") + " uuid=0x" + c.secondaryUuid.toString(16) + " traits: " + ts);
}
