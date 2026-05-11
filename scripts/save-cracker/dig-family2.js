#!/usr/bin/env node
// dig-family2.js — pin down child/spouse slots in character records.
//
// Initial finding from dig-family1.js: Quintus Ogulnius_Gallus has children's
// uuids at +54 (Servius) and +58 (Marcus). The +50..+97 range was previously
// labeled "birth-seed hash" by session 4 but actually carries family-graph
// pointers.
//
// This script:
//   1. For EVERY LAYOUT_A character, dump +50..+90 byte-by-byte to see
//      patterns of u32 family-uuid references.
//   2. For each character with a non-null fatherUuid, check WHICH offset
//      in the father's record holds THIS character's uuid (proving child
//      slot mechanism is bidirectional).
//   3. Look for spouse uuid — would appear in BOTH partners' records at the
//      same offset.

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

function loadSave(savePath) {
  const buf = fs.readFileSync(savePath);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return { buf, recs, path: savePath };
}

function dumpFamilyBytes(save, layoutLetter) {
  const { buf, recs } = save;
  const layoutA = recs.filter(r => layoutLetter === 'A' ? r.lastName : !r.lastName);
  console.log(`\n=== ${save.path.split(/[\\\/]/).pop()} (LAYOUT_${layoutLetter}: ${layoutA.length}) ===`);
  // Build map: uuid -> rec
  const byUuid = new Map();
  for (const r of recs) byUuid.set(r.primaryUuid, r);

  // For each LAYOUT_A char, find all u32 values in +50..+90 that match ANY character's uuid
  console.log('\n--- u32 cross-references (any offset 0..150, any other char uuid) ---');
  for (const r of layoutA) {
    const refs = [];
    for (let i = 0; i + 4 <= 200; i++) {
      const v = buf.readUInt32LE(r.offset + i);
      if (v === 0 || v === 0xffffffff) continue;
      if (v === r.primaryUuid) continue;
      const target = byUuid.get(v);
      if (target) {
        refs.push({ rel: i, target, val: v });
      }
    }
    if (refs.length > 0) {
      console.log(`\n  ${r.firstName} ${r.lastName || ''} (uuid=${r.primaryUuid}, age=${r.age}, gender=${r.gender}, father=${r.fatherUuid || '-'}):`);
      for (const x of refs) {
        const tag = x.target.primaryUuid === r.fatherUuid ? 'FATHER ' :
                    (x.target.fatherUuid === r.primaryUuid ? 'CHILD ' : '');
        console.log(`    +${x.rel}: u32=${x.val} -> ${tag}${x.target.firstName} ${x.target.lastName || ''} (gender=${x.target.gender}, age=${x.target.age})`);
      }
    }
  }
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const ALEX = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";

dumpFamilyBytes(loadSave(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav')), 'A');
