#!/usr/bin/env node
// dig-family14.js — investigate whether wives have their own character
// records at all, or live in a separate compact "family member" table.
//
// Approach:
//   1) Pick known wives from descr_strat (Baebiana, Alypia, etc).
//   2) For each, find ALL positions in the save where u32 == nameLookup[wife].
//   3) For each hit, dump a 64-byte window and classify the byte pattern.
//   4) See if wife records use the same trait-block / portrait signature.

const fs = require('fs');
const path = require('path');

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const nameToIdx = new Map();
nameLookup.forEach((n, i) => { if (n) nameToIdx.set(n, i); });

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));
console.log(`save_1.2.sav size: ${buf.length}`);

const knownWives = ['Baebiana', 'Alypia', 'Dryantilla', 'Prisca', 'Honoria', 'Mucia', 'Cornelia', 'Marcia', 'Pomponia', 'Matidia', 'Claudia', 'Fulvia', 'Ancharia', 'Plotina', 'Ocellina', 'Sulpicia', 'Porcia', 'Livia', 'Popillia', 'Salonina', 'Domitia', 'Livilla'];

function hex(b, o, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += b[o+i].toString(16).padStart(2,'0') + ' ';
  }
  return s.trim();
}

for (const w of knownWives) {
  const idx = nameToIdx.get(w);
  if (idx == null) { console.log(`${w}: not in nameLookup`); continue; }
  const hits = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === idx) hits.push(i);
  }
  console.log(`\n=== ${w} (idx=${idx}): ${hits.length} u32 hits ===`);
  // Show first 10 hits with surrounding context, focus on hits with non-zero gender byte (female=2)
  let shown = 0;
  for (const pos of hits) {
    const gender = buf[pos+4];
    // We want hits where +4 is a small gender byte (1 or 2)
    if (gender !== 1 && gender !== 2) continue;
    // also skip very low positions (descr_names index area)
    if (pos < 100000) continue;
    if (shown >= 5) break;
    shown++;
    const before = pos >= 8 ? hex(buf, pos-8, 8) : 'n/a';
    const after = hex(buf, pos, 40);
    console.log(`  pos=${pos}: [-8:${before}] ${after}  gender=${gender}`);
  }
  if (shown === 0) console.log(`  (no hit with gender byte 1/2 in main file body)`);
}
