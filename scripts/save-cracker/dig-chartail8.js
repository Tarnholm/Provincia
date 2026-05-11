// dig-chartail8.js — broader survey of the +18..+25 family-link zone and
// also examine the +126 per-turn ticker (1 vs 9 deltas).
//
// Two specific questions:
//   1) Across ALL LAYOUT_A characters in rome6, what values does +18 u32 hold?
//      If +18 is a family-link / adopted-into-family pointer, most LAYOUT_A
//      chars (Roman, has family lastname) should have a REAL u32 here (not
//      0xffffffff) since they belong to known families.
//   2) +126 — what does the increment correlate with? Turn count?

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
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

const buf = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// +18 u32 distribution among LAYOUT_A
const aChars = recs.filter(r => r.lastName);
console.log(`# ${aChars.length} LAYOUT_A chars in save_rome6`);

const u32_18 = new Map();
for (const r of aChars) {
  const v = buf.readUInt32LE(r.offset + 18);
  u32_18.set(v, (u32_18.get(v) || 0) + 1);
}
console.log(`\n## +18 u32 distribution (top 10)`);
for (const [v, cnt] of [...u32_18.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  const lab = v === 0xffffffff ? "0xff_sentinel"
    : v < nameLookup.length ? `${v} (${nameLookup[v]})`
    : `${v} (out of range)`;
  console.log(`  ${lab.padEnd(40)} ${cnt}x`);
}

// What about +22 u32?
const u32_22 = new Map();
for (const r of aChars) {
  const v = buf.readUInt32LE(r.offset + 22);
  u32_22.set(v, (u32_22.get(v) || 0) + 1);
}
console.log(`\n## +22 u32 distribution (top 10)`);
for (const [v, cnt] of [...u32_22.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${(v === 0xffffffff ? "0xff_sentinel" : v).toString().padEnd(40)} ${cnt}x`);
}

// Show samples where +18 != 0xff
console.log(`\n## LAYOUT_A chars with +18 != 0xff (samples)`);
let samples = 0;
for (const r of aChars) {
  const v18 = buf.readUInt32LE(r.offset + 18);
  if (v18 === 0xffffffff) continue;
  if (samples++ > 15) break;
  const v22 = buf.readUInt32LE(r.offset + 22);
  console.log(`  ${r.firstName} ${r.lastName}  +18: ${v18} (${nameLookup[v18] || "?"})  +22: ${v22}  age: ${r.age}  role: ${r.role}`);
}

// Now session 4 said: "+18 u32 0xffffffff sentinel (variable family link) STRONG"
// Let's see: every LAYOUT_A char with a real value at +18 — is the value pointing
// to that character's father's lastName or grandfather's lastName?
//
// Marcus rome7: +18 = 1102 (Cornelius_Scapula)  +22 = 2
// fatherUuid is at +46 — let me cross-reference.

// Also: +106 distribution across many chars to figure out semantics
console.log(`\n## +106 u8 distribution among LAYOUT_A (save_rome6)`);
const v106 = new Map();
for (const r of aChars) {
  const v = buf.readUInt8(r.offset + 106);
  v106.set(v, (v106.get(v) || 0) + 1);
}
for (const [k, c] of [...v106.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k.toString().padStart(4)}: ${c}x`);
}

// +126 distribution
console.log(`\n## +126 u8 distribution among LAYOUT_A (save_rome6)`);
const v126 = new Map();
for (const r of aChars) {
  const v = buf.readUInt8(r.offset + 126);
  v126.set(v, (v126.get(v) || 0) + 1);
}
for (const [k, c] of [...v126.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k.toString().padStart(4)}: ${c}x`);
}

// What is the role of chars with +106 or +126 high values? Are they leaders?
console.log(`\n## High +126 chars (>10) in save_rome6`);
for (const r of aChars) {
  const v = buf.readUInt8(r.offset + 126);
  if (v > 8) {
    const isLeader = r.traits.some(t => t.name === "Factionleader");
    const isHeir = r.traits.some(t => t.name === "Factionheir");
    console.log(`  ${r.firstName} ${r.lastName}  +126=${v}  +106=${buf.readUInt8(r.offset+106)}  age=${r.age}  isLeader=${isLeader} isHeir=${isHeir}`);
  }
}
