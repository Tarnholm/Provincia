// Find the section type registry by looking for known section names

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// Look for ASCIIZ section names at every byte position in the first 0x4000 bytes
const knownNames = ['settlement', 'faction', 'character', 'army', 'navy', 'building', 'unit', 'region', 'tile'];

console.log('Looking for known section name ASCII patterns in first 0x4000 bytes:\n');
for (const name of knownNames) {
  const target = Buffer.concat([Buffer.from(name, 'latin1'), Buffer.from([0])]);
  let off = 0;
  let count = 0;
  while (count < 5) {
    const idx = T1.indexOf(target, off);
    if (idx === -1 || idx > 0x10000) break;
    count++;
    // What's around it?
    const before = Array.from(T1.slice(Math.max(0, idx - 8), idx)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const after = Array.from(T1.slice(idx + target.length, idx + target.length + 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('  ' + name.padEnd(15) + ' @ 0x' + idx.toString(16).padStart(6) + '  before:[' + before + ']  after:[' + after + ']');
    off = idx + 1;
  }
}

// Also dump 0x500..0x800 to see what's actually there
console.log('\nDump of 0x500..0x800:');
for (let off = 0x500; off < 0x800; off += 16) {
  const hex = Array.from(T1.slice(off, off + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(T1.slice(off, off + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + off.toString(16) + ': ' + hex + ' |' + ascii + '|');
}
