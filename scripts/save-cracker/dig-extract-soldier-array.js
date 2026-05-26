// Extract the new unit's soldier array from T4 and analyze stride/structure.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Unit record starts ~0x154ac1a (string position). Soldier array seems to start after
// the "Etruria" pstr16 and some metadata, around 0x154ac96.

const UNIT_START = 0x154ac1a;
console.log('=== Bytes 0x154ac1a to 0x154ae00 (chunked as 32-byte rows) ===');
for (let off = 0x154ac1a; off < 0x154ae00; off += 32) {
  const hex = Array.from(T4.slice(off, off + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(T4.slice(off, off + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('0x' + off.toString(16) + ': ' + hex + '  |' + ascii + '|');
}

// Detect end of unit record: look for `ff ff ff ff` runs after the soldier array
console.log('\n=== Bytes 0x154ae00 to 0x154b000 (looking for unit-array end) ===');
for (let off = 0x154ae00; off < 0x154b000; off += 32) {
  const hex = Array.from(T4.slice(off, off + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(T4.slice(off, off + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('0x' + off.toString(16) + ': ' + hex + '  |' + ascii + '|');
}

// Try parsing as 9-byte records starting at 0x154ac96
console.log('\n=== Trying 9-byte stride starting at 0x154ac96 ===');
const RECORD_SIZE = 9;
const ARRAY_START = 0x154ac96;
for (let i = 0; i < 80; i++) {
  const off = ARRAY_START + i * RECORD_SIZE;
  if (off + RECORD_SIZE > T4.length) break;
  const hex = Array.from(T4.slice(off, off + RECORD_SIZE)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  soldier ' + i.toString().padStart(2) + ' @ 0x' + off.toString(16) + ': ' + hex);
}
