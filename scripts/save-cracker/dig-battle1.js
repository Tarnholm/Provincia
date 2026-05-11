#!/usr/bin/env node
// Battle outcomes probe — diff damagedturn1.sav vs notdamagedturn1.sav (same size 1189090).
// This pair represents "did/didn't take damage in a battle on turn 1".

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

console.log(`A=${A.length}, B=${B.length}, Δ=${B.length - A.length}`);

// Same size — direct byte diff
const diffs = [];
let runStart = -1;
for (let i = 0; i < A.length; i++) {
  if (A[i] !== B[i]) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      diffs.push({ start: runStart, end: i, len: i - runStart });
      runStart = -1;
    }
  }
}
if (runStart >= 0) diffs.push({ start: runStart, end: A.length, len: A.length - runStart });

console.log(`\nTotal diff runs: ${diffs.length}`);
let total = 0;
for (const d of diffs) total += d.len;
console.log(`Total bytes differing: ${total}`);

// Categorize: small (≤4 bytes), medium (≤64), large
const small = diffs.filter(d => d.len <= 4);
const medium = diffs.filter(d => d.len > 4 && d.len <= 64);
const large = diffs.filter(d => d.len > 64);
console.log(`Small (≤4B): ${small.length}, Medium (5-64B): ${medium.length}, Large (>64B): ${large.length}`);

console.log(`\nTop 50 diff runs by size:`);
diffs.sort((x, y) => y.len - x.len);
for (const d of diffs.slice(0, 50)) {
  const aHex = A.slice(d.start, Math.min(d.end, d.start + 24)).toString('hex');
  const bHex = B.slice(d.start, Math.min(d.end, d.start + 24)).toString('hex');
  console.log(`  0x${d.start.toString(16).padStart(8, '0')} len=${d.len.toString().padStart(4)} | A: ${aHex} | B: ${bHex}`);
}
