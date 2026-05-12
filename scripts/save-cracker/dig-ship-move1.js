// dig-ship-move1.js
// Ship-move diff: save_5.2 vs save_6.2 (both 34,690,796 bytes)
// 0-byte net delta: pure in-place changes.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_5.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));

console.log(`A size: ${A.length}  B size: ${B.length}  same=${A.length === B.length}`);

const N = Math.min(A.length, B.length);
let totalDiff = 0;
const runs = [];
let runStart = -1;

for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    totalDiff++;
    if (runStart === -1) runStart = i;
  } else if (runStart !== -1) {
    let j = i + 1;
    const gapLimit = Math.min(i + 4, N);
    while (j < gapLimit && A[j] === B[j]) j++;
    if (j < N && A[j] !== B[j]) {
      i = j - 1;
      continue;
    }
    runs.push({ start: runStart, end: i, len: i - runStart });
    runStart = -1;
  }
}
if (runStart !== -1) runs.push({ start: runStart, end: N, len: N - runStart });

console.log(`total byte diffs: ${totalDiff}`);
console.log(`run count: ${runs.length}`);

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// Show ALL runs (should be small)
console.log('\nAll diff runs:');
for (const r of runs.slice(0, 200)) {
  // Dump 32 bytes around each run for inspection
  const off = r.start;
  const a16 = A.subarray(Math.max(0, off - 4), Math.min(N, off + r.len + 12)).toString('hex');
  const b16 = B.subarray(Math.max(0, off - 4), Math.min(N, off + r.len + 12)).toString('hex');
  console.log(`  [${hex(r.start)}..${hex(r.end)}] len=${r.len}`);
  console.log(`    A: ${a16}`);
  console.log(`    B: ${b16}`);
}

// For each run, look for u32 changes (ship coords)
console.log('\nu32 deltas (aligned reads) for each run:');
for (const r of runs.slice(0, 50)) {
  const base = r.start & ~3;
  const a32 = A.readUInt32LE(base);
  const b32 = B.readUInt32LE(base);
  if (a32 !== b32) {
    const sa32 = A.readInt32LE(base);
    const sb32 = B.readInt32LE(base);
    console.log(`  ${hex(base)}  u32: ${a32} → ${b32}  (s32: ${sa32} → ${sb32})`);
  }
}
