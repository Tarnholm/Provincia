// Investigate the 0x7c20..0xaa00 zone where we found isolated u32s in 32K-42K range.
// These might be per-settlement detail records containing population/health/etc.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(peace.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// First show the candidate offsets with their full context (-16..+32)
const CANDIDATES = [0x7e48, 0x7fd4, 0x8170, 0x83ac, 0x8668, 0x8c88, 0x9054, 0x96ec, 0x9bf4, 0xa2dc];

console.log('=== Context around per-settlement-population candidates ===');
for (const c of CANDIDATES) {
  const v = peace.readUInt32LE(c);
  console.log('\n--- u32@0x' + c.toString(16) + ' = ' + v + ' ---');
  for (let row = -1; row <= 2; row++) {
    const addr = c + row * 16;
    console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16) + (row === 0 ? ' ←' : ''));
  }
}

// What's the average stride? If these are at consistent fixed offsets within
// per-settlement records, the stride should be constant.
console.log('\n=== Strides between candidates ===');
for (let i = 1; i < CANDIDATES.length; i++) {
  console.log('  0x' + CANDIDATES[i-1].toString(16) + ' → 0x' + CANDIDATES[i].toString(16) +
    ' = ' + (CANDIDATES[i] - CANDIDATES[i-1]) + ' bytes');
}

// Look at the entire 0x7c20..0xaa00 zone for a repeating pattern
// First show a few rows
console.log('\n=== First 256 bytes of zone 0x7c20 ===');
for (let p = 0x7c20; p < 0x7d20; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}
