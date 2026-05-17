// Full-file treasury scan with stricter isolation criteria.
// Spain's vanilla starting treasury is around 5000-10000 denarii.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const SAVES = [];
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const year = buf.readInt32LE(0x514);
  SAVES.push({ name: f, buf, year, size: buf.length });
}
SAVES.sort((a, b) => a.size - b.size);

const T1_SAVES = SAVES.filter(s => s.name.includes('Turn 1'));
const T4_SAVES = SAVES.filter(s => s.name.includes('Turn 4'));
console.log('T1 saves:', T1_SAVES.length, '  T4 saves:', T4_SAVES.length);

// At T1, treasury would be ~5000-10000. At T4 it would be 8000-16000.
// Use SAME-turn-stability + cross-turn-variation filter:
//   - All T1 saves: same value (treasury doesn't change within a turn)
//   - All T4 saves: same value (or very close)
//   - T1 vs T4: different (treasury changed over 3 turns)

const len = Math.min(...SAVES.map(s => s.buf.length));
console.log('Common file length: ' + len);

const isolatedCandidates = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const t1Vals = T1_SAVES.map(s => s.buf.readInt32LE(off));
  const t4Vals = T4_SAVES.map(s => s.buf.readInt32LE(off));

  // Filter to plausible treasury range
  const t1v = t1Vals[0];
  const t4v = t4Vals[0];
  if (t1v < 1000 || t1v > 30000) continue;
  if (t4v < 1000 || t4v > 30000) continue;
  // All T1 saves same; all T4 saves same
  if (new Set(t1Vals).size !== 1) continue;
  if (new Set(t4Vals).size !== 1) continue;
  if (t1v === t4v) continue;
  // Stricter isolation: neighbors must be radically different magnitude
  let neighborHits = 0;
  for (const delta of [-16, -12, -8, -4, 4, 8, 12, 16]) {
    if (off + delta < 0 || off + delta + 4 > len) continue;
    const n = SAVES[0].buf.readInt32LE(off + delta);
    if (n >= 500 && n <= 35000) neighborHits++;
  }
  if (neighborHits >= 2) continue;  // Too many similar neighbors → it's an array
  isolatedCandidates.push({ off, t1v, t4v, neighborHits });
}

console.log('\n=== Found ' + isolatedCandidates.length + ' isolated candidates in full file ===');
// Sort by Δ — treasury should grow modestly (1000-10000 over 3 turns)
isolatedCandidates.sort((a, b) => {
  const dA = Math.abs(a.t4v - a.t1v);
  const dB = Math.abs(b.t4v - b.t1v);
  return dA - dB;
});

console.log('\nTop 30 candidates (sorted by spread; small spread = stable treasury growth):');
for (const c of isolatedCandidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' T1=' + c.t1v + ' T4=' + c.t4v + ' Δ=' + (c.t4v - c.t1v) + ' nbrs=' + c.neighborHits);
}

// Also try i32 (signed) since treasury could go negative (debt)
console.log('\n=== Negative-treasury candidates (i32 < 0 anywhere) ===');
const debt = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const t1Vals = T1_SAVES.map(s => s.buf.readInt32LE(off));
  const t4Vals = T4_SAVES.map(s => s.buf.readInt32LE(off));
  const allVals = [...t1Vals, ...t4Vals];
  if (!allVals.some(v => v < 0)) continue;
  if (allVals.some(v => v < -30000 || v > 30000)) continue;
  if (new Set(t1Vals).size !== 1) continue;
  if (new Set(t4Vals).size !== 1) continue;
  if (t1Vals[0] === t4Vals[0]) continue;
  debt.push({ off, t1: t1Vals[0], t4: t4Vals[0] });
}
console.log('Found ' + debt.length + ' negative-treasury candidates');
for (const c of debt.slice(0, 10)) {
  console.log('  i32@0x' + c.off.toString(16) + ' T1=' + c.t1 + ' T4=' + c.t4);
}
