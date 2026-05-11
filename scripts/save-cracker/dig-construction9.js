#!/usr/bin/env node
// Drill into Pella's settlement record diff. The 1223 byte diff is concentrated
// in -1586..-955 relative to name marker.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

const aName = 0x10d8c; // Pella name marker A
const bName = 0x10d8c; // same position in B

// session 3 says name at +2272, so record starts at name - 2272 = name - 2272
const recStart = aName - 2272;
console.log(`Pella record start (estimated): 0x${recStart.toString(16)}`);

// Show diff regions
const SCAN_BACK = 2400; // settlement record extends backward
const SCAN_FWD = 2200;

const diffs = [];
let runStart = -1;
for (let j = -SCAN_BACK; j < SCAN_FWD; j++) {
  const aIdx = aName + j;
  const bIdx = bName + j;
  if (aIdx < 0 || bIdx < 0 || aIdx >= A.length || bIdx >= B.length) continue;
  if (A[aIdx] !== B[bIdx]) {
    if (runStart < 0) runStart = j;
  } else {
    if (runStart >= 0) {
      diffs.push({ start: runStart, end: j });
      runStart = -1;
    }
  }
}
if (runStart >= 0) diffs.push({ start: runStart, end: SCAN_FWD });

console.log(`\nPella diff runs (relative to name marker @ 0x${aName.toString(16)}):`);
for (const d of diffs) {
  const len = d.end - d.start;
  const aStart = aName + d.start;
  const bStart = bName + d.start;
  const aHex = A.slice(aStart, aStart + Math.min(len, 32)).toString('hex');
  const bHex = B.slice(bStart, bStart + Math.min(len, 32)).toString('hex');
  console.log(`  [${d.start}..${d.end}] len=${len}  A: ${aHex}  B: ${bHex}`);
}

// Dump bytes around the diff "hot zone" in detail
console.log(`\n=== Pella diff hot-zone @ relative -1600..-900 (raw bytes) ===`);
for (let row = -1600; row < -900; row += 32) {
  let aLine = `0x${(aName+row).toString(16)} A: `;
  let bLine = `         B: `;
  let diffStr = '         ! ';
  for (let k = 0; k < 32; k++) {
    if (aName + row + k >= A.length) break;
    const av = A[aName + row + k];
    const bv = B[bName + row + k];
    aLine += av.toString(16).padStart(2, '0') + ' ';
    bLine += bv.toString(16).padStart(2, '0') + ' ';
    diffStr += (av === bv ? '   ' : '** ');
  }
  console.log(aLine);
  console.log(bLine);
  console.log(diffStr);
  console.log();
}
