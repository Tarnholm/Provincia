// Diff save_t0justbeforeturnend vs save_t1 — the End Turn delta.
// File grew by 639,253 bytes. The diff captures every per-turn change:
// AI moves, journal events, treasury increments, year/turn advance,
// per-faction exploration grids, etc.
//
// Strategy: walking byte-diff with 256-byte resync window (wider than
// adoption diff because more content shifts). Cluster, classify, and
// surface the highest-signal changes.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t0justbeforeturnend.sav');
const B = fs.readFileSync(BASE + 'save_t1.sav');

console.log('A (t0_end):', A.length);
console.log('B (t1):   ', B.length);
console.log('Δ:        ', B.length - A.length, '(', ((B.length - A.length) / 1024).toFixed(1), 'KB)');

const MAX_DIFFS = 50000;
const RESYNC_WINDOW = 256;
const RESYNC_RUN = 24;

function findResync(aOff, bOff) {
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
      if (ok) return { aOff: aBase, bOff: bBase, shift: s };
      if (shift === 0) break;
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
    if (!inDiff) { diffStartA = i; diffStartB = j; inDiff = true; }
    const r = findResync(i, j);
    if (r) {
      diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: r.aOff - diffStartA, lenB: r.bOff - diffStartB });
      if (diffs.length >= MAX_DIFFS) break;
      i = r.aOff; j = r.bOff; inDiff = false;
    } else {
      i++; j++;
    }
  }
}
if (inDiff) diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });

console.log('\nDiff spans:', diffs.length);

// Cluster (gap ≤ 128)
const clusters = [];
let cur = null;
for (const d of diffs) {
  if (!cur || d.aOff - cur.aEnd > 128) {
    if (cur) clusters.push(cur);
    cur = { aStart: d.aOff, aEnd: d.aOff + d.lenA, bStart: d.bOff, bEnd: d.bOff + d.lenB, spans: 1, totalA: d.lenA, totalB: d.lenB };
  } else {
    cur.aEnd = d.aOff + d.lenA;
    cur.bEnd = d.bOff + d.lenB;
    cur.spans++;
    cur.totalA += d.lenA;
    cur.totalB += d.lenB;
  }
}
if (cur) clusters.push(cur);

console.log('Clusters (gap≤128):', clusters.length);

// Top 30 by combined size
const sorted = clusters.slice().sort((x, y) => (y.totalA + y.totalB) - (x.totalA + x.totalB));
console.log('\n=== Top 30 clusters by size ===');
for (let k = 0; k < 30 && k < sorted.length; k++) {
  const c = sorted[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16).padStart(8, '0') +
              '..0x' + c.aEnd.toString(16).padStart(8, '0') +
              '  spans=' + c.spans +
              '  lenA=' + c.totalA + ' lenB=' + c.totalB +
              '  Δ=' + (c.totalB - c.totalA));
}

// Categorize: per-zone summary
const ZONES = [
  ['header', 0x0, 0x4400],
  ['body (early)', 0x4400, 0x84000],
  ['scripted events', 0x84000, 0xa9000],
  ['CHARACTER_PATHS', 0xa9000, 0xf9000],
  ['zeros gap', 0xf9000, 0x800000],
  ['tile-attr static', 0x800000, 0xf80000],
  ['settlement-plans', 0xf80000, 0x1180000],
  ['settlement zone', 0x1180000, 0x14e0000],
  ['character/pos records', 0x14e0000, 0x1540000],
  ['major-faction records', 0x1540000, 0x17d0000],
  ['NPC ff-records', 0x17d0000, 0x2100000],
  ['JOURNAL section', 0x2100000, 0x2200000],
  ['final tail', 0x2200000, 0xffffffff],
];
function zoneOf(off) {
  for (const z of ZONES) if (off >= z[1] && off < z[2]) return z[0];
  return '?';
}
const perZone = new Map();
for (const c of clusters) {
  const z = zoneOf(c.aStart);
  const cur = perZone.get(z) || { clusters: 0, totalA: 0, totalB: 0 };
  cur.clusters++;
  cur.totalA += c.totalA;
  cur.totalB += c.totalB;
  perZone.set(z, cur);
}
console.log('\n=== Per-zone diff summary ===');
for (const z of ZONES) {
  const s = perZone.get(z[0]);
  if (!s) continue;
  console.log('  ' + z[0].padEnd(24) + ' clusters=' + String(s.clusters).padStart(5) +
              '  ΔA=' + String(s.totalA).padStart(8) + ' ΔB=' + String(s.totalB).padStart(8) +
              '  net=' + (s.totalB - s.totalA));
}

// Save the clusters to JSON
const path = require('path');
const out = {
  saveA: 'save_t0justbeforeturnend.sav', saveB: 'save_t1.sav',
  sizes: { a: A.length, b: B.length, delta: B.length - A.length },
  clusterCount: clusters.length, diffSpans: diffs.length,
  clusters: clusters.map(c => ({ aStart: c.aStart, aEnd: c.aEnd, bStart: c.bStart, bEnd: c.bEnd, totalA: c.totalA, totalB: c.totalB, spans: c.spans, zone: zoneOf(c.aStart) })),
};
fs.writeFileSync(path.join(__dirname, 'out-endturn-clusters.json'), JSON.stringify(out, null, 1));
console.log('\nWrote out-endturn-clusters.json');
