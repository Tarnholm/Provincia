#!/usr/bin/env node
// dig-family3.js — verify and characterize the child-slot field.
//
// From dig-family2: Quintus Ogulnius_Gallus has TWO children referenced at
// +54 and +58. Let me:
//   1. Verify this pattern across both Rome saves (T1 and rome10).
//   2. Dump bytes Quintus +0..+100 in both saves and look at the
//      structure around +50..+62 (might be [count][uuid_list] or
//      [uuid_slot_0][uuid_slot_1]...).
//   3. Check for spouse slot — what u32 in Quintus's record (or his
//      sons') refers to Quintus's wife? Quintus's wife (if any) would be
//      a LAYOUT_A female; check by gender.

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

for (const [label, sp] of corpus) {
  const buf = fs.readFileSync(sp);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const byName = new Map();
  for (const r of recs) byName.set(r.firstName + (r.lastName ? ' ' + r.lastName : ''), r);
  const quintus = byName.get('Quintus Ogulnius_Gallus');
  if (!quintus) { console.log(label, 'NO Quintus'); continue; }

  console.log(`\n=== ${label}: Quintus Ogulnius_Gallus (offset 0x${quintus.offset.toString(16)}, uuid=${quintus.primaryUuid}) ===`);
  // Dump +40..+100 byte-by-byte
  for (let i = 40; i < 100; i += 4) {
    const v = buf.readUInt32LE(quintus.offset + i);
    let bytes = '';
    for (let j = 0; j < 4; j++) bytes += buf[quintus.offset + i + j].toString(16).padStart(2,'0') + ' ';
    let note = '';
    if (v === 0) note = '';
    else if (v === 0xffffffff) note = 'sentinel';
    else {
      for (const r of recs) {
        if (r.primaryUuid === v) {
          note = `-> ${r.firstName} ${r.lastName || ''} (age=${r.age}, gender=${r.gender}, father=${r.fatherUuid===quintus.primaryUuid?'QUINTUS':'-'})`;
          break;
        }
      }
    }
    console.log(`  +${i.toString().padStart(3)}: ${bytes} u32=${v.toString().padStart(10)} ${note}`);
  }
}

// Now: more general — for EVERY LAYOUT_A character who has children in this
// save (defined as another LAYOUT_A char's fatherUuid == this char's
// primaryUuid), check WHERE in this char's record those children's uuids
// appear. Pattern: are they always at +54 and +58? Or scattered?
console.log('\n=== Universal child-slot location scan ===');
for (const [label, sp] of corpus) {
  const buf = fs.readFileSync(sp);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const layoutA = recs.filter(r => r.lastName);
  for (const father of layoutA) {
    const kids = recs.filter(r => r.fatherUuid === father.primaryUuid);
    if (kids.length === 0) continue;
    console.log(`\n${label}: ${father.firstName} ${father.lastName} (uuid=${father.primaryUuid}) -> ${kids.length} children`);
    for (const kid of kids) {
      // search father's record +0..+200 for kid's uuid
      let foundAt = [];
      for (let i = 0; i + 4 <= 200; i++) {
        if (buf.readUInt32LE(father.offset + i) === kid.primaryUuid) foundAt.push(i);
      }
      console.log(`   ${kid.firstName} ${kid.lastName || ''} (uuid=${kid.primaryUuid}) found at father+${foundAt.join(',+') || 'NOT FOUND'}`);
    }
    // also dump +50..+90 raw
    let bytes = '';
    for (let i = 50; i < 90; i++) bytes += buf[father.offset + i].toString(16).padStart(2,'0') + ' ';
    console.log(`   father +50..+89: ${bytes}`);
  }
}
