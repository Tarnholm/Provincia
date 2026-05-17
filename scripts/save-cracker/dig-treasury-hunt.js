// Find Spain's per-turn treasury. It should:
//   1. Be the SAME across all same-turn saves (T4 Start, T4 attack, T4 besieged)
//   2. CHANGE between turns (T1 → T2 → T3 → T4)
//   3. Be in the range 100..100000 (plausible treasury)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

// Categorize saves by turn (using year + filename hints)
const T1_SAVES = [];
const T4_SAVES = [];
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const year = buf.readInt32LE(0x514);
  if (f.includes('Turn 1') && !f.includes('Turn 2') && year === -270) T1_SAVES.push(buf);
  else if ((f.includes('Turn 4') || f.includes('besiged')) && year === -269) T4_SAVES.push(buf);
}
console.log('T1 saves:', T1_SAVES.length, '  T4 saves:', T4_SAVES.length);

// Find u32 positions where:
//   - All T4 saves have the SAME value
//   - All T1 saves have the SAME value
//   - T1 value != T4 value
//   - Both values are in [100..100000]
console.log('\n=== Treasury candidates ===');
const candidates = [];
const len = Math.min(...T1_SAVES.map(b => b.length), ...T4_SAVES.map(b => b.length));
for (let off = 0; off < 0x10000; off += 4) {
  if (off + 4 > len) break;
  const t1Vals = new Set(T1_SAVES.map(b => b.readInt32LE(off)));
  const t4Vals = new Set(T4_SAVES.map(b => b.readInt32LE(off)));
  if (t1Vals.size !== 1 || t4Vals.size !== 1) continue;
  const t1v = T1_SAVES[0].readInt32LE(off);
  const t4v = T4_SAVES[0].readInt32LE(off);
  if (t1v === t4v) continue;
  if (t1v < 100 || t1v > 100000) continue;
  if (t4v < 100 || t4v > 100000) continue;
  candidates.push({ off, t1: t1v, t4: t4v });
}
console.log('Found ' + candidates.length + ' candidates');
candidates.sort((a, b) => a.off - b.off);
for (const c of candidates) {
  console.log('  u32@0x' + c.off.toString(16) + ': T1=' + c.t1 + '  T4=' + c.t4 + '  Δ=' + (c.t4 - c.t1));
}
