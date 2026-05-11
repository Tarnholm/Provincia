// Find every character whose firstName decodes as Aulus*, then look for
// surname Messapivs/Messapian or anything like it. User says the garrison
// commander at this region is "Aulus Messapivs", age 21, cmd 3, infl 4, mgmt 2.
// His unit is 36 men (1 + 35 bodyguards).

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../src/unitParser.js");
const { findCharacterRecords } = require("../src/characterParser.js");
const { findAllSettlementMarkers } = require("../src/buildingParser.js");
const { findSettlementGovernors } = require("../src/saveOwnershipParser.js");

const savePath = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Autosave   Republic of Rome   Turn 5.sav";
const buf = fs.readFileSync(savePath);

const modDir = "C:\\RIS\\RIS\\data";
const nameLookup = fs.readFileSync(path.join(modDir, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(modDir, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const characters = findCharacterRecords(buf, nameLookup, traitNames, null);
const units = findUnitRecords(buf);

console.log("Characters total:", characters.length);

// Every char whose firstName starts with 'Aulus':
const auluses = characters.filter(c => c.firstName && c.firstName.startsWith("Aulus"));
console.log("\nCharacters firstName=Aulus*:", auluses.length);
for (const c of auluses) {
  console.log(`  @0x${c.offset.toString(16)} ${c.firstName} ${c.lastName||""} sec=0x${(c.secondaryUuid||0).toString(16)} age=${c.age} traits=${c.traits.length}`);
}

// Every char age 21:
const age21 = characters.filter(c => c.age === 21);
console.log("\nCharacters age 21 total:", age21.length);
for (const c of age21.slice(0, 30)) {
  console.log(`  @0x${c.offset.toString(16)} ${c.firstName} ${c.lastName||""} traits=${c.traits.length}`);
}

// Look for "messapian general" units with ~35 raw soldiers (36 displayed):
const messGenerals = units.filter(u => u.name && u.name.toLowerCase().includes("general"));
console.log("\nGeneral-like units (showing 30-40 soldiers):");
for (const u of messGenerals) {
  if (u.soldiers >= 30 && u.soldiers <= 40) {
    console.log(`  @0x${u.offset.toString(16)} name="${u.name}" region=${u.region} cmd=0x${(u.commanderUuid||0).toString(16)} ${u.soldiers}/${u.maxSoldiers}`);
  }
}

// Look for "messapian" anything in unit names:
console.log("\nAll unit names containing 'messap':");
const messUnits = units.filter(u => u.name && u.name.toLowerCase().includes("messap"));
for (const u of messUnits.slice(0, 30)) {
  console.log(`  @0x${u.offset.toString(16)} name="${u.name}" region=${u.region} cmd=0x${(u.commanderUuid||0).toString(16)} ${u.soldiers}/${u.maxSoldiers}`);
}

// All distinct unit names containing 'general':
const genNames = new Set();
for (const u of units) if (u.name && u.name.toLowerCase().includes("general")) genNames.add(u.name);
console.log("\nDistinct general-like unit names:", Array.from(genNames));
