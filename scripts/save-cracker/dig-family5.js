#!/usr/bin/env node
// dig-family5.js — distinguish "birth-seed hash" vs "child uuid"
//
// Observation: +50..+65 is 16 bytes. For Quintus (has 2 children), +54 and +58
// matched his children's uuids. BUT every LAYOUT_A character has non-zero
// values at +50/+54/+58/+62 — including bachelor 20-year-olds.
//
// HYPOTHESIS A: These are runtime char-state seeds, NOT pointers — the
// coincidence with Servius/Marcus uuids is just because the engine USES the
// same seed-derived value for the child uuid generation.
//
// HYPOTHESIS B: +54 and +58 ARE child-uuid pointers (real edges), but the
// engine zero-fills only when the slot is fully unused. The unused slots
// carry GARBAGE bytes — they're just untouched.
//
// Test: in rome10, are Quintus's +54..+57 bytes IDENTICAL to T1 (would imply
// "seed hash") or DIFFERENT (would imply "uuid pointer that changes between
// game sessions")?

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

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf1 = fs.readFileSync(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav'));
const buf2 = fs.readFileSync(path.join(SAVES, 'save_rome10.sav'));
const recs1 = cp.findCharacterRecords(buf1, nameLookup, traitNames, null);
const recs2 = cp.findCharacterRecords(buf2, nameLookup, traitNames, null);

// Match by (firstName, lastName)
const byName2 = new Map();
for (const r of recs2) byName2.set(r.firstName + '|' + (r.lastName||''), r);

// Track each LAYOUT_A char's +44..+70 bytes across the two saves
const layoutA1 = recs1.filter(r => r.lastName);
console.log(`=== Comparing ${layoutA1.length} LAYOUT_A chars across T1 and rome10 ===\n`);

for (const r1 of layoutA1) {
  const r2 = byName2.get(r1.firstName + '|' + r1.lastName);
  if (!r2) { console.log(r1.firstName + ' ' + r1.lastName + ': NOT FOUND in rome10'); continue; }
  // Compare +44..+70 byte-by-byte
  let identical = [];
  let differs = [];
  for (let i = 44; i < 70; i++) {
    const same = buf1[r1.offset + i] === buf2[r2.offset + i];
    (same ? identical : differs).push(i);
  }
  const hasKids = recs1.some(r => r.fatherUuid === r1.primaryUuid);
  console.log(`${r1.firstName} ${r1.lastName} (hasKidsInSave=${hasKids}):`);
  console.log(`  +44..+69 differs at: ${differs.map(d => `+${d}`).join(',')}`);
  // Dump the actual values
  let line1 = '  T1: ';
  let line2 = '  R10:';
  for (let i = 44; i < 70; i++) {
    line1 += buf1[r1.offset + i].toString(16).padStart(2,'0') + ' ';
    line2 += buf2[r2.offset + i].toString(16).padStart(2,'0') + ' ';
  }
  console.log(line1);
  console.log(line2);
}
