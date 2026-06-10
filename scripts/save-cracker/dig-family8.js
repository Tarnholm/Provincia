#!/usr/bin/env node
// dig-family8.js — Decode the +50..+65 layout.
//
// Findings so far:
//   +44, +45 = padding zeros for most chars; non-zero only when role-class byte
//   +46..+49 = fatherUuid (CONFIRMED u32)
//   +50..+61 = "12-byte birth-seed hash" per session 4, BUT:
//     - For Quintus (family head, 2 sons): +54=Servius, +58=Marcus
//     - For sons (Marcus, Servius): seems random
//   +62..+65 = 4 bytes (might be more child slot or seed)
//   +66..+67 = u16 (always 0?)
//   +68..+71 = u32 0xffff0000 marker (constant?)
//   +72..+75 = u32 0x0000ffff or 0xffff (constant)
//   +76..+79 = u32 (small int, maybe count?)
//
// Test: dump +44..+80 for all 25 LAYOUT_A chars and look for the constant
// markers (+68, +72) — if they're constant, then everything between +50..+67
// is real data.

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
const buf = fs.readFileSync(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav'));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// For each LAYOUT_A char, dump +44..+80 and look for patterns
const layoutA = recs.filter(r => r.lastName);
console.log('Character record +44..+80 byte map (LAYOUT_A only)');
console.log('Hypothesis: +50..+65 is family-link slot array;');
console.log('  Quintus has 2 children -> +54 = elder son uuid, +58 = younger son uuid');
console.log();

// columns: name, +44..+45, +46..+49=fath, +50..+53, +54..+57, +58..+61, +62..+65, +66..+67, +68..+71, +72..+75, +76..+79
console.log('Name | +44-45 | +46 fath | +50 a | +54 b | +58 c | +62 d | +66 e | +68 sent | +72 ? | +76 cnt');
for (const c of layoutA) {
  const o = c.offset;
  const cols = [
    c.firstName + ' ' + c.lastName,
    buf.readUInt16LE(o+44).toString(16).padStart(4,'0'),
    buf.readUInt32LE(o+46).toString(16).padStart(8,'0'),
    buf.readUInt32LE(o+50).toString(16).padStart(8,'0'),
    buf.readUInt32LE(o+54).toString(16).padStart(8,'0'),
    buf.readUInt32LE(o+58).toString(16).padStart(8,'0'),
    buf.readUInt32LE(o+62).toString(16).padStart(8,'0'),
    buf.readUInt16LE(o+66).toString(16).padStart(4,'0'),
    buf.readUInt32LE(o+68).toString(16).padStart(8,'0'),
    buf.readUInt32LE(o+72).toString(16).padStart(8,'0'),
    buf.readUInt32LE(o+76).toString(16).padStart(8,'0'),
  ];
  console.log(cols.join(' | '));
}

// Compare with rome10 for the same chars
console.log('\n=== rome10 ===');
const buf2 = fs.readFileSync(path.join(SAVES, 'save_rome10.sav'));
const recs2 = cp.findCharacterRecords(buf2, nameLookup, traitNames, null);
const byName2 = new Map(); for (const r of recs2) byName2.set(r.firstName + '|' + (r.lastName||''), r);
for (const c of layoutA) {
  const c2 = byName2.get(c.firstName + '|' + c.lastName);
  if (!c2) continue;
  const o = c2.offset;
  const cols = [
    c.firstName + ' ' + c.lastName,
    buf2.readUInt16LE(o+44).toString(16).padStart(4,'0'),
    buf2.readUInt32LE(o+46).toString(16).padStart(8,'0'),
    buf2.readUInt32LE(o+50).toString(16).padStart(8,'0'),
    buf2.readUInt32LE(o+54).toString(16).padStart(8,'0'),
    buf2.readUInt32LE(o+58).toString(16).padStart(8,'0'),
    buf2.readUInt32LE(o+62).toString(16).padStart(8,'0'),
    buf2.readUInt16LE(o+66).toString(16).padStart(4,'0'),
    buf2.readUInt32LE(o+68).toString(16).padStart(8,'0'),
    buf2.readUInt32LE(o+72).toString(16).padStart(8,'0'),
    buf2.readUInt32LE(o+76).toString(16).padStart(8,'0'),
  ];
  console.log(cols.join(' | '));
}

// Count uniqueness of +68, +72 across saves
console.log('\n+68 distinct values across all chars + both saves:');
const v68 = new Set();
for (const c of recs) v68.add(buf.readUInt32LE(c.offset+68));
for (const c of recs2) v68.add(buf2.readUInt32LE(c.offset+68));
console.log([...v68]);

console.log('\n+72 distinct values across all chars + both saves:');
const v72 = new Set();
for (const c of recs) v72.add(buf.readUInt32LE(c.offset+72));
for (const c of recs2) v72.add(buf2.readUInt32LE(c.offset+72));
console.log([...v72]);
