// Treasury hunt v2: properly categorize saves by turn number

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const BY_TURN = { 1: [], 2: [], 3: [], 4: [] };
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      BY_TURN[t].push({ name: f, buf });
      break;
    }
  }
}
for (const t of [1, 2, 3, 4]) {
  console.log('T' + t + ' saves: ' + BY_TURN[t].length + ' — ' + BY_TURN[t].map(s => s.name).join(' | '));
}

// Pick the SMALLEST save per turn (most representative of clean turn-start state)
const TURN_REPS = {};
for (const t of [1, 2, 3, 4]) {
  if (BY_TURN[t].length === 0) continue;
  BY_TURN[t].sort((a, b) => a.buf.length - b.buf.length);
  TURN_REPS[t] = BY_TURN[t][0].buf;
  console.log('T' + t + ' rep: ' + BY_TURN[t][0].name + ' (' + BY_TURN[t][0].buf.length + ' bytes)');
}

const turns = Object.keys(TURN_REPS).map(Number).sort((a, b) => a - b);
console.log('\nUsing turns: ' + turns.join(', '));

const len = Math.min(...Object.values(TURN_REPS).map(b => b.length));

// Hunt for monotonically growing u32 with small per-turn deltas
const candidates = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const vals = turns.map(t => TURN_REPS[t].readUInt32LE(off));
  if (vals.some(v => v < 100 || v > 100000)) continue;
  // Strictly monotonic (treasury accumulates)
  let strictlyMonoUp = true;
  let strictlyMonoDown = true;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] <= vals[i-1]) strictlyMonoUp = false;
    if (vals[i] >= vals[i-1]) strictlyMonoDown = false;
  }
  if (!strictlyMonoUp && !strictlyMonoDown) continue;
  // Deltas in plausible range
  const deltas = [];
  for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i-1]);
  if (deltas.some(d => Math.abs(d) < 50 || Math.abs(d) > 8000)) continue;
  // Skip fixed-point (multiples of 256)
  if (vals.every(v => v % 256 === 0)) continue;
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((a, b) => a + (b - avgDelta) ** 2, 0) / deltas.length;
  const stddev = Math.sqrt(variance);
  const cvar = avgDelta !== 0 ? stddev / Math.abs(avgDelta) : 999;
  candidates.push({ off, vals, deltas, avgDelta, stddev, cvar });
}

console.log('\n=== Found ' + candidates.length + ' monotonic candidates ===');
candidates.sort((a, b) => a.cvar - b.cvar);
console.log('\nTop 30 by coefficient of variation (stable income):');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' vals=[' + c.vals.join(', ') + '] Δ=[' + c.deltas.join(', ') + '] CV=' + c.cvar.toFixed(3));
}
