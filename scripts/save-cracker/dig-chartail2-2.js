#!/usr/bin/env node
// dig-chartail2-2.js — exhaustive Rome T1 vs rome10 character tail diff.
//
// Cross-save comparison: T1 and rome10 are DIFFERENT game-session snapshots
// of (approximately) the same in-game state. Match characters by name pair
// and look at which bytes differ. Bytes that are GAME STATE should match;
// bytes that are RUNTIME pointers / per-session hashes should differ.

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
const bufA = fs.readFileSync(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav'));
const bufB = fs.readFileSync(path.join(SAVES, 'save_rome10.sav'));
const recsA = cp.findCharacterRecords(bufA, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(bufB, nameLookup, traitNames, null);

console.log(`T1: ${recsA.length} chars; rome10: ${recsB.length} chars`);

const byNameB = new Map();
for (const r of recsB) byNameB.set(r.firstName + '|' + (r.lastName||''), r);

// For each char, diff byte-by-byte in +0..+302 (LAYOUT_A) or +0..+298 (LAYOUT_B)
// Count how many bytes differ at each relative offset across the whole population
const diffCountByOffset = new Map(); // rel -> count
const stableCount = new Map(); // rel -> count of matched chars
let matched = 0;
for (const rA of recsA) {
  const rB = byNameB.get(rA.firstName + '|' + (rA.lastName||''));
  if (!rB) continue;
  matched++;
  const hi = rA.lastName ? 302 : 298;
  for (let i = 0; i < hi; i++) {
    stableCount.set(i, (stableCount.get(i)||0)+1);
    if (bufA[rA.offset + i] !== bufB[rB.offset + i]) {
      diffCountByOffset.set(i, (diffCountByOffset.get(i)||0)+1);
    }
  }
}

console.log(`Matched ${matched} chars by name. Each char compared byte-by-byte +0..+301.`);
console.log('\nOffsets where >50% of chars differ between T1 and rome10:');
const sorted = [...diffCountByOffset.entries()].sort((a, b) => a[0]-b[0]);
for (const [off, count] of sorted) {
  const pct = (count / matched * 100).toFixed(1);
  if (count >= matched/2) console.log(`  +${off.toString().padStart(3)}: ${count}/${matched} (${pct}%) differ`);
}

console.log('\nOffsets where 10-50% of chars differ:');
for (const [off, count] of sorted) {
  const pct = (count / matched * 100).toFixed(1);
  if (count >= matched/10 && count < matched/2) console.log(`  +${off.toString().padStart(3)}: ${count}/${matched} (${pct}%) differ`);
}

console.log('\nOffsets in +200..+301 that differ for ANY char:');
for (const [off, count] of sorted) {
  if (off < 200 || off > 301) continue;
  console.log(`  +${off}: ${count}/${matched} differ`);
}

// Focus: which bytes in +44..+80 always differ vs game state?
console.log('\n+40..+90 byte stability:');
for (let i = 40; i <= 90; i++) {
  const c = diffCountByOffset.get(i) || 0;
  const note = c === matched ? 'ALWAYS' : c === 0 ? '         stable' : `${c}/${matched}`;
  console.log(`  +${i}: ${note}`);
}
