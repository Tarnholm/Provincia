// dig-unit-section-registry.js
// Read the section type registry (at ~0x566) and report the unit/army/soldier
// related section types + counts. Then locate where in the file the unit string
// records sit relative to faction records and settlement zone, to understand if
// the unit zone IS the army container or a separate persistent roster.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));

function readRegistry(buf) {
  let p = 0x500;
  while (p < 0xf00) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const ns = p + 4;
      if (buf[ns] >= 0x41 && buf[ns] <= 0x5a) {
        const ne = buf.indexOf(0x00, ns);
        if (ne !== -1 && ne < ns + 60) {
          const name = buf.slice(ns, ne).toString('latin1');
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  const types = [];
  while (p < buf.length - 5) {
    const count = buf.readUInt32LE(p);
    if (count > 100000) break;
    const ns = p + 4;
    const ne = buf.indexOf(0x00, ns);
    if (ne === -1 || ne > ns + 60) break;
    const name = buf.slice(ns, ne).toString('latin1');
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count, at: p });
    p = ne + 1;
  }
  return types;
}

const types = readRegistry(buf);
console.log(`Registry: ${types.length} section types`);
console.log('\nUnit/army/soldier/character-related types:');
for (const t of types) {
  if (/UNIT|ARMY|SOLDIER|BANNER|GENERAL|CHARACTER|SETTLEMENT|FORT|WATCHTOWER|FLEET|NAVY|STACK|MOVE|POSITION/.test(t.name)) {
    console.log(`  ID ${t.id.toString().padStart(3)}: ${t.name.padEnd(36)} count=${t.count}`);
  }
}

// Count units the parser finds
const recs = findUnitRecords(buf);
console.log(`\nfindUnitRecords found: ${recs.length} unit string records`);
// Tally generals/bodyguards vs combat units
const gens = recs.filter(r => /general|bodyguard|captain/.test(r.name) && r.commanderUuid != null).length;
console.log(`  with commanderUuid (general/captain bodyguards): ${gens}`);

// Print the full registry for reference
console.log('\nFull registry:');
for (const t of types) console.log(`  ID ${t.id.toString().padStart(3)}: ${t.name.padEnd(40)} count=${t.count}`);
