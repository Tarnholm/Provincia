// Diff save_t1 vs save_t1adoption (the adoption event diff — only +248
// bytes between the two). Ground truth from message_log:
//   * Biggus Dickus (Dummies leader)  UUID = 0xa4dac540
//   * Aulus         (adopted heir)    UUID = 0x9eab92c0
//   * Event: Aulus adopted by Biggus Dickus into the Dummies family

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t1.sav');
const B = fs.readFileSync(BASE + 'save_t1adoption.sav');

console.log('A (t1)        :', A.length, 'bytes');
console.log('B (t1adoption):', B.length, 'bytes');
console.log('Δ:', B.length - A.length, 'bytes');

// Walking diff with resync
const MAX_DIFFS = 5000;
const RESYNC_WINDOW = 64;
const RESYNC_RUN = 16;

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

// Cluster (gap ≤ 32)
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

console.log('\nDiff spans:', diffs.length, '  Clusters (gap≤32):', clusters.length);

// Sort by combined size
const sorted = clusters.slice().sort((x, y) => (y.totalA + y.totalB) - (x.totalA + x.totalB));
console.log('\n=== All clusters sorted by size ===');
for (let k = 0; k < sorted.length; k++) {
  const c = sorted[k];
  console.log('  #' + k + '  0x' + c.aStart.toString(16).padStart(8, '0') +
              '..0x' + c.aEnd.toString(16).padStart(8, '0') +
              '  spans=' + c.spans +
              '  lenA=' + c.totalA + ' lenB=' + c.totalB +
              '  Δ=' + (c.totalB - c.totalA));
}

// For each cluster, dump bytes from A and B
console.log('\n=== Cluster contents (first 200 bytes shown) ===');
for (let k = 0; k < sorted.length; k++) {
  const c = sorted[k];
  console.log('\n--- Cluster #' + k + ' @ 0x' + c.aStart.toString(16) + ' ---');
  const aSize = Math.min(200, c.aEnd - c.aStart);
  const bSize = Math.min(200, c.bEnd - c.bStart);
  const aBytes = A.subarray(c.aStart, c.aStart + aSize);
  const bBytes = B.subarray(c.bStart, c.bStart + bSize);
  // Hex dump
  const dumpBytes = (buf, label) => {
    for (let o = 0; o < buf.length; o += 16) {
      const slice = buf.subarray(o, Math.min(o + 16, buf.length));
      const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
      const asc = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
      console.log('   ' + label + ' +' + o.toString(16).padStart(3, '0') + ': ' + hex.padEnd(48) + '  ' + asc);
    }
  };
  console.log('  A region (0x' + c.aStart.toString(16) + '..0x' + (c.aStart + aSize).toString(16) + ', lenA=' + c.totalA + '):');
  dumpBytes(aBytes, 'A');
  console.log('  B region (0x' + c.bStart.toString(16) + '..0x' + (c.bStart + bSize).toString(16) + ', lenB=' + c.totalB + '):');
  dumpBytes(bBytes, 'B');
}

// Check for known UUIDs in the diff regions
const AULUS = 0x9eab92c0;
const BIGGUS = 0xa4dac540;
console.log('\n=== Search for Aulus (0x9eab92c0) and Biggus (0xa4dac540) UUIDs ===');
function findUuid(buf, uuid) {
  const hits = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === uuid) hits.push(i);
  }
  return hits;
}
const aulusInA = findUuid(A, AULUS);
const aulusInB = findUuid(B, AULUS);
const bigInA = findUuid(A, BIGGUS);
const bigInB = findUuid(B, BIGGUS);
console.log('Aulus  (0x9eab92c0):  occurrences in A=' + aulusInA.length + ', B=' + aulusInB.length);
console.log('Biggus (0xa4dac540):  occurrences in A=' + bigInA.length + ', B=' + bigInB.length);

if (aulusInB.length > 0) {
  console.log('\nAulus appearances in B (first 10):');
  for (const o of aulusInB.slice(0, 10)) {
    const inCluster = sorted.find(c => o >= c.bStart - 32 && o < c.bEnd + 32);
    console.log('  0x' + o.toString(16) + (inCluster ? ' (in diff cluster!)' : ''));
  }
}
if (bigInB.length > 0) {
  console.log('\nBiggus appearances in B (first 10):');
  for (const o of bigInB.slice(0, 10)) {
    const inCluster = sorted.find(c => o >= c.bStart - 32 && o < c.bEnd + 32);
    console.log('  0x' + o.toString(16) + (inCluster ? ' (in diff cluster!)' : ''));
  }
}
