// For each unit record, extract the surrounding UUID/owner field.
// If unit ownership clusters by UUID, those UUIDs are faction IDs.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Find all unit-type ASCII strings in 0x37000..end
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
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ')) {
      // Don't match settlement names like "Vicus_Gothi" — those don't contain space
      // Filter on lowercase first char (unit types)
      if (s[0] === s[0].toLowerCase()) {
        UNITS.push({ off: p, type: s });
      }
    }
  }
  p = q + 1;
}

console.log('Total unit records: ' + UNITS.length);

// For each unit, look at the u32 fields BEFORE the type string for owner info
// Typically: u32@-4 = some count, u32@-8 = some flag, u32@-12 = uuid, u32@-16 = uuid2
// Look ~32 bytes before for an interesting structure
const OWNER_HISTOGRAM = {};
for (const u of UNITS) {
  // Find the most "significant" u32 in the 32 bytes before type name
  // A faction UUID would be a non-zero non-pointer value with bounded frequency
  for (let back = -32; back <= -4; back += 4) {
    const addr = u.off + back;
    if (addr < 0) continue;
    const v = buf.readUInt32LE(addr);
    // Skip small numbers (counts, indices)
    if (v < 100) continue;
    if (v > 0xFF000000) continue;  // Skip negative/large pointers
    // Track this as candidate owner
    const key = back + ':' + v;
    OWNER_HISTOGRAM[key] = (OWNER_HISTOGRAM[key] || 0) + 1;
  }
}

// Look for offsets where ~20 unique values each appear ~30 times (would be faction owners)
// Group by back-offset
const byBackOff = {};
for (const [key, count] of Object.entries(OWNER_HISTOGRAM)) {
  const [back, v] = key.split(':');
  if (!byBackOff[back]) byBackOff[back] = [];
  byBackOff[back].push({ v: parseInt(v), count });
}

console.log('\n=== Per back-offset: # of unique values + top 5 ===');
for (const [back, candidates] of Object.entries(byBackOff)) {
  candidates.sort((a, b) => b.count - a.count);
  if (candidates.length < 50) {  // Limit to small unique sets
    console.log('  back=' + back + ': ' + candidates.length + ' unique values. Top 5: ' +
      candidates.slice(0, 5).map(c => c.v + '(×' + c.count + ')').join(', '));
  }
}

// Try u32 fields at +18 to +60 after the unit type (where data starts after name+region)
// Actually let me try a simpler approach: cluster units by their type-name prefix
// (which tells us their faction)
console.log('\n=== Unit type prefix clustering (faction inference) ===');
const factionByType = {};
for (const u of UNITS) {
  // Extract first word
  const fac = u.type.split(' ')[0];
  if (!factionByType[fac]) factionByType[fac] = [];
  factionByType[fac].push(u);
}
const sortedFactions = Object.entries(factionByType).sort((a, b) => b[1].length - a[1].length);
for (const [fac, units] of sortedFactions.slice(0, 20)) {
  console.log('  ' + fac.padEnd(15) + ' = ' + units.length + ' units (examples: ' + units.slice(0, 3).map(u => u.type).join(', ') + ')');
}
