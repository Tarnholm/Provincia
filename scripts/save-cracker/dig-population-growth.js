// Find settlement population GROWTH RATE.
// In Spain T1->T2 (just end-turn), populations should grow by ~0.5%-2% per turn.
// Find u32 fields where T2 = T1 * 1.005..1.03 (typical RTW growth rate).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

console.log('T1: ' + T1.length);
console.log('T2: ' + T2.length);

// Spain settlement populations (approximate from descr_strat for Spain in RIS):
// Most settlements should be a few thousand. Let me search for u32 where T1 is 1000-25000
// and T2 = T1 * 1.005..1.03.

const candidates = [];
const minLen = Math.min(T1.length, T2.length);
for (let off = 0x1000; off < minLen - 4; off += 4) {
  const v1 = T1.readUInt32LE(off);
  const v2 = T2.readUInt32LE(off);
  if (v1 < 800 || v1 > 25000) continue;
  if (v2 <= v1) continue;
  const ratio = v2 / v1;
  if (ratio < 1.001 || ratio > 1.05) continue;
  // Must be a population — not multiples of 256
  if (v1 % 256 === 0) continue;
  candidates.push({ off, v1, v2, ratio, delta: v2 - v1 });
}

console.log('\n=== Population growth candidates: T1 in [800,25000], T2/T1 in [1.001, 1.05] ===');
console.log('Found ' + candidates.length + ' candidates');
candidates.sort((a, b) => Math.abs(a.ratio - 1.015) - Math.abs(b.ratio - 1.015));
console.log('\nTop 30 closest to typical +1.5% growth:');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + '  T1=' + c.v1 + '  T2=' + c.v2 +
    '  ratio=' + c.ratio.toFixed(4) + '  Δ=+' + c.delta);
}

// In RTW the pop count is shown as soldiers in display, but stored as raw pop count.
// Settlements with growth issues (plague, lower farming) would NOT grow.
// Let me also check pairs that are u32-aligned AND the surrounding bytes look like a stats block.

// Look for settlement-level pattern around candidates: high u32 values nearby (population),
// low u8 values nearby (level, tax rate, public order)
console.log('\n=== Context dump for top 5 candidates ===');
for (const c of candidates.slice(0, 5)) {
  console.log('\nu32@0x' + c.off.toString(16) + ' T1=' + c.v1 + ' T2=' + c.v2);
  // Show 16 u32s before and after
  for (let i = -32; i <= 32; i += 4) {
    const v1 = T1.readInt32LE(c.off + i);
    const v2 = T2.readInt32LE(c.off + i);
    if (i === 0) console.log('    +' + i.toString().padStart(3) + ': T1=' + v1 + '  T2=' + v2 + '   <-- CANDIDATE');
    else if (v1 !== v2) console.log('    +' + i.toString().padStart(3) + ': T1=' + v1 + '  T2=' + v2 + '  Δ=' + (v2 - v1));
  }
}
