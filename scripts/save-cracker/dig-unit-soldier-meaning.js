// dig-unit-soldier-meaning.js
// Decode the 9-byte soldier record. Compare a wpn=1 unit (aor etruscan spearmen,
// slots [4,4,4]) vs a wpn=0 unit to see if a per-soldier byte encodes weapon.
// Also test the canonical memory layout (weapon@+7) against this array phase.
//
// The array we found: each soldier = [b0][b1][b2 marker 0x10-0x70][00 00 00 00 00][b8].
// b1 dominantly 0x04; b2 varies 0x10..0x70; b8 varies 0..6. Decode each.
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
function findArrayStart(buf, te, count) {
  let off = -1;
  for (let p = te + 12; p < te + 48; p++) {
    if (buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) { off = p; break; }
  }
  if (off < 0) return { arrayStart: null, slots: 0 };
  let slots = 0;
  while (off >= 0 && buf[off] === 0x01 && buf[off + 1] === 0x00 && buf[off + 2] === 0x40 && buf[off + 3] === 0x00) { off += 14; slots++; if (slots > 12) break; }
  for (let p = off; p < off + 24 && p + 2 <= buf.length; p++) if (buf.readUInt16LE(p) === count) return { arrayStart: p + 2, slots };
  return { arrayStart: null, slots };
}

const buf = fs.readFileSync(path.join(BASE_R, 'save_before armor upgrade queue.sav'));
const recs = findUnitRecords(buf);
for (const r of recs) {
  const ne = r.offset + 2 + Buffer.from(r.name, 'ascii').length + 1;
  r.uuid = buf.readUInt32LE(ne);
}

// pick the wpn=1 etruscan spearmen and a plain wpn=0 unit (any large infantry)
const wpn1 = recs.find(r => r.name === 'aor etruscan spearmen' && r.weaponUpgrade === 1);
const wpn0 = recs.find(r => r.weaponUpgrade === 0 && r.soldiers >= 100 && /infantry|spear|hoplite|warband|swordsm/.test(r.name));

for (const r of [wpn1, wpn0]) {
  if (!r) { console.log('missing target'); continue; }
  const te = regionTermEnd(buf, r);
  const { arrayStart, slots } = findArrayStart(buf, te, r.soldiers);
  console.log(`\n=== "${r.name}"@${r.region} wpn=${r.weaponUpgrade} sold=${r.soldiers} slots=${slots} ===`);
  if (!arrayStart) { console.log('  no array'); continue; }
  // histogram every byte position
  const hist = {};
  for (let b = 0; b < 9; b++) hist[b] = {};
  for (let i = 0; i < r.soldiers; i++) {
    const off = arrayStart + i * 9;
    for (let b = 0; b < 9; b++) { const v = buf[off + b]; hist[b][v] = (hist[b][v] || 0) + 1; }
  }
  for (let b = 0; b < 9; b++) {
    const e = Object.entries(hist[b]).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([v, c]) => `0x${(+v).toString(16)}×${c}`).join(' ');
    console.log(`  byte+${b}: ${e}`);
  }
  // REALIGNED interpretation: real soldier record starts at arrayStart and the
  // weapon byte is at +3 (0x04 = wpn lvl 1). Test by counting how many soldiers
  // have byte+3 == 0x04 (should be ALL for wpn=1, NONE for wpn=0).
  let wpnByteCount = 0;
  for (let i = 0; i < r.soldiers; i++) if (buf[arrayStart + i * 9 + 3] === 0x04) wpnByteCount++;
  console.log(`  >>> soldiers with byte+3==0x04 (weapon lvl1): ${wpnByteCount}/${r.soldiers}`);
  // Show first 8 with all 9 bytes annotated
  console.log('  first 8 soldiers raw 9B:');
  for (let i = 0; i < 8; i++) {
    const off = arrayStart + i * 9;
    console.log(`     ${Array.from(buf.slice(off, off + 9)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
}
