// Test hypothesis: are the three default_set sub-lists grouped by CULTURE?
//
// For each default_set marker, dump:
//   - 16 bytes BEFORE the "default_set" pstr16 (might encode culture/group ID)
//   - 61 bytes AFTER (the trailer)
//   - Culture byte of each building entry within the list
//
// If list 1 has culture=X, list 2 has culture=Y, list 3 has culture=Z (all distinct),
// the user's hypothesis is confirmed.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T11 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function hex(buf, off, n) {
  return Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function findAllDefaultSet(buf, fromOff, toOff) {
  const target = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const positions = [];
  let p = fromOff;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1 || idx >= toOff) break;
    positions.push(idx);
    p = idx + 14;
  }
  return positions;
}

// Epidamnus T11 spans 0x1ca4f to ~0x1de00 (next settlement)
const dsPositions = findAllDefaultSet(T11, 0x1ca4f, 0x1e000);
console.log('Found ' + dsPositions.length + ' default_set markers in Epidamnus zone');

for (let i = 0; i < dsPositions.length; i++) {
  const dsOff = dsPositions[i];
  console.log('\n=== List ' + (i + 1) + ' default_set @ 0x' + dsOff.toString(16) + ' ===');
  console.log('  16 bytes BEFORE: ' + hex(T11, dsOff - 16, 16));
  console.log('  default_set pstr (14 bytes): ' + hex(T11, dsOff, 14));
  console.log('  61-byte trailer AFTER: ' + hex(T11, dsOff + 14, 32) + ' ...');
  console.log('  Full 61-byte trailer:');
  for (let j = 0; j < 64; j += 16) {
    console.log('    +' + j.toString().padStart(2) + ': ' + hex(T11, dsOff + 14 + j, 16));
  }

  // Walk building entries until next default_set or settlement boundary
  const nextDs = (i + 1 < dsPositions.length) ? dsPositions[i + 1] : 0x1e000;
  let p = dsOff + 14 + 61;
  console.log('  Buildings:');
  while (p < nextDs - 4) {
    const r = readPstr16Asciiz(T11, p);
    if (!r) { p++; continue; }
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) { p++; continue; }
    if (r.str.length < 3) { p++; continue; }
    if (r.str === 'default_set') break;

    // Read trailer of this building entry
    const entryEnd = p + r.totalLen + 78;
    if (entryEnd > T11.length) break;
    const tier = T11[p + r.totalLen + 4];
    const culture = T11[p + r.totalLen + 76];
    // Show first 8 bytes of building trailer
    const trailerSample = hex(T11, p + r.totalLen, 16);
    console.log('    0x' + p.toString(16) + '  ' + r.str.padEnd(28) + ' tier=' + tier + ' culture=' + culture + ' trailer:[' + trailerSample + '...]');
    p = entryEnd;
  }
}
