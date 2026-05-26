// dig-unit-nonzero-slots.js
// Find units with NON-ZERO stat-slot XX bytes (= actual weapon/armor/exp
// upgrades) in each save, and also non-zero unitParser xp/wpn/arm. This tells
// us where real upgrades live and whether the slot XX or the +16/+17 byte is
// the upgrade carrier. Compare BEFORE vs UPGRADED for the upgraded settlement.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

function regionTermEnd(buf, r) {
  const ne = r.offset + 2 + Buffer.from(r.name, 'ascii').length;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true, nm = '';
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
      nm += String.fromCharCode(buf[j]);
    }
    if (!ok || nm !== r.region) continue;
    return re + 4;
  }
  return null;
}
function statSlots(buf, te) {
  let off = -1;
  for (let p = te + 12; p < te + 48; p++) {
    if (buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) { off = p; break; }
  }
  const slots = [];
  let p = off;
  while (off >= 0 && buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) {
    slots.push(buf[p + 4]); p += 14;
    if (slots.length > 12) break;
  }
  return { slotStart: off, slots };
}
function load(file) {
  const buf = fs.readFileSync(path.join(BASE_R, file));
  const recs = findUnitRecords(buf);
  for (const r of recs) {
    const nameEnd = r.offset + 2 + Buffer.from(r.name, 'ascii').length + 1;
    r.uuid = buf.readUInt32LE(nameEnd);
    r.te = regionTermEnd(buf, r);
    r.ss = r.te != null ? statSlots(buf, r.te) : { slots: [] };
  }
  return { buf, recs, byUuid: new Map(recs.map(r => [r.uuid, r])) };
}

for (const [tag, file] of [['BEFORE', 'save_before armor upgrade queue.sav'], ['UPGRADED', 'save_next turn, armour upgraded..sav']]) {
  const L = load(file);
  const nzSlot = L.recs.filter(r => r.ss.slots.some(v => v !== 0));
  const nzWpn = L.recs.filter(r => r.weaponUpgrade > 0);
  const nzArm = L.recs.filter(r => r.armourUpgrade > 0);
  const nzXp = L.recs.filter(r => r.xp > 0);
  console.log(`\n=== ${tag} ===`);
  console.log(`  units with non-zero stat-slot XX: ${nzSlot.length}`);
  for (const r of nzSlot.slice(0, 20)) console.log(`     "${r.name}"@${r.region} slots=[${r.ss.slots}] (parser wpn=${r.weaponUpgrade} arm=${r.armourUpgrade} xp=${r.xp})`);
  console.log(`  units with parser weaponUpgrade>0: ${nzWpn.length}`);
  console.log(`  units with parser armourUpgrade>0: ${nzArm.length}`);
  console.log(`  units with parser xp>0: ${nzXp.length}`);
}

// Now: BEFORE vs UPGRADED — find units whose slot set went from all-zero to
// containing a non-zero (the genuine armor upgrade), matched by uuid.
const B = load('save_before armor upgrade queue.sav');
const U = load('save_next turn, armour upgraded..sav');
console.log('\n=== Units that GAINED a non-zero stat slot (BEFORE->UPGRADED) ===');
let gained = 0;
for (const rb of B.recs) {
  const ru = U.byUuid.get(rb.uuid);
  if (!ru || ru.name !== rb.name) continue;
  const beforeNZ = rb.ss.slots.some(v => v !== 0);
  const afterNZ = ru.ss.slots.some(v => v !== 0);
  if (!beforeNZ && afterNZ) {
    gained++;
    if (gained <= 30) console.log(`   "${rb.name}"@${rb.region} [${rb.ss.slots}] -> [${ru.ss.slots}]  (parser wpn ${rb.weaponUpgrade}->${ru.weaponUpgrade} arm ${rb.armourUpgrade}->${ru.armourUpgrade})`);
  }
}
console.log(`  total gained: ${gained}`);
