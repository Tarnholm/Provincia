#!/usr/bin/env node
// dig-family6.js — check whether +54 and +58 are ALWAYS child uuid slots
// (with sentinel values when no child exists) OR a birth-seed hash that
// just happens to match for the family-head case.
//
// Test: in saves where Quintus has 2 sons (T1, rome10) — does Quintus's +54
// always match the OLDEST son and +58 match the YOUNGER? Across game
// sessions, the uuids change but the relative slot stability should hold.

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
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
const corpus = [
  ['Rome T1', path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav')],
  ['rome10', path.join(SAVES, 'save_rome10.sav')],
];

const loaded = corpus.map(([label, p]) => {
  const buf = fs.readFileSync(p);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return { label, buf, recs };
});

// For each save, look at family clusters
for (const { label, buf, recs } of loaded) {
  console.log(`\n=== ${label}: comprehensive family analysis ===`);
  const layoutA = recs.filter(r => r.lastName);

  // Map name -> rec
  const byName = new Map();
  for (const r of layoutA) byName.set(r.firstName + '|' + r.lastName, r);

  // Group by lastName
  const families = new Map();
  for (const r of layoutA) {
    if (!families.has(r.lastName)) families.set(r.lastName, []);
    families.get(r.lastName).push(r);
  }

  for (const [fname, members] of families) {
    if (members.length < 2) continue;
    console.log(`\n[Family: ${fname}]`);
    for (const m of members) {
      console.log(`  ${m.firstName} ${m.lastName} (uuid=${m.primaryUuid}, age=${m.age}, father=${m.fatherUuid || '-'})`);
      // Dump +44..+72 u32 slots
      const slots = [];
      for (let i = 44; i <= 72; i += 4) {
        const v = buf.readUInt32LE(m.offset + i);
        let note = '';
        if (v === 0) note = '0';
        else if (v === 0xffffffff) note = 'FFFF';
        else {
          // check against all char uuids
          for (const r of recs) if (r.primaryUuid === v) {
            note = `${r.firstName} ${r.lastName||''}`;
            if (r.fatherUuid === m.primaryUuid) note += '[CHILD]';
            if (r.primaryUuid === m.fatherUuid) note += '[FATHER]';
            break;
          }
          if (!note) note = `?u32=${v}`;
        }
        slots.push(`+${i}:${note}`);
      }
      console.log(`    ` + slots.join('  '));
    }
  }
}

// Quintus comparison across saves
console.log('\n=== Quintus T1 vs rome10 — child slot mapping ===');
for (const { label, buf, recs } of loaded) {
  const q = recs.find(r => r.firstName === 'Quintus' && r.lastName === 'Ogulnius_Gallus');
  if (!q) continue;
  const marcus = recs.find(r => r.firstName === 'Marcus' && r.lastName === 'Ogulnius_Gallus');
  const servius = recs.find(r => r.firstName === 'Servius' && r.lastName === 'Ogulnius_Gallus');
  const q54 = buf.readUInt32LE(q.offset + 54);
  const q58 = buf.readUInt32LE(q.offset + 58);
  console.log(`${label}: Quintus +54=${q54} (${q54===servius.primaryUuid?'SERVIUS':q54===marcus.primaryUuid?'MARCUS':'?'}); +58=${q58} (${q58===servius.primaryUuid?'SERVIUS':q58===marcus.primaryUuid?'MARCUS':'?'})`);
  console.log(`  Marcus uuid=${marcus.primaryUuid}, age=${marcus.age}`);
  console.log(`  Servius uuid=${servius.primaryUuid}, age=${servius.age}`);
}
