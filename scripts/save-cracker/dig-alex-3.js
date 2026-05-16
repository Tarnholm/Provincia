// Crack the +159 besiege-fort command record.
// The smallest atomic player-action diff. Find the exact bytes of the
// command record and verify it's actually 159 bytes contiguous.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const baseline = fs.readFileSync(BASE + 'save_17-05-2026   Macedon   Turn 1.sav');
const fort     = fs.readFileSync(BASE + 'save_17-05-2026   Macedon   Turn 1 besige fort.sav');

console.log('Baseline:', baseline.length, '  besiege fort:', fort.length, '  Δ:', fort.length - baseline.length);

// True alignment: scan from FRONT for first diff, from BACK for last diff.
// Everything between is the changed region.
let firstFrontDiff = -1;
for (let i = 0; i < Math.min(baseline.length, fort.length); i++) {
  if (baseline[i] !== fort[i]) { firstFrontDiff = i; break; }
}
console.log('First diff from front: 0x' + firstFrontDiff.toString(16));

let lastBackDiff = -1;
{
  let ai = baseline.length - 1;
  let bi = fort.length - 1;
  while (ai >= 0 && bi >= 0) {
    if (baseline[ai] !== fort[bi]) { lastBackDiff = bi; break; }
    ai--; bi--;
  }
}
console.log('Last diff from back: 0x' + lastBackDiff.toString(16), ' (in besiege_fort)');
console.log('Length of divergence region in besiege_fort:', lastBackDiff - firstFrontDiff + 1, 'bytes');
console.log('Length in baseline:', baseline.length - (fort.length - (lastBackDiff - firstFrontDiff + 1)) - firstFrontDiff, 'bytes');

// Now look for the smallest set of REAL changes vs alignment-shifts.
// Compare bytes at [firstFrontDiff..firstFrontDiff+200] of both saves.
console.log('\n=== First 256 bytes of divergence in each ===');
function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}
dump('A', baseline, firstFrontDiff, 256);
console.log('---');
dump('B', fort, firstFrontDiff, 256);

// Walk through and report exact mismatches and their byte offsets
console.log('\n=== Exact byte mismatches in divergence region ===');
let mismatches = 0;
let lastReported = -100;
for (let i = firstFrontDiff; i < Math.min(firstFrontDiff + 300, baseline.length, fort.length); i++) {
  if (baseline[i] !== fort[i]) {
    mismatches++;
    if (i - lastReported > 4) {
      // group start
      console.log('  diff cluster starting at 0x' + i.toString(16));
    }
    if (i - lastReported >= 1) {
      console.log('    0x' + i.toString(16) + ': A=0x' + baseline[i].toString(16).padStart(2, '0') + '  B=0x' + fort[i].toString(16).padStart(2, '0'));
    }
    lastReported = i;
    if (mismatches > 100) break;
  }
}
console.log('Mismatches in first 300 bytes:', mismatches);

// At the END of the divergence region, find where things re-align
// Show the LAST 100 bytes of divergence (just before re-alignment).
console.log('\n=== Last 200 bytes before re-alignment (in besiege_fort = B) ===');
dump('B', fort, lastBackDiff - 200, 200);

// Find ALL true-content clusters within the divergence range using a
// careful greedy-realign approach.
const clusters = [];
let aPtr = firstFrontDiff;
let bPtr = firstFrontDiff;
const SHIFT_MAX = 200;
const REALIGN_RUN = 32;

while (aPtr < baseline.length && bPtr < fort.length && bPtr <= lastBackDiff) {
  if (baseline[aPtr] === fort[bPtr]) {
    // try greedy match
    let matchLen = 0;
    while (aPtr + matchLen < baseline.length && bPtr + matchLen < fort.length &&
           baseline[aPtr + matchLen] === fort[bPtr + matchLen]) matchLen++;
    if (matchLen >= REALIGN_RUN) {
      aPtr += matchLen;
      bPtr += matchLen;
      continue;
    }
  }
  // mismatch — find the next REALIGN_RUN-long match
  const startA = aPtr;
  const startB = bPtr;
  let found = null;
  for (let shift = -SHIFT_MAX; shift <= SHIFT_MAX; shift++) {
    const aTry = aPtr + Math.max(0, -shift);
    const bTry = bPtr + Math.max(0, shift);
    if (aTry + REALIGN_RUN > baseline.length || bTry + REALIGN_RUN > fort.length) continue;
    let ok = true;
    for (let k = 0; k < REALIGN_RUN; k++) {
      if (baseline[aTry + k] !== fort[bTry + k]) { ok = false; break; }
    }
    if (ok) {
      // Skip self (zero-shift trivial match — would have been caught above)
      if (aTry > aPtr || bTry > bPtr) {
        found = { aTry, bTry, shift };
        break;
      }
    }
  }
  if (found) {
    clusters.push({
      aStart: startA, aEnd: found.aTry,
      bStart: startB, bEnd: found.bTry,
      lenA: found.aTry - startA, lenB: found.bTry - startB,
    });
    aPtr = found.aTry;
    bPtr = found.bTry;
  } else {
    break;
  }
}
console.log('\n=== True clusters (greedy realign) ===');
for (const c of clusters) {
  console.log('  A:0x' + c.aStart.toString(16) + '..0x' + c.aEnd.toString(16) +
              '  B:0x' + c.bStart.toString(16) + '..0x' + c.bEnd.toString(16) +
              '  lenA=' + c.lenA + ' lenB=' + c.lenB +
              '  Δ=' + (c.lenB - c.lenA));
}

// Total deltas
const totalΔA = clusters.reduce((s, c) => s + c.lenA, 0);
const totalΔB = clusters.reduce((s, c) => s + c.lenB, 0);
console.log('Total cluster bytes — A: ' + totalΔA + '  B: ' + totalΔB + '  net: ' + (totalΔB - totalΔA));
console.log('(Should match file size delta: +159)');
