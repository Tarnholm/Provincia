// Session 110 — Gnaeus Cornelius Scipio moved 1 tile south.
// Two saves provided by user (Downloads):
//   save_halo_oneman.sav..sav  (before; 35,990,303 bytes)
//   save_halo_moved.sav..sav   (after;  35,990,301 bytes)
// Goal: classify every byte-level difference and locate the character-position bytes.

const fs = require('fs');
const path = require('path');

const A_PATH = 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav';
const B_PATH = 'C:\\Users\\vtarn\\Downloads\\save_halo_moved.sav..sav';

const A = fs.readFileSync(A_PATH);
const B = fs.readFileSync(B_PATH);

console.log('A (before/oneman):', A.length, 'bytes');
console.log('B (after/moved): ', B.length, 'bytes');
console.log('Size delta:', B.length - A.length, '(B - A)');

// Step 1: align as best we can. Since sizes differ by 2 bytes, we can't just
// pair offsets 1:1 past the first divergence. Strategy:
//   - walk byte-by-byte until first mismatch
//   - for the first mismatch, look ahead in B to re-sync (small windowed search)
//   - record (offsetA, offsetB, lenA, lenB) for each mismatch span

const MAX_DIFFS = 5000;
const RESYNC_WINDOW = 64;       // try to resync within ±64 bytes
const RESYNC_RUN = 16;          // require 16 consecutive matching bytes after resync

function findResync(aOff, bOff) {
  // Try shifts -RESYNC_WINDOW .. +RESYNC_WINDOW in B relative to A
  // Pick the smallest |shift| that yields RESYNC_RUN matches.
  let best = null;
  for (let shift = 0; shift <= RESYNC_WINDOW; shift++) {
    for (const sign of [+1, -1]) {
      const s = shift * sign;
      const aBase = aOff;
      const bBase = bOff + s;
      if (bBase < 0 || bBase + RESYNC_RUN > B.length) continue;
      if (aBase + RESYNC_RUN > A.length) continue;
      let ok = true;
      for (let k = 0; k < RESYNC_RUN; k++) {
        if (A[aBase + k] !== B[bBase + k]) { ok = false; break; }
      }
      if (ok) {
        best = { aOff: aBase, bOff: bBase, shift: s };
        return best;
      }
      if (shift === 0) break; // don't try +0 and -0
    }
  }
  return null;
}

const diffs = [];
let i = 0, j = 0;
let inDiff = false;
let diffStartA = 0, diffStartB = 0;

while (i < A.length && j < B.length) {
  if (A[i] === B[j]) {
    if (inDiff) {
      diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });
      if (diffs.length >= MAX_DIFFS) break;
      inDiff = false;
    }
    i++; j++;
  } else {
    if (!inDiff) {
      diffStartA = i; diffStartB = j;
      inDiff = true;
    }
    // Try to resync
    const r = findResync(i, j);
    if (r) {
      // close current diff at the resync point
      diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: r.aOff - diffStartA, lenB: r.bOff - diffStartB });
      if (diffs.length >= MAX_DIFFS) break;
      i = r.aOff;
      j = r.bOff;
      inDiff = false;
    } else {
      // No resync within window — advance both
      i++; j++;
    }
  }
}
if (inDiff) {
  diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });
}

console.log('\nTotal diff spans:', diffs.length);

// Step 2: cluster adjacent diffs (gap <= 32 bytes in A) into regions
const clusters = [];
let cur = null;
for (const d of diffs) {
  if (!cur) { cur = { aStart: d.aOff, aEnd: d.aOff + d.lenA, bStart: d.bOff, bEnd: d.bOff + d.lenB, spans: 1, totalA: d.lenA, totalB: d.lenB }; continue; }
  if (d.aOff - cur.aEnd <= 32) {
    cur.aEnd = d.aOff + d.lenA;
    cur.bEnd = d.bOff + d.lenB;
    cur.spans++;
    cur.totalA += d.lenA;
    cur.totalB += d.lenB;
  } else {
    clusters.push(cur);
    cur = { aStart: d.aOff, aEnd: d.aOff + d.lenA, bStart: d.bOff, bEnd: d.bOff + d.lenB, spans: 1, totalA: d.lenA, totalB: d.lenB };
  }
}
if (cur) clusters.push(cur);

console.log('Clusters (gap≤32):', clusters.length);

// Step 3: print clusters with size + position
const SECTIONS = [
  { name: 'header',         from: 0x000000, to: 0x004000 },
  { name: 'body+char_paths', from: 0x004000, to: 0x800000 },   // ~0..8 MB
  { name: 'tile-attr gap',  from: 0x800000, to: 0x1180000 },   // ~8..17.5 MB (9.8 MB)
  { name: 'settlement+factions', from: 0x1180000, to: 0x1814000 }, // ~17.5..25 MB
  { name: 'NPC ff-records tail', from: 0x1814000, to: 0x2300000 }, // ~25..35 MB
  { name: 'final tail',     from: 0x2300000, to: 0xFFFFFFFF },
];
function classify(off) {
  for (const s of SECTIONS) {
    if (off >= s.from && off < s.to) return s.name;
  }
  return '?';
}

console.log('\n=== Top 50 clusters by combined size ===');
const sorted = clusters.slice().sort((x,y) => (y.totalA + y.totalB) - (x.totalA + x.totalB));
const top = sorted.slice(0, 50);
for (const c of top) {
  const sec = classify(c.aStart);
  console.log(
    '  0x' + c.aStart.toString(16).padStart(8, '0') +
    '..0x' + c.aEnd.toString(16).padStart(8, '0') +
    '  spans=' + c.spans +
    '  lenA=' + c.totalA + ' lenB=' + c.totalB +
    '  sec=' + sec
  );
}

// Step 4: per-section histogram
const histA = {}, histB = {}, histClusters = {};
for (const c of clusters) {
  const sec = classify(c.aStart);
  histA[sec] = (histA[sec] || 0) + c.totalA;
  histB[sec] = (histB[sec] || 0) + c.totalB;
  histClusters[sec] = (histClusters[sec] || 0) + 1;
}
console.log('\n=== Per-section histogram ===');
for (const s of SECTIONS) {
  if (!(s.name in histClusters)) continue;
  console.log('  ' + s.name.padEnd(28) + ' clusters=' + histClusters[s.name] +
              '  A=' + (histA[s.name]||0) + 'B' +
              '  B=' + (histB[s.name]||0) + 'B');
}

// Step 5: smallest clusters by size (looking for the position bytes — should be tiny)
console.log('\n=== 30 smallest clusters (likely position + admin bytes) ===');
const small = clusters.slice().sort((x,y) => (x.totalA + x.totalB) - (y.totalA + y.totalB)).slice(0, 30);
for (const c of small) {
  const sec = classify(c.aStart);
  const a = A.subarray(c.aStart, c.aEnd);
  const b = B.subarray(c.bStart, c.bEnd);
  const ah = Array.from(a.subarray(0, 32)).map(x=>x.toString(16).padStart(2,'0')).join(' ');
  const bh = Array.from(b.subarray(0, 32)).map(x=>x.toString(16).padStart(2,'0')).join(' ');
  console.log(
    '  0x' + c.aStart.toString(16).padStart(8, '0') +
    ' sec=' + sec.padEnd(22) +
    ' lenA=' + c.totalA + ' lenB=' + c.totalB
  );
  console.log('    A: ' + ah);
  console.log('    B: ' + bh);
}

// Step 6: write a JSON output so future scripts can re-use
const out = {
  paths: { a: A_PATH, b: B_PATH },
  sizes: { a: A.length, b: B.length, delta: B.length - A.length },
  clusterCount: clusters.length,
  clusters: clusters.map(c => ({
    aStart: c.aStart, aEnd: c.aEnd, bStart: c.bStart, bEnd: c.bEnd,
    lenA: c.totalA, lenB: c.totalB, spans: c.spans, section: classify(c.aStart),
  })),
};
const OUT = path.join(__dirname, 'out-halo-move-clusters.json');
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('\nWrote', OUT);
