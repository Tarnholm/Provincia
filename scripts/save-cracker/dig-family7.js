#!/usr/bin/env node
// dig-family7.js — clean analysis of family-graph slots
//
// Key fields in character header:
//   +42 (LAYOUT_A) - role byte
//   +43..+45 - padding (some chars have non-zero here = role-wide?)
//   +46..+49 - fatherUuid u32
//   +50..+61 - 12 bytes of "birth-seed hash" per session 4
//     But:
//       +54..+57 = Servius (eldest son of Quintus)
//       +58..+61 = Marcus (younger son of Quintus)
//   +62..+65 - 4 more bytes (maybe child slot 3, or seed)
//
// New hypothesis: +50..+61 is a SLOT ARRAY of 3 u32s, each potentially
// pointing to a related character (children, spouse, sibling), OR each
// being a sentinel (random-looking bytes when slot is unused).
//
// Test: in a save where the family has a different shape (1 son, 3 sons,
// daughter, etc.), examine what's at the slots.

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/RIS/RIS/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

// Look at ALL the calibration saves we have to find diverse family shapes.
// Or: dig the Macedon LAYOUT_B characters for family information.
const ALEX = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";
const buf = fs.readFileSync(path.join(ALEX, 'save_Autosave   Macedon   Turn 97.sav'));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

console.log(`Macedon T97: ${recs.length} chars (${recs.filter(r=>r.lastName).length} LAYOUT_A, ${recs.filter(r=>!r.lastName).length} LAYOUT_B)`);

// Build father -> children map
const childrenOf = new Map();
for (const r of recs) {
  if (r.fatherUuid && r.fatherUuid !== 0xffffffff) {
    if (!childrenOf.has(r.fatherUuid)) childrenOf.set(r.fatherUuid, []);
    childrenOf.get(r.fatherUuid).push(r);
  }
}
// Map uuid -> rec
const byUuid = new Map();
for (const r of recs) byUuid.set(r.primaryUuid, r);

// For LAYOUT_B: father slot at +42, so child slots might be at +50..+61 or similar shifted
console.log('\n=== Families with parent in save (LAYOUT_A or LAYOUT_B parent) ===');
for (const [fid, kids] of childrenOf) {
  const parent = byUuid.get(fid);
  if (!parent) {
    console.log(`Father uuid=${fid} NOT in save (${kids.length} children: ${kids.map(k=>k.firstName).join(', ')})`);
    continue;
  }
  const parentLayout = parent.lastName ? 'A' : 'B';
  console.log(`\nParent: ${parent.firstName} ${parent.lastName || ''} (LAYOUT_${parentLayout}, uuid=${parent.primaryUuid}, age=${parent.age}, gender=${parent.gender}) - ${kids.length} children`);
  // Look at parent's bytes +42..+72 for each kid's uuid
  for (const kid of kids) {
    let foundAt = [];
    for (let i = 0; i + 4 <= 200; i++) {
      if (buf.readUInt32LE(parent.offset + i) === kid.primaryUuid) foundAt.push(i);
    }
    const kidLayout = kid.lastName ? 'A' : 'B';
    console.log(`  child ${kid.firstName} ${kid.lastName || ''} (LAYOUT_${kidLayout}, uuid=${kid.primaryUuid}, age=${kid.age}): in parent record at +${foundAt.join(', +') || 'NOT FOUND'}`);
  }
}
