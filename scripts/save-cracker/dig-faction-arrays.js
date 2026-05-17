// Find more 21-entry u32 arrays (one per faction). Spain is at index 18.
// Treasury would be one such array with diverse values per faction.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}
const buf = T_FILES[4];

// Scan for 21-entry u32 arrays
const len = Math.min(...Object.values(T_FILES).map(b => b.length));
console.log('Scanning for 21-entry u32 arrays with plausible per-faction data...');

const candidates = [];
for (let start = 0x100; start < len - 84; start += 4) {
  const vals = [];
  for (let i = 0; i < 21; i++) vals.push(buf.readUInt32LE(start + i * 4));
  // Filter: must have at least 5 distinct values, no values > 100000
  if (vals.some(v => v > 100000)) continue;
  const distinct = new Set(vals);
  if (distinct.size < 5) continue;
  if (distinct.size > 21) continue;
  // Most values must be in 0..50000
  const inRange = vals.filter(v => v >= 0 && v <= 50000).length;
  if (inRange < 18) continue;
  // Player faction index 18 should have a SPECIAL value (e.g. unique)
  const playerVal = vals[18];
  // Check the player's value is plausibly a faction-specific stat
  candidates.push({ start, vals, playerVal, distinct: distinct.size });
}

console.log('Found ' + candidates.length + ' candidate 21-entry arrays');

// Sort by number of distinct values (more distinct = more interesting)
candidates.sort((a, b) => b.distinct - a.distinct);

for (const c of candidates.slice(0, 15)) {
  // Check cross-turn stability
  let varying = 0;
  for (let i = 0; i < 21; i++) {
    const v1 = T_FILES[1].readUInt32LE(c.start + i * 4);
    const v4 = T_FILES[4].readUInt32LE(c.start + i * 4);
    if (v1 !== v4) varying++;
  }
  console.log('\n  0x' + c.start.toString(16) + ' (distinct=' + c.distinct + ', T1↔T4 varying=' + varying + '):');
  console.log('    values: [' + c.vals.join(', ') + ']');
  console.log('    Spain (idx 18) = ' + c.playerVal);
}
