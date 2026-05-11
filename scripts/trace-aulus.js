// Trace Aulus Gabinius end-to-end.
const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../src/unitParser.js");
const { findCharacterRecords } = require("../src/characterParser.js");
const { findAllSettlementMarkers } = require("../src/buildingParser.js");
const { findSettlementGovernors } = require("../src/saveOwnershipParser.js");

const savePath = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Autosave   Republic of Rome   Turn 5.sav";
const buf = fs.readFileSync(savePath);

// Load mod name lookup directly from the RIS data dir (same as main.js).
const modDir = "C:\\RIS\\RIS\\data";
const nameLookupPath = path.join(modDir, "descr_names_lookup.txt");
const traitsPath = path.join(modDir, "export_descr_character_traits.txt");
const nameLookup = fs.readFileSync(nameLookupPath, "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(traitsPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}
console.log("Loaded", nameLookup.length, "names,", traitNames.length, "traits");

const units = findUnitRecords(buf);
const characters = findCharacterRecords(buf, nameLookup, traitNames, null);
const settlements = findAllSettlementMarkers(buf);
console.log("Units:", units.length, "Characters (v1):", characters.length, "Settlements:", settlements.length);

// Aulus
const aulus = characters.filter(c => c.firstName && c.firstName.startsWith("Aulus"));
console.log("\nv1 chars firstName=Aulus*:", aulus.length);
for (const a of aulus.slice(0, 20)) {
  console.log(`  @0x${a.offset.toString(16)} ${a.firstName} ${a.lastName || ""} sec=0x${(a.secondaryUuid||0).toString(16)} pri=0x${(a.primaryUuid||0).toString(16)} age=${a.age} traits=${a.traits.length}`);
}

const target = 0xb444a820;
const matches = characters.filter(c => c.secondaryUuid === target || c.primaryUuid === target);
console.log(`\nv1 chars whose secondaryUuid or primaryUuid == 0x${target.toString(16)}:`, matches.length);
for (const m of matches) {
  console.log(`  @0x${m.offset.toString(16)} ${m.firstName} ${m.lastName || ""}`);
}

// Type 4/5/6 records with this uuid.
console.log("\nWorld-object records (type 4/5/6) for uuid 0xb444a820:");
let countTypes = { 4: 0, 5: 0, 6: 0 };
for (let N = 24; N < buf.length - 8; N++) {
  if (buf.readUInt32LE(N - 4) !== N - 4) continue;
  const type = buf.readUInt32LE(N - 12);
  if (type !== 6 && type !== 5 && type !== 4) continue;
  const uuid = buf.readUInt32LE(N - 8);
  if (uuid !== target) continue;
  const x = buf.readUInt32LE(N);
  const y = buf.readUInt32LE(N + 4);
  console.log(`  type=${type} @N=0x${N.toString(16)} x=${x} y=${y}`);
  countTypes[type]++;
}
console.log("  totals:", countTypes);

// Governor decode
const governors = findSettlementGovernors(buf, settlements, -1940);
console.log("\nSettlements with non-zero governor uuid (first 30):");
let i = 0;
for (const [city, uuid] of Object.entries(governors)) {
  if (i++ >= 30) break;
  console.log(`  ${city} → 0x${uuid.toString(16)}`);
}
console.log("\nSettlements where governor uuid == 0x" + target.toString(16) + ":");
for (const [city, uuid] of Object.entries(governors)) {
  if (uuid === target) console.log(`  ${city}`);
}

// Aulus's bodyguard unit details
const aulusUnit = units.find(u => u.offset === 0x155fbf4);
console.log("\nAulus's bodyguard unit @0x155fbf4:", JSON.stringify(aulusUnit));

// All roman generals
const generals = units.filter(u => u.name === "roman general");
console.log("\nAll roman general unit records:");
for (const g of generals) {
  console.log(`  @0x${g.offset.toString(16)} region=${g.region} cmd=0x${(g.commanderUuid||0).toString(16)} ${g.soldiers}/${g.maxSoldiers}`);
}
