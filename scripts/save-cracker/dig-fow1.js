// dig-fow1.js
// Toggle-FoW diff: save_8.2 vs save_9.2 (both 34,690,934 bytes — same size)
// Goal: find every byte that changed; cluster by region; report top runs.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_9.2.sav'));

console.log(`A size: ${A.length}  B size: ${B.length}  same=${A.length === B.length}`);

// Same-size in-place diff (the brief says 0-byte delta)
const N = Math.min(A.length, B.length);
let totalDiff = 0;
const runs = []; // [{start, end, len}]
let runStart = -1;

for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    totalDiff++;
    if (runStart === -1) runStart = i;
  } else {
    if (runStart !== -1) {
      // Allow up to 7-byte gaps of equal bytes inside a run (RLE-typical)
      let j = i + 1;
      let allEq = true;
      const gapLimit = Math.min(i + 7, N);
      while (j < gapLimit && A[j] === B[j]) j++;
      if (j < N && A[j] !== B[j]) {
        // gap within tolerance; extend
        i = j - 1;
        continue;
      }
      runs.push({ start: runStart, end: i, len: i - runStart });
      runStart = -1;
    }
  }
}
if (runStart !== -1) {
  runs.push({ start: runStart, end: N, len: N - runStart });
}

console.log(`total byte diffs: ${totalDiff}`);
console.log(`run count: ${runs.length}`);

// Top 30 longest runs
runs.sort((a, b) => b.len - a.len);
console.log('\nTop 30 longest diff runs:');
for (const r of runs.slice(0, 30)) {
  const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
  console.log(`  [${hex(r.start)}..${hex(r.end)}]  len=${r.len}`);
}

// Region histogram: bucket diffs by 1MB-aligned chunk
const buckets = new Map();
for (let i = 0; i < N; i++) {
  if (A[i] !== B[i]) {
    const b = Math.floor(i / 0x100000);
    buckets.set(b, (buckets.get(b) || 0) + 1);
  }
}
console.log('\nDiff density per 1MB bucket (top 20):');
const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
for (const [bucket, cnt] of sorted.slice(0, 20)) {
  console.log(`  [${(bucket * 0x100000).toString(16).padStart(8, '0')}..+1MB]: ${cnt} bytes`);
}

// Also count gaps≥1KB between consecutive diffs to find sparse clusters
console.log('\nClusters (gaps ≥ 1KB between diffs):');
const sortedRuns = runs.slice().sort((a, b) => a.start - b.start);
const clusters = [];
let cur = null;
for (const r of sortedRuns) {
  if (!cur) {
    cur = { start: r.start, end: r.end, bytes: r.len, runs: 1 };
  } else if (r.start - cur.end <= 1024) {
    cur.end = r.end;
    cur.bytes += r.len;
    cur.runs++;
  } else {
    clusters.push(cur);
    cur = { start: r.start, end: r.end, bytes: r.len, runs: 1 };
  }
}
if (cur) clusters.push(cur);

clusters.sort((a, b) => b.bytes - a.bytes);
console.log(`Cluster count: ${clusters.length}`);
for (const c of clusters.slice(0, 20)) {
  const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
  console.log(`  [${hex(c.start)}..${hex(c.end)}]  diff_bytes=${c.bytes}  runs=${c.runs}  span=${c.end - c.start}`);
}
