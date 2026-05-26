// Locate religion percentages per settlement.
// In RTW: each settlement tracks % belief per religion (greek, roman, eastern, egyptian,
// carthaginian, barbarian, pagan). RR has 6-7 religions.
//
// Religions in vanilla/RR are stored either:
//   - 6 or 7 u8 bytes (percent 0-100) summing to ~100
//   - 6 or 7 u32 bytes (fixed-point or higher precision)
//
// Strategy: for each settlement, look around the stats block (583 bytes per session
// summary) for groups of 6-7 bytes that sum to ~100 (or close to it).

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

// Find Epidamnus
const epi = findUtf16(SAVE, 'Epidamnus');
console.log('Epidamnus @ 0x' + epi.toString(16));

// Scan +/- 3000 bytes around Epidamnus, looking for 6-7 consecutive bytes that sum to 80-100
// (Religion percentages should sum to ~100; allow some slop for rounding.)
console.log('\n=== Scan for 6-byte windows summing to 90-110 (religion percent candidates) ===');
const candidates6 = [];
for (let off = epi - 3000; off < epi + 3000; off++) {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += SAVE[off + i];
  if (sum >= 95 && sum <= 105) {
    // Also each byte must be in 0..100 range
    let validBytes = true;
    for (let i = 0; i < 6; i++) {
      if (SAVE[off + i] > 100) { validBytes = false; break; }
    }
    if (validBytes) candidates6.push({ off, sum, bytes: Array.from(SAVE.slice(off, off + 6)) });
  }
}
console.log('Found ' + candidates6.length + ' 6-byte candidates summing to 95-105');
for (const c of candidates6.slice(0, 30)) {
  console.log('  0x' + c.off.toString(16) + ' sum=' + c.sum + ' bytes=[' + c.bytes.join(',') + ']');
}

console.log('\n=== Scan for 7-byte windows summing to 95-105 ===');
const candidates7 = [];
for (let off = epi - 3000; off < epi + 3000; off++) {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += SAVE[off + i];
  if (sum >= 95 && sum <= 105) {
    let validBytes = true;
    for (let i = 0; i < 7; i++) {
      if (SAVE[off + i] > 100) { validBytes = false; break; }
    }
    if (validBytes) candidates7.push({ off, sum, bytes: Array.from(SAVE.slice(off, off + 7)) });
  }
}
console.log('Found ' + candidates7.length + ' 7-byte candidates');
for (const c of candidates7.slice(0, 30)) {
  console.log('  0x' + c.off.toString(16) + ' sum=' + c.sum + ' bytes=[' + c.bytes.join(',') + ']');
}

// Look for u32-aligned percentage groups (4-byte values where 6 of them sum to ~100*256 or 100*1)
console.log('\n=== Scan for 6 u32s summing to ~100 (as if percentages stored as integers) ===');
for (let off = epi - 3000; off < epi + 3000; off += 4) {
  let sum = 0;
  let validU32 = true;
  for (let i = 0; i < 6; i++) {
    const v = SAVE.readUInt32LE(off + i * 4);
    if (v > 100) { validU32 = false; break; }
    sum += v;
  }
  if (validU32 && sum >= 95 && sum <= 105) {
    const vals = [];
    for (let i = 0; i < 6; i++) vals.push(SAVE.readUInt32LE(off + i * 4));
    console.log('  0x' + off.toString(16) + ' sum=' + sum + ' vals=[' + vals.join(',') + ']');
  }
}

// Alternative: floats summing to 1.0 each. Or u16 percentages.
