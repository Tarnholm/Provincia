#!/usr/bin/env node
// dig-family9.js — Rigorous child-slot verification.
//
// CLAIM: For LAYOUT_A characters with N children, the slots at +54, +58
// (and possibly +62) contain those children's primaryUuids, in age-descending
// order. Population is N slots populated for N children.
//
// TESTS:
//   1. For every parent in Rome T1 and rome10, verify children appear at
//      EXACTLY +54, +58, +62 (and not at other offsets).
//   2. Cross-check across the calibration corpus (Macedon late-game saves).
//   3. Count of TRUE positives vs FALSE positives.

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

function load(p) {
  const buf = fs.readFileSync(p);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return { buf, recs, path: p };
}

function check(save) {
  const { buf, recs, path: spath } = save;
  const byUuid = new Map();
  for (const r of recs) byUuid.set(r.primaryUuid, r);
  // Build father -> children
  const childrenOf = new Map();
  for (const r of recs) {
    if (r.fatherUuid && r.fatherUuid !== 0xffffffff && r.fatherUuid !== 0) {
      if (!childrenOf.has(r.fatherUuid)) childrenOf.set(r.fatherUuid, []);
      childrenOf.get(r.fatherUuid).push(r);
    }
  }
  console.log(`\n=== ${spath.split(/[\\\/]/).pop()} ===`);
  console.log(`Total chars: ${recs.length}, with fatherUuid set: ${[...childrenOf.values()].reduce((s,a)=>s+a.length,0)}`);
  let inSave = 0, found = 0, notFound = 0;
  const positions = new Map();
  for (const [fid, kids] of childrenOf) {
    const parent = byUuid.get(fid);
    if (!parent) continue;
    inSave += kids.length;
    // For each kid, find its uuid in parent's record +0..+200
    for (const kid of kids) {
      let foundAt = [];
      for (let i = 0; i + 4 <= 200; i++) {
        if (buf.readUInt32LE(parent.offset + i) === kid.primaryUuid) foundAt.push(i);
      }
      if (foundAt.length > 0) {
        found++;
        for (const p of foundAt) positions.set(p, (positions.get(p)||0)+1);
      } else {
        notFound++;
      }
    }
  }
  console.log(`Children with parent in save: ${inSave}; found in parent's record: ${found}; not found: ${notFound}`);
  console.log(`Found at offsets (count): ${[...positions.entries()].sort((a,b) => a[0]-b[0]).map(([o,c]) => `+${o}:${c}`).join(', ')}`);
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const ALEX = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";
const CAL = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";

check(load(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav')));
check(load(path.join(SAVES, 'save_rome10.sav')));
check(load(path.join(ALEX, 'save_Autosave   Macedon   Turn 97.sav')));
check(load(path.join(ALEX, 'save_Autosave   Macedon   Turn 98 End.sav')));
check(load(path.join(ALEX, 'save_Autosave   Macedon   Turn 99 Start.sav')));
check(load(path.join(CAL, '0004_save_Autosave   Macedon   Turn 7 End.sav')));
check(load(path.join(CAL, '0005_save_Autosave   Macedon   Turn 8 Start.sav')));
check(load(path.join(ALEX, 'save_saveturn1construction.sav')));
check(load(path.join(ALEX, 'save_saveturn2start.sav')));
check(load(path.join(ALEX, 'save_damagedturn1.sav')));
