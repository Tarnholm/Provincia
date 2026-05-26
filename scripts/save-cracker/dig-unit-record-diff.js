// Diff matched unit records T11 vs T12 to find weapon_lvl / armor_lvl / exp fields

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T11 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

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

// Collect all unit entries in unit zone
function collectUnits(buf, fromOff, toOff) {
  const units = [];
  let p = fromOff;
  while (p < toOff && p < buf.length - 4) {
    const r = readPstr16Asciiz(buf, p);
    if (r && r.str.length >= 4 && /^[a-z][a-z _]+$/.test(r.str) && r.str.includes(' ')) {
      units.push({ off: p, str: r.str, totalLen: r.totalLen });
      p += r.totalLen;
      continue;
    }
    p++;
  }
  return units;
}

// The unit zone starts around 0x1e7b9 in T11 and 0x1eb1b in T12 (from previous scan)
const u11 = collectUnits(T11, 0x1e000, 0x40000);
const u12 = collectUnits(T12, 0x1e000, 0x40000);
console.log('T11 units: ' + u11.length);
console.log('T12 units: ' + u12.length);

// Match unit i to unit i (assuming same order)
const matchCount = Math.min(u11.length, u12.length);
console.log('Matching ' + matchCount + ' units pairwise...');

// For each matched pair, compute the byte trailer for each (next unit offset - current)
// and find differences. Look specifically for bytes where T12 = T11 + 1 (weapon+1) or
// T12 = T11 + 3 (exp+3).

const allDiffs = {};  // position (in record) -> [{unit, t11Val, t12Val}, ...]

for (let i = 0; i < matchCount - 1; i++) {
  const a = u11[i];
  const b = u12[i];
  // Length of this unit's record = distance to next unit
  const aLen = u11[i+1].off - a.off;
  const bLen = u12[i+1].off - b.off;
  if (aLen !== bLen) continue; // different size — skip
  if (aLen > 100) continue; // too big — different structure
  if (a.str !== b.str) continue; // unit type mismatch — skip
  // Diff byte-by-byte
  for (let j = a.totalLen; j < aLen; j++) {
    const t11v = T11[a.off + j];
    const t12v = T12[b.off + j];
    if (t11v !== t12v) {
      const recOff = j;  // offset within record
      if (!allDiffs[recOff]) allDiffs[recOff] = [];
      allDiffs[recOff].push({ unit: a.str, off: a.off, t11v, t12v, delta: t12v - t11v });
    }
  }
}

console.log('\n=== Byte positions in unit record that DIFFER between T11/T12 ===');
const positions = Object.keys(allDiffs).map(Number).sort((a, b) => a - b);
for (const pos of positions) {
  const diffs = allDiffs[pos];
  console.log('\n  +' + pos.toString().padStart(2) + ': ' + diffs.length + ' units differ here');
  // Show first 8
  for (const d of diffs.slice(0, 8)) {
    console.log('    "' + d.unit + '"@0x' + d.off.toString(16) + ': T11=' + d.t11v + ' T12=' + d.t12v + ' Δ=' + (d.delta > 0 ? '+' : '') + d.delta);
  }
}

// Find positions where T12-T11 is consistently +1 or +3 (weapon or exp upgrade pattern)
console.log('\n=== Positions where T12-T11 = +1 (weapon upgrade?) ===');
for (const pos of positions) {
  const diffs = allDiffs[pos];
  const plusOnes = diffs.filter(d => d.delta === 1);
  if (plusOnes.length >= 2) {
    console.log('  +' + pos + ': ' + plusOnes.length + ' units have +1 change');
    for (const d of plusOnes.slice(0, 5)) {
      console.log('    "' + d.unit + '": ' + d.t11v + ' -> ' + d.t12v);
    }
  }
}

console.log('\n=== Positions where T12-T11 = +3 (experience upgrade?) ===');
for (const pos of positions) {
  const diffs = allDiffs[pos];
  const plusThrees = diffs.filter(d => d.delta === 3);
  if (plusThrees.length >= 2) {
    console.log('  +' + pos + ': ' + plusThrees.length + ' units have +3 change');
    for (const d of plusThrees.slice(0, 5)) {
      console.log('    "' + d.unit + '": ' + d.t11v + ' -> ' + d.t12v);
    }
  }
}
