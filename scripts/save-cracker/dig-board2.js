// dig-board2.js — board diff: save_6.2 (ship moved) vs save_7.2 (diplomat boarded)
// 0-byte delta. 5.66MB of byte diffs. Locate non-AI-cache changes.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
const N = A.length;

const counts = new Map();
for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    const b = Math.floor(i / 0x100000);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
}
console.log('1MB buckets:');
const sorted1M = [...counts.entries()].sort((a, b) => a[0] - b[0]);
for (const [b, c] of sorted1M) {
  console.log(`  [${hex(b * 0x100000)}..+1MB]: ${c} diff bytes`);
}

// 64KB buckets, top 30
const counts64 = new Map();
for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    const b = Math.floor(i / 0x10000);
    counts64.set(b, (counts64.get(b) || 0) + 1);
  }
}
console.log('\nTop 30 64KB buckets:');
const sorted64 = [...counts64.entries()].sort((a, b) => b[1] - a[1]);
for (const [b, c] of sorted64.slice(0, 30)) {
  console.log(`  [${hex(b * 0x10000)}..+64KB]: ${c} diff bytes`);
}

// Find runs ≥8B (likely a moved coord or pointer)
console.log('\nDiff runs ≥ 8 bytes:');
let runStart = -1;
const longRuns = [];
for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    if (runStart === -1) runStart = i;
  } else if (runStart !== -1) {
    if (i - runStart >= 8) {
      longRuns.push({ start: runStart, end: i, len: i - runStart });
    }
    runStart = -1;
  }
}
console.log(`Long runs: ${longRuns.length}`);
for (const r of longRuns.slice(0, 60)) {
  const lo = Math.max(0, r.start - 8);
  const hi = Math.min(N, r.start + r.len + 16);
  console.log(`  [${hex(r.start)}..${hex(r.end)}] len=${r.len}`);
  console.log(`    A: ${A.subarray(lo, hi).toString('hex')}`);
  console.log(`    B: ${B.subarray(lo, hi).toString('hex')}`);
}
