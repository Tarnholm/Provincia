// Try i64 treasury - many games use 64-bit for currency

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const TURN_FILES = {
  1: 'save_17-05-2026   Spain   Turn 1.sav',
  2: 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav',
  3: 'save_Autosave   Spain   Turn 3 End.sav',
  4: 'save_Autosave   Spain   Turn 4 Start.sav',
};
const BUFFERS = {};
for (const t of [1, 2, 3, 4]) BUFFERS[t] = fs.readFileSync(path.join(BASE, TURN_FILES[t]));

const len = Math.min(...Object.values(BUFFERS).map(b => b.length));

// Look at u32 at fixed offsets where treasury could be.
// Constraints:
//   - Stable within all T1 saves (just one T1 here so OK)
//   - Different across T1→T4
//   - Magnitude in 1000-50000
//   - NOT multiple of 256
//   - NOT multiple of 4 (lots of pointers and coords are aligned to 4)
//     ← actually treasury could be aligned, this is wrong filter

// Better: look at SHARED bytes across saves
// Treasury at offset X:
//   - changes between turns
//   - same value at multiple saves of the SAME turn

console.log('=== Look in low offsets 0x14a0..0x4800 (UUID/character zone) ===');
console.log('=== for u32 fields that vary between turns in ' + '1000..30000' + ' range ===');

const TURN_REPS = { 1: BUFFERS[1], 2: BUFFERS[2], 3: BUFFERS[3], 4: BUFFERS[4] };

const candidates = [];
for (let off = 0x14a0; off < 0x4800; off += 4) {
  const vals = [1, 2, 3, 4].map(t => TURN_REPS[t].readUInt32LE(off));
  if (vals.some(v => v < 100 || v > 100000)) continue;
  if (vals.every(v => v === vals[0])) continue;  // unchanging — uninteresting
  if (vals.every(v => v % 256 === 0)) continue;  // skip fixed-point
  const deltas = [];
  for (let i = 1; i < vals.length; i++) deltas.push(vals[i] - vals[i-1]);
  // Accept any direction of change
  candidates.push({ off, vals, deltas });
}
console.log('Found ' + candidates.length + ' candidates with varying u32 values in 0x14a0..0x4800');
for (const c of candidates.slice(0, 40)) {
  console.log('  u32@0x' + c.off.toString(16) + ' vals=[' + c.vals.join(', ') + '] Δ=[' + c.deltas.join(', ') + ']');
}
