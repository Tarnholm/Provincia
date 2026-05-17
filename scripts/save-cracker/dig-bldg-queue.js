// Compare T1 baseline vs "Turn 1 building queued in Sparta, pella"
// This should ONLY add a building queue (not a unit queue).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BASELINE = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const BLDG = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

console.log('Baseline: ' + BASELINE.length + ' bytes');
console.log('Building queued: ' + BLDG.length + ' bytes');
console.log('Delta: +' + (BLDG.length - BASELINE.length));

// Find ALL ASCII building-name strings ADDED in the queue save
function findAsciizStringsIn(buf, start, end) {
  const strings = new Set();
  for (let p = start; p < end; p++) {
    if (buf[p] < 0x20 || buf[p] > 0x7e) continue;
    let q = p;
    while (q < end && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
    const len = q - p;
    if (len >= 4 && len <= 30) {
      const s = buf.slice(p, q).toString('latin1');
      if (/^[a-z][a-z_0-9]+$/.test(s)) strings.add(s);
    }
    p = q;
  }
  return strings;
}

const PELLA_AREA_START = 0x10500;
const PELLA_AREA_END = 0x10dac;
const SPARTA_AREA_START = 0x10dac;
const SPARTA_AREA_END = 0x11e00;

const basePella = findAsciizStringsIn(BASELINE, PELLA_AREA_START, PELLA_AREA_END);
const newPella = findAsciizStringsIn(BLDG, PELLA_AREA_START, PELLA_AREA_END + 1000);
const addedPella = [...newPella].filter(s => !basePella.has(s));
console.log('\nStrings added in Pella area: ' + (addedPella.length > 0 ? addedPella.join(', ') : 'none'));

const baseSparta = findAsciizStringsIn(BASELINE, SPARTA_AREA_START, SPARTA_AREA_END);
const newSparta = findAsciizStringsIn(BLDG, SPARTA_AREA_START, SPARTA_AREA_END + 1000);
const addedSparta = [...newSparta].filter(s => !baseSparta.has(s));
console.log('Strings added in Sparta area: ' + (addedSparta.length > 0 ? addedSparta.join(', ') : 'none'));

// Also check building queue locations in detail — show first occurrence of each NEW string in queue save
console.log('\n=== Where the new building strings appear in queue save ===');
for (const s of [...addedPella, ...addedSparta]) {
  const target = Buffer.from(s);
  // Find with length prefix (pstr16)
  for (let p = 0; p < BLDG.length - target.length - 2; p++) {
    if (BLDG[p] === s.length + 1 && BLDG[p+1] === 0) {  // pstr16 length prefix
      if (BLDG.subarray(p + 2, p + 2 + target.length).equals(target) && BLDG[p + 2 + target.length] === 0) {
        // Check baseline doesn't have it at this position
        const baseExists = BASELINE.subarray(p + 2, p + 2 + target.length).equals(target);
        console.log('  "' + s + '" pstr16 at 0x' + p.toString(16) + (baseExists ? ' (also in baseline)' : ' [NEW]'));
        break;
      }
    }
  }
}

// Direct comparison: count building name occurrences
console.log('\n=== Building name occurrence counts (queue should add one) ===');
const BUILDING_TYPES = ['core_building', 'defenses', 'barracks', 'market', 'missiles', 'equestrian',
  'smith', 'port_buildings', 'health', 'hinterland_farms', 'hinterland_roads', 'hinterland_mines',
  'amphitheatres', 'theatres', 'academic', 'despotic_law', 'taverns', 'caravans',
  'temple_of_hunting', 'temple_of_governors', 'temple_of_battle', 'temple_of_one_god',
  'temple_of_battleforge', 'temple_of_fertility', 'temple_of_forge', 'temple_of_horse',
  'temple_of_naval', 'temple_of_trade', 'temple_of_victory', 'temple_of_violence',
  'temple_of_law', 'temple_of_leadership', 'temple_of_love', 'temple_of_justice',
  'temple_of_healing', 'temple_of_fun', 'temple_of_farming'];

function countPstr16(buf, name) {
  const target = Buffer.alloc(2 + name.length + 1);
  target.writeUInt16LE(name.length + 1, 0);
  target.write(name, 2);
  target[2 + name.length] = 0;
  let count = 0;
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) { count++; p++; }
  return count;
}

console.log('Building'.padEnd(25) + ' baseline → queue (Δ)');
for (const b of BUILDING_TYPES) {
  const baseCt = countPstr16(BASELINE, b);
  const newCt = countPstr16(BLDG, b);
  if (newCt !== baseCt) {
    console.log('  ' + b.padEnd(23) + '  ' + baseCt + ' → ' + newCt + ' (Δ=' + (newCt - baseCt) + ')');
  }
}
