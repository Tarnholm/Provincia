// Look for a LIVE owner table somewhere other than 0x1190 (which is static).
// Search for tables with ~60-70 entries (matching playable-faction settlement count)
// where the faction-id field varies between turns.

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

// Try various strides (4, 8, 12, 16, 20, 24) and look for sequences of u32
// values in 0..25 range (faction-id range)
console.log('=== Hunt for live-owner-table candidates ===');

for (const stride of [4, 8, 12, 16, 20, 24]) {
  console.log('\n--- Stride ' + stride + ' bytes ---');
  // For each starting position, count how many consecutive u32 values are 0-25
  let bestRun = 0;
  let bestStart = 0;
  let bestRunCount = 0;
  for (let start = 0x100; start < 0x40000; start += 4) {
    let run = 0;
    let p = start;
    while (p < len - 4) {
      const v = buf.readUInt32LE(p);
      if (v > 25) break;
      run++;
      p += stride;
    }
    if (run >= 50 && run <= 150) {
      // Plausible per-settlement table size
      console.log('  start=0x' + start.toString(16) + ' run=' + run);
      bestRunCount++;
      if (bestRunCount > 8) break;
    }
  }
}

// Specifically check 0x1190 area extended — maybe there's another owner field nearby
console.log('\n=== Stride-12 records starting at various offsets in 0x1190..0x1600 ===');
for (const startOff of [0x1190, 0x1194, 0x1198, 0x119c]) {
  let run = 0;
  let p = startOff;
  while (p < 0x1600) {
    const v = buf.readUInt32LE(p + 4);  // facId is at +4 in the 0x1190 table
    if (v > 25 || v < 0) break;
    run++;
    p += 12;
  }
  console.log('  start=0x' + startOff.toString(16) + ' run=' + run);
}

// Now check if the existing 0x1190 table has any RELATED tables elsewhere
// Look for u32 values that match Spain's settlement coords or hashes
// to find a per-settlement live-owner table
console.log('\n=== Search for tables that vary T1→T4 at fixed offsets ===');
// Find offsets where the entire table shifts
let varying = [];
for (let off = 0x100; off < 0x40000; off += 4) {
  const v1 = T_FILES[1].readInt32LE(off);
  const v4 = T_FILES[4].readInt32LE(off);
  if (v1 === v4) continue;
  // Plausible faction-id range
  if (v1 < 0 || v1 > 25) continue;
  if (v4 < 0 || v4 > 25) continue;
  if (v1 !== v4) varying.push({ off, v1, v4 });
}
console.log('Found ' + varying.length + ' u32 offsets with faction-id-like values that change T1→T4');
for (const v of varying.slice(0, 30)) {
  console.log('  0x' + v.off.toString(16) + ': T1=' + v.v1 + ' T4=' + v.v4);
}
