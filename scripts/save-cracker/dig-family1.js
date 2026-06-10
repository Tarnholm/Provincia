#!/usr/bin/env node
// dig-family1.js — explore family tree relationships in character records.
//
// Known fields:
//   +46 u32 fatherUuid (LAYOUT_A)
//   +42 u32 fatherUuid (LAYOUT_B)
//
// Goal: locate spouse uuid, child uuid(s), mother uuid (?). RTW lets you click
// through marriage/birth events on the family tree screen, so the engine MUST
// persist these graph edges.
//
// Approach:
//   1. Find all LAYOUT_A characters in a save (Roman family). They have
//      surnames so families are visually grouped.
//   2. Group by lastName + look at which characters share lastName ("Cornelius",
//      "Iulius", etc.) — those are family.
//   3. For each character, dump the +50..+97 region (currently mostly mapped
//      to "birth seed hash" and "death cause") and look for u32 values that
//      MATCH another character's primaryUuid in the SAME family.

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

function loadSave(savePath) {
  const buf = fs.readFileSync(savePath);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return { buf, recs, path: savePath };
}

function analyzeFamily(save) {
  const { buf, recs, path: spath } = save;
  console.log(`\n=== ${spath.split(/[\\\/]/).pop()} ===`);
  console.log(`Chars: ${recs.length} (${recs.filter(r=>r.lastName).length} LAYOUT_A)`);
  // Build a uuid -> character map
  const byUuid = new Map();
  for (const r of recs) byUuid.set(r.primaryUuid, r);
  // Group LAYOUT_A by lastName
  const families = new Map();
  for (const r of recs.filter(r => r.lastName)) {
    if (!families.has(r.lastName)) families.set(r.lastName, []);
    families.get(r.lastName).push(r);
  }
  // For each family (with >=2 members), look at +50..+97 and find u32s matching another family member's uuid
  for (const [fname, members] of families) {
    if (members.length < 2) continue;
    console.log(`\n  Family ${fname}: ${members.length} members`);
    const memberUuids = new Set(members.map(m => m.primaryUuid));
    for (const m of members) {
      console.log(`    ${m.firstName} ${m.lastName} (uuid=${m.primaryUuid}, gender=${m.gender}, age=${m.age}, father=${m.fatherUuid})`);
      // Dump +50..+97 scanning for u32 matches against family
      const off = m.offset;
      for (let i = 0; i + 4 <= 300; i++) {
        const v = buf.readUInt32LE(off + i);
        if (memberUuids.has(v) && v !== m.primaryUuid && v !== m.fatherUuid) {
          console.log(`      +${i}: u32=${v} matches family member ${byUuid.get(v).firstName} ${byUuid.get(v).lastName}`);
        }
      }
    }
  }
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const ALEX = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";

// Rome saves have many Roman LAYOUT_A characters — best chance for family detection
analyzeFamily(loadSave(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav')));
analyzeFamily(loadSave(path.join(SAVES, 'save_rome10.sav')));
// Alexander corpus has some LAYOUT_A too
analyzeFamily(loadSave(path.join(ALEX, 'save_saveturn1start.sav')));
