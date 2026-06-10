#!/usr/bin/env node
// dig-family4.js — investigate the +50..+62 region.
//
// Quintus has +50..+53 = some non-zero data; +54..+57 = Servius (son);
// +58..+61 = Marcus (son); +62..+65 = more data; +66..+67 = bytes;
// +68..+71 = ff sentinel; +76..+79 = u32 (might be child count = 2)
//
// Hypothesis: +50..+73 is a child-uuid array of up to 6 slots
// (4-byte each), or +50..+65 is a 4-slot child uuid array + 2 spare slots,
// OR +50..+53 is a SPOUSE uuid slot.
//
// Test: look at saves with marriages, check whether the +50 value matches
// a LAYOUT_A FEMALE character's uuid.

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
const byUuid = new Map();
for (const r of recs) byUuid.set(r.primaryUuid, r);

// For EVERY LAYOUT_A character (including females), check what's at +50, +54, +58, +62,
// AND whether those values match other characters' uuids
const layoutA = recs.filter(r => r.lastName);
console.log(`${layoutA.length} LAYOUT_A characters`);

// First — enumerate ALL females. The parser says gender 1=M, 2=F (per session 4)
// Actually let me verify with the data
const genderCounts = new Map();
for (const r of recs) genderCounts.set(r.gender, (genderCounts.get(r.gender)||0)+1);
console.log('Gender counts:', Object.fromEntries(genderCounts));
console.log('Females (gender=2):', recs.filter(r => r.gender === 2).map(r => r.firstName + ' ' + (r.lastName||'')).slice(0, 30));

// Check the female characters' fatherUuid - they should have one if they're in a family
console.log('\n=== ALL females ===');
for (const f of recs.filter(r => r.gender === 2)) {
  console.log(`  ${f.firstName} ${f.lastName||''} uuid=${f.primaryUuid}, father=${f.fatherUuid||'-'}, offset=0x${f.offset.toString(16)}, layoutB=${!f.lastName}`);
}

// For Quintus, check +50..+72 in detail
const quintus = recs.find(r => r.firstName === 'Quintus' && r.lastName === 'Ogulnius_Gallus');
if (quintus) {
  console.log('\n=== Quintus +44..+75 byte dump ===');
  for (let i = 44; i < 76; i++) {
    console.log(`  +${i}: 0x${buf[quintus.offset + i].toString(16).padStart(2,'0')}`);
  }
  console.log('\n=== Quintus u32 at various offsets ===');
  for (const off of [44, 48, 50, 52, 54, 58, 62, 66, 68, 70, 72]) {
    const v = buf.readUInt32LE(quintus.offset + off);
    let note = '';
    const m = byUuid.get(v);
    if (m) note = `-> ${m.firstName} ${m.lastName||''} (g=${m.gender}, age=${m.age})`;
    console.log(`  +${off}: u32=${v} ${note}`);
  }
}

// For EVERY LAYOUT_A char, list what's at +50..+62 and decode any u32 values
console.log('\n=== +50..+62 u32 walk per LAYOUT_A char ===');
for (const c of layoutA) {
  const slots = [];
  for (let i = 50; i <= 62; i += 4) {
    const v = buf.readUInt32LE(c.offset + i);
    if (v === 0 || v === 0xffffffff) slots.push(`+${i}:${v===0?'0':'F'}`);
    else {
      const m = byUuid.get(v);
      slots.push(`+${i}:${v}${m?` (${m.firstName})`:''}`);
    }
  }
  console.log(`  ${c.firstName} ${c.lastName}: ${slots.join(' | ')}`);
}
