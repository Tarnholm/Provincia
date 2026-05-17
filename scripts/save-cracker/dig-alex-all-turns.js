// Analyze ALL Alexander saves to find treasury via monotonic growth pattern

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));

// Pick one representative save per turn (smallest = closest to turn-start)
const turnSaves = {};
for (const f of allFiles) {
  const m = f.match(/Turn (\d+)/);
  if (!m) continue;
  const t = parseInt(m[1]);
  const buf = fs.readFileSync(path.join(BASE, f));
  if (!turnSaves[t] || buf.length < turnSaves[t].buf.length) {
    turnSaves[t] = { name: f, buf };
  }
}

const turns = Object.keys(turnSaves).map(Number).sort((a, b) => a - b);
console.log('Turns with saves: ' + turns.join(', '));
for (const t of turns) console.log('  T' + t + ': ' + turnSaves[t].name);

// Look for u32 offsets where:
//   1. Value is in plausible treasury range (500-30000)
//   2. Value is monotonically increasing (or near-monotonic) across turns
//   3. Not a multiple of 256 (skip fixed-point)
//   4. Differences between consecutive turns are 200-3000 (reasonable income)

const len = Math.min(...turns.map(t => turnSaves[t].buf.length));
console.log('\nMin file length: ' + len);

console.log('\n=== Scanning for treasury-like monotonic u32 fields ===');
const candidates = [];
for (let off = 0x100; off < 0x80000; off += 4) {
  const vals = turns.map(t => turnSaves[t].buf.readUInt32LE(off));
  // Skip if any value out of plausible range
  if (vals.some(v => v < 500 || v > 50000)) continue;
  // Skip if no variation
  if (new Set(vals).size === 1) continue;
  // Check monotonicity (allowing rare drops for war losses)
  let mostlyMono = true;
  let inc = 0, dec = 0, eq = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i-1]) inc++;
    else if (vals[i] < vals[i-1]) dec++;
    else eq++;
  }
  // Skip fixed-point
  if (vals.every(v => v % 256 === 0)) continue;
  // Most increases (income gain) — at least 60% monotonic increase
  if (inc < (vals.length - 1) * 0.5) continue;
  // Check delta range
  const deltas = [];
  for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i-1]);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (Math.abs(avgDelta) < 100 || Math.abs(avgDelta) > 5000) continue;
  candidates.push({ off, vals, avgDelta, inc, dec });
}

candidates.sort((a, b) => Math.abs(a.avgDelta - 1000) - Math.abs(b.avgDelta - 1000));
console.log('Found ' + candidates.length + ' candidates with monotonic-ish growth');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' avg+' + c.avgDelta.toFixed(0) + ' (inc=' + c.inc + ', dec=' + c.dec + '): [' + c.vals.join(', ') + ']');
}

// Also try byte-aligned to catch unaligned treasury fields
console.log('\n=== Byte-aligned (off += 1) scan ===');
const byteCands = [];
for (let off = 0x100; off < 0x80000; off += 1) {
  const vals = turns.map(t => turnSaves[t].buf.readUInt32LE(off));
  if (vals.some(v => v < 1000 || v > 50000)) continue;
  if (new Set(vals).size < 3) continue;
  let inc = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i-1]) inc++;
  }
  if (inc < (vals.length - 1) * 0.6) continue;
  if (vals.every(v => v % 256 === 0)) continue;
  const deltas = [];
  for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i-1]);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (Math.abs(avgDelta) < 300 || Math.abs(avgDelta) > 3000) continue;
  byteCands.push({ off, vals, avgDelta });
}
console.log('Byte-aligned candidates: ' + byteCands.length);
byteCands.sort((a, b) => Math.abs(a.avgDelta - 1000) - Math.abs(b.avgDelta - 1000));
for (const c of byteCands.slice(0, 15)) {
  console.log('  u32@0x' + c.off.toString(16) + ' avg+' + c.avgDelta.toFixed(0) + ': [' + c.vals.join(', ') + ']');
}
