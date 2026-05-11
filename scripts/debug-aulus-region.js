// Trace which region Aulus's char record is bucketed under in save_3,
// and what would arrive in saveCharactersByRegion via main.js's flow.
const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav';
const MOD = 'C:/RIS/RIS/data';

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, 'descr_names_lookup.txt'),'utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, 'export_descr_character_traits.txt'),'utf8').split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/); if (m) traitNames.push(m[1]);
}
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
const units = findUnitRecords(buf);

// Replicate main.js's regionByCommanderUuid
const regionByCommanderUuid = new Map();
for (const u of units) {
  if (u.commanderUuid && u.region && !regionByCommanderUuid.has(u.commanderUuid)) {
    regionByCommanderUuid.set(u.commanderUuid, u.region);
  }
}

// Resolve regions for each char
for (const c of chars) c.region = regionByCommanderUuid.get(c.secondaryUuid) || null;

// Find Aulus Gabinius
const aulus = chars.find(c => c.secondaryUuid === 0xa77c10f);
console.log("Aulus Gabinius (uuid 0xa77c10f):");
console.log("  firstName:", aulus.firstName);
console.log("  lastName:", aulus.lastName);
console.log("  originalLastName:", aulus.originalLastName);
console.log("  region (from regionByCommanderUuid):", aulus.region);

// Find Marcus too
const marcus = chars.find(c => c.firstName === "Marcus" && /Livius/i.test(c.lastName || c.originalLastName || ""));
if (marcus) {
  console.log("\nMarcus:");
  console.log("  firstName:", marcus.firstName, "lastName:", marcus.lastName, "originalLastName:", marcus.originalLastName);
  console.log("  region (from regionByCommanderUuid):", marcus.region);
}

// What region are Aulus's bodyguard units tagged with?
console.log("\nAulus's bodyguard unit region tag:");
const aulusUnits = units.filter(u => u.commanderUuid === 0xa77c10f);
aulusUnits.forEach(u => console.log("  ", u.name, "region:", u.region));
