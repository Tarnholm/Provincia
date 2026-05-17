// Very tight filter for 21-entry per-faction treasury array.

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

const len = Math.min(...Object.values(T_FILES).map(b => b.length));

console.log('Tight treasury hunt: 21 distinct values in 1000-50000 range...');
const candidates = [];
for (let start = 0x100; start < len - 84; start += 4) {
  const vals = [];
  let valid = true;
  for (let i = 0; i < 21; i++) {
    const v = buf.readUInt32LE(start + i * 4);
    if (v < 100 || v > 100000) { valid = false; break; }
    vals.push(v);
  }
  if (!valid) continue;
  // ALL distinct
  if (new Set(vals).size !== 21) continue;
  // Skip if all multiples of 256 (polygon coords)
  if (vals.every(v => v % 256 === 0)) continue;
  // Most NOT multiples of 16
  const mult16 = vals.filter(v => v % 16 === 0).length;
  if (mult16 > 15) continue;
  candidates.push({ start, vals });
}

console.log('Found ' + candidates.length + ' tight candidates');

// For each, check cross-turn stability
for (const c of candidates.slice(0, 30)) {
  // Check that values stay reasonable in T1
  const t1Vals = [];
  let t1Valid = true;
  for (let i = 0; i < 21; i++) {
    const v = T_FILES[1].readUInt32LE(c.start + i * 4);
    if (v < 0 || v > 100000) { t1Valid = false; break; }
    t1Vals.push(v);
  }
  if (!t1Valid) continue;
  // Index 18 (Spain player) should be stable-ish
  const spainT4 = c.vals[18];
  const spainT1 = t1Vals[18];

  console.log('\n  0x' + c.start.toString(16) + ':');
  console.log('    T4 vals: [' + c.vals.join(', ') + ']');
  console.log('    Spain (idx 18): T1=' + spainT1 + ', T4=' + spainT4);
}

// Also try byte-aligned (1-byte stride)
console.log('\n\n=== Byte-aligned hunt ===');
const bcands = [];
for (let start = 0x100; start < len - 84; start += 1) {
  const vals = [];
  let valid = true;
  for (let i = 0; i < 21; i++) {
    const v = buf.readUInt32LE(start + i * 4);
    if (v < 1000 || v > 50000) { valid = false; break; }
    vals.push(v);
  }
  if (!valid) continue;
  if (new Set(vals).size !== 21) continue;
  if (vals.every(v => v % 256 === 0)) continue;
  bcands.push({ start, vals });
}
console.log('Byte-aligned candidates: ' + bcands.length);
for (const c of bcands.slice(0, 10)) {
  console.log('  0x' + c.start.toString(16) + ': Spain (idx 18) = ' + c.vals[18] + ', vals: [' + c.vals.slice(0, 8).join(',') + '...]');
}
