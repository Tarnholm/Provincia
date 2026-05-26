// Try resolving v1 chars' portraits directly via their primaryUuid back-ref.
// If primaryUuid → extended record → +280 works for v1 chars, we can drop
// the coord bridge entirely.
const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const { resolvePortraitsByCharacter, parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav");

// Load mod data so findCharacterRecords works
const traitsPath = "C:/RIS/RIS/data/export_descr_character_traits.txt";
const namesPath = "C:/RIS/RIS/data/descr_names_lookup.txt";
const nameLookup = fs.readFileSync(namesPath, "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(traitsPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^Trait\s+(\S+)/);
    if (m) traitNames.push(m[1]);
  }
}

const v1Chars = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`v1 chars: ${v1Chars.length}`);

// Pretend each v1 char has ownUuid = primaryUuid (try the back-ref search)
const fake = v1Chars.map(c => ({ ownUuid: c.primaryUuid, offset: c.offset, age: c.age, firstName: c.firstName, lastName: c.lastName, faction: c.faction }));
const portraitsByPrim = resolvePortraitsByCharacter(buf, fake);
console.log(`portraits resolved via primaryUuid back-ref: ${portraitsByPrim.size}`);
let uniqueByPrim = new Set();
for (const [, v] of portraitsByPrim) uniqueByPrim.add(v.cards);
console.log(`unique cards paths: ${uniqueByPrim.size}`);

// Try secondaryUuid bridge
const fake2 = v1Chars.map(c => ({ ownUuid: c.secondaryUuid, offset: c.offset, age: c.age, firstName: c.firstName }));
const portraitsBySec = resolvePortraitsByCharacter(buf, fake2);
console.log(`portraits resolved via secondaryUuid back-ref: ${portraitsBySec.size}`);

// Show AntigonosB specifically
const antig = v1Chars.find(c => c.firstName === "AntigonosB");
if (antig) {
  const pPrim = portraitsByPrim.get(antig.primaryUuid);
  const pSec = portraitsBySec.get(antig.secondaryUuid);
  console.log("\nAntigonosB:");
  console.log(`  primaryUuid=${antig.primaryUuid?.toString(16)} → ${pPrim?.cards || "(none)"}`);
  console.log(`  secondaryUuid=${antig.secondaryUuid?.toString(16)} → ${pSec?.cards || "(none)"}`);
}

// Show DemetriosC
const dem = v1Chars.find(c => c.firstName === "DemetriosC");
if (dem) {
  const pPrim = portraitsByPrim.get(dem.primaryUuid);
  console.log("DemetriosC:");
  console.log(`  primaryUuid=${dem.primaryUuid?.toString(16)} → ${pPrim?.cards || "(none)"}`);
}
