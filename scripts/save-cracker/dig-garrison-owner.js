// Derive settlement ownership from garrison units.
// For each region, find which faction's units are present. That faction = owner.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

// Find all unit records
const UNITS = [];
let p = 0x37000;
while (p < buf.length) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6 && len <= 50) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ') && s[0] === s[0].toLowerCase()) {
      // Read location pstr16 after type
      const afterType = p + len;
      let locRec = null;
      for (let skip = 0; skip < 30; skip++) {
        const r = readPstr16Utf16(buf, afterType + skip);
        if (r && r.str.length >= 3) {
          locRec = r;
          break;
        }
      }
      if (locRec) {
        UNITS.push({ off: p, type: s, location: locRec.str });
      }
    }
  }
  p = q + 1;
}
console.log('Total units: ' + UNITS.length);

// Map unit-type prefix → faction
// Type prefix tells us the unit's faction-of-origin (cultural source)
// e.g. "spanish scutarii" = Spain-typed, "carthaginian cavalry" = Carthage-typed
const PREFIX_TO_FACTION = {
  spanish: 'spain',
  carthaginian: 'carthage',
  numidian: 'numidia',
  egyptian: 'egypt',
  thracian: 'thrace',
  roman: 'rome_general',  // could be any Roman family
  greek: 'greek_or_macedon',
  east: 'eastern',  // parthia/pontus/armenia/seleucid
  warband: 'barbarian',
  barb: 'barbarian',  // gauls/germans/britons/dacia/scythia
  merc: 'mercenary',
  naval: 'any',
  rebel: 'rebel',
  eastern: 'rebel',
  barbarian: 'rebel',
};

// Group units by location (region/settlement)
const byLocation = {};
for (const u of UNITS) {
  const facPrefix = u.type.split(' ')[0];
  if (!byLocation[u.location]) byLocation[u.location] = [];
  byLocation[u.location].push({ unit: u.type, factionPrefix: facPrefix });
}

// For each location, print the faction distribution
console.log('\n=== Garrison composition by region/location ===');
const locations = Object.keys(byLocation).sort();
for (const loc of locations.slice(0, 50)) {
  const units = byLocation[loc];
  const facCounts = {};
  for (const u of units) facCounts[u.factionPrefix] = (facCounts[u.factionPrefix] || 0) + 1;
  const summary = Object.entries(facCounts).sort((a, b) => b[1] - a[1])
    .map(([f, n]) => f + '×' + n).join(', ');
  console.log('  ' + loc.padEnd(25) + ' (' + units.length + ' units): ' + summary);
}

// Focus on Spain's regions
console.log('\n=== Spain\'s expected regions ===');
const SPAIN_REGIONS = ['Hispania', 'Lusitania', 'Gallaecia', 'Taraconenis', 'Baetica', 'Celtiberia'];
for (const region of SPAIN_REGIONS) {
  const units = byLocation[region] || [];
  if (units.length === 0) {
    console.log('  ' + region + ': NO units');
    continue;
  }
  const facCounts = {};
  for (const u of units) facCounts[u.factionPrefix] = (facCounts[u.factionPrefix] || 0) + 1;
  const summary = Object.entries(facCounts).sort((a, b) => b[1] - a[1])
    .map(([f, n]) => f + '×' + n).join(', ');
  console.log('  ' + region.padEnd(15) + ' (' + units.length + ' units): ' + summary);
}
