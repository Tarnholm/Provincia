// THE big one: T4 Start (before war) → T4 attack Carthage (declaring war).
// Should isolate exactly where Spain↔Carthage diplomatic state changes
// in the save, finally cracking session 109's partner-faction puzzle.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const B = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav'));

console.log('A (T4 Start, peace):', A.length);
console.log('B (T4 attack Carthage, war declared):', B.length);
console.log('Δ:', B.length - A.length);

// Year field check
console.log('\nA year:', A.readInt32LE(0x514), '  B year:', B.readInt32LE(0x514));

// Front and back diff
let frontDiff = -1;
for (let i = 0; i < Math.min(A.length, B.length); i++) {
  if (A[i] !== B[i]) { frontDiff = i; break; }
}
let backDiff = -1;
let ai = A.length - 1, bi = B.length - 1;
while (ai >= 0 && bi >= 0) {
  if (A[ai] !== B[bi]) { backDiff = bi; break; }
  ai--; bi--;
}
console.log('First diff: 0x' + frontDiff.toString(16));
console.log('Last diff (in B): 0x' + backDiff.toString(16));
console.log('Divergence width in B: ' + (backDiff - frontDiff + 1) + ' bytes');

// Walking diff with resync to find true content clusters
const RESYNC_WINDOW = 128;
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
const MAX = 50000;
while (i < A.length && j < B.length) {
  if (A[i] === B[j]) {
    if (inDiff) { diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB }); inDiff = false; }
    i++; j++;
  } else {
    if (!inDiff) { diffStartA = i; diffStartB = j; inDiff = true; }
    const r = findResync(i, j);
    if (r) { diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: r.aOff - diffStartA, lenB: r.bOff - diffStartB }); i = r.aOff; j = r.bOff; inDiff = false; }
    else { i++; j++; }
    if (diffs.length > MAX) break;
  }
}
if (inDiff) diffs.push({ aOff: diffStartA, bOff: diffStartB, lenA: i - diffStartA, lenB: j - diffStartB });

// Cluster
const clusters = [];
let cur = null;
for (const d of diffs) {
  if (!cur || d.aOff - cur.aEnd > 64) {
    if (cur) clusters.push(cur);
    cur = { aStart: d.aOff, aEnd: d.aOff + d.lenA, bStart: d.bOff, bEnd: d.bOff + d.lenB, totalA: d.lenA, totalB: d.lenB, spans: 1 };
  } else {
    cur.aEnd = d.aOff + d.lenA;
    cur.bEnd = d.bOff + d.lenB;
    cur.totalA += d.lenA; cur.totalB += d.lenB; cur.spans++;
  }
}
if (cur) clusters.push(cur);

console.log('\nDiff clusters:', clusters.length);
console.log('Top 25 by size:');
const sorted = clusters.slice().sort((a, b) => (b.totalA + b.totalB) - (a.totalA + a.totalB));
for (let k = 0; k < 25 && k < sorted.length; k++) {
  const c = sorted[k];
  console.log('  #' + k + '  A:0x' + c.aStart.toString(16).padStart(7, '0') + '  spans=' + c.spans + '  lenA=' + c.totalA + ' lenB=' + c.totalB + '  Δ=' + (c.totalB - c.totalA));
}

// Search for "Carthage" UTF-16 in both
function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}
console.log('\n"Carthage" UTF-16:');
console.log('  A:', findUtf16(A, 'Carthage').slice(0, 5).map(o => '0x' + o.toString(16)));
console.log('  B:', findUtf16(B, 'Carthage').slice(0, 5).map(o => '0x' + o.toString(16)));
console.log('\n"War" UTF-16:');
console.log('  A:', findUtf16(A, 'War').length);
console.log('  B:', findUtf16(B, 'War').length);

// Look for "carthage" ASCII (the faction tag)
let p = 0;
const carthAscA = [], carthAscB = [];
while ((p = A.indexOf(Buffer.from('carthage'), p)) !== -1) { carthAscA.push(p); p++; }
p = 0;
while ((p = B.indexOf(Buffer.from('carthage'), p)) !== -1) { carthAscB.push(p); p++; }
console.log('\n"carthage" ASCII:');
console.log('  A:', carthAscA.length, 'positions');
console.log('  B:', carthAscB.length, 'positions');

// Look for "spain" ASCII (player faction tag) — should still appear in both
let q = 0;
const spainA = [], spainB = [];
while ((q = A.indexOf(Buffer.from('spain'), q)) !== -1) { spainA.push(q); q++; }
q = 0;
while ((q = B.indexOf(Buffer.from('spain'), q)) !== -1) { spainB.push(q); q++; }
console.log('\n"spain" ASCII: A=' + spainA.length + ' B=' + spainB.length);

// Dump first cluster context
if (sorted.length > 0) {
  const c = sorted[0];
  console.log('\n=== Top cluster context (B side, 200 bytes from start) ===');
  for (let o = c.bStart; o < c.bStart + 200 && o < B.length; o += 16) {
    const slice = B.subarray(o, Math.min(o + 16, c.bStart + 200, B.length));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}
