// Find FACTION_ECONOMICS array start by looking for a position that anchors
// a 36-record array of fixed stride.
//
// At each candidate offset C, check if there are 36 OTHER positions at
// C, C+S, C+2S, ..., C+35*S that all contain a u32 in plausible treasury range.
// Try strides 40, 48, 56, 64, 72, 80, 88, 96, 100, 120.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// For each stride, scan for arrays
const STRIDES = [40, 48, 56, 60, 64, 72, 80, 88, 92, 96, 100, 104, 112, 120, 128, 144, 160, 200];
const COUNT = 36;

console.log('Spain T1 treasury at 0x2c5e1 = ' + T1.readUInt32LE(0x2c5e1));
console.log('Searching for 36-record FACTION_ECONOMICS array near 0x2c5e1...\n');

for (const S of STRIDES) {
  let bestAnchor = null;
  // Search around 0x2c5e1 - need to find an anchor that includes 0x2c5e1
  for (let recOff = 0; recOff < S; recOff++) {
    // If treasury is at +recOff within each record, the array starts at 0x2c5e1 - X*S - recOff
    // for some X in [0..35]
    for (let X = 0; X < COUNT; X++) {
      const arrayStart = 0x2c5e1 - X * S - recOff;
      if (arrayStart < 0x1000) continue;
      if (arrayStart + (COUNT - 1) * S + 4 > T1.length) continue;
      // Check that all 36 records have a u32 at +recOff in [0, 50000] (treasury or 0 for defeated)
      let allValid = true;
      const values = [];
      for (let i = 0; i < COUNT; i++) {
        const v = T1.readUInt32LE(arrayStart + i * S + recOff);
        if (v < 0 || v > 200000) { allValid = false; break; }
        values.push(v);
      }
      if (!allValid) continue;
      // Score: how many of the 36 values are in plausible treasury range (50..30000)?
      const goodTreasury = values.filter(v => v > 50 && v < 30000).length;
      if (goodTreasury < 20) continue;
      // Also require: at least 15 unique values (different factions have different treasuries)
      const uniqueCount = new Set(values).size;
      if (uniqueCount < 15) continue;
      // Spain's value (treasury 2500) must be in the list
      if (!values.includes(2500)) continue;
      if (!bestAnchor || goodTreasury > bestAnchor.goodTreasury) {
        bestAnchor = { arrayStart, recOff, X_for_Spain: X, goodTreasury, uniqueCount, values };
      }
    }
  }
  if (bestAnchor) {
    console.log('STRIDE=' + S + ': array@0x' + bestAnchor.arrayStart.toString(16) +
      '  treasuryOffset@+' + bestAnchor.recOff +
      '  Spain at record ' + bestAnchor.X_for_Spain +
      '  good=' + bestAnchor.goodTreasury + '/' + COUNT +
      '  unique=' + bestAnchor.uniqueCount);
    if (bestAnchor.goodTreasury >= 30) {
      console.log('  Values: [' + bestAnchor.values.join(', ') + ']');
    }
  }
}
