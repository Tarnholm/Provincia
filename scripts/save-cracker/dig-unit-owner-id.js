// Identify per-unit owner UUID. Each unit's record header has fields before
// the type-name ASCII. Look for the field that clusters into ~20 distinct values
// (one per faction).

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
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ') && s[0] === s[0].toLowerCase()) {
      UNITS.push({ off: p, type: s });
    }
  }
  p = q + 1;
}
console.log('Total units: ' + UNITS.length);

// For each unit, scan -48 to +200 bytes for fields that cluster well
// Specifically look for u32 values that:
//   1. Have ~15-25 unique values across all 649 units (matches # of factions)
//   2. Distribution roughly matches faction inference from unit type prefix
//   3. NOT zero, NOT 0xffffffff
console.log('\n=== Find u32 offsets with ~15-25 unique values across all units ===');
for (let relOff = -48; relOff < 300; relOff += 4) {
  const vals = [];
  for (const u of UNITS) {
    if (u.off + relOff + 4 > buf.length || u.off + relOff < 0) continue;
    const v = buf.readUInt32LE(u.off + relOff);
    vals.push(v);
  }
  const unique = new Set(vals);
  if (unique.size >= 12 && unique.size <= 30) {
    // Get top values
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log('  rel-offset ' + (relOff >= 0 ? '+' : '') + relOff + ': ' + unique.size + ' unique. Top: ' +
      top.map(([v, n]) => v + '×' + n).join(', '));
  }
}

// Cross-reference: which u32 values correlate with the unit-type prefix?
// If field@rel=X has distinct value=V for all "roman" units and distinct V' for "carthaginian", that's the owner ID
console.log('\n=== Cross-correlation: unit-type prefix vs candidate owner fields ===');
const FACTION_PREFIXES = ['barb', 'greek', 'merc', 'east', 'roman', 'carthaginian', 'egyptian',
  'numidian', 'spanish', 'thracian', 'warband', 'naval', 'rebel', 'eastern', 'barbarian'];

// Best-correlation offset
const CANDIDATE_OFFSETS = [-32, -24, -16, -12, -8, -4];
for (const relOff of CANDIDATE_OFFSETS) {
  console.log('\n  --- rel-offset ' + relOff + ' ---');
  const byPrefix = {};
  for (const u of UNITS) {
    if (u.off + relOff + 4 > buf.length || u.off + relOff < 0) continue;
    const v = buf.readUInt32LE(u.off + relOff);
    const prefix = u.type.split(' ')[0];
    if (!byPrefix[prefix]) byPrefix[prefix] = {};
    byPrefix[prefix][v] = (byPrefix[prefix][v] || 0) + 1;
  }
  // For each faction prefix, find its dominant value
  for (const fac of FACTION_PREFIXES) {
    const counts = byPrefix[fac];
    if (!counts) continue;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > 1) {
      const purity = (top[1] / total * 100).toFixed(0);
      console.log('    ' + fac.padEnd(15) + ' dominant=' + top[0] + ' (' + purity + '% of ' + total + ' units)');
    }
  }
}
