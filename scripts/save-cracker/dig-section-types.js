// The 0x500-0x800 zone has all RTW section type names. After each name there
// must be a count + pointer to actual records. Find them.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Find ASCII section names — capitalized identifiers
const NAMES = [];
let p = 0x100;
while (p < 0x2000) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 4) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[A-Z][A-Z_0-9]+$/.test(s)) {
      NAMES.push({ off: p, name: s, len });
    }
  }
  p = q + 1;
}

console.log('Total section type names: ' + NAMES.length);

// For each name, dump bytes immediately AFTER
console.log('\n=== Section names + 32 bytes after ===');
for (const n of NAMES.slice(0, 20)) {
  const after = n.off + n.len + 1;  // null terminator
  // Try to interpret next 16 bytes
  if (after + 16 > buf.length) continue;
  console.log('\n  ' + n.name.padEnd(35) + ' name@0x' + n.off.toString(16) + ' next-bytes:');
  console.log('    ' + hex(after, 32));
  // Read u32 fields after
  const u32s = [];
  for (let i = 0; i < 8; i++) u32s.push(buf.readUInt32LE(after + i * 4));
  console.log('    u32 fields: ' + u32s.join(', '));
}

// Look for a TYPE TABLE with structure {string_offset, count, data_ptr} for each section type
// Often these tables are RIGHT BEFORE the strings or RIGHT AFTER
console.log('\n=== Look for u32 pointers to section name offsets ===');
const namesByOff = {};
for (const n of NAMES) namesByOff[n.off] = n.name;
// Search the file for u32 values that equal a section-name offset
for (let off = 0; off < 0x2000; off += 4) {
  const v = buf.readUInt32LE(off);
  if (namesByOff[v]) {
    // Check the next u32 too
    const next = buf.readUInt32LE(off + 4);
    console.log('  0x' + off.toString(16) + ': u32 = 0x' + v.toString(16) + ' → "' + namesByOff[v] + '" (next u32: ' + next + ' = 0x' + next.toString(16) + ')');
  }
}

// Look in nearby zones (the registry might be in 0x0..0x100 too)
console.log('\n=== First 256 bytes (file header) ===');
for (let row = 0; row < 16; row++) {
  console.log('  0x' + (row * 16).toString(16) + ': ' + hex(row * 16, 16));
}
