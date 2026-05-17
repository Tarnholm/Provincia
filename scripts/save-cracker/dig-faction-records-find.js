// FACTION has 34 instances per the section type registry. Find where they're stored.
// The records must be at known offsets — likely arranged as a fixed-stride array
// somewhere in the unmapped zones.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Parse the section type registry. Format: ASCII name + null + u32 count
console.log('=== Section type registry ===');
const registry = [];
let p = 0x500;
while (p < 0x1000) {
  // Find next ASCII string
  if (buf[p] < 0x41 || buf[p] > 0x5a) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len < 4) { p = q + 1; continue; }
  const name = buf.slice(p, q).toString('latin1');
  if (!/^[A-Z][A-Z_0-9]+$/.test(name)) { p = q + 1; continue; }
  if (buf[q] !== 0) { p = q + 1; continue; }  // must end with null
  // u32 count comes after the null terminator
  const countOff = q + 1;
  const count = buf.readUInt32LE(countOff);
  if (count > 100000) { p = q + 1; continue; }  // sanity
  registry.push({ nameOff: p, name, count });
  p = countOff + 4;
}

console.log('Total registered section types: ' + registry.length);
for (const r of registry) {
  console.log('  0x' + r.nameOff.toString(16).padStart(4, '0') + '  count=' + String(r.count).padStart(4) + '  ' + r.name);
}

// Particularly interested in: FACTION, ECONOMICS_DATA, MAP_REGIONS
console.log('\n=== Key section types ===');
for (const target of ['FACTION', 'ECONOMICS_DATA', 'MAP_REGIONS', 'CHARACTER_DB', 'LEGION_DESCRIPTION', 'IMPERATOR', 'HOLD_REGIONS', 'ANCILLARY_UNIT', 'SOLDIER_PERSISTENT', 'FORT_MANAGER']) {
  const r = registry.find(x => x.name === target);
  if (r) console.log('  ' + target + ': ' + r.count + ' instances');
}
