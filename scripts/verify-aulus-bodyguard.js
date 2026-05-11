// One-shot verification that the unit parser now picks up Aulus
// Gabinius's bodyguard at offset ~0x155fbf6 in the RoR T5 save.
const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../src/unitParser.js");

const savePath = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Autosave   Republic of Rome   Turn 5.sav";
const buf = fs.readFileSync(savePath);
console.log("Save size:", buf.length, "bytes");

const records = findUnitRecords(buf);
console.log("Total unit records:", records.length);

// Search for Aulus's bodyguard near 0x155fbf4.
const targetOffset = 0x155fbf4;
const window = records.filter(r => Math.abs(r.offset - targetOffset) < 100);
console.log("\nUnit records near 0x155fbf4:", window.length);
for (const r of window) {
  console.log(`  @0x${r.offset.toString(16)}: ${r.name} | region=${r.region} | uuid=0x${(r.commanderUuid||0).toString(16)} | sold=${r.soldiers}/${r.maxSoldiers}`);
}

// Also: how many "roman general" bodyguards do we now find?
const generals = records.filter(r => r.name === "roman general");
console.log("\nTotal 'roman general' records:", generals.length);

// Tarras region units
const tarasUnits = records.filter(r => r.region === "Taras");
console.log("\nUnit records in Taras region:", tarasUnits.length);
for (const r of tarasUnits) {
  console.log(`  @0x${r.offset.toString(16)}: ${r.name} | uuid=0x${(r.commanderUuid||0).toString(16)} | sold=${r.soldiers}/${r.maxSoldiers}`);
}
