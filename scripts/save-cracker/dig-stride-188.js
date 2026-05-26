// Verify hypothesis: FACTION_ECONOMICS records are 188 bytes apart.
// Three pairs of T1=2500 are exactly 0xBC=188 bytes apart in T1.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

const STRIDE = 188;
const COUNT = 36;

// Try array start positions at 0x2c5e1 - X*188 for X in 0..35
console.log('Testing array start positions around 0x2c5e1...');
for (let X = 0; X <= 36; X++) {
  const arrayStart = 0x2c5e1 - X * STRIDE;
  if (arrayStart < 0x1000) continue;
  if (arrayStart + COUNT * STRIDE > T1.length) continue;
  // Read u32 at +0 of each "record" and see if values look like treasuries
  const t1vals = [];
  const t2vals = [];
  let good = 0;
  for (let i = 0; i < COUNT; i++) {
    const off = arrayStart + i * STRIDE;
    const v1 = T1.readUInt32LE(off);
    const v2 = T2.readUInt32LE(off);
    t1vals.push(v1);
    t2vals.push(v2);
    if (v1 >= 0 && v1 < 100000 && v2 >= 0 && v2 < 100000) good++;
  }
  if (good < 30) continue;
  console.log('\n  arrayStart=0x' + arrayStart.toString(16) + ' (Spain at record ' + X + ')  good=' + good + '/' + COUNT);
  console.log('  T1 vals: [' + t1vals.join(',') + ']');
  console.log('  T2 vals: [' + t2vals.join(',') + ']');
  // Check deltas
  const deltas = t1vals.map((v, i) => t2vals[i] - v);
  console.log('  Deltas:  [' + deltas.join(',') + ']');
}

// Also try treasury at OFFSET WITHIN RECORD (not at +0)
console.log('\n=== Try treasury at various offsets within 188-byte record ===');
for (let recOff = 0; recOff < STRIDE; recOff += 4) {
  for (let X = 0; X <= 36; X++) {
    const arrayStart = 0x2c5e1 - recOff - X * STRIDE;
    if (arrayStart < 0x1000) continue;
    if (arrayStart + COUNT * STRIDE > T1.length) continue;
    // Check: how many records have a plausible treasury (0..50000) at +recOff?
    let goodTreas = 0;
    let nonZero = 0;
    for (let i = 0; i < COUNT; i++) {
      const v = T1.readUInt32LE(arrayStart + i * STRIDE + recOff);
      if (v >= 0 && v < 50000) goodTreas++;
      if (v > 0 && v < 50000) nonZero++;
    }
    if (goodTreas === COUNT && nonZero >= 25) {
      // Also ensure 2500 is in the array
      const vals = [];
      for (let i = 0; i < COUNT; i++) vals.push(T1.readUInt32LE(arrayStart + i * STRIDE + recOff));
      if (!vals.includes(2500)) continue;
      console.log('  recOff=' + recOff + ' arrayStart=0x' + arrayStart.toString(16) + ' Spain at record ' + X + ' nonZero=' + nonZero);
      // Show top values
      console.log('    First 36 values: [' + vals.join(',') + ']');
      break;
    }
  }
}
