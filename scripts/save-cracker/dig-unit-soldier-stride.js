// dig-unit-soldier-stride.js
// Pin the per-soldier stride inside the container. After the variable-count
// stat-slot region there is a u16 count followed by the soldier array. Each
// soldier record appears to be 9 bytes with a recurring marker byte. Align and
// dump to confirm stride == 9 and which byte is the marker / weapon / exp.
//
// Also decode the +4 float and slot-count vs unit class.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const recs = findUnitRecords(buf);

function regionTermEnd(r) {
  const ne = r.offset + 2 + Buffer.from(r.name, 'ascii').length; // index of null
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

// Find the soldier array start: after the stat slots there is a u16 == count
// followed by the array. Walk past consecutive 01 00 40 00 slots, then look for
// the count u16.
function findArrayStart(te, count) {
  // Find the first 01 00 40 00 slot anywhere in te+16..te+40
  let off = -1;
  for (let p = te + 12; p < te + 48; p++) {
    if (buf[p] === 0x01 && buf[p + 1] === 0x00 && buf[p + 2] === 0x40 && buf[p + 3] === 0x00) { off = p; break; }
  }
  const slotStart = off;
  let slots = 0;
  while (off >= 0 && buf[off] === 0x01 && buf[off + 1] === 0x00 && buf[off + 2] === 0x40 && buf[off + 3] === 0x00) {
    off += 14; slots++;
    if (slots > 12) break;
  }
  // After slots: some zero padding, then u16 count, then array.
  for (let p = off; p < off + 24; p++) {
    if (buf.readUInt16LE(p) === count) {
      return { arrayStart: p + 2, slots, countAt: p, slotStart };
    }
  }
  return { arrayStart: null, slots, countAt: null, slotStart };
}

const samples = [
  recs.find(r => r.name === 'roman hastati early' && r.region === 'Etruria'),
  recs.find(r => r.name === 'roman equites early' && r.region === 'Etruria'),
  recs.find(r => r.name === 'roman leves' && r.region === 'Etruria'),
];

for (const r of samples) {
  if (!r) continue;
  const te = regionTermEnd(r);
  const f = buf.readFloatLE(te + 4);
  const { arrayStart, slots, countAt } = findArrayStart(te, r.soldiers);
  console.log('\n============================================================');
  console.log(`"${r.name}" sold=${r.soldiers}  +4float=${f}  slots=${slots}  countAt@+${countAt!=null?countAt-te:'?'}  arrayStart@+${arrayStart!=null?arrayStart-te:'?'}`);
  console.log('============================================================');
  if (!arrayStart) continue;
  // Dump first 12 soldiers at 9-byte stride
  console.log('  9-byte stride from arrayStart:');
  for (let i = 0; i < 12; i++) {
    const off = arrayStart + i * 9;
    const hex = Array.from(buf.slice(off, off + 9)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`    sold ${i.toString().padStart(2)}: ${hex}`);
  }
  // Validate: 9*count bytes later should be the 0xff terminator run
  const expectedEnd = arrayStart + 9 * r.soldiers;
  const ffHex = Array.from(buf.slice(expectedEnd - 4, expectedEnd + 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  bytes around arrayStart+9*count (=+${expectedEnd-te}): ${ffHex}`);
  // byte histogram of the +2 position (the marker) and +0 (weapon?) and +8
  const hist = {};
  for (let i = 0; i < r.soldiers; i++) {
    const off = arrayStart + i * 9;
    if (off + 9 > buf.length) break;
    for (let b = 0; b < 9; b++) {
      hist[b] = hist[b] || {};
      const v = buf[off + b];
      hist[b][v] = (hist[b][v] || 0) + 1;
    }
  }
  console.log('  per-byte-position value histogram (top 4 each):');
  for (let b = 0; b < 9; b++) {
    const entries = Object.entries(hist[b]).sort((x, y) => y[1] - x[1]).slice(0, 4)
      .map(([v, c]) => `0x${(+v).toString(16)}×${c}`).join(' ');
    console.log(`    byte+${b}: ${entries}`);
  }
}
