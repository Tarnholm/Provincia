// Compare the two "roman hastati early" units' soldier records.
// One was retrained (weapon_lvl 1), the other not (weapon_lvl 0).
// The byte that DIFFERS identifies weapon_lvl.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

const HASTATI_1 = 0x1547146;
const HASTATI_2 = 0x15479d1;

// Show context around each
function dump(off, label) {
  console.log('\n=== ' + label + ' @ 0x' + off.toString(16) + ' ===');
  const end = off + 1500;
  for (let p = off; p < end; p += 32) {
    const hex = Array.from(T4.slice(p, p + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(p, p + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  0x' + p.toString(16) + ': ' + hex + '  |' + ascii + '|');
  }
}

dump(HASTATI_1, 'Hastati 1');
dump(HASTATI_2, 'Hastati 2');

// Both units have the same TYPE name. Their records start at the name position.
// Find where the soldier arrays start (after the name + metadata).
// Compare the bytes ALIGNED to each unit's start.
console.log('\n=== Byte-by-byte diff of corresponding offsets (relative to each name) ===');
const RECORD_SPAN = 1500;
let diffs = [];
for (let dx = 0; dx < RECORD_SPAN; dx++) {
  const a = T4[HASTATI_1 + dx];
  const b = T4[HASTATI_2 + dx];
  if (a !== b) {
    diffs.push({ dx, a, b });
  }
}
console.log('Total byte differences: ' + diffs.length);
// Print first 100 differences
for (const d of diffs.slice(0, 100)) {
  console.log('  +' + d.dx.toString().padStart(4) + ' (Hastati 1 @ 0x' + (HASTATI_1 + d.dx).toString(16) + '): h1=' + d.a.toString(16).padStart(2, '0') + ' h2=' + d.b.toString(16).padStart(2, '0'));
}

// Look for byte positions where ONE soldier has a specific weapon-like value (0x01 or 0x04)
// and the OTHER has 0x00. With 122 soldiers and 9-byte stride, there should be a CLEAN pattern.
console.log('\n=== Looking for STRIDED differences (suggests one byte per soldier varies) ===');
// Group diffs by their position MODULO 9 (to detect a 9-byte stride pattern)
const modCounts = {};
for (const d of diffs) {
  for (let s = 5; s <= 12; s++) {
    const mod = d.dx % s;
    if (!modCounts[s]) modCounts[s] = {};
    if (!modCounts[s][mod]) modCounts[s][mod] = 0;
    modCounts[s][mod]++;
  }
}
console.log('Diff distribution by stride+offset (top per stride):');
for (const s of [7, 8, 9, 10, 11, 12]) {
  const entries = Object.entries(modCounts[s] || {}).sort((a, b) => b[1] - a[1]);
  console.log('  stride=' + s + ': ' + entries.slice(0, 4).map(([m, c]) => 'off=' + m + ':' + c).join(', '));
}
