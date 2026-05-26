// Look for the FACTION_ECONOMICS array more broadly — find any 36-stride sequence
// where ANY one position contains 2500 (Spain's T1 treasury) and most positions
// contain "treasury-like" u32 values.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// Find all positions in T1 where u32 = 2500 (Spain's treasury)
const positions = [];
for (let p = 0; p < T1.length - 4; p++) {
  if (T1.readUInt32LE(p) === 2500) positions.push(p);
}
console.log('u32=2500 positions in T1: ' + positions.length);
for (const p of positions.slice(0, 20)) console.log('  0x' + p.toString(16));

// For each position, check if it's part of an array — look at nearby positions
// at strides 40-200 and see if there are matching treasury patterns.
console.log('\n=== Check each position for being in a fixed-stride array ===');
for (const p of positions) {
  // Look at the PRECEDING and FOLLOWING positions at various strides
  for (const S of [40, 48, 56, 60, 64, 72, 76, 80, 84, 88, 92, 96, 100, 112, 128]) {
    let beforeCount = 0;
    let afterCount = 0;
    // Count adjacent "treasury-like" values at stride S
    for (let i = 1; i <= 36; i++) {
      // Check before
      const bp = p - i * S;
      if (bp >= 0) {
        const v = T1.readUInt32LE(bp);
        if (v >= 0 && v <= 100000) beforeCount++;
      }
      const ap = p + i * S;
      if (ap + 4 <= T1.length) {
        const v = T1.readUInt32LE(ap);
        if (v >= 0 && v <= 100000) afterCount++;
      }
    }
    const total = beforeCount + afterCount;
    if (total >= 50) {
      console.log('  0x' + p.toString(16) + ' stride=' + S + ' before=' + beforeCount + ' after=' + afterCount);
    }
  }
}

// Even broader — at 0x2c5e1 specifically, what's the pattern at various strides?
console.log('\n=== Values at 0x2c5e1 +/- 35 records for various strides ===');
for (const S of [76, 80, 84, 100, 120]) {
  console.log('\nstride=' + S + ':');
  for (let i = -10; i <= 10; i++) {
    const off = 0x2c5e1 + i * S;
    if (off >= 0 && off + 4 <= T1.length) {
      const v = T1.readUInt32LE(off);
      console.log('  +' + i.toString().padStart(3) + ' @0x' + off.toString(16) + ': ' + v);
    }
  }
}
