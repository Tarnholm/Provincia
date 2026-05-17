// Decode the historic events table at 0x5400-0x5cef.
// Each event has a name (volcano, plague_in_macedonia, etc.) and likely:
//   - trigger year
//   - whether it has fired
//   - some random offset

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(peace.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Read pstr16-ASCIIZ at each known event location and dump surrounding bytes
const EVENTS = [
  ['volcano', 0x05428],
  ['eruption_at_etna', 0x05432],
  ['plague', 0x05466],
  ['plague_in_macedonia', 0x0546f],
  ['historic', 0x054a6],
  ['stoic_philosophy', 0x054b1],
];

function readPstr16Asciiz(off) {
  const lenP1 = peace.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 60) return null;
  return { str: peace.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

console.log('=== Event records with surrounding bytes ===');
for (const [expected, off] of EVENTS) {
  const r = readPstr16Asciiz(off);
  console.log('\n' + expected + ' @ 0x' + off.toString(16) + ' → "' + (r ? r.str : 'NULL') + '" len=' + (r ? r.totalLen : 0));
  console.log('  bytes before (-16..0): ' + hex(off - 16, 16));
  console.log('  pstr16 + 16 bytes after: ' + hex(off, (r ? r.totalLen : 0) + 16));
}

// Now scan the 0x5400-0x5d00 region for the GRAMMAR of events:
//   pstr16("volcano") + ??? + pstr16("eruption_at_etna") + ???
// Look at stride between known event-name pstr16s
console.log('\n=== Stride analysis 0x5400-0x5d00 ===');
let prevP = 0x5400;
let p = 0x5400;
while (p < 0x5d00) {
  const r = readPstr16Asciiz(p);
  if (r && r.str.length >= 4 && /^[a-z_][a-z_0-9]+$/.test(r.str)) {
    console.log('  0x' + p.toString(16) + '  ' + r.str + '  (stride from previous: ' + (p - prevP) + ')');
    prevP = p;
    p += r.totalLen;
  } else {
    p++;
  }
}

// Look at u32@0x49d8 and u32@0x5188 context
console.log('\n=== u32@0x49d8 = 3905 context ===');
for (let row = -2; row <= 2; row++) {
  const addr = 0x49d8 + row * 16;
  console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16));
}
console.log('\n=== u32@0x5188 = 7726 context ===');
for (let row = -2; row <= 2; row++) {
  const addr = 0x5188 + row * 16;
  console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16));
}
