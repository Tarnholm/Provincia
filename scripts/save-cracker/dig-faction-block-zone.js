// Investigate the 0x4800..0x5400 zone for per-faction records.
// If it's 20 factions × 154 bytes, expect a repeating record-stride.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(peace.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Look for repeating structural patterns in 0x4800..0x5400
console.log('=== Bytes 0x4800..0x5400 (3072 bytes) in 32-byte rows ===');
for (let p = 0x4800; p < 0x5400; p += 32) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 32));
}
