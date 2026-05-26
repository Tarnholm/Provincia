// Dump the FULL 78-byte trailer of building entries and look for:
//   1. Embedded pstr16 (level-name strings like "blacksmith", "smiths_workshop")
//   2. Indices/IDs that might point to a level table
//   3. Differences between same-chain different-tier entries (= what changes on upgrade)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

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

// From earlier walker — Epidamnus T11 list-3 buildings:
//   0x1d7f9  core_building tier=1
//   0x1d960  smith tier=0
//   0x1dad7  temple_of_horse_2 tier=1
// From list-2:
//   0x1d109  core_building tier=2  (so we can compare core T1 vs T2)
//   0x1d270  port_buildings tier=1
// From list-1:
//   0x1cac1  core_building tier=1

function dumpTrailer(off, label) {
  const r = readPstr16Asciiz(SAVE, off);
  if (!r) {
    console.log(label + ': not a pstr16');
    return;
  }
  console.log('\n=== ' + label + ' @ 0x' + off.toString(16) + ' name="' + r.str + '" ===');
  const trailerStart = off + r.totalLen;
  // Walk 78 bytes
  console.log('Bytes 0..77 (after the name string + null):');
  for (let j = 0; j < 78; j += 16) {
    const hex = Array.from(SAVE.slice(trailerStart + j, trailerStart + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(SAVE.slice(trailerStart + j, trailerStart + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(2) + ': ' + hex + '  |' + ascii + '|');
  }
  // Read as u32s at common positions
  console.log('Word-level reads:');
  console.log('  u32@+0  = 0x' + SAVE.readUInt32LE(trailerStart + 0).toString(16) + ' (random bytes? hash?)');
  console.log('  u8@+4   = ' + SAVE.readUInt8(trailerStart + 4) + ' (likely TIER)');
  console.log('  u8@+5   = 0x' + SAVE.readUInt8(trailerStart + 5).toString(16) + ' (flag/category)');
  console.log('  u32@+8  = 0x' + SAVE.readUInt32LE(trailerStart + 8).toString(16));
  console.log('  u32@+72 = 0x' + SAVE.readUInt32LE(trailerStart + 72).toString(16));
  // Check for embedded pstr16 anywhere in the trailer
  for (let j = 0; j < 78 - 4; j++) {
    const r2 = readPstr16Asciiz(SAVE, trailerStart + j);
    if (r2 && r2.str.length >= 4 && /^[a-z_][a-z_0-9]+$/.test(r2.str)) {
      console.log('  EMBEDDED pstr16 at trailer+' + j + ': "' + r2.str + '"');
    }
  }
}

dumpTrailer(0x1cac1, 'List-1 core_building T1');
dumpTrailer(0x1d109, 'List-2 core_building T2');
dumpTrailer(0x1d7f9, 'List-3 core_building T1');
dumpTrailer(0x1d960, 'List-3 smith T0');
dumpTrailer(0x1dad7, 'List-3 temple_of_horse_2 T1');
dumpTrailer(0x1d270, 'List-2 port_buildings T1');

// Now: do entries with SAME chain + SAME tier have identical-ish trailers?
// (core_building T1 appears in both list 1 AND list 3 — compare them)
console.log('\n\n=== DIFF: List-1 core_T1 vs List-3 core_T1 (should be IDENTICAL if same building) ===');
const t1 = 0x1cac1 + readPstr16Asciiz(SAVE, 0x1cac1).totalLen;
const t3 = 0x1d7f9 + readPstr16Asciiz(SAVE, 0x1d7f9).totalLen;
const diffs = [];
for (let i = 0; i < 78; i++) {
  if (SAVE[t1 + i] !== SAVE[t3 + i]) {
    diffs.push({ pos: i, list1: SAVE[t1 + i], list3: SAVE[t3 + i] });
  }
}
console.log('Identical bytes: ' + (78 - diffs.length) + '/78');
console.log('Differing byte positions:');
for (const d of diffs) {
  console.log('  +' + d.pos.toString().padStart(2) + ': list1=0x' + d.list1.toString(16).padStart(2, '0') + '  list3=0x' + d.list3.toString(16).padStart(2, '0'));
}
