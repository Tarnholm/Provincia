#!/usr/bin/env node
// Construction queue probe — diff save_saveturn1start vs save_saveturn1construction (Alexander/Macedon)
// Goal: find the bytes that flip when a construction project is started.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const a = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const b = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

console.log(`A size: ${a.length}`);
console.log(`B size: ${b.length}`);
console.log(`Δ size: ${b.length - a.length}`);

// Find sign-aligned diff regions (within same-offset shift if possible).
// First, do raw byte-by-byte diff at offset zero for the common prefix.
const minLen = Math.min(a.length, b.length);
const diffs = [];
let runStart = -1;
for (let i = 0; i < minLen; i++) {
  if (a[i] !== b[i]) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      diffs.push([runStart, i - runStart]);
      runStart = -1;
    }
  }
}
if (runStart >= 0) diffs.push([runStart, minLen - runStart]);

console.log(`\nTotal raw diff runs (no shift): ${diffs.length}`);
console.log(`Top 30 runs by size:`);
diffs.sort((x, y) => y[1] - x[1]);
for (const [off, len] of diffs.slice(0, 30)) {
  console.log(`  0x${off.toString(16).padStart(8, '0')} len=${len}`);
}

// Stats: total bytes differing
let totalDiff = 0;
for (const [, len] of diffs) totalDiff += len;
console.log(`Total bytes differing: ${totalDiff}`);
