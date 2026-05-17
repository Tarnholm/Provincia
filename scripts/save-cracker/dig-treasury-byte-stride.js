// Try byte-stride (off += 1 instead of 4) and tighter range.
// Also try i64 (8-byte values).

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

const len = Math.min(...Object.values(TURN_GROUPS).flat().map(b => b.length));

// Try byte-stride
console.log('=== Strict treasury (byte-aligned, same value within turn) ===');
const candidates = [];
for (let off = 0x100; off < len - 4; off += 1) {  // BYTE stride
  const turnVals = {};
  let okSameTurn = true;
  for (const t of [1, 2, 3, 4]) {
    const vals = TURN_GROUPS[t].map(b => b.readUInt32LE(off));
    if (new Set(vals).size !== 1) { okSameTurn = false; break; }
    turnVals[t] = vals[0];
  }
  if (!okSameTurn) continue;
  if (turnVals[1] === turnVals[4]) continue;
  if (Object.values(turnVals).some(v => v < 500 || v > 50000)) continue;
  if (Object.values(turnVals).every(v => v % 256 === 0)) continue;
  candidates.push({ off, turnVals });
}
console.log('Found ' + candidates.length + ' byte-aligned candidates');
candidates.sort((a, b) => {
  const dA = Math.max(...Object.values(a.turnVals)) - Math.min(...Object.values(a.turnVals));
  const dB = Math.max(...Object.values(b.turnVals)) - Math.min(...Object.values(b.turnVals));
  return dA - dB;
});
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) +
    ': T1=' + c.turnVals[1] + ' T2=' + c.turnVals[2] + ' T3=' + c.turnVals[3] + ' T4=' + c.turnVals[4]);
}

// Also try u16 fields
console.log('\n=== u16 strict candidates ===');
const u16cands = [];
for (let off = 0x100; off < len - 2; off += 1) {
  const turnVals = {};
  let ok = true;
  for (const t of [1, 2, 3, 4]) {
    const vals = TURN_GROUPS[t].map(b => b.readUInt16LE(off));
    if (new Set(vals).size !== 1) { ok = false; break; }
    turnVals[t] = vals[0];
  }
  if (!ok) continue;
  if (turnVals[1] === turnVals[4]) continue;
  if (Object.values(turnVals).some(v => v < 1000 || v > 30000)) continue;
  if (Object.values(turnVals).every(v => v % 256 === 0)) continue;
  u16cands.push({ off, turnVals });
}
console.log('Found ' + u16cands.length + ' u16 candidates');
u16cands.sort((a, b) => {
  const dA = Math.max(...Object.values(a.turnVals)) - Math.min(...Object.values(a.turnVals));
  const dB = Math.max(...Object.values(b.turnVals)) - Math.min(...Object.values(b.turnVals));
  return dA - dB;
});
for (const c of u16cands.slice(0, 20)) {
  console.log('  u16@0x' + c.off.toString(16) +
    ': T1=' + c.turnVals[1] + ' T2=' + c.turnVals[2] + ' T3=' + c.turnVals[3] + ' T4=' + c.turnVals[4]);
}
