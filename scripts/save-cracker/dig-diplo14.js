// dig-diplo14.js — Scan Macedon Turn 97/98/99 save trio for byte differences
// that might be diplomatic state changes.
//
// Strategy: just diff aligned regions. If only one diplomatic action happened
// between two saves, the bytes that changed in the same offset across saves
// will be sparse.

const fs = require("fs");

const dir = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/";
const t97 = fs.readFileSync(dir + "save_Autosave   Macedon   Turn 97.sav");
const t98 = fs.readFileSync(dir + "save_Autosave   Macedon   Turn 98 End.sav");
const t99 = fs.readFileSync(dir + "save_Autosave   Macedon   Turn 99 Start.sav");

console.log(`T97: ${t97.length} bytes`);
console.log(`T98: ${t98.length} bytes`);
console.log(`T99: ${t99.length} bytes`);

// Quick diff function — just count bytes that differ
function diff(a, b, maxLen) {
  const len = Math.min(maxLen, a.length, b.length);
  let diffs = 0;
  const positions = [];
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      diffs++;
      if (positions.length < 200) positions.push(i);
    }
  }
  return { diffs, positions, totalCompared: len };
}

const len97_98 = Math.min(t97.length, t98.length);
const d9798 = diff(t97, t98, len97_98);
console.log(`\nT97 vs T98: ${d9798.diffs}/${d9798.totalCompared} bytes differ (${(100 * d9798.diffs / d9798.totalCompared).toFixed(1)}%)`);

const len98_99 = Math.min(t98.length, t99.length);
const d9899 = diff(t98, t99, len98_99);
console.log(`T98 vs T99: ${d9899.diffs}/${d9899.totalCompared} bytes differ (${(100 * d9899.diffs / d9899.totalCompared).toFixed(1)}%)`);

// Look at the contiguous regions where T98 and T99 differ to see if they cluster
console.log("\nClusters of T98-T99 diffs (first 30 of pos):");
let lastPos = -100;
let clusters = [];
let currCluster = null;
for (const pos of d9899.positions) {
  if (currCluster && pos - lastPos < 16) {
    currCluster.end = pos;
    currCluster.count++;
  } else {
    if (currCluster) clusters.push(currCluster);
    currCluster = { start: pos, end: pos, count: 1 };
  }
  lastPos = pos;
}
if (currCluster) clusters.push(currCluster);

// Largest clusters
clusters.sort((a, b) => b.count - a.count || (b.end - b.start) - (a.end - a.start));
console.log(`Total clusters: ${clusters.length}`);
console.log("Top 30 by count:");
for (let i = 0; i < Math.min(30, clusters.length); i++) {
  const c = clusters[i];
  console.log(`  @0x${c.start.toString(16)}..0x${c.end.toString(16)} count=${c.count} span=${c.end - c.start} bytes`);
}

// Look at differences in the very-end-of-file (where lua counter table is)
const tailDiffStart = Math.max(0, t99.length - 50000);
const tail97 = t97.slice(tailDiffStart, tailDiffStart + 50000);
const tail99 = t99.slice(tailDiffStart, tailDiffStart + 50000);
let tailDiffs = 0;
for (let i = 0; i < tail97.length; i++) if (tail97[i] !== tail99[i]) tailDiffs++;
console.log(`\nT97 vs T99, last 50KB: ${tailDiffs} differing bytes`);

// Find isolated changes — bytes that differ but aren't part of clusters
const isolated = clusters.filter(c => c.count === 1 || (c.count === 2 && c.end - c.start < 8));
console.log(`Isolated single-byte changes: ${isolated.length}`);
console.log("First 20 isolated diffs (likely high-signal):");
for (let i = 0; i < Math.min(20, isolated.length); i++) {
  const c = isolated[i];
  // Show byte values at this position
  const v97 = t97[c.start];
  const v98 = t98[c.start];
  const v99 = t99[c.start];
  console.log(`  @0x${c.start.toString(16)} T97=${v97} T98=${v98} T99=${v99}`);
}
