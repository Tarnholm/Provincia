// dig-unit-container-spec.js
// Consolidate + VALIDATE the full unit-container spec across many units in a
// real save. Confirm:
//   te+0  u32 = 0
//   te+4  f32 = current movement points
//   te+8  u32 = max soldiers
//   te+12 u32 = current soldiers
//   te+16 u8  = stat-slot count (then slotCount × 14-byte 01 00 40 00 XX slots)
//   then u16 = soldier count (==current), then count × 9-byte soldier records
//   then 0xff terminator run, then a trailer
//
// Per-soldier 9B (our array phase): [u16 +0][marker +2][weapon +3][0 +4..+7][status +8]
// weapon byte +3 == 0x04 iff unit weapon_lvl 1. Validate the per-soldier weapon
// byte aggregates to the unit's weaponUpgrade.
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

// Parse the variant-A container. The stat-slot region starts at te+17 (te+16 is
// a u8 slot-count). Soldier array follows: u16 count then count×9B records.
function parseContainer(buf, te, expectCur) {
  if (te == null) return null;
  const zero = buf.readUInt32LE(te);
  if (zero !== 0) return null; // variant-A only
  const mp = buf.readFloatLE(te + 4);
  const maxS = buf.readUInt32LE(te + 8);
  const curS = buf.readUInt32LE(te + 12);
  const slotCountByte = buf[te + 16];
  // Count actual 01 00 40 00 slots from te+17
  let off = te + 17, slots = [];
  while (buf[off] === 0x01 && buf[off + 1] === 0x00 && buf[off + 2] === 0x40 && buf[off + 3] === 0x00 && slots.length < 16) {
    slots.push(buf[off + 4]); off += 14;
  }
  // After slots: zero padding then u16 count==curS then array
  let arrayStart = null, countAt = null;
  for (let p = off; p < off + 24 && p + 2 <= buf.length; p++) {
    if (buf.readUInt16LE(p) === curS && curS > 0) { countAt = p; arrayStart = p + 2; break; }
  }
  return { mp, maxS, curS, slotCountByte, slots, arrayStart, countAt, slotEnd: off };
}

const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const recs = findUnitRecords(buf);

let ok = 0, varA = 0, arrayOk = 0, wpnMatch = 0, wpnTotal = 0, slotEqWpn = 0;
const slotCountByName = {};
const mismatch = [];
for (const r of recs) {
  const te = regionTermEnd(buf, r);
  const c = parseContainer(buf, te, r.soldiers);
  if (!c) continue;
  varA++;
  // max/cur sanity
  if (c.maxS === r.maxSoldiers && c.curS === r.soldiers) ok++;
  slotCountByName[r.name] = c.slots.length;
  if (!c.arrayStart) continue;
  // validate array end lands on 0xff
  const endOff = c.arrayStart + 9 * c.curS;
  if (endOff + 4 <= buf.length && buf[endOff] === 0xff && buf[endOff + 1] === 0xff && buf[endOff + 2] === 0xff && buf[endOff + 3] === 0xff) arrayOk++;
  else continue;
  // per-soldier weapon byte +3
  let w04 = 0;
  for (let i = 0; i < c.curS; i++) if (buf[c.arrayStart + i * 9 + 3] === 0x04) w04++;
  const allWpn1 = w04 === c.curS;
  const noneWpn = w04 === 0;
  wpnTotal++;
  if ((r.weaponUpgrade === 1 && allWpn1) || (r.weaponUpgrade === 0 && noneWpn)) wpnMatch++;
  else if (mismatch.length < 15) mismatch.push(`"${r.name}"@${r.region} parserWpn=${r.weaponUpgrade} soldiersWith0x04=${w04}/${c.curS} slots=[${c.slots}]`);
  // Hypothesis: stat slot[0] XX/4 == weaponUpgrade? (slots showed XX=4 for wpn1)
  if (c.slots.length > 0) {
    const slotWpn = c.slots[0] === 4 ? 1 : (c.slots[0] === 0 ? 0 : -9);
    if (slotWpn === r.weaponUpgrade) slotEqWpn++;
  }
}
console.log(`variant-A containers: ${varA}`);
console.log(`max/cur match parser: ${ok}/${varA}`);
console.log(`array end on 0xffffffff: ${arrayOk}`);
console.log(`per-soldier weapon byte+3 matches parser weaponUpgrade: ${wpnMatch}/${wpnTotal}`);
console.log(`stat slot[0]==4 <=> weaponUpgrade==1 holds: ${slotEqWpn}/${wpnTotal}`);
console.log('\nslot count by unit type (sample):');
const names = Object.keys(slotCountByName).slice(0, 30);
for (const n of names) console.log(`  ${n}: ${slotCountByName[n]} slots`);
if (mismatch.length) {
  console.log('\nweapon-byte mismatches:');
  for (const m of mismatch) console.log('  ' + m);
}
