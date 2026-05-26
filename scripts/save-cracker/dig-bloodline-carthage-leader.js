// dig-bloodline-carthage-leader.js
//
// GROUND TRUTH (descr_strat imperial_campaign carthage block):
//   Leader = Hannibal (age 25 @ T0, x257 y333)
//   Heir   = HannoC   (age 16 @ T0, x260 y318)
// Player faction in the save_t0..t7 series = carthage.
//
// Confirm leader/heir via traits 457(Factionleader)/458(Factionheir), then
// dump their family-edge fields so we can track them across the adoption diff.
//
// Pure read; reports only.

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");
const { parseFactionTreasuries, identifyFactionRecordOwners } = require("../../src/saveCrackerExtras.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const MOD_DIR = "C:\\RIS\\RIS\\data";
const nameLookup = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitDeclOrder = [];
for (const line of fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitDeclOrder.push(tm[1]);
}

const argSave = process.argv[2] || "save_t0.sav";
const buf = fs.readFileSync(path.join(SAVES, argSave));
console.log(`Save: ${argSave}\n`);

const v1 = findCharacterRecords(buf, nameLookup, traitDeclOrder, null);

function hex(n){ return "0x"+((n>>>0).toString(16)); }
function dumpChar(c, label){
  const fl = c.traits.find(t=>t.name==="Factionleader");
  const fh = c.traits.find(t=>t.name==="Factionheir");
  console.log(`${label}: ${c.firstName} ${c.lastName||""} @${hex(c.offset)}`);
  console.log(`   age=${c.age} infl=${c.influence} cmd=${c.command} tile=(${c.tileX},${c.tileY}) dead=${c.isDead}`);
  console.log(`   primaryUuid=${hex(c.primaryUuid)} secondaryUuid=${hex(c.secondaryUuid)}`);
  console.log(`   fatherUuid=${c.fatherUuid?hex(c.fatherUuid):"-"} spouseUuid=${c.spouseUuid?hex(c.spouseUuid):"-"} children=[${c.childUuids.map(hex).join(",")}]`);
  console.log(`   isLeader(457)=${c.isLeader}${fl?` pts=${fl.points}`:""}  isHeir(458)=${c.isHeir}${fh?` pts=${fh.points}`:""}`);
  console.log(`   traits: ${c.traits.map(t=>`${t.name}:${t.points}`).join(", ")}`);
}

// Find Hannibal (leader) and HannoC (heir) — match on name + tile-on-map.
const hannibals = v1.filter(c => c.firstName === "Hannibal");
const hannocs   = v1.filter(c => c.firstName === "HannoC");
console.log(`Records named Hannibal: ${hannibals.length}, HannoC: ${hannocs.length}\n`);

// The real leader/heir are the ones flagged isLeader/isHeir with a real tile.
console.log("=== Hannibal candidates ===");
for (const c of hannibals) dumpChar(c, "  cand");
console.log("\n=== HannoC candidates ===");
for (const c of hannocs) dumpChar(c, "  cand");

// All isLeader records WITH a map tile (real on-map leaders, filters name-pool)
const realLeaders = v1.filter(c => c.isLeader && c.tileX != null);
const realHeirs   = v1.filter(c => c.isHeir && c.tileX != null);
console.log(`\n=== On-map isLeader records: ${realLeaders.length} (of ${v1.filter(c=>c.isLeader).length} total) ===`);
for (const c of realLeaders) console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} (${c.tileX},${c.tileY}) flPts=${c.traits.find(t=>t.name==="Factionleader").points} children=${c.childUuids.length}`);
console.log(`\n=== On-map isHeir records: ${realHeirs.length} ===`);
for (const c of realHeirs) console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} (${c.tileX},${c.tileY}) fhPts=${c.traits.find(t=>t.name==="Factionheir").points}`);
