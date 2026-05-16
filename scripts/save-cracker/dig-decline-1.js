// Diff save_t2 (adoption accepted) vs save_t2declineadoption (adoption
// declined). Same End Turn played in both, differing only by the
// adoption decision made at t1. Δ size = -636 bytes (decline is smaller),
// so accepting adoption costs ~636 bytes over 1 turn of consequences.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t2declineadoption.sav');
const B = fs.readFileSync(BASE + 'save_t2.sav');

console.log('A (t2 decline):', A.length);
console.log('B (t2 accept ):', B.length);
console.log('Δ:             ', B.length - A.length, '(B is larger by', B.length - A.length, 'bytes — the cost of having Aulus as adopted heir)');

// Walking diff with 256-byte resync
const RESYNC_WINDOW = 256;
const RESYNC_RUN = 24;
const MAX_DIFFS = 50000;

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

// Cluster (gap ≤ 64)
const clusters = [];
let cur = null;
for (const d of diffs) {
  if (!cur || d.aOff - cur.aEnd > 64) {
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

console.log('Clusters (gap≤64):', clusters.length);

// Calculate REAL deltas (filtering bogus negative-lenB clusters from resync)
const realClusters = clusters.filter(c => c.totalA >= 0 && c.totalB >= 0);

// Top clusters by combined size
const sorted = realClusters.slice().sort((x, y) => (y.totalA + y.totalB) - (x.totalA + x.totalB));
console.log('\n=== Top 40 clusters by combined size ===');
for (let k = 0; k < 40 && k < sorted.length; k++) {
  const c = sorted[k];
  console.log('  #' + k + '  A:0x' + c.aStart.toString(16).padStart(8, '0') +
              '  spans=' + c.spans +
              '  lenA=' + c.totalA + ' lenB=' + c.totalB +
              '  Δ=' + (c.totalB - c.totalA));
}

// Search for "Aulus" in B
const aulusNeedle = Buffer.from([0x41, 0x00, 0x75, 0x00, 0x6c, 0x00, 0x75, 0x00, 0x73, 0x00]);
const aulusInA = [];
let p = 0;
while ((p = A.indexOf(aulusNeedle, p)) !== -1) { aulusInA.push(p); p++; }
const aulusInB = [];
p = 0;
while ((p = B.indexOf(aulusNeedle, p)) !== -1) { aulusInB.push(p); p++; }
console.log('\n=== "Aulus" UTF-16 occurrences ===');
console.log('In A (t2_declineadoption):', aulusInA.length, 'positions:', aulusInA.slice(0, 10).map(o => '0x' + o.toString(16)));
console.log('In B (t2_accept):         ', aulusInB.length, 'positions:', aulusInB.slice(0, 10).map(o => '0x' + o.toString(16)));

// Sanity-check key counters
console.log('\n=== Key counters ===');
function counters(buf, label) {
  console.log(label.padEnd(34) + '  turn=' + (buf.readUInt32LE(0x44e3) + 1) +
              '  year=' + buf.readInt32LE(0x44e7) +
              '  evtCtr@0x43f8=' + buf.readUInt32LE(0x43f8));
}
counters(A, 'A (t2_declineadoption)');
counters(B, 'B (t2)');

// Count paths in each
function countPaths(buf) {
  let n = 0;
  for (let p = 0xa9000; p + 12 < 0x800000 && p + 12 < buf.length; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 8) !== p + 8) continue;
    n++;
  }
  return n;
}
console.log('A paths:', countPaths(A));
console.log('B paths:', countPaths(B));
