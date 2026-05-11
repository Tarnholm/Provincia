// What coords does the save have for Aulus and Marcus?
const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";

const { findCharacterRecords } = require("../src/characterParser.js");
const { findUnitRecords } = require("../src/unitParser.js");

const buf = fs.readFileSync(SAVE);
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const characters = findCharacterRecords(buf, nameLookup, traitNames, null);

// Find Aulus Gabinius
console.log("\nAulus Gabinius records:");
for (const c of characters.filter(c => c.firstName === "Aulus" && (c.lastName === "Gabinius" || c.lastName?.includes("Gabinius")))) {
  console.log("  firstName=", c.firstName, "lastName=", c.lastName, "secondaryUuid=0x" + (c.secondaryUuid||0).toString(16), "x=", c.x, "y=", c.y);
}

console.log("\nMarcus Livius Drusus records:");
for (const c of characters.filter(c => c.firstName === "Marcus" && (c.lastName?.includes("Drusus") || c.lastName?.includes("Livius")))) {
  console.log("  firstName=", c.firstName, "lastName=", c.lastName, "secondaryUuid=0x" + (c.secondaryUuid||0).toString(16), "x=", c.x, "y=", c.y);
}
