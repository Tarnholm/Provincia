// dig-chartail9.js — clarify the +18..+25 family link semantics.
//
// Marcus's father link should be findable via fatherUuid (+46). Compare:
//   - Marcus rome7: +18=1102 (Cornelius_Scapula), +22=2
//   - Aulus rome6: +18=1102 (Cornelius_Scapula), +22=2
//
// If +18 = fatherUuid → it should equal the primaryUuid of a char whose
// lastName_idx is 1102 / Cornelius_Scapula. But +18 is u32=1102 which is
// a NAME INDEX, not a uuid. So +18 is character-name-index.
//
// One way to interpret: +18 = "in-progress adoption candidate", named after
// the bridegroom's family clan. Marcus's was set at end-turn when Marcus's
// adoption was queued. Aulus already has it because the adoption resolved.
//
// Better test: look at Marcus's fatherUuid (+46). Is it pointing to a
// Cornelius_Scapula character?

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

const buf = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// Find Marcus and Aulus in rome7
const marcus = recs.find(r => r.firstName === "Marcus" && r.lastName === "Livius_Drusus");
const aulus = recs.find(r => r.firstName === "Aulus" && r.lastName === "Gabinius");

for (const c of [marcus, aulus].filter(Boolean)) {
  const off = c.offset;
  console.log(`\n## ${c.firstName} ${c.lastName} in rome7  off=0x${off.toString(16)}`);
  console.log(`  primaryUuid: ${c.primaryUuid}`);
  console.log(`  fatherUuid:  ${buf.readUInt32LE(off + 46)}`);
  console.log(`  +18 u32: ${buf.readUInt32LE(off + 18)} (${nameLookup[buf.readUInt32LE(off + 18)] || "?"})`);
  console.log(`  +22 u32: ${buf.readUInt32LE(off + 22)}`);
  console.log(`  age: ${c.age}`);
  console.log(`  role: ${c.role}`);
  console.log(`  +88 u8: ${buf.readUInt8(off + 88)} (small-enum hypothesis)`);
  console.log(`  +98 u16: ${buf.readUInt16LE(off + 98)} (commission/state hypothesis)`);
  console.log(`  +102 u16: ${buf.readUInt16LE(off + 102)}`);
  console.log(`  +106 u8: ${buf.readUInt8(off + 106)}`);
  console.log(`  +126 u8: ${buf.readUInt8(off + 126)}`);
  console.log(`  +150 i32: ${buf.readInt32LE(off + 150)}`);
  console.log(`  +178 u8: ${buf.readUInt8(off + 178)}`);
  console.log(`  +182 u32: ${buf.readUInt32LE(off + 182)}`);
  console.log(`  +218 u8: ${buf.readUInt8(off + 218)}`);
  console.log(`  +222 u8: ${buf.readUInt8(off + 222)}`);
  console.log(`  +286 u8: ${buf.readUInt8(off + 286)}`);
  console.log(`  +302 u16 (traitCount): ${buf.readUInt16LE(off + 302)}`);
}

// Search the save for the fatherUuid - does any character record have it?
// Marcus's fatherUuid - look up in the trait/char list
console.log(`\n## Resolving Marcus's father by fatherUuid lookup`);
const fatherUuid = buf.readUInt32LE(marcus.offset + 46);
console.log(`  Marcus fatherUuid: ${fatherUuid}`);
for (const r of recs) {
  if (r.primaryUuid === fatherUuid) {
    console.log(`  MATCH: ${r.firstName} ${r.lastName}  primaryUuid=${r.primaryUuid}  age=${r.age}  off=0x${r.offset.toString(16)}`);
    break;
  }
}

// Is Marcus's father a Cornelius_Scapula? If so, +18 = father's lastName index makes sense
const fatherIdx = nameLookup.indexOf("Cornelius_Scapula");
console.log(`  nameLookup index for 'Cornelius_Scapula': ${fatherIdx}`);

// Show all chars whose lastName is Cornelius_Scapula
console.log(`\n## All Cornelius_Scapula chars in rome7`);
for (const r of recs) {
  if (r.lastName === "Cornelius_Scapula") {
    console.log(`  ${r.firstName} ${r.lastName}  primaryUuid=${r.primaryUuid}  age=${r.age}  off=0x${r.offset.toString(16)}`);
  }
}

// Also resolve Aulus's father
console.log(`\n## Resolving Aulus Gabinius father`);
const aFatherUuid = buf.readUInt32LE(aulus.offset + 46);
console.log(`  Aulus fatherUuid: ${aFatherUuid}`);
for (const r of recs) {
  if (r.primaryUuid === aFatherUuid) {
    console.log(`  MATCH: ${r.firstName} ${r.lastName}  age=${r.age}`);
    break;
  }
}
