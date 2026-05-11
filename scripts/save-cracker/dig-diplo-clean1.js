// Session 32: byte-by-byte diff of clean trade-rights save pair.
// save_1.1 = before, save_2.1 = after Romans Julii proposed Trade Rights to Messapians (Messapians accepted).
// No end-turn between saves; ~10 byte size delta.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A_PATH = path.join(SAVES, 'save_1.1.sav');
const B_PATH = path.join(SAVES, 'save_2.1.sav');

const a = fs.readFileSync(A_PATH);
const b = fs.readFileSync(B_PATH);

console.log(`A size = ${a.length}, B size = ${b.length}, delta = ${b.length - a.length}`);

// First: find all single-byte diffs at the SAME offset (until shift point).
// Walk forward and find the first offset where bytes differ.
const minLen = Math.min(a.length, b.length);
let firstDiff = -1;
for (let i = 0; i < minLen; i++) {
  if (a[i] !== b[i]) { firstDiff = i; break; }
}
console.log(`First diff offset: 0x${firstDiff.toString(16)} (${firstDiff})`);

// Walk forward from firstDiff. Count runs of contiguous diffs.
// We do this in two phases: aligned (assume no shift), then if alignment breaks, try shift.

// Aligned pass — collect every offset where bytes differ.
const alignedDiffs = [];
for (let i = 0; i < minLen; i++) {
  if (a[i] !== b[i]) alignedDiffs.push(i);
}
console.log(`Aligned diff count (raw): ${alignedDiffs.length}`);

// Group into runs (contiguous offsets).
function groupRuns(offsets, maxGap = 8) {
  const runs = [];
  if (!offsets.length) return runs;
  let start = offsets[0], prev = offsets[0];
  for (let k = 1; k < offsets.length; k++) {
    const o = offsets[k];
    if (o - prev <= maxGap) {
      prev = o;
    } else {
      runs.push({ start, end: prev });
      start = o; prev = o;
    }
  }
  runs.push({ start, end: prev });
  return runs;
}

const runs = groupRuns(alignedDiffs, 8);
console.log(`Aligned diff runs (gap<=8): ${runs.length}`);
for (const r of runs) {
  console.log(`  0x${r.start.toString(16)}..0x${r.end.toString(16)} (${r.end - r.start + 1} bytes)`);
}

// If too many runs, fall back to gap=64 grouping.
if (runs.length > 50) {
  const runs2 = groupRuns(alignedDiffs, 64);
  console.log(`\n=== Re-grouped with gap<=64: ${runs2.length} runs ===`);
  for (const r of runs2.slice(0, 60)) {
    console.log(`  0x${r.start.toString(16)}..0x${r.end.toString(16)} (${r.end - r.start + 1} bytes)`);
  }
}
