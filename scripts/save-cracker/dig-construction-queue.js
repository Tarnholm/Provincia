// Find the 3 BUILDING_CONSTRUCTION_ITEM records (buildings under construction).
// Per the section registry, these are 3 specific records in the file.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

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

// Find ALL pstr16_asciiz records that look like building names
// outside the regular settlement building lists
console.log('=== Search for building-related ASCII pstr16 strings ===');
const BUILDING_NAMES = [
  'core_building', 'defenses', 'barracks', 'market', 'equestrian', 'missiles',
  'hinterland_farms', 'hinterland_roads', 'hinterland_mines', 'amphitheatres',
  'port_buildings', 'smith', 'temple_of_governors', 'temple_of_justice',
  'temple_of_trade', 'temple_of_leadership', 'temple_of_one_god',
  'temple_of_fertility', 'temple_of_hunting', 'temple_of_law',
  'temple_of_diplomacy', 'temple_of_motherhood', 'temple_of_war',
];

// Map building name → list of all its pstr16 hit positions
const allHits = {};
for (const name of BUILDING_NAMES) {
  allHits[name] = [];
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(name.length + 1, 0);
  const target = Buffer.concat([lenBuf, Buffer.from(name + '\0')]);
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    allHits[name].push(p);
    p++;
  }
}

// Print total hits per building name
console.log('Total pstr16_asciiz hits per building category:');
for (const [name, hits] of Object.entries(allHits)) {
  if (hits.length > 0) {
    console.log('  ' + name.padEnd(25) + ' ' + hits.length + ' hits');
  }
}

// Each settlement has its built buildings. Are there EXTRA hits beyond those?
// We know from session 146 there are 246 building records across 103 settlements.
// If construction queue has 3 entries, total should be 246 + 3 = 249-ish.
const totalHits = Object.values(allHits).reduce((sum, h) => sum + h.length, 0);
console.log('\nTotal building-name pstr16 hits: ' + totalHits);
console.log('(Session 146 found 246 in walked settlements; difference might be construction)');

// Look for the "extra" hits OUTSIDE the regular settlement zones
// Settlement records are at 0x1943f-0x3c000. Hits outside that range are interesting.
console.log('\n=== Building-name hits OUTSIDE 0x1943f..0x3c000 ===');
for (const [name, hits] of Object.entries(allHits)) {
  const outside = hits.filter(h => h < 0x1943f || h > 0x3c000);
  if (outside.length > 0) {
    console.log('  ' + name + ': ' + outside.length + ' outside hits at ' + outside.slice(0, 5).map(h => '0x' + h.toString(16)).join(', '));
  }
}

// Specifically search for "core_building" near the section type registry zone
// or other unmapped sections
console.log('\n=== "core_building" hits in 0x0..0x1943f ===');
for (const h of allHits['core_building'] || []) {
  if (h < 0x1943f) {
    console.log('  0x' + h.toString(16));
    // Show context
    const start = Math.max(0, h - 32);
    const end = Math.min(buf.length, h + 32);
    const hex = Array.from(buf.slice(start, end)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    console.log('    bytes: ' + hex);
  }
}
