// Treasury hunt #N: find u32 values that grow monotonically across turns
// with similar per-turn deltas (income should be roughly constant turn-over-turn).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

// Pick canonical turn-start saves: one per turn
const TURN_SAVES = {};
for (const f of allFiles) {
  if (!f.includes('Start')) continue;
  const buf = fs.readFileSync(path.join(BASE, f));
  // Extract turn number from filename
  const m = f.match(/Turn (\d+) Start/);
  if (!m) continue;
  const t = parseInt(m[1]);
  if (!TURN_SAVES[t]) TURN_SAVES[t] = buf;
}

const turns = Object.keys(TURN_SAVES).map(Number).sort((a, b) => a - b);
console.log('Turn-Start saves available: ' + turns.join(', '));

const len = Math.min(...Object.values(TURN_SAVES).map(b => b.length));

// Hunt: u32 values that are strictly monotonic across turns
// AND have per-turn deltas in 100..5000 (plausible Spain income range)
const candidates = [];
for (let off = 0x100; off < len - 4; off += 4) {
  const vals = turns.map(t => TURN_SAVES[t].readUInt32LE(off));
  // Must be all in 100..100000 (plausible treasury range)
  if (vals.some(v => v < 100 || v > 100000)) continue;
  // Must be strictly monotonic
  let strictlyMono = true;
  let increasing = vals[1] > vals[0];
  for (let i = 1; i < vals.length; i++) {
    if (increasing) {
      if (vals[i] <= vals[i-1]) { strictlyMono = false; break; }
    } else {
      if (vals[i] >= vals[i-1]) { strictlyMono = false; break; }
    }
  }
  if (!strictlyMono) continue;
  // Compute deltas
  const deltas = [];
  for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i-1]);
  // All deltas must be in 100..5000 (or -5000..-100 for monotonic decrease)
  if (deltas.some(d => Math.abs(d) < 100 || Math.abs(d) > 5000)) continue;
  // Compute variance of deltas — treasury income should be relatively stable
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const variance = deltas.reduce((a, b) => a + (b - avgDelta) ** 2, 0) / deltas.length;
  const stddev = Math.sqrt(variance);
  // Skip fixed-point (multiples of 256)
  if (vals.every(v => v % 256 === 0)) continue;
  candidates.push({ off, vals, deltas, stddev });
}

console.log('\n=== Found ' + candidates.length + ' strictly-monotonic candidates with plausible income deltas ===');
candidates.sort((a, b) => a.stddev - b.stddev);

console.log('\nTop 30 by lowest delta variance (steady income):');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' vals=[' + c.vals.join(', ') + '] Δ=[' + c.deltas.join(', ') + '] σ=' + c.stddev.toFixed(1));
}
