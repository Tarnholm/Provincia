#!/usr/bin/env node
// dig-family10.js — Determine the EXACT slot assignment rule for children.
//
// Question: which child goes in +50? +54? +58? +62?
// Hypotheses:
//   A) By age: eldest at +50, then +54, ...
//   B) By birth-order: first-born at +50 regardless of survival
//   C) By gender: sons first, then daughters
//   D) Alphabetical by firstName
// Test: enumerate parents with 2+ children and check which child is at +50.

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
const buf = fs.readFileSync(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav'));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const byUuid = new Map();
for (const r of recs) byUuid.set(r.primaryUuid, r);

// father -> children
const childrenOf = new Map();
for (const r of recs) {
  if (r.fatherUuid && r.fatherUuid !== 0xffffffff && r.fatherUuid !== 0) {
    if (!childrenOf.has(r.fatherUuid)) childrenOf.set(r.fatherUuid, []);
    childrenOf.get(r.fatherUuid).push(r);
  }
}

console.log('=== Parents with 2+ children in save: assignment of children to slots ===');
for (const [fid, kids] of childrenOf) {
  if (kids.length < 2) continue;
  const parent = byUuid.get(fid);
  if (!parent) continue;
  // Sort kids by age desc, then firstName
  const sortedByAge = [...kids].sort((a, b) => b.age - a.age);
  // For each slot at +50, +54, +58, +62, find which kid is there
  const slots = {};
  for (const off of [50, 54, 58, 62, 66, 70, 74, 78]) {
    const v = buf.readUInt32LE(parent.offset + off);
    const k = kids.find(kk => kk.primaryUuid === v);
    slots[off] = k ? k.firstName + ' (age=' + k.age + ', g=' + k.gender + ')' : (v === 0 ? '0' : `?u32=${v}`);
  }
  console.log(`Parent ${parent.firstName} ${parent.lastName || ''} (uuid=${fid}, age=${parent.age}, kids by age desc: ${sortedByAge.map(k => k.firstName + '(' + k.age + ',g' + k.gender + ')').join(', ')})`);
  for (const off of [50, 54, 58, 62, 66]) console.log(`  +${off}: ${slots[off]}`);
}
