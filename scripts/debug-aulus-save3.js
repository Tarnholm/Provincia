// Find Aulus's actual save-3 position and check for duplicates.
const fs = require('fs');
const path = require('path');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav';
const MOD = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data';

const { findCharacterRecords } = require('C:/dev/Provincia/src/characterParser.js');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, 'descr_names_lookup.txt'),'utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, 'export_descr_character_traits.txt'),'utf8').split(/\r?\n/)) { const m=line.match(/^Trait\s+(\S+)/); if(m) traitNames.push(m[1]); }

const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
const units = findUnitRecords(buf);

console.log("ALL Aulus Gabinius character records:");
for (const c of chars.filter(c => c.firstName==='Aulus')) {
  console.log("  ", c.firstName, c.lastName, "uuid=0x" + (c.secondaryUuid||0).toString(16), "offset=0x" + (c.offset||0).toString(16));
}

console.log("\nAll units with commanderUuid pointing at any Aulus:");
const aulusUuids = new Set(chars.filter(c => c.firstName==='Aulus').map(c => c.secondaryUuid));
for (const u of units) {
  if (aulusUuids.has(u.commanderUuid)) {
    console.log("  unit=" + u.name + " cmd=0x" + u.commanderUuid.toString(16) + " region=" + u.region + " offset=0x" + u.offset.toString(16));
  }
}

console.log("\nUnits in Salentinia region (where Uria is):");
const saUnits = units.filter(u => u.region && u.region.toLowerCase().includes("salent"));
for (const u of saUnits.slice(0, 30)) {
  console.log("  " + u.name + " cmd=0x" + (u.commanderUuid||0).toString(16) + " soldiers=" + u.soldiers);
}
console.log("Total Salentinia units:", saUnits.length);
