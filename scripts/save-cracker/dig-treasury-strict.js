// STRICTER treasury hunt: same value across ALL same-turn saves.
// Spain's treasury should be IDENTICAL across the 3 T1 saves AND across the 5 T4 saves.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const TURN_GROUPS = { 1: [], 2: [], 3: [], 4: [] };
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      TURN_GROUPS[t].push(fs.readFileSync(path.join(BASE, f)));
      break;
    }
  }
}
for (const t of [1, 2, 3, 4]) console.log('T' + t + ': ' + TURN_GROUPS[t].length + ' saves');

const len = Math.min(...Object.values(TURN_GROUPS).flat().map(b => b.length));
console.log('Min file length: ' + len);

// For each u32 offset, require ALL same-turn saves to have IDENTICAL values
// AND require T1, T2, T3, T4 all DIFFER (or at least 2 of them differ)
const candidates = [];
for (let off = 0x100; off < len - 4; off += 4) {
  // Check each turn group has identical values
  const turnVals = {};
  let okSameTurn = true;
  for (const t of [1, 2, 3, 4]) {
    const vals = TURN_GROUPS[t].map(b => b.readUInt32LE(off));
    if (new Set(vals).size !== 1) { okSameTurn = false; break; }
    turnVals[t] = vals[0];
  }
  if (!okSameTurn) continue;
  // T1 must differ from T4
  if (turnVals[1] === turnVals[4]) continue;
  // Plausible treasury range
  if (Object.values(turnVals).some(v => v < 1000 || v > 100000)) continue;
  // Skip fixed-point
  if (Object.values(turnVals).every(v => v % 256 === 0)) continue;
  candidates.push({ off, turnVals });
}

console.log('\n=== Strict candidates ===');
console.log('Found: ' + candidates.length);

// Sort by smallest spread (treasury should grow modestly)
candidates.sort((a, b) => {
  const dA = Math.max(...Object.values(a.turnVals)) - Math.min(...Object.values(a.turnVals));
  const dB = Math.max(...Object.values(b.turnVals)) - Math.min(...Object.values(b.turnVals));
  return dA - dB;
});

for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) +
    ': T1=' + c.turnVals[1] + ' T2=' + c.turnVals[2] + ' T3=' + c.turnVals[3] + ' T4=' + c.turnVals[4]);
}
