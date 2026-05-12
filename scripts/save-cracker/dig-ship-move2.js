// dig-ship-move2.js
// 248k bytes changed between save_5.2 and save_6.2 (ship MOVED).
// 0-byte net delta. That's massive — but the start address range is in 0x5000-0xf0000
// (AI cache region per dossier). Need to:
//   1. Find diffs OUTSIDE the AI-cache region — those will be the actual ship-move bytes.
//   2. Cluster diffs by 64-KB region.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_5.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
const N = A.length;

// 64KB-bucket histogram
const BUCKET = 0x10000;
const counts = new Map();
for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    const b = Math.floor(i / BUCKET);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`Total per-byte diffs: ${total}`);
console.log(`Bucket count (≥10 diffs): ${[...counts.values()].filter(v => v >= 10).length}`);

// All buckets sorted
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log('\nTop 30 64KB buckets:');
for (const [b, c] of sorted.slice(0, 30)) {
  console.log(`  [${hex(b * BUCKET)}..+64KB]: ${c} diff bytes`);
}

// 1MB-bucket histogram
const counts1M = new Map();
for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    const b = Math.floor(i / 0x100000);
    counts1M.set(b, (counts1M.get(b) || 0) + 1);
  }
}
console.log('\nAll 1MB buckets:');
const sorted1M = [...counts1M.entries()].sort((a, b) => a[0] - b[0]);
for (const [b, c] of sorted1M) {
  console.log(`  [${hex(b * 0x100000)}..+1MB]: ${c} diff bytes`);
}

// Find diff runs OUTSIDE the AI cache region (0x5000..0xf0000)
// Per dossier: AI cache + faction trailing data lives mostly < 0x100000.
// Real game-state diffs are usually in 0x100000+ (settlement/army region) and the tail.
console.log('\n=== Diffs OUTSIDE [0x5000..0x100000] (suspected AI cache) ===');
const outside = [];
let runStart = -1;
for (let i = 0; i < N; i++) {
  if (i >= 0x5000 && i < 0x100000) continue;
  if (A[i] !== B[i]) {
    if (runStart === -1) runStart = i;
  } else if (runStart !== -1) {
    outside.push({ start: runStart, end: i, len: i - runStart });
    runStart = -1;
  }
}
if (runStart !== -1) outside.push({ start: runStart, end: N, len: N - runStart });
console.log(`Outside-AI diff runs: ${outside.length}`);
for (const r of outside.slice(0, 80)) {
  const ctxLo = Math.max(0, r.start - 8);
  const ctxHi = Math.min(N, r.start + r.len + 16);
  const aHex = A.subarray(ctxLo, ctxHi).toString('hex');
  const bHex = B.subarray(ctxLo, ctxHi).toString('hex');
  console.log(`  [${hex(r.start)}..${hex(r.end)}] len=${r.len}`);
  console.log(`    A: ${aHex}`);
  console.log(`    B: ${bHex}`);
}
