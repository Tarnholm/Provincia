// Survey culture-byte distribution across ALL building entries in the save.
// RTW culture IDs (Alexander):
//   0 = barbarian, 1 = greek, 2 = roman, 3 = egyptian, 4 = carthaginian, 5 = eastern
//   255 = wildcard / no-culture
//
// User's point: a barbarian smith can upgrade to a greek smith on the next tier.
// So buildings preserve the original culture until upgraded. We should see
// culture=0 buildings inside settlements currently owned by non-barbarian factions.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

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

// Scan whole file for pstr16 ASCII strings that look like building chain names
// then read the tier/culture bytes.

const buildingChains = new Set([
  'core_building', 'defenses', 'barracks', 'market', 'port_buildings',
  'hinterland_farms', 'hinterland_roads', 'smith', 'taverns', 'bath',
  'amphitheater', 'sewers', 'temple_of_horse', 'temple_of_horse_2',
  'temple_of_battle', 'temple_of_war', 'temple_of_battle_2', 'temple_of_war_2',
  'equestrian', 'governors_villa', 'mines', 'horse_breeder',
  'archery_range', 'practice_field', 'wall', 'palace',
]);

const findings = [];
let p = 0;
while (p < SAVE.length - 4) {
  const r = readPstr16Asciiz(SAVE, p);
  if (!r) { p++; continue; }
  if (!buildingChains.has(r.str) && !/^[a-z_][a-z_0-9]+$/.test(r.str)) { p++; continue; }
  if (r.str.length < 4) { p++; continue; }
  // Only consider entries followed by what looks like a building trailer
  if (p + r.totalLen + 78 > SAVE.length) break;
  const tier = SAVE[p + r.totalLen + 4];
  const culture = SAVE[p + r.totalLen + 76];
  // Trailers have a stable byte pattern at +5 (often 0x44, 0x43, 0xc4, 0x61, etc.)
  const t5 = SAVE[p + r.totalLen + 5];
  if (![0x44, 0x43, 0xc4, 0xc2, 0xc3, 0x45, 0x61, 0x00].includes(t5)) { p++; continue; }
  if (tier > 10) { p++; continue; }
  findings.push({ off: p, name: r.str, tier, culture });
  p += r.totalLen + 78;
}

console.log('Total building-looking entries found: ' + findings.length);

// Tally culture distribution
const cultureCounts = {};
for (const f of findings) cultureCounts[f.culture] = (cultureCounts[f.culture] || 0) + 1;
console.log('\nCulture byte distribution:');
const cultureNames = { 0: 'barbarian', 1: 'greek', 2: 'roman', 3: 'egyptian', 4: 'carthaginian', 5: 'eastern', 255: 'wildcard/none' };
for (const [c, count] of Object.entries(cultureCounts).sort((a, b) => b[1] - a[1])) {
  console.log('  culture=' + c.padStart(3) + ' (' + (cultureNames[c] || '?') + '): ' + count);
}

// List the BARBARIAN-cultured buildings (culture=0)
console.log('\n=== Buildings tagged culture=0 (barbarian) — should be in captured-from-barbarian zones ===');
const barbarian = findings.filter(f => f.culture === 0);
for (const f of barbarian.slice(0, 30)) {
  console.log('  0x' + f.off.toString(16).padStart(6) + '  ' + f.name.padEnd(28) + ' tier=' + f.tier);
}
console.log('Total barbarian-cultured: ' + barbarian.length);

// List CARTHAGINIAN / EASTERN cultured
console.log('\n=== Buildings tagged with non-greek/non-wildcard culture ===');
const nonGreek = findings.filter(f => f.culture !== 1 && f.culture !== 255);
const byCulture = {};
for (const f of nonGreek) {
  byCulture[f.culture] = (byCulture[f.culture] || 0) + 1;
}
console.log('Non-greek/non-wildcard counts:');
for (const [c, count] of Object.entries(byCulture).sort((a, b) => b[1] - a[1])) {
  console.log('  culture=' + c + ' (' + (cultureNames[c] || '?') + '): ' + count);
}

// Show a sample of culture=5 (eastern) buildings if any
const eastern = findings.filter(f => f.culture === 5);
console.log('\nFirst 15 eastern-cultured buildings:');
for (const f of eastern.slice(0, 15)) {
  console.log('  0x' + f.off.toString(16) + '  ' + f.name + ' tier=' + f.tier);
}

// And barbarian smiths specifically — these would prove the user's point
const barbSmith = findings.filter(f => f.culture === 0 && f.name === 'smith');
console.log('\n=== Barbarian smiths (culture=0): ' + barbSmith.length + ' ===');
for (const f of barbSmith) {
  console.log('  0x' + f.off.toString(16) + '  smith tier=' + f.tier);
}
