// dig-bloodline-leader-dedupe.js
//
// The v1 parser flags 211 Factionleader + 200 Factionheir records in macedon t0
// — implausible for 23 factions. Investigate WHAT these records are.
// Hypotheses:
//   (a) duplicate records of the same ~23 leaders (name-pool mirrors)
//   (b) the parser misreads the trait list and tid 457 is a coincidence
//   (c) Factionleader trait points encode something — real leaders have high pts
//
// Group leaders by (firstName,lastName,age,primaryUuid) and by Factionleader
// points value. Real leaders should have high, distinct points; pool mirrors
// should be junk.

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const MOD_DIR = "C:\\RIS\\RIS\\data";
const nameLookup = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitDeclOrder = [];
for (const line of fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitDeclOrder.push(tm[1]);
}

const argSave = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(path.join(SAVES, argSave));
console.log(`Save: ${argSave}\n`);

const v1 = findCharacterRecords(buf, nameLookup, traitDeclOrder, null);
const leaders = v1.filter(c => c.isLeader);
const heirs = v1.filter(c => c.isHeir);
console.log(`v1=${v1.length} leaders=${leaders.length} heirs=${heirs.length}\n`);

// Distribution of Factionleader points among "leaders"
function ptsOf(c, traitName) {
  const t = c.traits.find(t => t.name === traitName);
  return t ? t.points : null;
}
const ptsDist = new Map();
for (const c of leaders) {
  const p = ptsOf(c, "Factionleader");
  ptsDist.set(p, (ptsDist.get(p) || 0) + 1);
}
console.log("Factionleader points distribution among leader records:");
for (const [p, n] of [...ptsDist.entries()].sort((a, b) => a[0] - b[0])) console.log(`  pts=${p}: ${n} records`);

// Age distribution of leaders
const ageDist = new Map();
for (const c of leaders) ageDist.set(c.age, (ageDist.get(c.age) || 0) + 1);
console.log("\nAge distribution of leader records:");
for (const [a, n] of [...ageDist.entries()].sort((a, b) => a[0] - b[0])) console.log(`  age=${a}: ${n}`);

// How many leaders have a sane trait count (real chars have several traits)?
const tcDist = new Map();
for (const c of leaders) { const k = c.traits.length; tcDist.set(k, (tcDist.get(k) || 0) + 1); }
console.log("\nTrait-count distribution among leaders:");
for (const [k, n] of [...tcDist.entries()].sort((a, b) => a[0] - b[0])) console.log(`  ${k} traits: ${n}`);

// Names of leaders — count how many distinct names
const names = leaders.map(c => `${c.firstName} ${c.lastName || ""}`.trim());
const nameSet = new Set(names);
console.log(`\nDistinct leader names: ${nameSet.size} / ${leaders.length}`);
console.log("First 30 leader names with age + pts + childCount + region-detectable:");
for (const c of leaders.slice(0, 30)) {
  console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} flPts=${ptsOf(c,"Factionleader")} children=${c.childUuids.length} father=${c.fatherUuid?"Y":"-"} tileX=${c.tileX} tileY=${c.tileY}`);
}

// CRITICAL TEST: does each leader have a tile position? Real live leaders are
// on the map; name-pool mirrors are not.
const withTile = leaders.filter(c => c.tileX != null);
console.log(`\nLeaders with a map tile position: ${withTile.length} / ${leaders.length}`);
for (const c of withTile.slice(0, 40)) {
  console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} (${c.tileX},${c.tileY}) flPts=${ptsOf(c,"Factionleader")} children=${c.childUuids.length}`);
}
