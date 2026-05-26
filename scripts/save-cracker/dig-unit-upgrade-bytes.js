// Find per-unit weapon_lvl / experience bytes by diffing T11 (pre-retrain)
// vs T12 (post-retrain). Retrained units at Epidamnus should show:
//   weapon_lvl: +1 (from smith blacksmith)
//   experience: +3 (from temple_of_horse_2 / large_temple)
//   armour_lvl: 0 (blacksmith doesn't give armor)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T11 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

console.log('T11: ' + T11.length + ' bytes');
console.log('T12: ' + T12.length + ' bytes');
console.log('Δsize: ' + (T12.length - T11.length));

// Find Epidamnus settlement record positions
function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const epi11 = findUtf16(T11, 'Epidamnus');
const epi12 = findUtf16(T12, 'Epidamnus');
console.log('Epidamnus T11 @ 0x' + epi11.toString(16) + ', T12 @ 0x' + epi12.toString(16));
console.log('Shift: ' + (epi12 - epi11) + ' bytes');

// Unit records in RTW saves typically have: weapon_lvl, armour_lvl, exp, soldiers
// These are usually small u8 values (0-9 for upgrade levels, 0-9 for exp chevrons,
// 1-360 for soldier count).
//
// Diff strategy: find all u8 bytes where T11=X and T12=X+1 (weapon bump) or
// T11=Y and T12=Y+3 (exp bump). Look at clusters of nearby changes.

// Step 1: Find all SHIFT-INVARIANT changed bytes (positions where the byte
// changed AT THE SAME ABSOLUTE OFFSET in both files — i.e., zones that didn't shift)

const minLen = Math.min(T11.length, T12.length);
console.log('\n=== Looking for unit-record patterns ===');

// Look for byte-pairs (weapon_lvl, armour_lvl) where T11 is (0,0) and T12 is (1,0)
// Adjacent to bytes that might be exp (T11=0, T12=3)
const candidates = [];
for (let off = 0x1000; off < minLen - 16; off++) {
  // weapon+1, armor same
  const w11 = T11[off];
  const w12 = T12[off];
  if (w12 - w11 !== 1) continue;
  if (w11 > 5) continue; // weapon_lvl max usually <= 3
  // Look for exp change in nearby bytes (±32)
  for (let dx = -32; dx <= 32; dx++) {
    if (dx === 0) continue;
    const e11 = T11[off + dx];
    const e12 = T12[off + dx];
    if (e12 - e11 !== 3) continue;
    if (e11 > 6) continue; // exp 0-9
    candidates.push({ wOff: off, eOff: off + dx, w11, w12, e11, e12 });
  }
}

console.log('Found ' + candidates.length + ' candidate weapon+1 / exp+3 pairs');
console.log('Top 40 (by closest weapon-exp distance):');
candidates.sort((a, b) => Math.abs(a.eOff - a.wOff) - Math.abs(b.eOff - b.wOff));
for (const c of candidates.slice(0, 40)) {
  console.log('  wOff=0x' + c.wOff.toString(16) + ' eOff=0x' + c.eOff.toString(16) +
    ' dx=' + (c.eOff - c.wOff) +
    '  weapon ' + c.w11 + '->' + c.w12 + '  exp ' + c.e11 + '->' + c.e12);
}

// Group candidates by their offset modulo common unit-record sizes (e.g., dx=2,3,4,8)
console.log('\n=== Most common weapon-exp byte distance ===');
const dxCounts = {};
for (const c of candidates) {
  const dx = c.eOff - c.wOff;
  dxCounts[dx] = (dxCounts[dx] || 0) + 1;
}
const sortedDx = Object.entries(dxCounts).sort((a, b) => b[1] - a[1]);
for (const [dx, count] of sortedDx.slice(0, 10)) {
  console.log('  dx=' + dx + ': ' + count + ' candidates');
}

// Also output sample regions where these patterns cluster
console.log('\n=== Top weapon-exp clusters (by region) ===');
const regions = {};
for (const c of candidates) {
  const region = Math.floor(c.wOff / 0x1000) * 0x1000;
  if (!regions[region]) regions[region] = [];
  regions[region].push(c);
}
const sortedRegions = Object.entries(regions).sort((a, b) => b[1].length - a[1].length);
for (const [region, cands] of sortedRegions.slice(0, 5)) {
  console.log('  region 0x' + parseInt(region).toString(16) + ': ' + cands.length + ' candidates');
}
