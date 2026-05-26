// dig-naval-shiptype.js
// Compare the post-name bytes of the 3 ship types (biremes/boats/triremes) to
// see if a numeric field (besides the name string) encodes ship class, and to
// document the 0x012c (300) field. Also check for blockade/at-sea state by
// comparing a fleet sitting in port vs at open sea (if distinguishable).

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_macedon t0.sav'));

const naval = findUnitRecords(buf).filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);

// Group by type, dump post-name 24 bytes for one of each
const oneOf = {};
for (const u of naval) if (!oneOf[u.name]) oneOf[u.name] = u;

console.log('=== post-name bytes by ship type ===');
for (const [name, u] of Object.entries(oneOf)) {
  const i = u.offset;
  const nl = buf.readUInt16LE(i);
  const after = i + 2 + nl; // first byte after name+\0
  const bytes = Array.from(buf.slice(after, after + 24)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  // The structured fields per earlier dump:
  //   after+0  u8  classByte
  //   after+1  8 bytes id-hash
  //   after+9  u32  = 0x0000000f (15) constant? then 00, then u32 0x012c(300)
  const classByte = buf[after];
  const f300 = buf.readUInt32LE(after + 14);
  console.log('  ' + name.padEnd(15) + ' @0x' + i.toString(16) +
    ' classByte=0x' + classByte.toString(16) +
    ' field@+10(u32)=' + buf.readUInt32LE(after + 10) +
    ' field@+14(u32)=' + f300 +
    '  raw[' + bytes + ']');
}

// histogram of classByte and the +14 field across all ships, split by type
console.log('\n=== classByte + maxPool(+14) histograms per type ===');
const stat = {};
for (const u of naval) {
  const i = u.offset; const nl = buf.readUInt16LE(i); const after = i + 2 + nl;
  const cb = buf[after]; const f14 = buf.readUInt32LE(after + 14);
  if (!stat[u.name]) stat[u.name] = { classByte: {}, f14: {} };
  stat[u.name].classByte[cb] = (stat[u.name].classByte[cb] || 0) + 1;
  stat[u.name].f14[f14] = (stat[u.name].f14[f14] || 0) + 1;
}
for (const [n, s] of Object.entries(stat)) {
  console.log('  ' + n.padEnd(15) + ' classByte=' + JSON.stringify(s.classByte) + ' field+14=' + JSON.stringify(s.f14));
}

// Note: ship TYPE is reliably the name string ("naval biremes" etc.). The unit
// type -> export_descr_unit class (light/medium/heavy ship, attack, hull) is a
// MOD-FILE lookup, not in the save. Confirm by listing distinct save names.
console.log('\n=== distinct ship-type names in save (these key into export_descr_unit) ===');
console.log('  ' + [...new Set(naval.map(u => u.name))].join(', '));
