// dig-chartail5.js — Marcus Livius_Drusus byte-by-byte +0..+302 across all
// rome saves PLUS expand to ALL bytes that change for Marcus, classifying each.
// We have established +286 (turn counter +5). What other state did Marcus
// store? He captured Uria/Brundisium, gained 13 traits, gained Messapivs
// epithet between rome6 and rome7.

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

const ROMES = ["save_rome1.sav", "save_rome2.sav", "save_rome3.sav", "save_rome4.sav",
  "save_rome5..sav", "save_rome6.sav", "save_rome7.sav", "save_rome8.sav", "save_rome9.sav"];
const bufs = ROMES.map(f => fs.readFileSync(path.join(SAVES, f)));
const allRecs = bufs.map(buf => cp.findCharacterRecords(buf, nameLookup, traitNames, null));

// Find Marcus
let muuid = null;
for (const r of allRecs[0]) {
  if (r.firstName === "Marcus" && r.lastName === "Livius_Drusus") muuid = `${r.primaryUuid}`;
}

const mslots = ROMES.map((_, i) => {
  for (const r of allRecs[i]) if (`${r.primaryUuid}` === muuid) return r;
  return null;
});

console.log("# Marcus Livius_Drusus across rome1..rome9");
for (let i = 0; i < 9; i++) {
  const r = mslots[i];
  if (!r) { console.log(`  ${ROMES[i]}: NOT FOUND`); continue; }
  console.log(`  ${ROMES[i]}: off=0x${r.offset.toString(16)}  age=${r.age}  traits=${r.traits.length}  ancillaries=${r.ancillaries.length}`);
}

// ALL bytes in -48..+302 that change anywhere across the 9 saves
console.log(`\n## ALL changing relative offsets in -48..+310 for Marcus`);
for (let rel = -48; rel <= 310; rel++) {
  const vals = mslots.map(r => bufs[mslots.indexOf(r)].readUInt8(r.offset + rel)); // wrong: use i
  // do it properly
  const v = [];
  for (let i = 0; i < 9; i++) v.push(bufs[i].readUInt8(mslots[i].offset + rel));
  const uniq = new Set(v);
  if (uniq.size > 1) {
    console.log(`  +${rel.toString().padStart(4)}: [${v.join(",")}]  uniq=${uniq.size}`);
  }
}

// Show Marcus's lastName index in rome1 vs rome7+ (Messapivs epithet)
console.log(`\n## Marcus lastName index transition`);
for (let i = 0; i < 9; i++) {
  const r = mslots[i];
  const lastIdx = bufs[i].readUInt32LE(r.offset + 5);
  console.log(`  ${ROMES[i]}: lastIdx=${lastIdx}  name=${nameLookup[lastIdx]}`);
}

// Trait deep dive — list Marcus's traits in rome1 vs rome7
console.log(`\n## Marcus trait list rome1 vs rome7`);
for (const i of [0, 6, 8]) {
  const r = mslots[i];
  console.log(`\n  ${ROMES[i]}: ${r.traits.length} trait slots, last 4:`);
  r.traits.forEach((t, idx) => {
    if (idx >= r.traits.length - 10) console.log(`    [${idx}] id=${t.id}  name=${t.name}  lvl=${t.level}`);
  });
}
