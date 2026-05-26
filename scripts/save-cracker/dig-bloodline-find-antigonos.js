// dig-bloodline-find-antigonos.js
//
// Ground truth: the antigonid faction LEADER at T0 in RIS is "AntigonosB"
// (age 50, x393 y391, Leader_Rating 3, Gonatas trait). Find his RECORD(s)
// in save_macedon t0 and report what marks him as leader. Then compare to a
// known NON-leader antigonid general to find the discriminating field.
//
// Two parsers in play:
//   - v1 findCharacterRecords: byte-walk records in the "live character"
//     section (UUID namespace A). Flags isLeader via Factionleader trait.
//   - parseCharacterExtras: role-anchored ("antigonid general\0" etc.),
//     UUID namespace B, exposes region + tile + age.
//
// We hunt for AntigonosB in BOTH and dump everything.

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");
const { parseCharacterExtras } = require("../../src/saveCrackerExtras.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const MOD_DIR = "C:\\RIS\\RIS\\data";
const nameLookup = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitDeclOrder = [];
for (const line of fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitDeclOrder.push(tm[1]);
}

const buf = fs.readFileSync(path.join(SAVES, "save_macedon t0.sav"));

// --- v1: find any char whose firstName == "AntigonosB" ---
const v1 = findCharacterRecords(buf, nameLookup, traitDeclOrder, null);
const antigV1 = v1.filter(c => c.firstName === "AntigonosB");
console.log(`=== v1 records named AntigonosB: ${antigV1.length} ===`);
for (const c of antigV1) {
  console.log(`  @0x${c.offset.toString(16)} age=${c.age} infl=${c.influence} cmd=${c.command} isLeader=${c.isLeader} isHeir=${c.isHeir} children=${c.childUuids.length} primaryUuid=0x${(c.primaryUuid>>>0).toString(16)}`);
  console.log(`    traits: ${c.traits.map(t=>`${t.name}:${t.points}`).join(", ")}`);
}

// --- ext: role-anchored chars at antigonid, age ~50 ---
const ext = parseCharacterExtras(buf);
const antigExt = ext.filter(c => c.culture === "antigonid" && c.age >= 48 && c.age <= 52);
console.log(`\n=== ext (role-anchored) antigonid chars age 48-52: ${antigExt.length} ===`);
for (const c of antigExt) {
  console.log(`  @0x${c.offset.toString(16)} ${c.role} region=${c.region} age=${c.age} ownUuid=0x${(c.ownUuid>>>0).toString(16)} bg=0x${(c.bodyguardUuid>>>0).toString(16)} spouse=0x${(c.spouseUuid>>>0).toString(16)}`);
}

// --- search for the name index of "AntigonosB" raw, with coord x393,y391 ---
const antIdx = nameLookup.indexOf("AntigonosB");
console.log(`\nnameLookup index of AntigonosB = ${antIdx}`);

// --- where do the 211 "leaders" live vs the ext chars? ---
const leaders = v1.filter(c => c.isLeader);
const extOffs = ext.map(c=>c.offset).sort((a,b)=>a-b);
const ldOffs = leaders.map(c=>c.offset).sort((a,b)=>a-b);
console.log(`\next char offset range:    0x${extOffs[0].toString(16)} .. 0x${extOffs[extOffs.length-1].toString(16)}`);
console.log(`v1 leader offset range:   0x${ldOffs[0].toString(16)} .. 0x${ldOffs[ldOffs.length-1].toString(16)}`);
console.log(`v1 ALL offset range:      0x${v1[0].offset.toString(16)} .. 0x${v1[v1.length-1].offset.toString(16)}`);

// Are leaders interleaved with non-leaders, or in a separate block?
const allV1Offs = v1.map(c=>c.offset).sort((a,b)=>a-b);
const ldSet = new Set(ldOffs);
// look at sequence of L/N over first 80 records
let seq = "";
for (const o of allV1Offs.slice(0, 120)) seq += ldSet.has(o) ? "L" : ".";
console.log(`\nfirst 120 v1 records (L=leader): ${seq}`);
