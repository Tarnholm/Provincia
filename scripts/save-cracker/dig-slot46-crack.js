// Final crack: for every char with a +46 value, check if that value appears
// as ANY other v1 char's child slot. If YES, then +46 = "I am the spouse of
// X, where X's wife/daughter at uuid Y is in their childUuids".
// This proves +46 = spouseUuid by transitivity.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const traitsList = [];
for (const m of traitsTxt.matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitsList.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traitsList, null);

// Build set of all child-slot uuids
const allChildUuids = new Set();
const childToParent = new Map(); // childUuid → parent record
for (const c of v1Records) {
  for (const cu of (c.childUuids || [])) {
    allChildUuids.add(cu);
    if (!childToParent.has(cu)) childToParent.set(cu, c);
  }
}
console.log(`Total distinct child uuids: ${allChildUuids.size}`);

// For each LAYOUT_B char, check if +46 is in this set
let testable = 0, slot46Zero = 0, slot46InChildSet = 0, slot46NotInChildSet = 0;
const hits = [], misses = [];
for (const c of v1Records) {
  if (c.lastName !== null) continue; // LAYOUT_B only
  if (c.offset < 47) continue;
  testable++;
  const slot46 = buf.readUInt32LE(c.offset + 46);
  if (slot46 === 0 || slot46 === 0xffffffff) { slot46Zero++; continue; }
  if (allChildUuids.has(slot46)) {
    slot46InChildSet++;
    if (hits.length < 10) hits.push({ name: c.firstName, slot46, parent: childToParent.get(slot46) });
  } else {
    slot46NotInChildSet++;
    if (misses.length < 10) misses.push({ name: c.firstName, slot46 });
  }
}
console.log(`\nLAYOUT_B v1 chars: ${testable}`);
console.log(`  +46 = 0 or FF: ${slot46Zero} (unmarried? — expected for many chars)`);
console.log(`  +46 IS in someone's child slot: ${slot46InChildSet}`);
console.log(`  +46 NOT in any child slot: ${slot46NotInChildSet}`);
console.log(`\nRatio of "+46 in child slot" vs total non-zero +46: ${(100 * slot46InChildSet / (slot46InChildSet + slot46NotInChildSet)).toFixed(1)}%`);

console.log("\nHit samples (slot46 IS in someone's child slot — proves spouse linkage):");
for (const h of hits) console.log(`  ${h.name} → slot46=${h.slot46} → child of ${h.parent.firstName}@0x${h.parent.offset.toString(16)}`);
console.log("\nMiss samples (slot46 not in any child slot — could be runtime-married spouse):");
for (const m of misses) console.log(`  ${m.name}: slot46=${m.slot46}`);

// Now: same test for LAYOUT_A using +50
let testableA = 0, slot50Zero = 0, slot50InChildSet = 0, slot50NotInChildSet = 0;
for (const c of v1Records) {
  if (c.lastName === null) continue; // LAYOUT_A only
  if (c.offset < 47) continue;
  testableA++;
  const slot50 = buf.readUInt32LE(c.offset + 50);
  if (slot50 === 0 || slot50 === 0xffffffff) { slot50Zero++; continue; }
  if (allChildUuids.has(slot50)) slot50InChildSet++;
  else slot50NotInChildSet++;
}
console.log(`\nLAYOUT_A v1 chars: ${testableA}`);
console.log(`  +50 = 0 or FF: ${slot50Zero}`);
console.log(`  +50 IS in someone's child slot: ${slot50InChildSet}`);
console.log(`  +50 NOT in any child slot: ${slot50NotInChildSet}`);
